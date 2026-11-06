/* =============================================================================
 * config.js —— 全局可调参数（场景与参数定义）
 *
 * 依赖：无。必须在所有其它 js 之前加载。
 *
 * 本文件集中定义：
 *   1. 好球区几何（信号/噪声的物理判定边界）
 *   2. 难度等级表 —— 直接操纵物理量 ε（球边到好球区线的距离，即压线深度 / 间隙）
 *   3. 先验概率 P(S)、执法风格（操纵判断标准 c）、打者身高
 *   4. 时间参数、试次参数、绘图配色
 *
 * 设计要点：界面上所有"难度"控制实际操纵的都是 ε（英寸），
 *           d′ 一律由数据事后计算，绝不在界面上直接让被试选 d′。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var C = {};

  /* ---------------------------------------------------------------------
   * 1. 好球区几何
   *
   * 规则原文：any part of the ball passes through any part of the strike zone。
   * 也就是说 —— **只要球的任何一部分经过好球区的任何一部分，就是好球**。
   * 球擦到边线（相切）算好球；球心在区外但球体压线，同样算好球。
   *
   * 真实棒球里好球区是一个三维立体区域（本垒板上方的一根"柱子"），
   * 本实现按作业规模**简化为一个平面**（球穿过本垒板前缘平面时的那个截面）。
   * 简化之后，"球经过好球区"就等价于平面上"圆盘与矩形相交"，即
   *
   *     球心到矩形的最短距离  ≤  球半径 r
   *
   * 于是可以把判定改写成一个只关于**球心**的条件：
   * 把矩形向四周外扩一个球半径 r，球心落在这个外扩区域**内侧**就是好球。
   * （这只是内部的一个等价换算，用来生成试次和反推 σ；那条外扩边界**不画出来**。）
   *
   * 这样做有两个好处：
   *   ① 判定规则完全忠实于规则原文，不再错误地要求"球心在区内"；
   *   ② ε 仍然是一个标量，SDT 的 d′ = 2ε/σ 推导完全不受影响。
   *
   * 画面上**只画好球区这一条线**。因为判据是"球与矩形是否相交"，而反馈阶段会把
   * 整颗球画在真实位置，擦没擦到一眼就能看出来 —— 再画一条抽象的"球心判定线"
   * 只会让画面变乱、让人误以为要判断的是球心。
   *
   * ε 的直观含义因此是：**球边到好球区线的那一小段距离** ——
   *   好球试次 → 球边越过了线 ε（压线深度）；坏球试次 → 球边离线的空隙是 ε。
   * 反馈阶段会把这一段用一条短粗线直接标出来。
   * ------------------------------------------------------------------ */
  C.zone = {
    // 好球区宽度 = 本垒板宽度 = 17 英寸（43.18 cm）
    plateWidthIn: 17,

    // 棒球直径约 2.9 英寸（7.3~7.5 cm）→ 半径 1.45″，用于"擦到即好球"的判定
    ballDiameterIn: 2.9,

    // 好球区高度 ≈ 0.115 × 身高(cm)。
    // 系数来源：MLB Statcast 平均 sz_bot ≈ 19.2 in、sz_top ≈ 41 in，
    // 对应约 188 cm 打者 → 好球区高 ≈ 21.8 in；21.8 / 188 ≈ 0.116。
    // 取 0.115 作为工程近似（膝下缘到球衣字母位）。
    zoneHeightPerCm: 0.115,
    batterHeightsCm: [170, 175, 180, 185, 190, 195],
    defaultBatterHeightCm: 180,

    // 沿边界采样时向两侧内缩的距离（英寸）。
    //
    // 这个值**不是随手填的**：它被设为外部噪声 σ_ext 的 3 倍。
    // 原因：每个试次只有一条"参照边界"（例如外角侧），但球在垂直于该边界的
    // 另一个坐标上仍然可能靠近上/下缘。若内缩量太小，显示端 1″ 的噪声就足以
    // 把球推到相邻边界之外，这个试次就变成真正意义上的"跨两条边界的模糊试次"，
    // 会把无关的混淆混进 d′，脏化「垂直 vs 水平」的分组比较。
    // 3σ_ext 的余量使这种污染的概率降到约 0.1% 以下。
    edgeInsetIn: 3.0,

    // 绘制留白：最"离谱"的噪声球（球边离好球区线还有 3″）连同球体也要完整落在画面里
    extremeMarginIn: 3.0,

    // 打者站位对影响界面的视觉呈现；好球区左右（称于本垒板，故不影响判定）
    hand: 'right'
  };

  C.zone.ballRadiusIn = C.zone.ballDiameterIn / 2;

  /** 由打者身高（cm）换算好球区高度（英寸） */
  C.zone.zoneHeightIn = function (heightCm) {
    return C.zone.zoneHeightPerCm * heightCm;
  };

  /**
   * 球心到好球区（矩形）的最短距离；球心在区内时为 0。
   * 平面上"圆盘与矩形相交"的判据就是这个距离与球半径的比较。
   */
  C.zone.centerToZoneDistIn = function (xIn, yIn, widthIn, heightIn) {
    var dx = Math.max(Math.abs(xIn) - widthIn / 2, 0);
    var dy = Math.max(Math.abs(yIn) - heightIn / 2, 0);
    return Math.sqrt(dx * dx + dy * dy);
  };

  /**
   * 球心到那条内部边界的有符号距离（英寸，向内为正）。它等于"球边到好球区线的距离"。
   *
   *   返回值 ≥ 0  →  球与好球区有重叠  →  **好球**（信号）
   *   返回值 < 0  →  球与好球区完全分离 →  **坏球**（噪声）
   *
   * 这个量正是每个试次的 ε对取绝（值），也是 SDT 模型里那个连续刺激量。
   */
  C.zone.ballSignedDistIn = function (xIn, yIn, widthIn, heightIn) {
    return C.zone.ballRadiusIn -
      C.zone.centerToZoneDistIn(xIn, yIn, widthIn, heightIn);
  };

  /** 球是否经过好球区（= 是否为好球） */
  C.zone.ballOverlapsZone = function (xIn, yIn, widthIn, heightIn) {
    return C.zone.ballSignedDistIn(xIn, yIn, widthIn, heightIn) >= 0;
  };

  /* ---------------------------------------------------------------------
   * 2. 难度等级表 —— 操纵的是物理量 ε，不是 d′
   *
   * 本实验采用心理物理学中的「外部噪声范式」（external noise paradigm）：
   *   · 显示端固定注入一个已知大小的位置噪声 σ_ext（见 C.externalNoiseIn），
   *     表现为球体在每试次被绘制于"真实位置 + 一个固定的随机偏移"，
   *     并按该偏移量施加高斯拖影模糊；
   *   · 各难度等级只改变信号强度 ε（球边到好球区线的距离）。
   *
   * 于是理想观察者（自身知觉噪声为 0）能达到的上限为：
   *     d′_理论 = 2ε / σ_ext            ← 这就是表中"理论 d′"的含义
   * 而实测 d′ 一定低于该上限，因为被试自身的知觉噪声 σ_int 会叠加进来：
   *     σ_total² = σ_ext² + σ_int²
   * 由实测 d′ 可得 σ_total = 2ε / d′_实测，进而剥离外部噪声得到
   *     σ_int = sqrt(max(0, σ_total² − σ_ext²))
   *
   * 这一步让"显示端不可能是像素完美的、那 d′ 从哪来"这个质疑不成立：
   * 外部噪声是被试无法归因的已知噪声源，它与 ε 的关系可检验、可复现。
   * ------------------------------------------------------------------ */
  C.externalNoiseIn = 1.0; // 显示端注入的位置噪声 σ_ext（英寸）

  C.difficultyLevels = [
    { id: 1, label: 'L1 极明显', epsilonIn: 3.0, note: '约一个球直径，几乎不会错' },
    { id: 2, label: 'L2 明显',   epsilonIn: 2.0, note: '约 2/3 球直径，比较轻松' },
    { id: 3, label: 'L3 基准',   epsilonIn: 1.0, note: '约 1/3 球直径，真实争议球核心区间' },
    { id: 4, label: 'L4 困难',   epsilonIn: 0.6, note: '约 1/5 球直径，吃力' },
    { id: 5, label: 'L5 极限',   epsilonIn: 0.3, note: '极其微小的偏差，接近瞎猜' }
  ];
  C.defaultLevelId = 3;

  C.getLevel = function (id) {
    for (var i = 0; i < C.difficultyLevels.length; i++) {
      if (C.difficultyLevels[i].id === id) return C.difficultyLevels[i];
    }
    return C.difficultyLevels[2];
  };

  /** 理想观察者的 d′ 上限：d′_理论 = 2ε / σ_ext */
  C.theoreticalDprime = function (epsilonIn, sigmaExtIn) {
    var s = sigmaExtIn || C.externalNoiseIn;
    return (2 * epsilonIn) / s;
  };

  /** 由总噪声中剥离外部噪声，得到被试自身的知觉噪声 */
  C.internalNoise = function (sigmaTotalIn, sigmaExtIn) {
    var s = (sigmaExtIn == null) ? C.externalNoiseIn : sigmaExtIn;
    if (!isFinite(sigmaTotalIn)) return NaN;
    var v = sigmaTotalIn * sigmaTotalIn - s * s;
    return v > 0 ? Math.sqrt(v) : 0;
  };

  /* ---------------------------------------------------------------------
   * 3. 先验概率 P(S) 与执法风格（操纵判断标准 c）
   * ------------------------------------------------------------------ */
  C.priorOptions = [
    { value: 0.30, label: 'P(S) = 0.30　打者强势局（投手在躲好球区）' },
    { value: 0.50, label: 'P(S) = 0.50　基准条件' },
    { value: 0.70, label: 'P(S) = 0.70　投手强势局（投手必须投好球）' }
  ];
  C.defaultPrior = 0.50;

  // kSign 表示判断标准 k 的移动方向（k = 主审内心"判好球所需的确信量"，单位英寸）。
  //   k > 0 → 需更强证据才判好球 → 少判好球 → c > 0（保守）
  //   k < 0 → 更容易判好球       → 多判好球 → c < 0（冒进）
  // 标准 SDT 约定：c > 0 = 保守 = 偏向报告"无信号"（本场景即"判坏球"）。
  C.styles = [
    {
      id: 'batter',
      label: '打者友好（严抓）',
      kSign: +1,
      kIn: +0.5,
      hint: '宁可漏判好球，也不能误判坏球 —— 本局请对好球要求更严格。'
    },
    {
      id: 'neutral',
      label: '中立',
      kSign: 0,
      kIn: 0,
      hint: '只按你看到的位置判，不受其它因素影响。'
    },
    {
      id: 'pitcher',
      label: '投手友好（宽松）',
      kSign: -1,
      kIn: -0.5,
      hint: '关键局面，好球区边缘的球也请判好球。'
    }
  ];
  C.defaultStyleId = 'neutral';
  C.getStyle = function (id) {
    for (var i = 0; i < C.styles.length; i++) if (C.styles[i].id === id) return C.styles[i];
    return C.styles[1];
  };

  /* ---------------------------------------------------------------------
   * 4. 时间参数（毫秒）
   * ------------------------------------------------------------------ */
  C.timing = {
    readyMs: 800,          // 试次准备（投手就位）
    flightMs: 450,         // 投球飞行时间 ≈ MLB 93 mph 跨 18.44 m 的 0.43 s
    responseWindowMs: 1500, // 判定窗口（作业要求的"刺激限时"）
    confidenceMs: 2000,    // ROC 信心评级模式的额外窗口
    feedbackMs: 800,       // 反馈呈现
    practiceFeedbackMs: 1100,
    isiMs: 450,            // 试次间隔
    warnMs: 300            // 限时条最后变红闪烁的时长
  };

  C.responseWindowOptions = [1000, 1500, 2000];

  /* ---------------------------------------------------------------------
   * 5. 试次与统计参数
   * ------------------------------------------------------------------ */
  C.trial = {
    trialsPerRound: 40,      // 默认 40（作业要求 ≥20；20 时 d′ 标准误过大）
    trialsOptions: [20, 40, 60],
    practiceTrials: 5,       // 练习试次（不计入统计）
    epsilonJitter: 0.20,     // 每试次 ε 在基准值 ±20% 内抖动，避免记忆固定偏移
    timeoutPolicy: 'exclude',// 'exclude' = 超时剔除（默认，推荐） | 'asNo' = 超时按判坏球计入
    correction: 'loglinear'  // 'loglinear' | 'oneOver2N' | 'none'
  };

  /* ---------------------------------------------------------------------
   * 6. ROC 模式
   * ------------------------------------------------------------------ */
  C.rocModes = [
    { id: 'none',   label: '关闭（纯二择一，节奏最快）' },
    { id: 'rating', label: '模式 A：单局 4 级信心评级法（一局即可画出 ROC）' },
    { id: 'multi',  label: '模式 B：多局不同执法风格（每局一个 ROC 点）' }
  ];
  C.defaultRocMode = 'none';

  // 4 级信心评级：1 肯定坏球 … 4 肯定好球
  C.confidenceLevels = [
    { value: 1, label: '肯定坏球', short: '1' },
    { value: 2, label: '像坏球',   short: '2' },
    { value: 3, label: '像好球',   short: '3' },
    { value: 4, label: '肯定好球', short: '4' }
  ];
  // 二择一阈值：rating >= 3 视为"判好球"
  C.confidenceStrikeThreshold = 3;

  /** 信心评级 → ROC 的三个累计切点（含各自的判定阈值） */
  C.rocCutsFromRatings = [
    { cut: 4, label: '仅"肯定好球"才判好球（最保守）' },
    { cut: 3, label: '评 3 或 4 判好球（主判定）' },
    { cut: 2, label: '评 2 及以上判好球（最冒进）' }
  ];

  /* ---------------------------------------------------------------------
   * 7. 绘图配色（明亮的日间球场）
   * ------------------------------------------------------------------ */
  C.colors = {
    // —— 球场 ——
    sky1: '#9fd0f5',
    sky2: '#dcefff',
    stands: '#c5d3e0',
    standsDot: '#aebecd',
    grass1: '#79c489',
    grass2: '#6bb87b',
    dirt: '#e3cba7',
    mound: '#d9be95',
    grassEdge: 'rgba(255,255,255,0.55)',

    // —— 人物剪影（深色，压在明亮背景上）——
    silhouette: 'rgba(45, 60, 76, 0.90)',
    catcher: 'rgba(30, 42, 56, 0.95)',
    mitt: 'rgba(58, 74, 92, 0.97)',
    mittLine: 'rgba(200, 214, 228, 0.75)',

    // —— 好球区（画面上唯一的线）——
    plateFace: '#ffffff',
    plateEdge: 'rgba(120,132,146,0.9)',
    zoneLine: 'rgba(255,255,255,0.95)',   // 真实好球区：白色实线
    zoneEdge: 'rgba(90,104,120,0.55)',
    accentLine: '#1c8bd6',                // 图表用的蓝色（画面上不再画判定线）
    zoneFill: 'rgba(28,139,214,0.07)',
    criterion: '#e08b2c',

    // —— 球 ——
    ball: '#ffffff',
    ballShade: '#dbe4ee',
    seam: '#d94a44',

    // —— 反馈 ——
    signal: '#1a9c56',
    noise: '#d94a44',
    textOnDark: '#ffffff',

    // —— 图表与文字 ——
    grid: 'rgba(30,50,75,0.10)',
    axis: 'rgba(30,50,75,0.35)',
    text: '#1f2d3d',
    textDim: '#69788a',
    hit: '#1a9c56',
    miss: '#d94a44',
    fa: '#d94a44',
    cr: '#1a9c56',
    timeout: '#8a97a6'
  };

  /* ---------------------------------------------------------------------
   * 8. 界面文案：四种结果的场景化解释（结果页与 README 共用）
   * ------------------------------------------------------------------ */
  C.outcomeText = {
    H:  { name: '命中 Hit',        en: 'Hit',   desc: '真好球，你判了好球 —— 正确，投手得利。' },
    M:  { name: '漏报 Miss',       en: 'Miss',  desc: '真好球，你判了坏球 —— 漏判好球，投手白投一个好球。' },
    FA: { name: '虚报 FA',         en: 'FA',    desc: '真坏球，你判了好球 —— 误判好球，打者被冤枉，代价最大且不可逆。' },
    CR: { name: '正确拒绝 CR',     en: 'CR',    desc: '真坏球，你判了坏球 —— 正确，球数 +1，打者得利。' },
    timeout: { name: '未响应',     en: 'Timeout', desc: '判定窗口内没有按键，单独记录，默认不计入 SDT 计算。' }
  };

  SDT.CONFIG = C;
})(typeof window !== 'undefined' ? window : globalThis);
