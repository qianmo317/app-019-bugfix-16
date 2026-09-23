// 切割清单：步骤完整性、尺寸与图纸/参数同源、留线与下锯顺序、注意事项（缺陷回归）
import { describe, it, expect } from 'vitest'
import { computeJoint } from '../../src/lib/calc'
import { buildCutList } from '../../src/lib/cutlist'
import { fmtDrawing, fmt01 } from '../../src/lib/format'
import type { Joint, JointKind } from '../../src/types'

function makeJoint(kind: JointKind, over: Partial<Joint['params']> = {}): Joint {
  return {
    kind,
    params: {
      boardA: { thickness: 20, width: 240 },
      boardB: { thickness: 18, width: 240 },
      wood: 'hardwood',
      fit: 'tight',
      dovetail: { angleRatio: 8 },
      tenon: { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 },
      kerfMm: 1.1,
      ...over,
    },
    notes: [],
  }
}

const joined = (ss: { action: string; detail: string }[]) => ss.map((s) => `${s.action} ${s.detail}`).join('\n')

describe('燕尾：齿板步骤完整（不得从画齿顶线跳到去料）', () => {
  for (const kind of ['dovetail', 'half-blind-dovetail'] as JointKind[]) {
    it(`${kind}: 画基准→齿顶线→齿根线→先锯两端半齿→中间齿→去料`, () => {
      const r = computeJoint(makeJoint(kind))
      const cut = buildCutList(makeJoint(kind), r)
      const actions = cut.boardA.map((s) => s.action)
      expect(actions).toEqual(['画基准', '画齿顶线', '画齿根线', '锯两端半齿', '锯中间各齿', '去料修底'])
      // 半齿那一步必须先于中间齿，且写清留线量（kerf/2 = 0.6mm @ kerf 1.1）
      const half = cut.boardA.find((s) => s.action === '锯两端半齿')!
      expect(half.no).toBeLessThan(cut.boardA.find((s) => s.action === '锯中间各齿')!.no)
      expect(half.detail).toContain('0.6mm')
      expect(half.detail).toContain('留线')
      // 齿根线步骤必须写出与图纸一致的斜度与斜移量
      expect(joined(cut.boardA)).toContain('斜度 1:8')
      expect(joined(cut.boardA)).toContain(`斜移 ${fmtDrawing(r.dovetail!.slopeOffset)}`)
      // 齿深、边距与计算结果一致（图纸 0.5 步进）
      expect(joined(cut.boardA)).toContain(`深 ${fmtDrawing(r.dovetail!.depth)}mm`)
      expect(joined(cut.boardA)).toContain(`边距 ${fmtDrawing(r.dovetail!.margin)}mm`)
    })
  }

  it('穿透燕尾：销板含清底/试装，先锯废料侧、留线', () => {
    const j = makeJoint('dovetail')
    const cut = buildCutList(j, computeJoint(j))
    const text = joined(cut.boardB)
    expect(cut.boardB.length).toBe(5)
    expect(text).toContain('先锯废料侧')
    expect(text).toContain('销侧留线')
    expect(cut.boardB.some((s) => s.action.includes('清底'))).toBe(true)
  })

  it('半隐燕尾：销板以凿代锯，仍有留线与清底', () => {
    const j = makeJoint('half-blind-dovetail')
    const cut = buildCutList(j, computeJoint(j))
    const text = joined(cut.boardB)
    expect(cut.boardB.length).toBe(5)
    expect(cut.boardB.some((s) => s.action === '剔两端半销')).toBe(true)
    expect(text).toContain('边线留线')
    expect(cut.boardB.some((s) => s.action.includes('清底'))).toBe(true)
  })

  it('半隐：销板只凿不锯穿，槽深 = 0.75 板厚', () => {
    const j = makeJoint('half-blind-dovetail')
    const cut = buildCutList(j, computeJoint(j))
    expect(joined(cut.boardB)).toContain('不得凿穿')
    expect(cut.cautions.some((c) => c.includes('只凿不锯穿'))).toBe(true)
    expect(joined(cut.boardB)).toContain('15mm') // 0.75 × 20
  })
})

describe('直榫：清单尺寸与图纸标注同源（旧清单榫厚写名义值装不进）', () => {
  it('硬木紧配：榫头/榫眼都写含配合榫厚，不再只写名义值', () => {
    const j = makeJoint('mortise-tenon', {
      boardA: { thickness: 20, width: 120 },
      boardB: { thickness: 18, width: 120 },
      fit: 'tight',
    })
    const r = computeJoint(j)
    const tn = r.tenon!
    expect(tn.nominalThickness).toBe(6.7)
    expect(tn.tenonThickness).toBe(6.9)
    const cut = buildCutList(j, r)
    const all = joined(cut.boardA) + '\n' + joined(cut.boardB)
    // 含配合榫厚（图纸 0.5 步进，与侧/正视图标注一致）必须出现在榫头线与榫眼线
    expect(all).toContain(`榫厚 ${fmtDrawing(tn.tenonThickness)}mm`)
    expect(all).toContain(`眼厚 ${fmtDrawing(tn.tenonThickness)}mm`)
    // 名义值与配合余量按 0.1 精度说明，不得把名义值当成加工尺寸
    expect(all).toContain(`名义 ${fmt01(tn.nominalThickness)}mm`)
    expect(all).toContain('余量 +0.2mm')
    // 眼宽 = 图纸榫宽，腹边距、肩宽与结果一致
    expect(all).toContain(`眼宽 ${fmtDrawing(tn.tenonWidth)}`)
    expect(all).toContain(`两侧肩宽各 ${fmtDrawing(tn.shoulder)}`)
    expect(all).toContain(`腹边距 ${fmtDrawing(tn.offsetFromFace)}`)
  })

  it('软木松配：含配合榫厚（名义 6.0 −0.4），盲榫眼深 = 榫长不打穿', () => {
    const j = makeJoint('mortise-tenon', {
      boardA: { thickness: 18, width: 120 },
      boardB: { thickness: 18, width: 120 },
      wood: 'softwood',
      fit: 'loose',
      tenon: { thicknessRatio: 1 / 3, lengthRatio: 0.6, offsetFromFace: 0 },
    })
    const r = computeJoint(j)
    expect(r.tenon!.tenonThickness).toBe(5.6)
    const cut = buildCutList(j, r)
    const all = joined(cut.boardA) + '\n' + joined(cut.boardB)
    expect(all).toContain(`榫厚 ${fmtDrawing(r.tenon!.tenonThickness)}mm`)
    expect(all).toContain(`眼厚 ${fmtDrawing(r.tenon!.tenonThickness)}mm`)
    expect(all).toContain('名义 6.0mm')
    expect(all).toContain('余量 −0.4mm')
    expect(all).toContain(`盲榫眼深 ${fmtDrawing(r.tenon!.mortiseDepth)}mm`)
    expect(all).toContain('不打穿')
  })

  it('A/B 两件都补了画基准与清底步骤', () => {
    const j = makeJoint('mortise-tenon')
    const cut = buildCutList(j, computeJoint(j))
    expect(cut.boardA.map((s) => s.action)).toEqual(['画基准', '画榫头线', '锯榫侧', '清底倒棱'])
    expect(cut.boardB.map((s) => s.action)).toEqual([
      '画基准',
      '画榫眼线',
      '凿/钻榫眼',
      '清底修壁',
      '试装',
    ])
  })

  it('穿透眼深写成「钻通板厚 + 加深 1mm」，并交代衬废板', () => {
    const j = makeJoint('mortise-tenon')
    const r = computeJoint(j)
    const cut = buildCutList(j, r)
    const text = joined(cut.boardB)
    expect(text).toContain(
      `眼钻通 ${fmtDrawing(r.tenon!.tenonLength)}mm 板厚，实际打 ${fmtDrawing(r.tenon!.mortiseDepth)}mm`,
    )
    expect(text).toContain('衬废木板')
    expect(cut.cautions.some((c) => c.includes('内收 0.6mm'))).toBe(true)
  })
})

describe('圆木榫：木榫蘸胶；尺寸与图纸一致', () => {
  it('注意事项含木榫周身蘸胶 + 1mm 排胶；孔径/深/数量来自计算', () => {
    const j = makeJoint('dowel')
    const r = computeJoint(j)
    const dw = r.dowel!
    const cut = buildCutList(j, r)
    expect(cut.cautions.some((c) => c.includes('木榫') && c.includes('蘸胶'))).toBe(true)
    const text = joined(cut.boardA)
    expect(text).toContain(`Ø${dw.dowelDia}`)
    expect(text).toContain(`孔深 ${fmtDrawing(dw.holeDepth)}`)
    expect(text).toContain(`共 ${dw.count} 个孔`)
    expect(text).toContain(`端距 ${fmtDrawing(dw.positions[0]!)}`)
  })
})

describe('拼板：交替翻转纹理；饼干榫号/槽深与图纸一致', () => {
  it('注意事项含交替翻转年轮（纹理）与饼干榫涂胶', () => {
    const j = makeJoint('panel-glue')
    const r = computeJoint(j)
    const pn = r.panel!
    const cut = buildCutList(j, r)
    expect(cut.cautions.some((c) => c.includes('交替翻转') && c.includes('纹理'))).toBe(true)
    expect(cut.cautions.some((c) => c.includes('饼干榫') && c.includes('涂胶'))).toBe(true)
    const text = joined(cut.boardA)
    expect(text).toContain(`#${pn.biscuitSize}`)
    expect(text).toContain(`槽深 ${fmtDrawing(pn.slotDepth)}`)
    expect(text).toContain(`共 ${pn.count} 个`)
    expect(text).toContain(`6×${fmtDrawing(pn.grooveDepth)}`)
  })
})

describe('搭接：切深/搭接长来自当前参数与配合；锯路文案不谎称画了锯切线', () => {
  it('紧配切深 9.8（=10−0.2），文案与视图标注数值一致', () => {
    const j = makeJoint('lap', { fit: 'tight' })
    const r = computeJoint(j)
    expect(r.lap!.depthEach).toBe(9.8)
    const cut = buildCutList(j, r)
    const text = joined(cut.boardA)
    expect(text).toContain('切深 10mm') // fmtDrawing 0.5 步进，与图纸「切深 10」一致
    expect(text).toContain('紧配少切 0.2mm')
    expect(text).toContain('搭接长 240mm')
    expect(text).toContain('剔槽清底')
    expect(cut.cautions.some((c) => c.includes('槽底') && c.includes('基准面平行'))).toBe(true)
  })

  it('无 saw 线的三类（lap/dowel/panel）注意事项明示「不画锯切线」', () => {
    for (const kind of ['lap', 'dowel', 'panel-glue'] as JointKind[]) {
      const j = makeJoint(kind)
      const cut = buildCutList(j, computeJoint(j))
      expect(cut.cautions[0]).toContain('不画锯切线')
      expect(cut.cautions[0]).toContain('1.1mm')
    }
  })

  it('燕尾/直榫注意事项保留「理论线+锯切线」表述', () => {
    for (const kind of ['dovetail', 'half-blind-dovetail', 'mortise-tenon'] as JointKind[]) {
      const j = makeJoint(kind)
      const cut = buildCutList(j, computeJoint(j))
      expect(cut.cautions[0]).toContain('理论线')
      expect(cut.cautions[0]).toContain('锯切线')
      expect(cut.cautions[0]).toContain('偏 0.6mm')
      expect(cut.cautions.some((c) => c.includes('先在废料上试锯'))).toBe(true)
    }
  })
})

describe('通用契约：步骤号有序、A/B 非空、注意事项 ≥2', () => {
  const kinds: JointKind[] = [
    'dovetail',
    'half-blind-dovetail',
    'mortise-tenon',
    'dowel',
    'lap',
    'panel-glue',
  ]
  for (const kind of kinds) {
    it(`${kind}: A 3~7 步、B 1~5 步，序号连续从 1 开始`, () => {
      const j = makeJoint(kind)
      const cut = buildCutList(j, computeJoint(j))
      expect(cut.boardA.length).toBeGreaterThanOrEqual(3)
      expect(cut.boardA.length).toBeLessThanOrEqual(7)
      expect(cut.boardB.length).toBeGreaterThanOrEqual(1)
      expect(cut.boardB.length).toBeLessThanOrEqual(5)
      for (const ss of [cut.boardA, cut.boardB]) {
        expect(ss.map((s) => s.no)).toEqual(ss.map((_, i) => i + 1))
      }
      expect(cut.cautions.length).toBeGreaterThanOrEqual(2)
    })
  }
})
