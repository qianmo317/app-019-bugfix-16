// 三视图一致性（蓝图 §10：正视图宽度 = 俯视图宽度）+ 锯路补偿 + 切割清单
import { describe, it, expect } from 'vitest'
import { computeJoint } from '../../src/lib/calc'
import { buildViews } from '../../src/geometry/views'
import { buildCutList } from '../../src/lib/cutlist'
import type { Joint, JointKind } from '../../src/types'

const JOINTS: JointKind[] = ['dovetail', 'half-blind-dovetail', 'mortise-tenon', 'dowel', 'lap', 'panel-glue']

function makeJoint(kind: JointKind): Joint {
  return {
    kind,
    params: {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      tenon: { thicknessRatio: 1 / 3, lengthRatio: 1, offsetFromFace: 0 },
      kerfMm: 1.1,
    },
    notes: [],
  }
}

describe('三视图一致性（断言：正视图宽 = 俯视图宽）', () => {
  for (const kind of JOINTS) {
    it(`${kind}: front.contentW === top.contentW`, () => {
      const joint = makeJoint(kind)
      const r = computeJoint(joint)
      const views = buildViews(joint, r)
      expect(views).toHaveLength(3)
      const front = views.find((v) => v.id === 'front')!
      const top = views.find((v) => v.id === 'top')!
      const side = views.find((v) => v.id === 'side')!
      expect(front.contentW).toBe(top.contentW)
      expect(side).toBeTruthy()
      // 视图内几何不得越界（局部坐标 −40~content+60 之外不允许）
      for (const v of views) {
        for (const l of v.lines) {
          expect(l.x1).toBeGreaterThanOrEqual(-40)
          expect(l.y1).toBeGreaterThanOrEqual(-40)
          expect(l.x2).toBeLessThanOrEqual(v.contentW + 60)
          expect(l.y2).toBeLessThanOrEqual(v.contentH + 60)
        }
      }
    })
  }

  it('燕尾：锯切线数量 = 2×齿数（每齿两侧 kerf 补偿线）', () => {
    const joint = makeJoint('dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const front = views.find((v) => v.id === 'front')!
    const sawCount = front.lines.filter((l) => l.cls === 'saw').length
    expect(sawCount).toBe(r.dovetail!.teeth.length * 2)
  })

  it('燕尾：齿序编号覆盖每个齿', () => {
    const joint = makeJoint('dovetail')
    const r = computeJoint(joint)
    const views = buildViews(joint, r)
    const front = views.find((v) => v.id === 'front')!
    expect(front.marks.map((m) => m.text)).toEqual(r.dovetail!.teeth.map((t) => String(t.index)))
  })
})

describe('切割清单', () => {
  for (const kind of JOINTS) {
    it(`${kind}: A/B 两件步骤非空且有序`, () => {
      const joint = makeJoint(kind)
      const r = computeJoint(joint)
      const cut = buildCutList(joint, r)
      expect(cut.boardA.length).toBeGreaterThan(0)
      expect(cut.boardB.length).toBeGreaterThan(0)
      expect(cut.boardA.map((s) => s.no)).toEqual(cut.boardA.map((s) => s.no).sort((a, b) => a - b))
      expect(cut.cautions.length).toBeGreaterThanOrEqual(2)
      expect(cut.cautions.some((c) => c.includes('锯路'))).toBe(true)
      expect(cut.cautions.some((c) => c.includes('锯切线'))).toBe(true)
    })
  }
})

describe('切割清单：步骤与图纸/参数对得上（缺失步骤回归）', () => {
  it('燕尾：齿根线与两端半齿必须在去料之前', () => {
    const joint = makeJoint('dovetail')
    const cut = buildCutList(joint, computeJoint(joint))
    const a = cut.boardA.map((s) => s.action)
    expect(a).toContain('画齿根线')
    expect(a).toContain('锯两端半齿')
    expect(a.indexOf('画齿顶线')).toBeLessThan(a.indexOf('画齿根线'))
    expect(a.indexOf('画齿根线')).toBeLessThan(a.indexOf('锯两端半齿'))
    expect(a.indexOf('锯两端半齿')).toBeLessThan(a.indexOf('锯齿间废料'))
    // 两端半齿防裂 + 留线写清
    expect(cut.cautions.some((c) => c.includes('两端半齿先锯') && c.includes('留线'))).toBe(true)
    // 尺寸来自当前 DovetailResult
    const r = computeJoint(joint)
    expect(cut.boardA[0]!.detail).toContain(fmt(r.dovetail!.depth))
    expect(cut.boardA[1]!.detail).toContain(fmt(r.dovetail!.teeth[0]!.topW))
  })

  it('半隐燕尾：齿板注明 0.75 板深不凿穿展示面，销板先锯后剔', () => {
    const joint = makeJoint('half-blind-dovetail')
    const cut = buildCutList(joint, computeJoint(joint))
    expect(cut.boardA.map((s) => s.action)).toEqual([
      '画基准', '画齿顶线', '画齿根线', '锯两端半齿', '锯齿间废料', '剔料清底',
    ])
    expect(cut.cautions.some((c) => c.includes('半隐') && c.includes('不穿透'))).toBe(true)
    expect(cut.boardB.map((s) => s.action)).toEqual(['过线', '画槽深线', '锯槽帮', '剔槽清底', '干试装'])
  })

  it('直榫：榫厚写含配合值，眼宽按名义内收，且含画基准与清底两步', () => {
    const joint = makeJoint('mortise-tenon')
    const r = computeJoint(joint)
    const tn = r.tenon!
    const cut = buildCutList(joint, r)
    // A 榫头：含配合的实际榫厚（标准配合 == 名义 6.0mm@18mm）
    expect(cut.boardA[1]!.detail).toContain(`榫厚 ${fmt(tn.tenonThickness)}mm`)
    expect(cut.boardA[0]!.action).toBe('画基准')
    // B 榫眼：宽度 = tenonWidth（不是名义榫厚），厚度按名义并内收 kerf/2
    expect(cut.boardB[0]!.detail).toContain(`眼宽 ${fmt(tn.tenonWidth)}mm`)
    expect(cut.boardB[0]!.detail).toContain(`名义 ${fmt(tn.nominalThickness)}mm`)
    expect(cut.boardB[0]!.detail).toContain(fmt(tn.mortiseSawOffset))
    expect(cut.boardB.map((s) => s.action)).toContain('清底修壁')
    // 穿透眼深 = 板厚 + 1
    expect(cut.boardB[1]!.detail).toContain(fmt(tn.mortiseDepth))
    expect(tn.mortiseDepth).toBe(joint.params.boardB.thickness + 1)
  })

  it('直榫紧配：清单体现过盈量，松配榫头小于名义', () => {
    const tight = makeJoint('mortise-tenon')
    tight.params = { ...tight.params, fit: 'tight' }
    const cutT = buildCutList(tight, computeJoint(tight))
    const tnT = computeJoint(tight).tenon!
    expect(tnT.tenonThickness).toBeGreaterThan(tnT.nominalThickness)
    expect(cutT.boardA[1]!.detail).toContain(`榫厚 ${fmt(tnT.tenonThickness)}mm`)
    expect(cutT.cautions.some((c) => c.includes('过盈'))).toBe(true)

    const loose = makeJoint('mortise-tenon')
    loose.params = { ...loose.params, fit: 'loose' }
    const cutL = buildCutList(loose, computeJoint(loose))
    const tnL = computeJoint(loose).tenon!
    expect(cutL.boardA[1]!.detail).toContain(`榫厚 ${fmt(tnL.tenonThickness)}mm`)
    expect(tnL.tenonThickness).toBeLessThan(tnL.nominalThickness)
  })

  it('圆木榫：注意事项写明木榫蘸胶，尺寸与 computeDowel 一致', () => {
    const joint = makeJoint('dowel')
    const r = computeJoint(joint)
    const cut = buildCutList(joint, r)
    expect(cut.cautions.some((c) => c.includes('木榫') && c.includes('蘸胶'))).toBe(true)
    expect(cut.boardA[1]!.detail).toContain(`Ø${fmt(r.dowel!.dowelDia)} × ${fmt(r.dowel!.dowelLength)}`)
    expect(cut.boardA[1]!.detail).toContain(`孔深 ${fmt(r.dowel!.holeDepth)}`)
    // 圆木榫视图不画锯切线 → 注意事项不得声称「沿锯切线下锯」
    expect(cut.cautions[0]).toContain('不画锯切线')
  })

  it('拼板：注意事项写明交替翻转年轮纹理', () => {
    const joint = makeJoint('panel-glue')
    const r = computeJoint(joint)
    const cut = buildCutList(joint, r)
    expect(cut.cautions.some((c) => c.includes('交替翻转') && c.includes('纹理'))).toBe(true)
    expect(cut.boardA[2]!.detail).toContain(`槽深 ${fmt(r.panel!.slotDepth)}`)
    expect(cut.boardA[1]!.detail).toContain(`#${r.panel!.biscuitSize}`)
  })

  it('搭接：切深与配合让刀随参数变', () => {
    const joint = makeJoint('lap')
    const r = computeJoint(joint)
    const cut = buildCutList(joint, r)
    expect(cut.boardA[0]!.detail).toContain(`切深 ${fmt(r.lap!.depthEach)}mm`)
    expect(cut.boardB[0]!.detail).toContain(`${fmt(r.lap!.depthEach)}mm`)
  })

  it('无对应计算结果时回退空 A 步骤而不抛错（燕尾）/ 拼板用兜底文案', () => {
    const cutDt = buildCutList(makeJoint('dovetail'), undefined)
    expect(cutDt.boardA).toEqual([])
    expect(cutDt.boardB.length).toBeGreaterThan(0)
    const cutPn = buildCutList(makeJoint('panel-glue'), undefined)
    expect(cutPn.boardA.length).toBeGreaterThan(0)
  })
})

function fmt(x: number): string {
  // 与图纸/清单相同的 0.5mm 标注格式
  const v = Math.round(x * 2) / 2
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
