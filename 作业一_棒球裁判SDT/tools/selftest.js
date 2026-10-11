/* =============================================================================
 * tools/selftest.js —— 数值自检（可选，需 Node.js）
 *
 * 用途：不打开浏览器就能验证 SDT 数学与试次生成是否正确。
 * 运行：在项目根目录执行   node tools/selftest.js
 *
 * 它不参与网页运行，纯粹是给开发者/助教做交叉验证用的。
 * ========================================================================== */
'use strict';

var path = require('path');
var ROOT = path.join(__dirname, '..', 'js');

require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'sdt.js'));
require(path.join(ROOT, 'trial.js'));
require(path.join(ROOT, 'stats.js'));

var SDT = globalThis.SDT;
var M = SDT.math;
var T = SDT.Trial;
var S = SDT.Stats;
var C = SDT.CONFIG;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '   ' + extra : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }

console.log('\n=== 1. 正态分布函数 ===');
ok('Phi(0) = 0.5', near(M.Phi(0), 0.5, 1e-6), 'Phi(0)=' + M.Phi(0));
ok('Phi(1.96) ≈ 0.975', near(M.Phi(1.96), 0.975, 1e-5), 'Phi(1.96)=' + M.Phi(1.96).toFixed(8));
ok('z(0.5) 精确为 0', M.z(0.5) === 0, 'z(0.5)=' + M.z(0.5));
ok('z(0.975) ≈ 1.959964', near(M.z(0.975), 1.959964, 1e-5), 'z(0.975)=' + M.z(0.975).toFixed(8));
ok('z(0.025) ≈ −1.959964', near(M.z(0.025), -1.959964, 1e-5), 'z(0.025)=' + M.z(0.025).toFixed(8));

var maxErr = 0;
[-4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 4].forEach(function (x) {
  maxErr = Math.max(maxErr, Math.abs(M.z(M.Phi(x)) - x));
});
ok('往返 z(Phi(x)) = x 的最大误差 < 1e-6', maxErr < 1e-6, 'maxErr=' + maxErr.toExponential(2));

var threw = false;
try { M.z(0); } catch (e) { threw = true; }
ok('z(0) 会抛错（提醒必须先做修正）', threw);

console.log('\n=== 2. 对数线性修正与 d′ 计算（Hautus 1995）===');
var counts = { H: 17, M: 3, FA: 4, CR: 16, timeout: 0 };
var m = M.computeMetrics(counts, { correction: 'loglinear', epsilonIn: 1.0 });
// 手算对照：pHit = 17.5/21, pFA = 4.5/21
ok('P(Hit) = 17.5/21', near(m.pHit, 17.5 / 21, 1e-12), 'pHit=' + m.pHit.toFixed(8));
ok('P(FA)  = 4.5/21', near(m.pFA, 4.5 / 21, 1e-12), 'pFA=' + m.pFA.toFixed(8));
ok('d′ ≈ 1.7591', near(m.dprime, 1.75906, 1e-4), 'd′=' + m.dprime.toFixed(5));
ok('c ≈ −0.0879', near(m.c, -0.08789, 1e-4), 'c=' + m.c.toFixed(5));
ok('β = exp(d′·c)', near(m.beta, Math.exp(m.dprime * m.c), 1e-12), 'β=' + m.beta.toFixed(5));
ok('β 的两种写法一致（φ(zH)/φ(zF)）', near(m.beta, m.betaAlt, 1e-6), 'βalt=' + m.betaAlt.toFixed(5));
ok('正确率 = 33/40 = 0.825', near(m.accuracy, 0.825, 1e-12), 'acc=' + m.accuracy);
ok('σ_total = 2ε/d′', near(m.sigmaTotal, 2 / m.dprime, 1e-12), 'σ_total=' + m.sigmaTotal.toFixed(5));
ok('σ_int = sqrt(σ_total² − σ_ext²)',
  near(m.sigmaInternal, Math.sqrt(Math.max(0, m.sigmaTotal * m.sigmaTotal - 1.0)), 1e-12),
  'σ_int=' + m.sigmaInternal.toFixed(5));

console.log('\n--- 极端比例（P(Hit)=1 且 P(FA)=0）---');
var ext = { H: 20, M: 0, FA: 0, CR: 20, timeout: 0 };
var mL = M.computeMetrics(ext, { correction: 'loglinear', epsilonIn: 1.0 });
var mO = M.computeMetrics(ext, { correction: 'oneOver2N', epsilonIn: 1.0 });
var mN = M.computeMetrics(ext, { correction: 'none', epsilonIn: 1.0 });
ok('loglinear 修正后 d′ 有限', isFinite(mL.dprime), 'd′=' + mL.dprime.toFixed(4));
ok('loglinear: pHit = 20.5/21', near(mL.pHit, 20.5 / 21, 1e-12));
ok('oneOver2N 修正后 d′ 有限', isFinite(mO.dprime), 'd′=' + mO.dprime.toFixed(4));
ok('不修正时 d′ 被兜底但仍然极大（演示用）', isFinite(mN.dprime) && mN.dprime > 8, 'd′=' + mN.dprime.toFixed(2));
ok('三种修正都返回有限值', [mL, mO, mN].every(function (x) { return isFinite(x.dprime) && isFinite(x.c); }));

console.log('\n--- 缺失一类试次时应拒绝计算 ---');
var bad = M.computeMetrics({ H: 10, M: 0, FA: 0, CR: 0, timeout: 0 }, {});
ok('只有信号试次 → valid=false 且 d′ 为 NaN', bad.valid === false && isNaN(bad.dprime));

console.log('\n=== 3. c 的方向约定 ===');
// 同样的分辨力，判断标准变保守（少判好球）→ c 应变大
var loose = M.computeMetrics({ H: 18, M: 2, FA: 8, CR: 12 }, {});
var strict = M.computeMetrics({ H: 12, M: 8, FA: 2, CR: 18 }, {});
ok('保守（少判好球）时 c 更大', strict.c > loose.c, 'c_严=' + strict.c.toFixed(3) + ' > c_松=' + loose.c.toFixed(3));
ok('两者 d′ 接近（分辨力未被标准改变）', Math.abs(strict.dprime - loose.dprime) < 1.0,
  'd′_严=' + strict.dprime.toFixed(3) + ', d′_松=' + loose.dprime.toFixed(3));

console.log('\n=== 4. 理论 ROC 曲线 ===');
var curve = M.rocCurve(1.5, 100);
ok('ROC 起点精确为 (0,0)', curve[0].phit === 0 && curve[0].pfa === 0);
ok('ROC 终点精确为 (1,1)', curve[100].phit === 1 && curve[100].pfa === 1);
ok('ROC 单调不减', curve.every(function (p, i) { return i === 0 || p.phit >= curve[i - 1].phit - 1e-12; }));
var mid = curve.find(function (p) { return near(p.pfa, 0.5, 0.006); });
ok('d′=1.5 时 ROC 中点 P(Hit) ≈ 0.933', near(mid.phit, M.Phi(1.5), 1e-3), 'P(Hit)=' + mid.phit.toFixed(4));
ok('理论 ROC 的 AUC > 0.5（d′ > 0 时曲线在对角线之上）', M.auc(curve) > 0.5,
  'AUC=' + M.auc(curve).toFixed(4));
var guess = M.rocCurve(0, 100);
ok('d′ = 0 时理论 ROC 的 AUC = 0.5（与对角线重合）', near(M.auc(guess), 0.5, 1e-6),
  'AUC=' + M.auc(guess).toFixed(6));

console.log('\n=== 5. 试次生成：P(S) 与边界平衡 ===');
[[40, 0.5], [40, 0.3], [40, 0.7], [20, 0.3], [20, 0.7], [60, 0.5]].forEach(function (cfg) {
  var n = cfg[0], pS = cfg[1];
  var tr = T.buildRound({
    nTrials: n, pSignal: pS, epsilonIn: 1.0, jitter: 0.2,
    zoneWidthIn: 17, zoneHeightIn: 20.7, edgeInsetIn: 1.5, seed: 12345
  });
  var a = T.audit(tr);
  ok('N=' + n + ' P(S)=' + pS + ' → 实际 P(S)=' + a.pSignalActual.toFixed(3),
    near(a.pSignalActual, pS, 1e-9) && a.n === n);
});

var tr = T.buildRound({
  nTrials: 40, pSignal: 0.5, epsilonIn: 1.0, jitter: 0.2,
  zoneWidthIn: 17, zoneHeightIn: 20.7, edgeInsetIn: 1.5, seed: 999
});
var aud = T.audit(tr);
ok('40 试次在 4 条边界上各 10 个', Object.keys(aud.byEdge).every(function (k) { return aud.byEdge[k] === 10; }),
  JSON.stringify(aud.byEdge));
ok('水平/垂直各 20 个', aud.byAxis.horizontal === 20 && aud.byAxis.vertical === 20,
  JSON.stringify(aud.byAxis));

var sigOK = true, noiseOK = true, ruleOK = true, gapOK = true;
var epsRange = [Infinity, 0];
tr.forEach(function (t) {
  if (t.isSignal && t.signedDistIn <= 0) sigOK = false;
  if (!t.isSignal && t.signedDistIn >= 0) noiseOK = false;
  epsRange[0] = Math.min(epsRange[0], Math.abs(t.signedDistIn));
  epsRange[1] = Math.max(epsRange[1], Math.abs(t.signedDistIn));

  // 核心规则：真实状态必须与"球的任何一部分是否经过好球区"完全一致
  var overlaps = C.zone.ballOverlapsZone(t.xIn, t.yIn, t.zoneWidthIn, t.zoneHeightIn);
  if (overlaps !== t.isSignal) ruleOK = false;

  // 噪声试次：球与好球区的间隙恰好等于 ε（球心在判定线外 ε）
  if (!t.isSignal && Math.abs(t.overlapIn + t.epsilonIn) > 1e-9) gapOK = false;
  // 信号试次：压线深度 = min(ε, 球半径)，因为球心一旦进入好球区内部就饱和了
  var expect = Math.min(t.epsilonIn, C.zone.ballRadiusIn);
  if (t.isSignal && Math.abs(t.overlapIn - expect) > 1e-9) gapOK = false;
});
ok('信号试次球心在判定线内侧（与好球区有重叠）', sigOK);
ok('噪声试次球心在判定线外侧（与好球区分离）', noiseOK);
ok('「球擦到即好球」规则与信号/噪声标记完全一致', ruleOK);
ok('噪声间隙 = ε；信号压线深度 = min(ε, 球半径)', gapOK,
  '球半径 ' + C.zone.ballRadiusIn.toFixed(2) + '″');
ok('ε 抖动落在 ±20% 内', epsRange[0] >= 0.8 - 1e-9 && epsRange[1] <= 1.2 + 1e-9,
  '[' + epsRange[0].toFixed(3) + ', ' + epsRange[1].toFixed(3) + ']');

console.log('\n--- 边界内缩：沿边界位置不会落在角上 ---');
var insetOK = true;
T.buildRound({
  nTrials: 200, pSignal: 0.5, epsilonIn: 1.0, jitter: 0,
  zoneWidthIn: 17, zoneHeightIn: 20, edgeInsetIn: 1.5, seed: 7
}).forEach(function (t) {
  if (t.axis === 'horizontal') {
    if (Math.abs(t.yIn) > 20 / 2 - 1.5 + 1e-9) insetOK = false;
  } else {
    if (Math.abs(t.xIn) > 17 / 2 - 1.5 + 1e-9) insetOK = false;
  }
});
ok('沿边界位置均与两端保持 edgeInset 以上的距离', insetOK);

console.log('\n--- 反馈图上"球边 → 好球区线"那一段的长度必须正好等于 ε ---');
// 这是画面上唯一被标出来的量：反馈阶段用一条短粗线连接球边与好球区线，
// 它的长度就是 ε（好球 = 压线深度，坏球 = 空隙）。这里逐试次核对。
var segOK = true, segWorst = 0;
T.buildRound({
  nTrials: 400, pSignal: 0.5, epsilonIn: 1.0, jitter: 0.2,
  zoneWidthIn: 17, zoneHeightIn: 20.7, edgeInsetIn: 3.0, sigmaExtIn: 1.0, seed: 31337
}).forEach(function (t) {
  var halfW = t.zoneWidthIn / 2, halfH = t.zoneHeightIn / 2, r = C.zone.ballRadiusIn;
  var signed;   // 从好球区线指向球边（朝区内为正）
  if (t.edge === 'left')       signed = (t.xIn + r) - (-halfW);
  else if (t.edge === 'right') signed = halfW - (t.xIn - r);
  else if (t.edge === 'top')   signed = halfH - (t.yIn - r);
  else                         signed = (t.yIn + r) - (-halfH);

  if (Math.abs(signed - t.signedDistIn) > 1e-9) segOK = false;
  if (Math.abs(Math.abs(signed) - t.epsilonIn) > 1e-9) segOK = false;
  segWorst = Math.max(segWorst, Math.abs(Math.abs(signed) - t.epsilonIn));
});
ok('线段长度 = ε，且符号与信号/噪声一致（400 个试次）', segOK,
  '最大偏差 ' + segWorst.toExponential(2));
ok('好球试次的这一小段在好球区线以内（压线）',
  T.buildRound({
    nTrials: 100, pSignal: 1.0, epsilonIn: 0.6, jitter: 0,
    zoneWidthIn: 17, zoneHeightIn: 20.7, edgeInsetIn: 3.0, sigmaExtIn: 1.0, seed: 5
  }).every(function (t) { return t.signedDistIn > 0; }));
ok('坏球试次的这一小段在好球区线以外（空隙）',
  T.buildRound({
    nTrials: 100, pSignal: 0.0, epsilonIn: 0.6, jitter: 0,
    zoneWidthIn: 17, zoneHeightIn: 20.7, edgeInsetIn: 3.0, sigmaExtIn: 1.0, seed: 6
  }).every(function (t) { return t.signedDistIn < 0; }));

console.log('\n=== 6. 统计与分组 ===');
var counts2 = S.emptyCounts();
var fakeTrials = [
  { isSignal: true,  edge: 'top', axis: 'vertical' },
  { isSignal: false, edge: 'top', axis: 'vertical' },
  { isSignal: true,  edge: 'left', axis: 'horizontal' }
];
S.tally(counts2, fakeTrials[0], 'strike');   // H
S.tally(counts2, fakeTrials[1], 'strike');   // FA
S.tally(counts2, fakeTrials[2], 'timeout');  // timeout（剔除）
ok('H/FA/timeout 计数正确', counts2.H === 1 && counts2.FA === 1 && counts2.timeout === 1,
  JSON.stringify(counts2));
ok('默认策略下超时不进入 SDT 计数', counts2.H + counts2.M + counts2.FA + counts2.CR === 2);

var counts3 = S.emptyCounts();
S.tally(counts3, fakeTrials[2], 'timeout', 'asNo');  // 应记为 Miss
ok('asNo 策略下超时按判坏球计入 Miss', counts3.M === 1 && counts3.timeout === 1, JSON.stringify(counts3));

var groups = S.groupCounts(
  [fakeTrials[0], fakeTrials[1], fakeTrials[2]],
  [{ response: 'strike', rating: 4 }, { response: 'strike', rating: 3 }, { response: 'timeout', rating: 1 }],
  function (t) { return t.axis; }
);
ok('按轴分组得到 vertical / horizontal 两组',
  groups.vertical && groups.horizontal && groups.vertical.H === 1 && groups.vertical.FA === 1,
  JSON.stringify(groups));

console.log('\n=== 7. ROC 信心评级法（模式 A）===');
var rTrials = [], rRecords = [];
var seedRng = T.makeRng(2024);
for (var i = 0; i < 40; i++) {
  var isS = i < 20;
  rTrials.push({ isSignal: isS });
  // 模拟一个有分辨力的被试：信号试次偏高评级，噪声试次偏低
  var lat = (isS ? 1.0 : -1.0) + (seedRng() * 2 - 1) * 1.1;
  var rating = lat > 0.8 ? 4 : lat > 0 ? 3 : lat > -0.8 ? 2 : 1;
  rRecords.push({ response: rating >= 3 ? 'strike' : 'ball', rating: rating });
}
var roc = S.rocFromRatings(rTrials, rRecords, 'loglinear');
ok('产出 3 个 ROC 点', roc.length === 3);
ok('ROC 点随切点变严而更保守（P(FA) 不增）',
  roc[0].point.pfa <= roc[1].point.pfa + 1e-12 && roc[1].point.pfa <= roc[2].point.pfa + 1e-12,
  roc.map(function (r) { return r.point.pfa.toFixed(3); }).join(' → '));
ok('曲线下面积 AUC 落在 (0.5, 1)',
  (function () { var a = M.auc(roc.map(function (r) { return r.point; })); return a > 0.5 && a <= 1; })(),
  'AUC=' + M.auc(roc.map(function (r) { return r.point; })).toFixed(4));
console.log('\n--- 外部显示噪声 σ_ext 是否按设定注入 ---');
var noiseTrials = T.buildRound({
  nTrials: 2000, pSignal: 0.5, epsilonIn: 1.0, jitter: 0,
  zoneWidthIn: 17, zoneHeightIn: 20, edgeInsetIn: 1.5, sigmaExtIn: 1.0, seed: 424242
});
var nX = noiseTrials.map(function (t) { return t.noiseXIn; });
var meanX = nX.reduce(function (a, b) { return a + b; }, 0) / nX.length;
var sdX = Math.sqrt(nX.reduce(function (a, b) { return a + (b - meanX) * (b - meanX); }, 0) / (nX.length - 1));
ok('显示噪声均值 ≈ 0', Math.abs(meanX) < 0.1, 'mean=' + meanX.toFixed(4));
ok('显示噪声标准差 ≈ σ_ext = 1.0', Math.abs(sdX - 1.0) < 0.06, 'sd=' + sdX.toFixed(4));
ok('显示位置 = 真实位置 + 噪声',
  noiseTrials.every(function (t) { return near(t.dispXIn, t.xIn + t.noiseXIn, 1e-12); }));

console.log('\n=== 8. d′–ε 回归与噪声反推 ===');
// 造一组符合 d′ = 2ε/σ_total（σ_total = 1.3）的数据
var synth = [0.3, 0.6, 1.0, 2.0, 3.0].map(function (e) {
  return { epsilonIn: e, dprime: 2 * e / 1.3 };
});
var fit = M.fitEpsilonSlope(synth, 1.0);
ok('回归成功', fit.ok === true);
ok('σ_total 还原为 1.3', near(fit.sigmaTotal, 1.3, 1e-9), 'σ_total=' + fit.sigmaTotal.toFixed(6));
ok('σ_int = sqrt(1.3² − 1.0²) ≈ 0.8307', near(fit.sigmaInternal, Math.sqrt(1.69 - 1.0), 1e-9),
  'σ_int=' + fit.sigmaInternal.toFixed(6));
ok('R² = 1（数据完全线性）', near(fit.r2, 1, 1e-9), 'R²=' + fit.r2.toFixed(8));

// 加入噪声后 σ_total 应仍接近真值
var noisy = [0.3, 0.6, 1.0, 2.0, 3.0].map(function (e, i) {
  var jitter = [0.10, -0.08, 0.12, -0.06, 0.05][i];
  return { epsilonIn: e, dprime: 2 * e / 1.3 + jitter };
});
var fit2 = M.fitEpsilonSlope(noisy, 1.0);
ok('含噪声数据 σ_total 接近 1.3', Math.abs(fit2.sigmaTotal - 1.3) < 0.15,
  'σ_total=' + fit2.sigmaTotal.toFixed(4) + ', R²=' + fit2.r2.toFixed(4));

// 若外部噪声大于总噪声，σ_int 应钳制为 0 而不是 NaN
var impossible = [{ epsilonIn: 1.0, dprime: 6.0 }, { epsilonIn: 3.0, dprime: 18.0 }];
var fitImp = M.fitEpsilonSlope(impossible, 1.0);
ok('σ_total < σ_ext 时 σ_int 钳制为 0', fitImp.sigmaInternal === 0,
  'σ_total=' + fitImp.sigmaTotal.toFixed(4) + ', σ_int=' + fitImp.sigmaInternal);

var fit3 = M.fitEpsilonSlope([{ epsilonIn: 1.0, dprime: 2.0 }], 1.0);
ok('只有一个 ε 水平时拒绝拟合并给出理由', fit3.ok === false && !!fit3.reason, fit3.reason);

console.log('\n=== 9. 会话历史 ===');
var hist = new S.History();
hist.add({ condition: { styleId: 'neutral', pSignal: 0.5, batterHeightCm: 180 }, metrics: { epsilonIn: 1.0, dprime: 2.0, pFA: 0.2, pHit: 0.9, c: 0 } });
hist.add({ condition: { styleId: 'neutral', pSignal: 0.5, batterHeightCm: 180 }, metrics: { epsilonIn: 2.0, dprime: 3.6, pFA: 0.1, pHit: 0.95, c: 0 } });
hist.add({ condition: { styleId: 'neutral', pSignal: 0.5, batterHeightCm: 180 }, metrics: { epsilonIn: 2.0, dprime: 3.6, pFA: 0.05, pHit: 0.95, c: 0.5 } });
ok('sameCondition 只取条件一致的前两局', hist.sameCondition({ styleId: 'neutral', pSignal: 0.5, batterHeightCm: 180 }).length === 3);
ok('usedEpsilons 去重升序', JSON.stringify(hist.usedEpsilons()) === JSON.stringify([1, 2]), JSON.stringify(hist.usedEpsilons()));
ok('按难度收集 ROC 点（同一 ε=2 的两局）', hist.rocPointsByLevel(2).length === 2);

console.log('\n=== 10. 配置自检 ===');
ok('默认难度 L3 的 ε = 1.0 in', C.getLevel(C.defaultLevelId).epsilonIn === 1.0);
ok('理论 d′ (ε=1.0, σ=1.0) = 2.0', near(C.theoreticalDprime(1.0), 2.0));
ok('打者 180cm 的好球区高度 ≈ 20.7 in', near(C.zone.zoneHeightIn(180), 20.7, 1e-9),
  C.zone.zoneHeightIn(180).toFixed(2) + ' in');
ok('好球区宽度 = 17 in（本垒板宽）', C.zone.plateWidthIn === 17);
ok('c > 0 对应"打者友好/严抓"', C.getStyle('batter').kIn > 0 && C.getStyle('pitcher').kIn < 0);
ok('沿边界内缩量 ≥ 3σ_ext（否则相邻边界会混进本试次）',
  C.zone.edgeInsetIn >= 3 * C.externalNoiseIn,
  'edgeInset=' + C.zone.edgeInsetIn + '″, σ_ext=' + C.externalNoiseIn + '″');
ok('理论 d′ 上限随 ε 单调下降（难度确实在变难）',
  (function () {
    var ls = C.difficultyLevels;
    for (var i = 1; i < ls.length; i++) {
      if (C.theoreticalDprime(ls[i].epsilonIn) >= C.theoreticalDprime(ls[i - 1].epsilonIn)) return false;
    }
    return true;
  })(),
  C.difficultyLevels.map(function (l) { return C.theoreticalDprime(l.epsilonIn).toFixed(1); }).join(' > '));
ok('默认难度给出可测量的 d′ 上限（既非天花板也非瞎猜）',
  C.theoreticalDprime(C.getLevel(C.defaultLevelId).epsilonIn) > 1 &&
  C.theoreticalDprime(C.getLevel(C.defaultLevelId).epsilonIn) < 4,
  'd′上限=' + C.theoreticalDprime(C.getLevel(C.defaultLevelId).epsilonIn).toFixed(2));

console.log('\n--- 打者身高 → 好球区高度 ---');
C.zone.batterHeightsCm.forEach(function (h) {
  var z = C.zone.zoneHeightIn(h);
  console.log('    ' + h + ' cm → 好球区高 ' + z.toFixed(2) + '″（' +
    (z * 2.54).toFixed(1) + ' cm）');
});
ok('身高越高好球区越高',
  C.zone.zoneHeightIn(195) > C.zone.zoneHeightIn(170),
  C.zone.zoneHeightIn(170).toFixed(1) + '″ < ' + C.zone.zoneHeightIn(195).toFixed(1) + '″');
ok('好球区高度落在真实棒球的合理区间（约 19–23″）',
  C.zone.zoneHeightIn(170) > 19 && C.zone.zoneHeightIn(195) < 23);

console.log('\n========================================');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
