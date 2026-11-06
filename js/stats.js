/* ============================================================
   stats.js — 描述统计、t 分布 / F 分布、配对检验、bootstrap、
              2×2 重复测量方差分析（手算公式，无外部依赖）
   ============================================================ */

window.S = (function () {

  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => (a.length ? sum(a) / a.length : NaN);
  const variance = a => {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return sum(a.map(x => (x - m) * (x - m))) / (a.length - 1);
  };
  const sd = a => Math.sqrt(variance(a));
  const median = a => quantile(a, 0.5);

  function quantile(values, q) {
    if (!values.length) return NaN;
    const a = values.slice().sort((x, y) => x - y);
    const pos = (a.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  const logit = p => Math.log(p / (1 - p));
  const expit = x => 1 / (1 + Math.exp(-x));

  /* ---------- 分布函数（Numerical Recipes） ---------- */

  function logGamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) { y += 1; ser += c[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  const tCDF = (t, df) => {
    const x = df / (df + t * t);
    const p = 0.5 * betai(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  };

  const fCDF = (F, d1, d2) => {
    if (F <= 0) return 0;
    return betai(d1 / 2, d2 / 2, d1 * F / (d1 * F + d2));
  };

  function tInv(p, df) {
    let lo = -80, hi = 80;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCDF(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------- 检验 ---------- */

  /** 配对 t 检验（双尾）＋ dz＋均值差的 95% CI */
  function paired(a, b) {
    const n = Math.min(a.length, b.length);
    const diffs = [];
    for (let i = 0; i < n; i++) diffs.push(a[i] - b[i]);
    const m = mean(diffs);
    const s = sd(diffs);
    const se = s / Math.sqrt(n);
    const df = n - 1;
    const t = m / se;
    const p = 2 * (1 - tCDF(Math.abs(t), df));
    const tc = tInv(0.975, df);
    return {
      n, mean: m, sd: s, se, df, t, p,
      dz: m / s,
      ci: [m - tc * se, m + tc * se]
    };
  }

  /** 单样本是否偏离 0（用于干扰量） */
  function oneSample(values) {
    const m = mean(values), s = sd(values), n = values.length;
    const se = s / Math.sqrt(n), df = n - 1;
    const t = m / se;
    const p = 2 * (1 - tCDF(Math.abs(t), df));
    const tc = tInv(0.975, df);
    return { n, mean: m, sd: s, se, df, t, p, dz: m / s, ci: [m - tc * se, m + tc * se] };
  }

  /** 均值差的 bootstrap 95% CI（按被试重抽，n 小的时候比 t 区间稳） */
  function bootstrapCI(values, statFn, B, alpha) {
    B = B || 5000;
    alpha = alpha === undefined ? 0.05 : alpha;
    if (!values.length) return [NaN, NaN];
    const fn = statFn || mean;
    const out = [];
    for (let b = 0; b < B; b++) {
      const s = [];
      for (let i = 0; i < values.length; i++) s.push(values[Math.floor(Math.random() * values.length)]);
      out.push(fn(s));
    }
    out.sort((a, b) => a - b);
    return [quantile(out, alpha / 2), quantile(out, 1 - alpha / 2)];
  }

  /* ---------- 2×2 重复测量 ANOVA ---------- */

  /**
   * cells: n 名被试，每人 [[a0b0, a0b1], [a1b0, a1b1]] 的单元格均值
   * 返回 SS / df / MS / F / p / partial η²
   */
  function anova2x2(cells) {
    const n = cells.length;
    const cellGrand = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      cellGrand.push(mean(cells.map(c => c[i][j])));
    }
    const grand = mean(cellGrand);
    const A = [0, 1].map(i => (cellGrand[i * 2] + cellGrand[i * 2 + 1]) / 2);
    const B = [0, 1].map(j => (cellGrand[j] + cellGrand[2 + j]) / 2);

    // 原始观测的总平方和（4n 个观测）
    let ssT = 0;
    cells.forEach(c => {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        ssT += Math.pow(c[i][j] - grand, 2);
      }
    });

    const subjMeans = cells.map(c => (c[0][0] + c[0][1] + c[1][0] + c[1][1]) / 4);
    let ssS = 0;
    subjMeans.forEach(m => { ssS += 4 * Math.pow(m - grand, 2); });

    const ssA = n * 2 * (Math.pow(A[0] - grand, 2) + Math.pow(A[1] - grand, 2));
    const ssB = n * 2 * (Math.pow(B[0] - grand, 2) + Math.pow(B[1] - grand, 2));
    let ssAB = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      ssAB += n * Math.pow(cellGrand[i * 2 + j] - A[i] - B[j] + grand, 2);
    }
    const ssE = Math.max(0, ssT - ssS - ssA - ssB - ssAB);

    const dfA = 1, dfB = 1, dfAB = 1, dfE = (n - 1) * 1;
    const msE = ssE / dfE;
    const F = { A: (ssA / dfA) / msE, B: (ssB / dfB) / msE, AB: (ssAB / dfAB) / msE };
    const p = {
      A: 1 - fCDF(F.A, dfA, dfE),
      B: 1 - fCDF(F.B, dfB, dfE),
      AB: 1 - fCDF(F.AB, dfAB, dfE)
    };
    const eta = {
      A: ssA / (ssA + ssE),
      B: ssB / (ssB + ssE),
      AB: ssAB / (ssAB + ssE)
    };
    return { n, grand, A, B, cellGrand, msE, dfE, ssA, ssB, ssAB, ssE, F, p, eta };
  }

  /* ---------- 分组聚合 ---------- */

  function groupBy(arr, keyFn) {
    const map = new Map();
    arr.forEach(item => {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  }

  return {
    sum, mean, variance, sd, median, quantile, logit, expit,
    tCDF, fCDF, tInv, betai,
    paired, oneSample, bootstrapCI, anova2x2, groupBy
  };
})();
