/* =============================================================================
 * trial.js —— 试次生成
 *
 * 依赖：config.js
 *
 * 职责：
 *   1. 精确控制先验概率 P(S)：先生成恰好 round(N × P(S)) 个信号试次，再打乱，
 *      而不是每个试次独立抛硬币（后者会引入抽样偏差）。
 *   2. 交叉分层：先在 4 条边界（内/外/上/下）之间平分试次，再在每条边界内
 *      按 P(S) 分配信号/噪声，保证「垂直 vs 水平」分组统计有足够数据。
 *   3. 操纵难度：把球心从（好球区外扩一个球半径的）内部边界向内（信号）或向外（噪声）
 *      偏移 ε 英寸。也就等价于"球边越过好球区线 ε"或"球边离线还有空隙 ε"。
 *   4. 沿边界采样时向两侧内缩 edgeInsetIn，避免"角上"导致的参照边界歧义。
 *   5. 注入外部显示噪声 σ_ext：每试次抽一个固定的随机偏移，被试看到的球心位置
 *      是"真实位置 + 该偏移"。这是心理物理学的「外部噪声范式」，也是让 d′
 *      落在可测量区间的前提（否则像素完美的显示会让 σ 趋近 0、d′ 冲到天上）。
 *
 * 坐标系（本文件与 scene.js 共用）：
 *   原点 = 好球区中心；x 向右为正；y 向上为正；单位 = 英寸。
 *   好球区：x ∈ [−W/2, +W/2]，y ∈ [−H/2, +H/2]，W = 17 in，H = 0.115 × 身高(cm)
 *   内部边界（不绘制）：把上述矩形向四周外扩球半径 1.45 in
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var CONFIG = SDT.CONFIG;

  /* ---------------------------------------------------------------------
   * 可复现的伪随机数发生器（线性同余）
   * 用固定种子可以完全复现一整局试次序列，方便调试与助教核对。
   * ------------------------------------------------------------------ */
  function makeRng(seed) {
    var s = (seed >>> 0) || 20260101;
    return function () {
      // Numerical Recipes 的 LCG 参数
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** Fisher–Yates 洗牌（原地） */
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 标准正态随机数（Box–Muller 变换）
   */
  function gauss(rng) {
    var u1 = 0, u2 = 0;
    while (u1 === 0) u1 = rng();   // 避免 log(0)
    u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * 生成单个试次
   *
   * 判定规则的实现（**重要**）：
   *   规则是"球的任何一部分经过好球区的任何一部分即为好球"，所以判定边界不是
   *   好球区本身，而是好球区**向外扩一个球半径 r** 之后得到的那条内部边界。
   *   本函数沿真实好球区的边长采样位置，再以那条内部边界为基准做 ε 的法向偏移：
   *
   *     信号试次：球心在内侧 ε  →  球边压过好球区线 ε（= 好球）
   *     噪声试次：球心在外侧 ε  →  球边离好球区线还有空隙 ε（= 坏球）
   *
   *   于是 ε 这个标量既能唯一决定真实状态，
   *   又保持了 SDT 模型 d′ = 2ε/σ 的干净推导。
   *
   * 另外注意"真实位置"与"显示位置"是两个不同的量：
   *   · 真实位置 (xIn, yIn)          —— 世界状态，决定信号/噪声，反馈时才揭示
   *   · 显示端外部噪声 (noiseXIn…)    —— 每个试次固定抽取一次，不随时间变化
   *   · 显示位置 (dispXIn, dispYIn)   —— 被试实际看到的球心位置 = 真实 + 噪声
   * 之所以让噪声"每试次固定"而不是逐帧抖动，是因为逐帧抖动会被视觉系统在
   * 时间上平均掉，从而无法有效提高 σ；固定的随机偏移才是标准的
   * 「外部噪声范式」（Lu & Dosher, 1998）的做法。
   *
   * @param {number} index    试次序号（0 起）
   * @param {string} edge     'left' | 'right' | 'top' | 'bottom'（参照的是哪条边界）
   * @param {boolean} isSignal true = 好球（信号），false = 坏球（噪声）
   * @param {number} eps      球边到好球区线的距离 ε（英寸，已含抖动）
   * @param {object} zone     { widthIn, heightIn, edgeInsetIn }
   * @param {number} sigmaExt 外部显示噪声标准差（英寸）
   * @param {function} rng
   */
  function makeTrial(index, edge, isSignal, eps, zone, sigmaExt, rng) {
    var halfW = zone.widthIn / 2;
    var halfH = zone.heightIn / 2;
    var inset = zone.edgeInsetIn;
    var r = CONFIG.zone.ballRadiusIn;      // 内部边界相对好球区外扩的量

    var x, y, axis, alongFrac;

    if (edge === 'left' || edge === 'right') {
      // 水平方向边界（内角 / 外角）：沿竖直方向采样位置
      axis = 'horizontal';
      var yMin = -halfH + inset;
      var yMax = halfH - inset;
      y = yMin + rng() * (yMax - yMin);
      alongFrac = (y - yMin) / (yMax - yMin);

      // 内部边界位置 = 好球区边界外扩一个球半径
      var xDecision = (edge === 'right') ? (halfW + r) : -(halfW + r);
      var inward = (edge === 'right') ? -1 : +1;   // 指向好球区内部的方向
      x = xDecision + inward * (isSignal ? eps : -eps);

    } else {
      // 垂直方向边界（上缘 / 下缘）：沿水平方向采样位置
      axis = 'vertical';
      var xMin = -halfW + inset;
      var xMax = halfW - inset;
      x = xMin + rng() * (xMax - xMin);
      alongFrac = (x - xMin) / (xMax - xMin);

      var yDecision = (edge === 'top') ? (halfH + r) : -(halfH + r);
      var inwardY = (edge === 'top') ? -1 : +1;
      y = yDecision + inwardY * (isSignal ? eps : -eps);
    }

    // ---- 外部显示噪声：每试次抽取一次并固定 ----
    var noiseX = gauss(rng) * sigmaExt;
    var noiseY = gauss(rng) * sigmaExt;
    var dispX = x + noiseX;
    var dispY = y + noiseY;

    return {
      index: index,
      isSignal: isSignal,
      edge: edge,
      axis: axis,                       // 'horizontal' = 内外角, 'vertical' = 高低
      epsilonIn: eps,
      xIn: x,                           // 真实球心相对好球区中心的横向位置（英寸，右为正）
      yIn: y,                           // 真实球心相对好球区中心的纵向位置（英寸，上为正）
      alongFrac: alongFrac,             // 沿边界的位置比例（0~1），供绘制使用
      signedDistIn: isSignal ? eps : -eps, // 球边到好球区线的有符号距离：向内为正

      // 真实状态下球与好球区的重叠/间隙（供反馈文字与自检使用）
      overlapIn: CONFIG.zone.ballSignedDistIn(x, y, zone.widthIn, zone.heightIn),

      // ---- 外部噪声与显示位置 ----
      sigmaExtIn: sigmaExt,
      noiseXIn: noiseX,
      noiseYIn: noiseY,
      dispXIn: dispX,                   // 被试实际看到的横向位置
      dispYIn: dispY,                   // 被试实际看到的纵向位置

      zoneWidthIn: zone.widthIn,
      zoneHeightIn: zone.heightIn,
      ballRadiusIn: r
    };
  }

  /**
   * 生成一整局试次
   * @param {object} opts
   *   opts.nTrials      试次总数
   *   opts.pSignal      先验概率 P(S)
   *   opts.epsilonIn    基准 ε（英寸）
   *   opts.jitter       ε 的抖动比例（0.2 = ±20%），可传 0 关闭
   *   opts.zoneWidthIn  好球区宽度
   *   opts.zoneHeightIn 好球区高度
   *   opts.edgeInsetIn  边界内缩量
   *   opts.sigmaExtIn   外部显示噪声 σ_ext（英寸），默认取 CONFIG.externalNoiseIn
   *   opts.seed         随机种子
   * @returns {Array} 已打乱顺序的试次数组
   */
  function buildRound(opts) {
    var rng = makeRng(opts.seed);
    var n = opts.nTrials;
    var pS = opts.pSignal;
    var zone = {
      widthIn: opts.zoneWidthIn,
      heightIn: opts.zoneHeightIn,
      edgeInsetIn: (opts.edgeInsetIn != null) ? opts.edgeInsetIn : CONFIG.zone.edgeInsetIn
    };
    var jitter = (opts.jitter != null) ? opts.jitter : CONFIG.trial.epsilonJitter;
    var sigmaExt = (opts.sigmaExtIn != null) ? opts.sigmaExtIn : CONFIG.externalNoiseIn;

    // ---- 1. 把试次在 4 条边界之间尽可能平分 ----
    var edgeNames = ['left', 'right', 'top', 'bottom'];
    var base = Math.floor(n / 4);
    var rem = n % 4;
    var edgeCount = {};
    edgeNames.forEach(function (e, i) {
      edgeCount[e] = base + (i < rem ? 1 : 0);
    });

    // ---- 2. 在每条边界内部再按 P(S) 分配信号/噪声 ----
    //
    // 先算出全局应有的信号试次数（保证实际的 P(S) 与设定值精确一致），
    // 再用「最大余数法」按各边界的试次数比例分配到 4 条边界。
    // 若直接对每条边界各自 round(cnt × P(S))，小样本下总体的 P(S) 会明显偏离
    // （例如 N=20、P(S)=0.3 时实际会变成 0.40），这是必须避免的方法学瑕疵。
    var nSignalTotal = Math.round(n * pS);
    var quotas = edgeNames.map(function (e) { return nSignalTotal * (edgeCount[e] / n); });
    var signalPerEdge = {};
    var assigned = 0;
    edgeNames.forEach(function (e, i) {
      signalPerEdge[e] = Math.floor(quotas[i]);
      assigned += signalPerEdge[e];
    });
    var leftover = nSignalTotal - assigned;
    var fracOrder = quotas.map(function (q, i) { return { i: i, frac: q - Math.floor(q) }; })
      .sort(function (a, b) { return b.frac - a.frac; });
    for (var k = 0; k < leftover; k++) {
      signalPerEdge[edgeNames[fracOrder[k].i]]++;
    }
    // 安全钳制：任何边界分配的试次数都不能超过它自身的试次数
    edgeNames.forEach(function (e) {
      if (signalPerEdge[e] > edgeCount[e]) signalPerEdge[e] = edgeCount[e];
    });

    var trials = [];
    var idx = 0;
    edgeNames.forEach(function (edge) {
      var cnt = edgeCount[edge];
      var nSignalEdge = signalPerEdge[edge];
      for (var i = 0; i < cnt; i++) {
        var isSignal = i < nSignalEdge;
        // ε 抖动：围绕基准值 ±jitter，避免被试记住固定的偏移量
        var factor = 1 + jitter * (2 * rng() - 1);
        var eps = opts.epsilonIn * factor;
        var tr = makeTrial(idx++, edge, isSignal, eps, zone, sigmaExt, rng);
        // 诊断字段：若被试完全按"显示位置"判断，他会怎么判？
        // （用于在结果页说明外部噪声的实际影响）
        tr.displayLooksInside = CONFIG.zone.ballOverlapsZone(
          tr.dispXIn, tr.dispYIn, zone.widthIn, zone.heightIn);
        trials.push(tr);
      }
    });

    // ---- 3. 打乱试次顺序，并重新编号 ----
    shuffle(trials, rng);
    trials.forEach(function (t, i) { t.index = i; });

    return trials;
  }

  /**
   * 统计一份试次列表的实际构成（用于自检：确认 P(S) 与边界平衡是否符合设计）
   */
  function audit(trials) {
    var a = { n: trials.length, nSignal: 0, nNoise: 0, byEdge: {}, byAxis: {} };
    trials.forEach(function (t) {
      if (t.isSignal) a.nSignal++; else a.nNoise++;
      a.byEdge[t.edge] = (a.byEdge[t.edge] || 0) + 1;
      a.byAxis[t.axis] = (a.byAxis[t.axis] || 0) + 1;
    });
    a.pSignalActual = a.n ? a.nSignal / a.n : NaN;
    return a;
  }

  SDT.Trial = {
    makeRng: makeRng,
    shuffle: shuffle,
    makeTrial: makeTrial,
    buildRound: buildRound,
    audit: audit
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDT.Trial;
  }
})(typeof window !== 'undefined' ? window : globalThis);
