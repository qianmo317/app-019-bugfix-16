// 切割清单：按榫卯类型生成锯切步骤顺序与注意事项（先锯哪条线、哪里留线）
// 所有尺寸与三视图标注同源（fmtDrawing = 图纸 0.5mm 步进标注），参数变了清单跟着变。
import type { Joint } from '../types'
import type { JointResult } from './calc'
import { fmtDrawing, fmt01 } from './format'

export interface CutStep {
  no: number
  action: string
  detail: string
}

export interface CutList {
  boardA: CutStep[]
  boardB: CutStep[]
  cautions: string[]
}

// 图纸画锯切线（虚线）的类型：燕尾两种 + 直榫；搭接/圆木榫/拼板为凿、钻、刨加工，不画锯切线
const SAW_LINE_KINDS = new Set(['dovetail', 'half-blind-dovetail', 'mortise-tenon'])

export function buildCutList(joint: Joint, r?: JointResult): CutList {
  const { kind } = joint
  const kerf = joint.params.kerfMm
  const hasSawLine = SAW_LINE_KINDS.has(kind)
  const kerfRule = hasSawLine
    ? `锯路宽度 ${fmtDrawing(kerf)}mm：实线为理论线、虚线为锯切线（理论线向废料侧偏移 ${fmtDrawing(kerf / 2)}mm），沿锯切线先锯废料侧，理论线留在工件上（留线修配）`
    : `锯路宽度 ${fmtDrawing(kerf)}mm：本类型三视图不画锯切线（以凿、钻、刨为主）；凡需锯切处，手工向废料侧让 ${fmtDrawing(kerf / 2)}mm 下锯，线留在工件上修配`

  const cautions: string[] = [
    kerfRule,
    '先在废料上试锯校准深度与角度，再上工件',
  ]

  if (kind === 'dovetail' || kind === 'half-blind-dovetail') {
    const dt = r?.dovetail
    const blind = kind === 'half-blind-dovetail'
    const steps: CutStep[] = dt
      ? [
          {
            no: 1,
            action: '画基准',
            detail: `选好展示面与基准边，划线器按齿深 ${fmtDrawing(dt.depth)}mm（${blind ? '0.75×板厚，半隐' : '板厚，穿透'}）四面画出齿深线`,
          },
          {
            no: 2,
            action: '画齿顶线',
            detail: `按齿宽表在展示面画各齿两侧线（首齿齿顶宽 ${fmtDrawing(dt.teeth[0]?.topW ?? 0)}mm，斜度 1:${joint.params.dovetail?.angleRatio ?? 8}），两端半齿边距 ${fmtDrawing(dt.margin)}mm 左右对称，共 ${dt.teeth.length} 齿`,
          },
          {
            no: 3,
            action: '画齿根线',
            detail: `把齿顶线过到背面：背面齿根宽 = 齿顶宽 − 2×斜移量（2×${fmtDrawing(dt.slopeOffset)} = ${fmtDrawing(2 * dt.slopeOffset)}mm），角尺连出齿根线并与齿宽表核对`,
          },
          {
            no: 4,
            action: '锯两端半齿',
            detail: '先锯两端半齿的外侧锯切线：端部木纹悬空最易劈裂，必须最先下锯；锯片走锯切线，理论线留在齿上（留线）',
          },
          {
            no: 5,
            action: '锯齿间废料',
            detail: '再逐齿锯齿间两侧锯切线，先锯废料侧、后锯靠齿侧，全程留线不锯进齿体',
          },
          {
            no: 6,
            action: '剔料清底',
            detail: `凿子自废料中部向两端剔除，凿平至齿深线 ${fmtDrawing(dt.depth)}mm${blind ? '；半隐槽只从背面开凿，不得凿穿展示面' : ''}，误差 ≤0.2mm`,
          },
        ]
      : []
    const tailCautions = [
      ...cautions,
      `两端半齿先锯、齿间后锯，防止端部先裂；下锯走锯切线（向废料侧让 ${fmtDrawing(kerf / 2)}mm），齿体一律留线，干装后再修配`,
    ]
    if (blind && dt) {
      tailCautions.push(`半隐销板只从端面开槽、深 ${fmtDrawing(dt.depth)}mm，正面不穿透；槽底要凿平`)
    }
    return { boardA: steps, boardB: pinBoardSteps(dt, blind, joint.params.boardB.thickness), cautions: tailCautions }
  }

  if (kind === 'mortise-tenon' && r?.tenon) {
    const tn = r.tenon
    const p = joint.params
    const tB = p.boardB.thickness
    const tw = fmtDrawing(tn.tenonWidth)
    const tt = fmtDrawing(tn.tenonThickness)
    const nt = fmtDrawing(tn.nominalThickness)
    const delta = tn.tenonThickness - tn.nominalThickness
    const fitText =
      delta === 0
        ? `榫厚 ${tt}mm（名义 ${nt}mm，${p.fit === 'tight' ? '紧' : p.fit === 'loose' ? '松' : '标准'}配合，余量 0）`
        : `榫厚 ${tt}mm（名义 ${nt}mm${delta > 0 ? '＋' : '−'}${fmt01(Math.abs(delta))} 配合余量）`
    const mx = fmtDrawing((p.boardB.width - tn.tenonWidth) / 2)
    const through = (p.tenon?.lengthRatio ?? 1) >= 1
    return {
      boardA: [
        {
          no: 1,
          action: '画基准',
          detail: `选好腹板面（基准面），从榫舌端量榫长 ${fmtDrawing(tn.tenonLength)}mm 四面过榫肩线；按腹边距 ${fmtDrawing(tn.offsetFromFace)}mm 在厚度方向定位`,
        },
        {
          no: 2,
          action: '画榫头线',
          detail: `${fitText}、榫宽 ${tw}mm，两侧肩宽各 ${fmtDrawing(tn.shoulder)}mm；与图纸侧视/俯视图逐项核对后再下锯`,
        },
        {
          no: 3,
          action: '锯榫侧',
          detail: '先锯厚度方向两条榫侧线（沿锯切线、留线），再锯两侧榫肩；锯片让在废料侧，肩线不得锯过',
        },
        {
          no: 4,
          action: '修肩倒棱',
          detail: '凿修榫肩使四面平齐，肩面留线最后刨修；榫头四角倒棱 1mm 便于入眼',
        },
      ],
      boardB: [
        {
          no: 1,
          action: '画基准',
          detail: `以同一腹板面为基准定位：眼宽 ${tw}mm（水平方向，边距各 ${mx}mm）、眼厚按名义 ${nt}mm，锯切线内收 ${fmtDrawing(tn.mortiseSawOffset)}mm 让刀`,
        },
        {
          no: 2,
          action: '画榫眼线',
          detail: through
            ? `穿透榫：眼深 ${fmtDrawing(tn.mortiseDepth)}mm（孔板厚 ${fmtDrawing(tB)}＋1mm，眼底加深防胶顶底）`
            : `盲榫：眼深 ${fmtDrawing(tn.mortiseDepth)}mm（＝榫长），眼底不凿穿`,
        },
        {
          no: 3,
          action: '凿/钻榫眼',
          detail: '两端留线、中间先镂空：排钻或凿去中部废料，两端只修到线内 0.5mm，背面垫废板防崩边',
        },
        {
          no: 4,
          action: '清底修壁',
          detail: '凿平眼底、修直四壁至名义尺寸，清净木屑后试榫：榫头能落到底、肩面无缝；过紧只修眼壁不动榫肩',
        },
      ],
      cautions: [
        ...cautions,
        `榫眼按名义榫厚 ${nt}mm 凿（锯切线内收 ${fmtDrawing(tn.mortiseSawOffset)}mm 保住名义尺寸），榫头按含配合的 ${tt}mm 锯${delta > 0 ? '，紧配过盈需木锤敲入' : ''}`,
        through
          ? `穿透榫眼深做到 ${fmtDrawing(tn.mortiseDepth)}mm（板厚＋1mm），防止装配时胶液把榫头顶死`
          : '盲榫眼底必须凿平，深度打够后方可试装',
        '榫眼两端与榫肩均留线：眼两端留线防凿大，肩面留线刨修保严丝合缝',
      ],
    }
  }

  if (kind === 'lap' && r?.lap) {
    const lap = r.lap
    const t = joint.params.boardA.thickness
    return {
      boardA: [
        {
          no: 1,
          action: '画基准',
          detail: `选好基准面，按搭接长 ${fmtDrawing(lap.lapLength)}mm 画肩线，按切深 ${fmtDrawing(lap.depthEach)}mm（料厚/2 ± 配合让刀）画深度线，两线四面过线`,
        },
        { no: 2, action: '锯肩', detail: '先锯搭接长肩线（端部废料侧先下锯），深度尺/限位环校准，沿线留线不锯过头' },
        {
          no: 3,
          action: '剔槽清底',
          detail: `废料区锯多条松料刀后凿平槽底至 ${fmtDrawing(lap.depthEach)}mm，剩余料厚 ${fmtDrawing(t - lap.depthEach)}mm，槽底与基准面平行，深度误差 ≤0.2mm`,
        },
      ],
      boardB: [
        {
          no: 1,
          action: '同法对板',
          detail: `另一块板按同基准切深 ${fmtDrawing(lap.depthEach)}mm，两板切深之和 = 料厚 ± 配合让刀；对扣干装检查无高低差`,
        },
      ],
      cautions: [
        ...cautions,
        '先锯肩线断开木纹、再锯松料刀剔槽；槽底必须与基准面平行，否则装后有缝',
      ],
    }
  }

  if (kind === 'dowel' && r?.dowel) {
    const dw = r.dowel
    const spacing = dw.positions[1] !== undefined ? dw.positions[1] - dw.positions[0] : 0
    return {
      boardA: [
        {
          no: 1,
          action: '画孔位基准',
          detail: `以拼缝端面为基准，按图纸 ${dw.count} 个孔位过线到两面：端距 ${fmtDrawing(dw.positions[0] ?? dw.edgeMargin)}mm、孔距 ${fmtDrawing(spacing)}mm，孔居板厚 ${fmtDrawing(joint.params.boardA.thickness)}mm 中心`,
        },
        {
          no: 2,
          action: '打孔',
          detail: `木榫 Ø${fmtDrawing(dw.dowelDia)} × ${fmtDrawing(dw.dowelLength)}mm，单板孔深 ${fmtDrawing(dw.holeDepth)}mm（半销长＋1mm 排胶），装限位环并垂直于拼缝面，板背垫废板`,
        },
        { no: 3, action: '插销试拼', detail: '孔内插定位销对位干拼，检查错台与缝隙后再拆开涂胶' },
      ],
      boardB: [
        {
          no: 1,
          action: '对位打孔',
          detail: `两板夹紧对齐，透过已有孔（或定位销）打另一板，保证同心、同深 ${fmtDrawing(dw.holeDepth)}mm`,
        },
      ],
      cautions: [
        ...cautions,
        '圆木榫插入前榫身蘸胶（或孔壁薄涂一圈），胶勿过多；孔底预留 1mm 排胶防胶顶，涂胶后迅速合拢夹固',
        '钻头必须垂直拼缝面、孔位居中，两板孔同心才能对位；打透侧背面垫废板防崩边',
      ],
    }
  }

  // panel-glue
  const pn = r?.panel
  const pnSpacing = pn && pn.positions[1] !== undefined ? pn.positions[1] - pn.positions[0] : 0
  return {
    boardA: [
      { no: 1, action: '刨缝画基准', detail: '拼缝刨平直，接缝对光不透；以拼缝面为基准，按图纸榫位线过线并标出板厚中心线' },
      {
        no: 2,
        action: '画饼干榫位',
        detail: pn
          ? `共 ${pn.count} 处，端距 ${fmtDrawing(pn.positions[0] ?? pn.edgeMargin)}mm、间距 ${fmtDrawing(pnSpacing)}mm（#${pn.biscuitSize} 饼干榫）`
          : '按图纸位置线，端部边距见参数',
      },
      {
        no: 3,
        action: '切槽清灰',
        detail: pn
          ? `饼干榫机切槽深 ${fmtDrawing(pn.slotDepth)}mm、居中于板厚；备选槽榫 ${pn.grooveWidth}×${fmtDrawing(pn.grooveDepth)}mm；槽内吹净除尘`
          : '饼干榫机切槽，深度按参数，槽内除尘',
      },
    ],
    boardB: [
      { no: 1, action: '同法切槽', detail: '两板槽位一一相对、深浅一致，建议夹具定位后再切；干拼检查拼缝与错台' },
    ],
    cautions: [
      ...cautions,
      '拼板相邻板交替翻转年轮（纹理）方向、正反交替排布，抵消内应力防翘曲',
      '饼干榫与槽壁蘸胶后及时合拢加压，刮净余胶；端距与间距按图纸榫位线，不得随意挪动',
    ],
  }
}

function pinBoardSteps(
  dt: JointResult['dovetail'],
  blind: boolean,
  tB: number,
): CutStep[] {
  const depthTxt = blind && dt ? fmtDrawing(dt.depth) : fmtDrawing(tB)
  if (blind) {
    return [
      {
        no: 1,
        action: '过线',
        detail: `齿板端面抵住销板端部，用划线针把齿形过到销板端面${dt ? `，两端半齿边距 ${fmtDrawing(dt.margin)}mm 对称` : ''}`,
      },
      {
        no: 2,
        action: '画槽深线',
        detail: `划线器在销板端面画槽深 ${depthTxt}mm 止线，展示面不开口`,
      },
      {
        no: 3,
        action: '锯槽帮',
        detail: '沿过线锯到槽深止线即停，先锯废料侧、两端半齿先锯；锯片走锯切线留线，不得锯伤展示面',
      },
      {
        no: 4,
        action: '剔槽清底',
        detail: `凿子自中部向两侧剔除废料，槽底凿平至 ${depthTxt}mm，保护销侧线与半齿`,
      },
      { no: 5, action: '干试装', detail: '先干装：过紧修销侧，过松检查锯路后重划线；半齿留线部分最后修配' },
    ]
  }
  return [
    {
      no: 1,
      action: '过线',
      detail: `把齿板端面抵住销板端部，用划线针把齿形过到销板端面与两面${dt ? `，半齿边距 ${fmtDrawing(dt.margin)}mm 左右对称` : ''}`,
    },
    {
      no: 2,
      action: '画销板深度线',
      detail: `划线器按销板全厚 ${depthTxt}mm 四面画深度线（穿透）`,
    },
    {
      no: 3,
      action: '锯销侧线',
      detail: '先锯废料侧锯切线，两端半齿先锯、其余销侧后锯；锯片贴锯切线，理论线留在销上（留线）',
    },
    { no: 4, action: '剔废料', detail: '凿子自中线向两侧剔，保护销侧线；两端半齿留线修配' },
    { no: 5, action: '干试装', detail: '先干装：过紧修销侧，过松检查锯路后重划线' },
  ]
}
