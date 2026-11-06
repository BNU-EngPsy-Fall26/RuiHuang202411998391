/* ============================================================
   ddm.js — EZ-diffusion（Wagenmakers et al., 2007）参数反解 + 模拟
   仅用于结果页的「模型预测 vs 实测」加分项，不参与主流程。
   ============================================================ */

window.DDM = (function () {

  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * EZ 反解：输入正确率 Pc、正确试次 RT 的均值（秒）与方差、总试次 N，
   * 返回漂移率 v、边界间隔 a、非决策时间 Ter。
   */
  function ez(Pc, VRT, MRT, N) {
    const eps = 1 / (2 * Math.max(1, N));
    if (Pc >= 1) Pc = 1 - eps;
    if (Pc <= 0) Pc = eps;
    if (Math.abs(Pc - 0.5) < 1e-9) Pc = 0.5 + eps;

    const L = Math.log(Pc / (1 - Pc));
    const s = 1, s2 = 1;
    const x = L * (L * Pc * Pc - L * Pc + Pc - 0.5) / VRT;
    if (!isFinite(x) || x <= 0) return null;

    const v = Math.sign(Pc - 0.5) * Math.pow(x, 0.25);
    const a = s2 * L / v;
    const y = -v * a / s2;
    const MDT = (a / (2 * v)) * (1 - Math.exp(y)) / (1 + Math.exp(y));
    const Ter = MRT - MDT;
    return { v, a, Ter, Pc, MRT, VRT, MDT };
  }

  /**
   * 用反解出的参数模拟选择反应：上边界记为「正确」。
   * 返回 {rt: 秒, acc: 0/1}
   */
  function simulate(params, n, opts) {
    opts = opts || {};
    const dt = opts.dt || 0.001;
    const maxT = opts.maxT || 4;
    const a = Math.max(params.a, 0.05);
    const v = params.v, Ter = Math.max(params.Ter, 0.05);
    const out = [];
    for (let i = 0; i < n; i++) {
      let x = a / 2, t = 0, hit = 0;
      while (t < maxT) {
        x += v * dt + Math.sqrt(dt) * randn();
        t += dt;
        if (x >= a) { hit = 1; break; }
        if (x <= 0) { hit = 0; break; }
      }
      if (t >= maxT - 1e-9) continue;
      out.push({ rt: Ter + t, acc: hit });
    }
    return out;
  }

  /** 核密度估计：给一组值，返回网格上的 {x, y} */
  function kde(values, grid, bandwidth) {
    if (!values.length) return [];
    const n = values.length;
    const m = window.S.mean(values);
    const s = window.S.sd(values) || 0.05;
    const h = bandwidth || 1.06 * s * Math.pow(n, -0.2);
    const lo = Math.min.apply(null, grid), hi = Math.max.apply(null, grid);
    const out = [];
    for (let i = 0; i < grid.length; i++) {
      const x = grid[i];
      let y = 0;
      for (let k = 0; k < n; k++) {
        const z = (x - values[k]) / h;
        y += Math.exp(-0.5 * z * z);
      }
      y = y / (n * h * Math.sqrt(2 * Math.PI));
      if (!isFinite(y)) y = 0;
      out.push({ x: x, y: y });
    }
    return out;
  }

  function grid(lo, hi, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * i / (n - 1));
    return out;
  }

  /**
   * 单个条件的完整拟合：用正确试次的 RT（毫秒）与总试次数
   * 返回 { params, sim, observed }
   */
  function fitCondition(rtCorrectMs, nTotal, nSim) {
    if (!rtCorrectMs.length) return null;
    const pc = rtCorrectMs.length / Math.max(1, nTotal);
    const sec = rtCorrectMs.map(x => x / 1000);
    const params = ez(pc, window.S.variance(sec), window.S.mean(sec), nTotal);
    if (!params) return null;
    const sim = simulate(params, nSim || 2000);
    return {
      params,
      pc: pc,
      observed: rtCorrectMs,
      sim: sim.map(d => d.rt * 1000)
    };
  }

  return { ez, simulate, kde, grid, fitCondition, randn };
})();
