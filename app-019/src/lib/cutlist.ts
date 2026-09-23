// 切割清单：按榫卯类型生成锯切步骤顺序与注意事项（先锯哪条线、哪里留线）
// 清单中的全部尺寸均取自 computeJoint 的计算结果，与三视图标注同源（蓝图 §8）
import type { Joint } from '../types'
import type { JointResult } from './calc'
import type { DovetailResult } from './dovetail'
import type { TenonResult } from './tenon'
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

/** 带锯切线的类型：燕尾（含半隐）三视图画 saw 线；直榫正视图声明锯切线内收 */
function hasSawLines(kind: Joint['kind']): boolean {
  return kind === 'dovetail' || kind === 'half-blind-dovetail' || kind === 'mortise-tenon'
}

export function buildCutList(joint: Joint, r?: JointResult): CutList {
  const kerf = joint.params.kerfMm
  const { kind } = joint

  // 锯路注意事项只在真正画了锯切线的类型中宣称「图纸同时标注」，避免清单与图纸对不上
  // kerf 是 0.1mm 步进的入参，按 0.1 精度显示（不能用图纸的 0.5 取整，否则与参数对不上）
  const cautions: string[] = hasSawLines(kind)
    ? [
        `锯路宽度 ${fmt01(kerf)}mm：图纸轮廓实线为理论线、虚线为锯切线（理论线向废料侧偏 ${fmt01(
          kerf / 2,
        )}mm）；按锯切线下锯，锯片外缘贴理论线，先锯废料侧`,
        '先在废料上试锯校准深度与角度，再上工件',
      ]
    : [
        `锯路宽度 ${fmt01(kerf)}mm：本类型三视图不画锯切线，手锯时自行往废料侧让约 ${fmt01(
          kerf / 2,
        )}mm，沿线外侧下锯、基准线一侧留线`,
        '先在废料上试锯校准深度与角度，再上工件',
      ]

  if (kind === 'dovetail' || kind === 'half-blind-dovetail') {
    return dovetailCutList(kind, joint.params, r?.dovetail, cautions)
  }

  if (kind === 'mortise-tenon') {
    return tenonCutList(joint.params, r?.tenon, cautions)
  }

  if (kind === 'lap') {
    return lapCutList(r, joint, cautions)
  }

  if (kind === 'dowel') {
    return dowelCutList(r, cautions)
  }

  // panel-glue
  return panelCutList(r, cautions)
}

// —— 燕尾榫（穿透 / 半隐）：A 件为齿板 ——
function dovetailCutList(
  kind: Joint['kind'],
  params: Joint['params'],
  dt: DovetailResult | undefined,
  cautions: string[],
): CutList {
  const blind = kind === 'half-blind-dovetail'
  const ratio = params.dovetail?.angleRatio ?? 8
  const halfKerf = fmt01(params.kerfMm / 2)
  const boardA: CutStep[] = []
  if (dt) {
    boardA.push(
      {
        no: 1,
        action: '画基准',
        detail: `选好大面与基准边，划线器在端面四围画齿深线（深 ${fmtDrawing(dt.depth)}mm${
          blind ? '，半隐不划透展示面' : '，穿透划全厚'
        }）；两端半齿边距各 ${fmtDrawing(dt.margin)}mm，先画边距定位线`,
      },
      {
        no: 2,
        action: '画齿顶线',
        detail: `按齿宽表在${blind ? '背面（开槽面）' : '展示面'}画 ${dt.teeth.length} 个齿的齿顶线（各齿齿顶宽见表），并把齿顶线过到端面`,
      },
      {
        no: 3,
        action: '画齿根线',
        detail: `在背面对照齿深线连接各齿侧面：斜度 1:${ratio}（单边斜移 ${fmtDrawing(
          dt.slopeOffset,
        )}mm），齿根宽按齿宽表，画完逐齿核对齿顶+齿间槽闭合到板宽`,
      },
      {
        no: 4,
        action: '锯两端半齿',
        detail: `先锯两端半齿（边距 ${fmtDrawing(dt.margin)}mm 处）：沿半齿内侧的锯切线下锯，端面入刀、外侧留线约 ${halfKerf}mm 不锯通；半齿最薄最易劈裂，落锯要浅、多锯少剁`,
      },
      {
        no: 5,
        action: '锯中间各齿',
        detail: '再按齿号顺序锯中间各齿：每齿先锯右侧线（废料侧）后锯左侧线，一律贴废料一侧下锯、齿侧留线，锯到齿深线停锯',
      },
      {
        no: 6,
        action: '去料修底',
        detail: blind
          ? '沿槽底线凿除齿间废料至 0.75 板深，槽底凿平、不得凿穿展示面，残线用窄凿清到线'
          : '中部先钻排孔/锯松料口再去掉齿间废料，凿子自齿深线向中部剔平，两端齿根处留线最后修，底面误差 ≤0.2mm',
      },
    )
  }

  return {
    boardA,
    boardB: pinBoardSteps(blind, dt),
    cautions: [
      ...cautions,
      '先锯两端半齿、后锯中间齿；半齿处一律留线，装配时再修，一次锯过必从端部劈裂',
      blind
        ? '半隐燕尾：销板（前脸）只凿不锯穿，槽深 = 齿深，展示面一侧不得露出端头'
        : '齿侧斜度两面一致（斜移量两端相等），过线后先干装再修销侧，禁止锯通基准线',
    ],
  }
}

// —— 燕尾 B 件：销板 ——
function pinBoardSteps(blind: boolean, dt: DovetailResult | undefined): CutStep[] {
  const depthText = dt ? fmtDrawing(dt.depth) : '—'
  if (blind) {
    return [
      { no: 1, action: '过线', detail: '齿板端面抵住销板（前脸）背面，划线针把齿形过到背面与两侧面，展示面不过线' },
      { no: 2, action: '画槽深线', detail: `在两面画槽深线（深 ${depthText}mm = 0.75×齿板厚），槽底一线四面过齐` },
      { no: 3, action: '剔两端半销', detail: '先凿两端半销位置：沿过线内侧落凿，边线留线、由浅入深，前脸一侧不得凿穿' },
      { no: 4, action: '剔中间销间废料', detail: '槽内先排钻去料，再沿线凿修到槽深线，凿刃斜面朝向废料、保护销侧线' },
      { no: 5, action: '清底试装', detail: '槽底凿平清到线（误差 ≤0.2mm），干装检验：过紧修销侧、过松复查齿板锯路，禁止反过来修齿' },
    ]
  }
  return [
    { no: 1, action: '过线', detail: '齿板端面抵住销板端部，划线针把齿形过到销板端面与两面，过线一次完成、不得挪动齿板' },
    { no: 2, action: '画销板深度线', detail: `划线器画销板全厚度深度线（${depthText}mm），两面线必须对齐` },
    { no: 3, action: '锯销侧线', detail: '先锯废料侧：每条销先锯右侧线后锯左侧线，锯片贴废料一侧、销侧留线；两端半销最易裂，先锯且只锯到深度线' },
    { no: 4, action: '剔废料', detail: '凿子自中线向两侧剔，先去掉中间大块再修两端，保护销侧线与半销边线' },
    { no: 5, action: '清底试装', detail: '端面凿平清到深度线，先干装：过紧修销侧，过松检查齿板锯路后重新过线，禁止锯通基准线' },
  ]
}

// —— 直榫（榫头 / 榫眼） ——
function tenonCutList(params: Joint['params'], tn: TenonResult | undefined, cautions: string[]): CutList {
  if (!tn) return { boardA: [], boardB: [], cautions }
  const through = tn.mortiseDepth > tn.tenonLength
  // 配合余量是 0.1mm 网格上的表值（计算表格量，按 0.1 精度说明）；加工尺寸本身仍按图纸的 0.5 步进取整
  const delta = Math.round((tn.tenonThickness - tn.nominalThickness) * 10) / 10
  const woodName = params.wood === 'hardwood' ? '硬木' : '软木'
  const fitName = params.fit === 'tight' ? '紧配' : params.fit === 'loose' ? '松配' : '标准'
  const fitText =
    delta === 0
      ? '标准配合无余量'
      : `名义 ${fmt01(tn.nominalThickness)}mm，${woodName}${fitName}余量 ${delta > 0 ? '+' : '−'}${fmt01(
          Math.abs(delta),
        )}mm`
  const sawOff = fmt01(tn.mortiseSawOffset)
  return {
    boardA: [
      {
        no: 1,
        action: '画基准',
        detail: `以腹板面为基准四面过线：腹边距 ${fmtDrawing(tn.offsetFromFace)}mm 画榫厚线，榫长 ${fmtDrawing(
          tn.tenonLength,
        )}mm 处四面环画榫肩线，两肩到端距离一致`,
      },
      {
        no: 2,
        action: '画榫头线',
        detail: `榫厚 ${fmtDrawing(tn.tenonThickness)}mm（${fitText}）、榫宽 ${fmtDrawing(
          tn.tenonWidth,
        )}mm，两侧肩宽各 ${fmtDrawing(tn.shoulder)}mm；线与图纸侧视图标注一致`,
      },
      {
        no: 3,
        action: '锯榫侧',
        detail: '先锯两榫侧面（沿肩线以外的废料侧下锯、榫侧留线），再锯榫肩；肩线四面留线，最后刨修到线',
      },
      {
        no: 4,
        action: '清底倒棱',
        detail: '剔净榫肩残料、肩面刨平清到线；榫头入孔端四角倒棱 1mm 便于入孔，不得倒到榫身配合面',
      },
    ],
    boardB: [
      {
        no: 1,
        action: '画基准',
        detail: `以同一腹板面为基准：眼中心对中板宽，眼下沿距腹板面 ${fmtDrawing(
          tn.offsetFromFace,
        )}mm，眼位线过到两面并打对角叉标记废料区`,
      },
      {
        no: 2,
        action: '画榫眼线',
        detail: `眼宽 ${fmtDrawing(tn.tenonWidth)}mm × 眼厚 ${fmtDrawing(tn.tenonThickness)}mm，${
          through
            ? `穿透：眼钻通 ${fmtDrawing(params.boardB.thickness)}mm 板厚，实际打 ${fmtDrawing(
                tn.mortiseDepth,
              )}mm（加深 1mm 防胶顶底）`
            : `盲榫眼深 ${fmtDrawing(tn.mortiseDepth)}mm（= 榫长，不打穿）`
        }；眼宽/眼厚与正视图标注一致`,
      },
      {
        no: 3,
        action: '凿/钻榫眼',
        detail: `锯切线相对眼线向内收 ${sawOff}mm（kerf/2）下锯/下凿，两端各留一线不凿到位，中间先排钻镂空`,
      },
      {
        no: 4,
        action: '清底修壁',
        detail: '眼壁修到眼线、眼内四角清方，眼底凿平并清尽木屑；穿透眼背面衬废木板防止出口崩茬',
      },
      {
        no: 5,
        action: '试装',
        detail: '干装：木锤垫木块敲入，肩面贴合无缝；过紧只修榫侧、不动榫眼，试好后拆开再上胶',
      },
    ],
    cautions: [
      ...cautions,
      `榫眼按名义尺寸画线、锯凿内收 ${sawOff}mm 让刀；榫头尺寸已含配合余量（${fitText}），勿再自行加减`,
      '榫眼穿透时眼底加深 1mm 并在背面衬废板；榫头倒棱仅在入孔端，配合面留线刨修',
    ],
  }
}

// —— 企口 / 搭接（Lap） ——
function lapCutList(r: JointResult | undefined, joint: Joint, cautions: string[]): CutList {
  const lap = r?.lap
  const fitText: Record<Joint['params']['fit'], string> = {
    tight: '紧配少切 0.2mm',
    standard: '标准配合不让刀',
    loose: '松配多切 0.2mm 留胶',
  }
  const depth = lap ? fmtDrawing(lap.depthEach) : '料厚/2'
  const lapLen = lap ? fmtDrawing(lap.lapLength) : fmtDrawing(joint.params.boardA.width)
  return {
    boardA: [
      { no: 1, action: '画基准', detail: '选定基准面，端面画半搭深度线与搭接长线，线过到板两面并对齐' },
      { no: 2, action: '画线', detail: `切深 ${depth}mm（料厚/2，${fitText[joint.params.fit]}）、搭接长 ${lapLen}mm，与正视/侧视图标注一致` },
      {
        no: 3,
        action: '锯肩',
        detail: `先锯搭接长端的肩线：沿线外侧（废料侧）下锯、留线约 ${fmt01(
          joint.params.kerfMm / 2,
        )}mm，深度尺/限位环校准到切深线即停`,
      },
      { no: 4, action: '剔槽清底', detail: '槽内锯多条松料口后剔去废料，凿子修槽底到深度线并清平，槽底与基准面平行，深度误差 ≤0.2mm' },
    ],
    boardB: [
      { no: 1, action: '重复对板', detail: `另一块板按同一基准面同法切深 ${depth}mm，两板切深之和 = 料厚 ± 让刀` },
      { no: 2, action: '试配上胶', detail: '干套检查错台与缝隙，槽底/肩部留线处刨修；合格后两贴合面均匀涂胶合拢，及时擦净挤出胶' },
    ],
    cautions: [
      ...cautions,
      '半搭槽底必须与基准面平行、两板切深一致，否则装后有错台和缝隙',
      '配合让刀量按当前松紧：紧配每侧少切 0.2mm（装后刨平），松配每侧多切 0.2mm 留胶层',
    ],
  }
}

// —— 圆木榫 / 饼干榫定位孔 ——
function dowelCutList(r: JointResult | undefined, cautions: string[]): CutList {
  const dw = r?.dowel
  const dia = dw ? fmtDrawing(dw.dowelDia) : '8/10'
  const len = dw ? fmtDrawing(dw.dowelLength) : '—'
  const depth = dw ? fmtDrawing(dw.holeDepth) : '—'
  const count = dw ? dw.count : 0
  const endMargin = dw ? fmtDrawing(dw.positions[0] ?? dw.edgeMargin) : '—'
  return {
    boardA: [
      { no: 1, action: '画基准', detail: '以拼缝面与板宽同一端为基准，按正视/俯视图画中心线与各孔位十字线，两面过线' },
      { no: 2, action: '画孔位', detail: `共 ${count} 个孔，端距 ${endMargin}mm、孔距均分（位置见图），木榫 Ø${dia} × ${len}mm` },
      { no: 3, action: '打孔', detail: `孔深 ${depth}mm（= 销长一半 + 1mm 排胶排气），钻头顶尖对准十字、与拼缝面垂直，限位环控深，孔内吹净木屑` },
      { no: 4, action: '装定位销', detail: '定位销（光杆/短木榫）插一半入孔对位，先干拼检验错台，再正式装木榫' },
    ],
    boardB: [
      { no: 1, action: '对位打孔', detail: '两板拼缝面贴紧、夹具对齐后，透过已有孔（或用定位销/对中器）引钻另一板，保证两孔同心、同侧孔深一致' },
      { no: 2, action: '试拼', detail: '干拼检查缝口与高低差；合格后拆出，准备上胶' },
    ],
    cautions: [
      ...cautions,
      '正式装配时木榫周身与孔壁都要蘸胶（胶液覆盖木榫全长），孔底预留的 1mm 用于存余胶与排气，敲入后及时擦净挤出胶',
      '钻孔必须垂直拼缝面并使用限位环；孔位偏差只能靠重定位修正，不得扩孔将就',
    ],
  }
}

// —— 拼板（饼干榫 / 槽） ——
function panelCutList(r: JointResult | undefined, cautions: string[]): CutList {
  const pn = r?.panel
  const size = pn ? `#${pn.biscuitSize}` : '#'
  const slotDepth = pn ? fmtDrawing(pn.slotDepth) : '—'
  const count = pn ? pn.count : 0
  const endMargin = pn ? fmtDrawing(pn.positions[0] ?? pn.edgeMargin) : '—'
  const grooveDepth = pn ? fmtDrawing(pn.grooveDepth) : '—'
  return {
    boardA: [
      { no: 1, action: '画基准', detail: '标出板面与拼缝基准边，在拼缝面画中心高度线；按正视图在各板缝面画槽位十字线，端距与间距同图' },
      { no: 2, action: '刨平拼缝', detail: '拼缝刨平直（可用长直尺/对光检验不透缝），相邻两板拼缝面配对编号，避免装反' },
      { no: 3, action: '画饼干榫位', detail: `共 ${count} 个 ${size} 饼干榫位，端距 ${endMargin}mm、间距均分（≤150mm 一颗），位置与正视/俯视图一致` },
      { no: 4, action: '切槽', detail: `饼干榫机靠紧基准面切槽，槽深 ${slotDepth}mm（备选槽榫 6×${grooveDepth}mm），槽口居中拼缝面，槽内除尘` },
    ],
    boardB: [
      { no: 1, action: '同法切槽', detail: '配对板按同一基准面、同一高度切槽：两板槽位一一对齐，建议夹具定位后再开机，槽深一致' },
      { no: 2, action: '试拼编号', detail: '不放饼干榫干拼检查整条缝，按顺序给板编号；确认各槽对位后拆开' },
    ],
    cautions: [
      ...cautions,
      '拼板必须交替翻转年轮（纹理）方向排列（相邻板心材面一正一反），抵消干湿变形，防止拼后翘曲',
      `${size} 饼干榫遇胶膨胀，涂胶后要快速合拢加压；饼干榫与槽壁均涂胶，夹具压力均匀，及时擦净挤出胶`,
    ],
  }
}
