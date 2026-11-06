/* ============================================================
   propmodel.js — 比例判断的周期幂模型（Hollands & Dyre, 2000）
   ĵ = p^β / (p^β + (1−p)^β)
   β = 1 时无偏；β < 1 时小比例被高估、大比例被低估。
   ============================================================ */

window.PM = (function () {

  function predict(p, beta) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const a = Math.pow(p, beta);
    const b = Math.pow(1 - p, beta);
    return a / (a + b);
  }

  /** points: [{p: 0..1, j: 0..1}]，最小化 SSE */
  function fit(points) {
    if (!points.length) return null;
    let best = { beta: 1, sse: Infinity };
    for (let beta = 0.10; beta <= 3.0; beta += 0.002) {
      let sse = 0;
      for (let i = 0; i < points.length; i++) {
        const d = predict(points[i].p, beta) - points[i].j;
        sse += d * d;
      }
      if (sse < best.sse) best = { beta: beta, sse: sse };
    }
    // 局部细化
    let lo = Math.max(0.05, best.beta - 0.004), hi = best.beta + 0.004;
    for (let i = 0; i < 40; i++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      const s1 = sseAt(points, m1), s2 = sseAt(points, m2);
      if (s1 < s2) hi = m2; else lo = m1;
    }
    const beta = (lo + hi) / 2;
    return { beta: beta, sse: sseAt(points, beta), r2: r2(points, beta) };
  }

  function sseAt(points, beta) {
    let sse = 0;
    for (let i = 0; i < points.length; i++) {
      const d = predict(points[i].p, beta) - points[i].j;
      sse += d * d;
    }
    return sse;
  }

  function r2(points, beta) {
    const m = points.reduce((s, d) => s + d.j, 0) / points.length;
    let sst = 0, sse = 0;
    points.forEach(d => {
      sst += Math.pow(d.j - m, 2);
      sse += Math.pow(d.j - predict(d.p, beta), 2);
    });
    return sst === 0 ? 1 : 1 - sse / sst;
  }

  function curve(beta, n) {
    const out = [];
    const steps = n || 60;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      out.push({ p: p, j: predict(p, beta) });
    }
    return out;
  }

  /** 按被试分组各拟合一次，用于 β 的不确定性（n 很小时只作参考） */
  function fitBySubject(points, subjectKey) {
    const groups = new Map();
    points.forEach(d => {
      const k = d[subjectKey];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(d);
    });
    const betas = [];
    groups.forEach(arr => {
      const f = fit(arr);
      if (f) betas.push(f.beta);
    });
    return betas;
  }

  return { predict, fit, r2, curve, fitBySubject };
})();
