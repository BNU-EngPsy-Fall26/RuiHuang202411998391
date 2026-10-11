/* =============================================================================
 * sdt.js —— 信号检测论的数学核心（结果计算与展示）
 *
 * 依赖：无（纯函数，不碰 DOM）。可在 Node 下直接 require 做单元测试。
 *
 * 提供：
 *   Phi(x) / phi(x) / erfc(x)     正态分布函数
 *   z(p)                           反正态（分位数）函数
 *   applyCorrection()              0/1 概率的修正对（数线性 / 1/(2N) / 不修正）
 *   computeMetrics()               由 2×2 计数算出全部 SDT 指标
 *   rocCurve()                     给定 d′ 的理论 ROC 曲线
 *   fitEpsilonSlope()              由 (ε, d′) 数据反推知觉噪声 σ̂
 *
 * 参考文献：
 *   Green, D. M., & Swets, J. A. (1966). Signal Detection Theory and Psychophysics.
 *   Macmillan, N. A., & Creelman, C. D. (2005). Detection Theory: A User's Guide (2nd ed.).
 *   Hautus, M. J. (1995). Corrections for extreme proportions and their biasing
 *     effects on estimated values of d′. Behavior Research Methods, 27, 46–51.
 *   Stanislaw, H., & Todorov, N. (1999). Calculation of signal detection theory
 *     measures. Behavior Research Methods, 31, 137–149.
 *   Wichura, M. J. (1988). Algorithm AS 241: The percentage points of the normal
 *     distribution. Applied Statistics, 37, 477–484.  (z(p) 所用算法，精度约 1e-15)
 *   Numerical Recipes in C (2nd ed.), §6.2 —— erfc 的 Chebyshev 拟合（|误差|<1.2e-7）
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};

  /* =====================================================================
   * 一、正态分布函数
   * ================================================================== */

  /**
   * 互补误差函数 erfc(x)。
   * 采用 Numerical Recipes §6.2 的 Chebyshev 拟合，绝对误差 < 1.2e-7，
   * 对本作业的精度需求（d′ 保留两位小数）绰绰有余。
   */
  function erfc(x) {
    var z = Math.abs(x);
    var t = 1.0 / (1.0 + 0.5 * z);
    var ans = t * Math.exp(
      -z * z - 1.26551223 +
      t * (1.00002368 +
      t * (0.37409196 +
      t * (0.09678418 +
      t * (-0.18628806 +
      t * (0.27886807 +
      t * (-1.13520398 +
      t * (1.48851587 +
      t * (-0.82215223 +
      t * 0.17087277)))))))));
    return x >= 0 ? ans : 2.0 - ans;
  }

  /** 标准正态累积分布函数 Φ(x) = P(Z ≤ x) */
  function Phi(x) {
    return 0.5 * erfc(-x / Math.SQRT2);
  }

  /** 标准正态概率密度函数 φ(x) */
  function phi(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /* =====================================================================
   * 二、反正态函数 z(p) = Φ⁻¹(p)
   *
   * 采用 Wichura (1988) 的 Algorithm AS 241（即 R 语言 qnorm 所用的算法），
   * 分段有理逼近，相对精度约 1e-15。选择它而不是 Acklam 近似 + 迭代精修，
   * 是因为 AS 241 在中部区域对 p = 0.5 精确返回 0，且不依赖 Φ 本身的精度。
   * ================================================================== */

  // AS 241 系数（原文献变量名 a0..a7 / b1..b7 / c0..c7 / d1..d7 / e0..e7 / f1..f7）
  var SPLIT1 = 0.425, SPLIT2 = 5.0, CONST1 = 0.180625, CONST2 = 1.6;

  var A0 = 3.3871328727963666080e0,  A1 = 1.3314166789178437745e2,
      A2 = 1.9715909503065514427e3,  A3 = 1.3731693765509461125e4,
      A4 = 4.5921953931549871457e4,  A5 = 6.7265770927008700853e4,
      A6 = 3.3430575583588128105e4,  A7 = 2.5090809287301226727e3;
  var B1 = 4.2313330701600911252e1,  B2 = 6.8718700749205790830e2,
      B3 = 5.3941960214247511077e3,  B4 = 2.1213794301586595867e4,
      B5 = 3.9307895800092710610e4,  B6 = 2.8729085735721942674e4,
      B7 = 5.2264952788528545610e3;
  var C0 = 1.42343711074968357734e0, C1 = 4.63033784615654529590e0,
      C2 = 5.76949722146069140550e0, C3 = 3.64784832476320460504e0,
      C4 = 1.27045825245236838258e0, C5 = 2.41780725177450611770e-1,
      C6 = 2.27238449892691845833e-2, C7 = 7.74545014278341407640e-4;
  var D1 = 2.05319162663775882187e0, D2 = 1.67638483018380384940e0,
      D3 = 6.89767334985100004550e-1, D4 = 1.48103976427480074590e-1,
      D5 = 1.51986665636164571966e-2, D6 = 5.47593808499534494600e-4,
      D7 = 1.05075007164441684324e-9;
  var E0 = 6.65790464350110377720e0, E1 = 5.46378491116411436990e0,
      E2 = 1.78482653991729133580e0, E3 = 2.96560571828504891230e-1,
      E4 = 2.65321895265761230930e-2, E5 = 1.24266094738807843860e-3,
      E6 = 2.71155556874348757815e-5, E7 = 2.01033439929228813265e-7;
  var F1 = 5.99832206555887937690e-1, F2 = 1.36929880922735805310e-1,
      F3 = 1.48753612908506148525e-2, F4 = 7.86869131145613259100e-4,
      F5 = 1.84631831751005468180e-5, F6 = 1.42151175831644588870e-7,
      F7 = 2.04426310338993978564e-15;

  /**
   * 反正态函数：给定概率 p 返回 z 值，使 Φ(z) = p。
   * 注意：p 必须严格落在 (0, 1) 开区间内，因此调用前必须先做 0/1 修正。
   */
  function z(p) {
    if (!(p > 0 && p < 1)) {
      throw new RangeError('z(p) 要求 0 < p < 1，收到 p = ' + p +
        '对提示：应先做（数线性修正）');
    }

    var q = p - 0.5;
    var r, val;

    if (Math.abs(q) <= SPLIT1) {
      // 中部：直接对 q 做有理逼近（q = 0 时精确得到 0）
      r = CONST1 - q * q;
      val = q * (((((((A7 * r + A6) * r + A5) * r + A4) * r + A3) * r + A2) * r + A1) * r + A0) /
                (((((((B7 * r + B6) * r + B5) * r + B4) * r + B3) * r + B2) * r + B1) * r + 1);
      return val;
    }

    // 尾部
    r = (q < 0) ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));

    if (r <= SPLIT2) {
      r = r - CONST2;
      val = (((((((C7 * r + C6) * r + C5) * r + C4) * r + C3) * r + C2) * r + C1) * r + C0) /
            (((((((D7 * r + D6) * r + D5) * r + D4) * r + D3) * r + D2) * r + D1) * r + 1);
    } else {
      r = r - SPLIT2;
      val = (((((((E7 * r + E6) * r + E5) * r + E4) * r + E3) * r + E2) * r + E1) * r + E0) /
            (((((((F7 * r + F6) * r + F5) * r + F4) * r + F3) * r + F2) * r + F1) * r + 1);
    }

    return (q < 0) ? -val : val;
  }

  /* =====================================================================
   * 三、0/1 概率的修正
   *
   * 当 P(Hit) = 1 或 P(FA) = 0 时 z 值为 ±∞，d′ 会炸掉。
   * 这是 SDT 实现中最常见的 bug，必须处理。
   * ================================================================== */

  /**
   * @param {number} h   命中数
   * @param {number} ns  信号试次总数
   * @param {number} fa  虚报数
   * @param {number} nn  噪声试次总数
   * @param {string} method 'loglinear' | 'oneOver2N' | 'none'
   * @returns {{pHit:number, pFA:number, applied:boolean}}
   */
  function applyCorrection(h, ns, fa, nn, method) {
    var pHit, pFA, applied = false;

    if (method === 'loglinear') {
      // Hautus (1995) 对数线性修正：把每个格子加 0.5，总数加 1
      pHit = (h + 0.5) / (ns + 1);
      pFA = (fa + 0.5) / (nn + 1);
      applied = (h === 0 || h === ns || fa === 0 || fa === nn);

    } else if (method === 'oneOver2N') {
      // 传统的 1/(2N) 修正：只替换极端的 0 与 1
      pHit = h / ns;
      pFA = fa / nn;
      if (h === 0)  { pHit = 1 / (2 * ns); applied = true; }
      if (h === ns) { pHit = 1 - 1 / (2 * ns); applied = true; }
      if (fa === 0)  { pFA = 1 / (2 * nn); applied = true; }
      if (fa === nn) { pFA = 1 - 1 / (2 * nn); applied = true; }

    } else {
      // 完全不修正 —— 只为演示"不修正会怎样"，用极小量兜底避免 Infinity
      pHit = h / ns;
      pFA = fa / nn;
      var EPS = 1e-6;
      if (pHit <= 0) { pHit = EPS; applied = true; }
      if (pHit >= 1) { pHit = 1 - EPS; applied = true; }
      if (pFA <= 0)  { pFA = EPS; applied = true; }
      if (pFA >= 1)  { pFA = 1 - EPS; applied = true; }
    }

    return { pHit: pHit, pFA: pFA, applied: applied };
  }

  /* =====================================================================
   * 四、由 2×2 计数计算全部 SDT 指标
   * ================================================================== */

  /**
   * @param {object} counts {H, M, FA, CR, timeout}
   * @param {object} opts
   *        opts.correction  'loglinear'(默认) | 'oneOver2N' | 'none'
   *        opts.epsilonIn   本轮使用的 ε（英寸），用于反推 σ 与理论 d′
   *        opts.sigmaExtIn  显示端注入的外部噪声 σ_ext，默认取配置值
   * @returns {object} 全部指标
   */
  function computeMetrics(counts, opts) {
    opts = opts || {};
    var method = opts.correction || 'loglinear';
    var eps = (typeof opts.epsilonIn === 'number') ? opts.epsilonIn : null;
    var sigmaExt = (typeof opts.sigmaExtIn === 'number') ? opts.sigmaExtIn : 1.0;

    var h = counts.H || 0, m = counts.M || 0;
    var fa = counts.FA || 0, cr = counts.CR || 0;
    var to = counts.timeout || 0;

    var ns = h + m;          // 信号试次数
    var nn = fa + cr;        // 噪声试次数
    var nValid = ns + nn;    // 有效（参与 SDT 计算）试次数
    var nTotal = nValid + to;

    var out = {
      H: h, M: m, FA: fa, CR: cr, timeout: to,
      nSignal: ns, nNoise: nn, nValid: nValid, nTotal: nTotal,
      pHitRaw: ns ? h / ns : NaN,
      pFARaw: nn ? fa / nn : NaN,
      pMiss: ns ? m / ns : NaN,
      pCR: nn ? cr / nn : NaN,
      accuracy: nValid ? (h + cr) / nValid : NaN,
      timeoutRate: nTotal ? to / nTotal : 0,
      correctionMethod: method,
      epsilonIn: eps,
      sigmaExtIn: sigmaExt,
      theoreticalDprime: eps ? (2 * eps) / sigmaExt : NaN,
      valid: true,
      notes: []
    };

    // 信号或噪声试次全缺 → 无法计算 d′
    if (ns === 0 || nn === 0) {
      out.valid = false;
      out.dprime = NaN; out.c = NaN; out.beta = NaN;
      out.sigmaTotal = NaN; out.sigmaInternal = NaN;
      out.pHit = NaN; out.pFA = NaN;
      out.notes.push('信号试次或噪声试次为 0，无法计算 d′（需要两类试次都存在）。');
      return out;
    }

    var corr = applyCorrection(h, ns, fa, nn, method);
    out.pHit = corr.pHit;
    out.pFA = corr.pFA;
    out.correctionApplied = corr.applied;
    if (corr.applied) {
      out.notes.push('P(Hit) 或 P(FA) 落在 0 或 1 上，已按 ' + method + ' 方法修正。');
    }

    // 核心公式
    var zH = z(out.pHit);
    var zF = z(out.pFA);
    out.zHit = zH;
    out.zFA = zF;
    out.dprime = zH - zF;                       // d′ = z(H) − z(F)
    out.c = -0.5 * (zH + zF);                   // c  = −½[z(H) + z(F)]
    out.beta = Math.exp(out.dprime * out.c);    // β  = exp(d′·c)
    out.betaAlt = phi(zH) / phi(zF);            // 另一种写法，用于验算

    // 由物理量反推噪声：d′ = 2ε/σ_total  →  σ_total = 2ε/d′
    // 再剥离已知的外部显示噪声，得到被试自身的知觉噪声 σ_int
    if (eps && Math.abs(out.dprime) > 1e-9) {
      out.sigmaTotal = (2 * eps) / Math.abs(out.dprime);
      var v = out.sigmaTotal * out.sigmaTotal - sigmaExt * sigmaExt;
      out.sigmaInternal = v > 0 ? Math.sqrt(v) : 0;   // σ_int = sqrt(σ_total² − σ_ext²)
      if (out.dprime < 0) {
        out.notes.push('d′ 为负值（低于随机水平），σ 按 |d′| 计算，请谨慎解释。');
      }
      if (v <= 0) {
        out.notes.push('实测 d′ 已达到或超过理想观察者的上限（σ_total ≤ σ_ext），' +
          '说明本轮数据可能受猜答或反应偏向影响，请谨慎解释。');
      }
    } else {
      out.sigmaTotal = NaN;
      out.sigmaInternal = NaN;
    }

    return out;
  }

  /* =====================================================================
   * 五、理论 ROC 曲线
   *
   * 由 d′ = z(H) − z(F) 得 z(H) = d′ + z(F)
   *   →  P(Hit) = Φ( d′ + z(P(FA)) )
   * 同一 d′ 下改变判断标准，点 (P(FA), P(Hit)) 即沿这条曲线移动。
   * ================================================================== */

  /**
   * @param {number} dprime
   * @param {number} n 采样点个数，默认 121
   * @returns {Array<{pfa:number, phit:number}>}
   */
  function rocCurve(dprime, n) {
    n = n || 121;
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var pfa = i / n;
      if (i === 0) { pts.push({ pfa: 0, phit: 0 }); continue; }        // 极端：从不判好球
      if (i === n) { pts.push({ pfa: 1, phit: 1 }); continue; }        // 极端：总是判好球
      var p = Math.min(Math.max(pfa, 1e-6), 1 - 1e-6);
      pts.push({ pfa: pfa, phit: Phi(dprime + z(p)) });
    }
    return pts;
  }

  /**
   * 经验 ROC 点的曲线下面积（梯形法）。
   *
   * 注意：只有「中间切点」的经验点是不够的，一条经验 ROC 必须用两个极端
   * 切点闭合：判据最严时 (P(FA), P(Hit)) = (0, 0)（从不判好球），
   * 判据最松时 = (1, 1)（总是判好球）。因此这里自动补上这两个端点，
   * 否则算出来的只是"部分面积"，会得到没有意义的数值。
   *
   * @param {Array<{pfa:number, phit:number}>} points
   * @returns {number} AUC
   */
  function auc(points) {
    if (!points || points.length < 1) return NaN;
    var pts = points.slice().sort(function (a, b) { return a.pfa - b.pfa; });
    if (pts[0].pfa > 1e-12) pts.unshift({ pfa: 0, phit: 0 });
    if (pts[pts.length - 1].pfa < 1 - 1e-12) pts.push({ pfa: 1, phit: 1 });

    var a = 0;
    for (var i = 1; i < pts.length; i++) {
      a += (pts[i].pfa - pts[i - 1].pfa) * (pts[i].phit + pts[i - 1].phit) / 2;
    }
    return a;
  }

  /* =====================================================================
   * 六、由 (ε, d′) 数据反推噪声
   *
   * SDT 预测 d′ = (2/σ)·ε，即一条**过原点**的直线。
   * 用最小二乘拟合过原点直线的斜率 b = Σ(εᵢ·d′ᵢ) / Σ(εᵢ²)，
   * 则 σ_total = 2 / b，再剥离已知的外部噪声得到被试自身的知觉噪声
   *     σ_int = sqrt(max(0, σ_total² − σ_ext²))
   * 这是本实验"用 SDT 测量不可观测心理量"的关键一步。
   * ================================================================== */

  /**
   * @param {Array<{epsilonIn:number, dprime:number}>} pts
   * @param {number} sigmaExtIn 已知的外部显示噪声
   * @returns {{slope:number, sigmaTotal:number, sigmaInternal:number, r2:number, n:number, ok:boolean, reason?:string}}
   */
  function fitEpsilonSlope(pts, sigmaExtIn) {
    var sigmaExt = (typeof sigmaExtIn === 'number') ? sigmaExtIn : 1.0;
    var valid = (pts || []).filter(function (p) {
      return isFinite(p.epsilonIn) && isFinite(p.dprime) && p.epsilonIn > 0;
    });
    var uniq = {};
    valid.forEach(function (p) { uniq[p.epsilonIn] = 1; });
    var nDistinct = Object.keys(uniq).length;

    if (valid.length < 2 || nDistinct < 2) {
      return { ok: false, n: valid.length, reason: '需要至少 2 个不同难度等级的成绩才能拟合（当前不同 ε 的水平数：' + nDistinct + '）。' };
    }

    var sxy = 0, sxx = 0, syy = 0;
    valid.forEach(function (p) {
      sxy += p.epsilonIn * p.dprime;
      sxx += p.epsilonIn * p.epsilonIn;
      syy += p.dprime * p.dprime;
    });

    var slope = sxy / sxx;                 // 过原点最小二乘斜率
    // 过原点回归的 R² = 1 − SSres/SStot（关于原点的总平方和）
    var ssres = 0;
    valid.forEach(function (p) {
      var e = p.dprime - slope * p.epsilonIn;
      ssres += e * e;
    });
    var sstot = syy;                       // 模型为 y = b·x 时，SStot = Σy²
    var r2 = sstot > 0 ? 1 - ssres / sstot : NaN;

    var sigmaTotal = slope > 1e-9 ? 2 / slope : NaN;
    var sigmaInternal = NaN;
    if (isFinite(sigmaTotal)) {
      var v = sigmaTotal * sigmaTotal - sigmaExt * sigmaExt;
      sigmaInternal = v > 0 ? Math.sqrt(v) : 0;
    }

    return {
      ok: true,
      n: valid.length,
      slope: slope,                        // 斜率 ≈ 2/σ_total
      sigmaTotal: sigmaTotal,              // 总噪声（外部 + 内部）
      sigmaInternal: sigmaInternal,        // 剥离外部噪声后的知觉噪声
      sigmaExtIn: sigmaExt,
      r2: r2,
      intercept0: true
    };
  }

  /* =====================================================================
   * 导出
   * ================================================================== */
  SDT.math = {
    erfc: erfc,
    Phi: Phi,
    phi: phi,
    z: z,
    applyCorrection: applyCorrection,
    computeMetrics: computeMetrics,
    rocCurve: rocCurve,
    auc: auc,
    fitEpsilonSlope: fitEpsilonSlope
  };

  // 便于在 Node 下做单元测试
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDT.math;
  }
})(typeof window !== 'undefined' ? window : globalThis);
