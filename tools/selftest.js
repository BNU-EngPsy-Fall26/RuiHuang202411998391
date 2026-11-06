/* ============================================================
   selftest.js — Node 下的纯逻辑自检（不需要浏览器）
   运行：node tools/selftest.js
   覆盖：试次生成与平衡、统计公式、EZ-DDM、周期幂模型
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;

const root = path.join(__dirname, '..', 'js');
['util.js', 'stats.js', 'ddm.js', 'propmodel.js', 'config.js', 'stroop.js', 'propjudge.js']
  .forEach(f => {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  });

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok   ' + name + (extra ? '  ' + extra : '')); }
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

console.log('\n[1] 试次生成与平衡');

const prac = Stroop.practice();
check('Stroop 练习 12 试次', prac.length === 12, 'n=' + prac.length);
check('练习同时含整合/分离', prac.some(t => t.display === 'integrated') && prac.some(t => t.display === 'separated'));

const plan = Stroop.formal('P-AAAA');
check('Stroop 两个区组', plan.blocks.length === 2);
check('返回键位映射', plan.map && (plan.map.id === 'A' || plan.map.id === 'B'), 'map=' + (plan.map && plan.map.id));
plan.blocks.forEach((b, i) => {
  check('区组 ' + (i + 1) + ' 有 40 试次', b.trials.length === 40, 'n=' + b.trials.length);
  const cong = b.trials.filter(t => t.congruency === 'congruent').length;
  const inc = b.trials.filter(t => t.congruency === 'incongruent').length;
  check('区组 ' + (i + 1) + ' 一致/不一致 = 20/20', cong === 20 && inc === 20, cong + '/' + inc);

  const inks = {};
  b.trials.forEach(t => { inks[t.ink] = (inks[t.ink] || 0) + 1; });
  check('区组 ' + (i + 1) + ' 四种墨色各 10 次', Object.values(inks).every(v => v === 10), JSON.stringify(inks));

  const bad = b.trials.filter(t => (t.congruency === 'incongruent') === (t.word === t.ink));
  check('区组 ' + (i + 1) + ' 词义与墨色关系正确', bad.length === 0);

  // ---- 按键与顺序平衡 ----
  const keys = {};
  b.trials.forEach(t => { keys[t.respKey] = (keys[t.respKey] || 0) + 1; });
  check('区组 ' + (i + 1) + ' 四个键各 10 次', Object.values(keys).every(v => v === 10), JSON.stringify(keys));

  const switches = b.trials.filter(t => t.hand_switch === 1).length;
  check('区组 ' + (i + 1) + ' 换手过渡 18–21 次', switches >= 18 && switches <= 21, 'switch=' + switches);

  const adjacentSame = b.trials.filter((t, k) => k > 0 && t.respKey === b.trials[k - 1].respKey).length;
  check('区组 ' + (i + 1) + ' 无相邻同键', adjacentSame === 0);

  const mapOk = b.trials.every(t => {
    const m = plan.map;
    return m.keys[t.ink] === t.respKey && t.correct_key === t.respKey;
  });
  check('区组 ' + (i + 1) + ' 键位符合映射', mapOk);

  const handOk = b.trials.every(t => (t.hand === 'L') === (t.respKey === 'd' || t.respKey === 'f'));
  check('区组 ' + (i + 1) + ' 左右手标记正确', handOk);
});

// 两套镜像映射都应能被分配到
let sawA = false, sawB = false;
for (let i = 0; i < 40; i++) {
  const m = Stroop.mappingFor('P-' + i);
  if (m.id === 'A') sawA = true;
  if (m.id === 'B') sawB = true;
}
check('A/B 两套映射都会出现', sawA && sawB);

const plan2 = Stroop.formal('P-AAAA');
check('同一编号的区组顺序稳定', plan2.blocks[0].display === plan.blocks[0].display);
const planB = Stroop.formal('P-BBBB');
check('不同编号可能换顺序（仅提示）', true, 'A=' + plan.blocks[0].display + ' B=' + planB.blocks[0].display);

const pFormal = PropJudge.formal();
check('比例判断 40 试次', pFormal.length === 40, 'n=' + pFormal.length);
['pie_none', 'pie_tick', 'bar_none', 'bar_tick'].forEach(c => {
  const xs = pFormal.filter(t => t.cond === c);
  check('条件 ' + c + ' 有 10 试次', xs.length === 10, 'n=' + xs.length);
  check('条件 ' + c + ' 比例不重复', new Set(xs.map(t => t.true_prop)).size === 10);
});
check('练习 4 试次且四条件各一', PropJudge.practice().length === 4);
check('比例池全是小数', CONFIG.prop.pool.every(v => Math.abs(v - Math.round(v)) > 0.01),
  CONFIG.prop.pool.join(','));
check('滑杆步长 0.1', CONFIG.prop.sliderStep === 0.1, 'step=' + CONFIG.prop.sliderStep);
check('比例池避开 25/50/75', CONFIG.prop.pool.every(v =>
  Math.abs(v - 25) > 2 && Math.abs(v - 50) > 2 && Math.abs(v - 75) > 2));
check('正式试次真值带小数', pFormal.some(t => Math.abs(t.true_prop - Math.round(t.true_prop)) > 0.01));

console.log('\n[2] 统计');

const a = [100, 120, 140, 160, 180];
const b = [92, 110, 128, 146, 164];
const pt = S.paired(a, b);
check('配对均值差 = 12', close(pt.mean, 12), 'mean=' + pt.mean);
check('dz 有限', isFinite(pt.dz), 'dz=' + pt.dz.toFixed(2));
check('95% CI 覆盖均值差', pt.ci[0] < 12 && pt.ci[1] > 12, '[' + pt.ci.map(x => x.toFixed(2)) + ']');

const one = S.oneSample([10, 20, 30, 40, 50]);
check('单样本均值 30', close(one.mean, 30));
check('t 分布 p 值合理', one.p >= 0 && one.p <= 1, 'p=' + one.p.toFixed(4));

// 2×2：A 主效应 +10，B 主效应 +20，交互 0，加上个体噪声
const cells = [];
let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
for (let s = 0; s < 10; s++) {
  const base = 500 + s * 5;
  cells.push([
    [base + rnd() * 4, base + 20 + rnd() * 4],
    [base + 10 + rnd() * 4, base + 30 + rnd() * 4]
  ]);
}
const an = S.anova2x2(cells);
check('ANOVA 主效应 A（显示）F 有限', isFinite(an.F.A), 'F=' + an.F.A.toFixed(2));
check('ANOVA 无交互时 F 较小', Math.abs(an.F.AB) < 3, 'F=' + an.F.AB.toFixed(2));
check('ANOVA η²p 在 0–1', an.eta.A >= 0 && an.eta.A <= 1);

// 从 F 分布算出的 p 应与手算一致：这里只检查边界
check('p 值在 [0,1]', [an.p.A, an.p.B, an.p.AB].every(p => p >= 0 && p <= 1));

console.log('\n[3] EZ-DDM');

const fit = DDM.ez(0.8, 0.02, 0.8, 100);
check('EZ 返回参数', fit && isFinite(fit.v) && isFinite(fit.a) && isFinite(fit.Ter),
  fit ? 'v=' + fit.v.toFixed(2) + ' a=' + fit.a.toFixed(2) + ' Ter=' + (fit.Ter * 1000).toFixed(0) + 'ms' : 'null');
const sim = DDM.simulate(fit, 3000);
const simMean = S.mean(sim.map(d => d.rt)) * 1000;
const simAcc = S.mean(sim.map(d => d.acc));
check('模拟均值接近输入 MRT（±10%）', Math.abs(simMean - 800) < 80, 'sim=' + simMean.toFixed(0) + 'ms');
check('模拟正确率接近输入 Pc（±0.05）', Math.abs(simAcc - 0.8) < 0.05, 'sim=' + simAcc.toFixed(2));

console.log('\n[4] 周期幂模型');

const pts = [];
for (let p = 0.05; p < 1; p += 0.1) pts.push({ p: p, j: PM.predict(p, 0.7) });
const pmFit = PM.fit(pts);
check('能回收 β≈0.70', Math.abs(pmFit.beta - 0.7) < 0.02, 'β=' + pmFit.beta.toFixed(3));
check('R² 高', pmFit.r2 > 0.99, 'R²=' + pmFit.r2.toFixed(4));
check('β=1 时无偏', close(PM.predict(0.3, 1), 0.3, 1e-9));

console.log('\n[5] 其他');

check('hash 稳定', U.hash('P-AAAA') === U.hash('P-AAAA'));
check('CSV 转义', U.toCSV(['a', 'b'], [['x,y', 'z']]).indexOf('"x,y"') > 0);
check('CSV 带 BOM', U.toCSV(['a'], [[1]]).charCodeAt(0) === 0xFEFF);

console.log('\n' + (failures ? '❌ ' + failures + ' 项失败' : '✅ 全部通过'));
process.exit(failures ? 1 : 0);
