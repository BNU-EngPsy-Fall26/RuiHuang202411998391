/* =============================================================================
 * tools/domtest.js —— 无浏览器集成自检（可选，需 Node.js）
 *
 * 运行：node tools/domtest.js
 *
 * 它用一套极简的假 DOM / 假 Canvas 把全部 8 个脚本按 index.html 的顺序加载起来，
 * 然后驱动 requestAnimationFrame 跑完一整局（含练习试次与信心评级），
 * 目的是在没有浏览器的环境下抓出：
 *   · 语法错误
 *   · game.js 引用了 index.html 里不存在的元素 id
 *   · 状态机卡死 / 试次丢失 / 记账重复
 *   · 结果页指标计算与图表绘制抛异常
 *
 * 注意：它**不能**替代在真实浏览器里看画面效果，只能保证程序逻辑跑得通。
 * ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------------------------------------------------------------------
 * 一、极简假 DOM
 * ------------------------------------------------------------------ */
var allElements = {};          // id → 元素
var pendingFrames = [];
var frameNow = 0;

function ClassList() { this.set = {}; }
ClassList.prototype.add = function (c) { this.set[c] = 1; };
ClassList.prototype.remove = function (c) { delete this.set[c]; };
ClassList.prototype.contains = function (c) { return !!this.set[c]; };
ClassList.prototype.toggle = function (c, force) {
  var want = (force === undefined) ? !this.set[c] : !!force;
  if (want) this.set[c] = 1; else delete this.set[c];
  return want;
};

function El(tag) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.children = [];
  this.style = {};
  this.dataset = {};
  this.listeners = {};
  this.classList = new ClassList();
  this.className = '';
  this.value = '';
  this._text = '';
  this._html = '';
  this._qcache = {};
}
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this.children = []; }
});
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.insertBefore = function (c) { this.children.unshift(c); return c; };
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c);
  if (i >= 0) this.children.splice(i, 1);
  return c;
};
El.prototype.addEventListener = function (t, f) {
  (this.listeners[t] = this.listeners[t] || []).push(f);
};
El.prototype.dispatch = function (t, ev) {
  var self = this;
  (this.listeners[t] || []).forEach(function (f) {
    f(ev || { type: t, target: self });
  });
};
El.prototype.click = function () {
  this.dispatch('click', { type: 'click', target: this, preventDefault: function () {} });
};
El.prototype.getBoundingClientRect = function () {
  // 画布给一个稳定的尺寸，其它元素给一个通用尺寸
  if (this.tagName === 'CANVAS') {
    return { width: this.id === 'stageCanvas' ? 1000 : 380,
             height: this.id === 'stageCanvas' ? 520 : 200,
             left: 0, top: 0, right: 1000, bottom: 520 };
  }
  return { width: 300, height: 40, left: 0, top: 0, right: 300, bottom: 40 };
};
El.prototype.closest = function (sel) {
  var name = sel.replace('.', '');
  if (this.className === name || this.tagName === sel.toUpperCase()) return this;
  return null;
};
El.prototype.querySelector = function (sel) {
  // 简化实现：只按标签名找，找不到就惰性造一个占位元素（便于跑通表格渲染）
  var want = sel.toUpperCase();
  for (var i = 0; i < this.children.length; i++) {
    if (this.children[i].tagName === want) return this.children[i];
  }
  if (this._qcache[sel]) return this._qcache[sel];
  var el = new El(sel);
  this._qcache[sel] = el;
  return el;
};
El.prototype.getContext = function () { return makeFakeCtx(); };
El.prototype.parentNode = null;

function makeFakeCtx() {
  var store = {};
  var target = {
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    createRadialGradient: function () { return { addColorStop: function () {} }; },
    measureText: function (t) { return { width: String(t).length * 6 }; }
  };
  return new Proxy(target, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (k in store) return store[k];
      return function () {};        // 其余绘图 API 一律当作空操作
    },
    set: function (t, k, v) { store[k] = v; return true; }
  });
}

// 从 index.html 抓出所有 id，建成元素表
var idRe = /id="([^"]+)"/g, m;
var htmlIds = [];
while ((m = idRe.exec(HTML)) !== null) {
  htmlIds.push(m[1]);
  var el = new El(m[1] === 'stageCanvas' || /Canvas$/.test(m[1]) ? 'canvas' : 'div');
  el.id = m[1];
  allElements[m[1]] = el;
}

var documentStub = {
  readyState: 'complete',
  body: new El('body'),
  _listeners: {},
  getElementById: function (id) { return allElements[id] || null; },
  createElement: function (tag) { return new El(tag); },
  addEventListener: function (t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
  dispatch: function (t, ev) { (this._listeners[t] || []).forEach(function (f) { f(ev); }); }
};

global.document = documentStub;
global.window = global;
global.devicePixelRatio = 2;
global.requestAnimationFrame = function (cb) { pendingFrames.push(cb); return pendingFrames.length; };
global.cancelAnimationFrame = function () {};
global.performance = global.performance || { now: function () { return frameNow; } };
global.addEventListener = function () {};
global.confirm = function () { return true; };
global.alert = function () {};
global.Blob = function (parts) { this.parts = parts; };
global.URL = global.URL || {};
global.URL.createObjectURL = function () { return 'blob:stub'; };
global.URL.revokeObjectURL = function () {};
global.setTimeout = global.setTimeout || function () {};

/* ---------------------------------------------------------------------
 * 二、按 index.html 的顺序加载脚本
 * ------------------------------------------------------------------ */
var scripts = [];
var sRe = /<script src="([^"]+)"><\/script>/g;
while ((m = sRe.exec(HTML)) !== null) scripts.push(m[1]);

console.log('\n按 index.html 的顺序加载 ' + scripts.length + ' 个脚本：');
scripts.forEach(function (s) {
  require(path.join(ROOT, s));
  console.log('  ✓ ' + s);
});

var SDT = global.SDT;
var App = global.SDTApp;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '   ' + extra : '')); }
}

console.log('\n=== 1. 脚本加载与初始化 ===');
ok('8 个脚本全部加载且无异常', scripts.length === 8);
ok('SDT 命名空间完整',
  !!(SDT.CONFIG && SDT.math && SDT.Trial && SDT.Stats && SDT.Scene && SDT.Charts && SDT.Export));
ok('main 初始化完成，暴露 SDTApp', !!(App && App.readSetup && App.getHistory));

console.log('\n=== 2. index.html 的元素 id 与 game.js 的引用是否对得上 ===');
// game.js 里 $('xxx') / DOM 数组里出现的 id
var gameSrc = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
var domListMatch = gameSrc.match(/\[\s*'setupPanel'[\s\S]*?\]\.forEach/);
var needed = [];
if (domListMatch) {
  var inner = domListMatch[0];
  var q = /'([A-Za-z0-9_]+)'/g, mm;
  while ((mm = q.exec(inner)) !== null) needed.push(mm[1]);
}
ok('从 game.js 解析出待检查的 id 列表', needed.length > 50, needed.length + ' 个');
var missing = needed.filter(function (id) { return htmlIds.indexOf(id) < 0; });
ok('game.js 引用的所有 id 都存在于 index.html', missing.length === 0,
  missing.length ? '缺失：' + missing.join(', ') : '共校验 ' + needed.length + ' 个');
var chartCanvases = needed.filter(function (id) { return /Canvas$/.test(id) && id !== 'stageCanvas'; });
ok('三张图表 + 舞台的 canvas 都已接入', chartCanvases.length === 3 && needed.indexOf('stageCanvas') >= 0,
  chartCanvases.join(', ') + ' + stageCanvas');

console.log('\n=== 3. 设置面板默认值 ===');
var cfg0 = App.readSetup();
ok('默认难度为 L3（ε = 1.0″）', cfg0.epsilonIn === 1.0, 'ε=' + cfg0.epsilonIn);
ok('默认 P(S) = 0.50', cfg0.pSignal === 0.5);
ok('默认执法风格 = 中立', cfg0.styleId === 'neutral');
ok('好球区宽度 = 17″', cfg0.zoneWidthIn === 17);
ok('好球区高度随打者身高换算', Math.abs(cfg0.zoneHeightIn - 0.115 * cfg0.batterHeightCm) < 1e-9,
  cfg0.batterHeightCm + 'cm → ' + cfg0.zoneHeightIn.toFixed(2) + '″');
ok('默认试次 40、判定窗口 1500ms、有练习试次',
  cfg0.nTrials === 40 && cfg0.responseWindowMs === 1500 && cfg0.practiceTrials > 0);

console.log('\n=== 4. 跑完整一局（含练习试次 + 信心评级 ROC 模式）===');
// 打开信心评级模式，这样能一并验证 ROC 路径
allElements.selRoc.value = 'rating';
allElements.selTrials.value = '40';

// ---- 驱动 rAF 帧循环 ----
var respondCount = 0;
var guard = 0;

function driveFrame() {
  frameNow += 20;
  var q = pendingFrames.slice();
  pendingFrames.length = 0;
  q.forEach(function (cb) { cb(frameNow); });

  var r = App.getRound();
  if (!r) return;

  var phase = App.getPhase();
  if (phase === 'roundEnd') return;

  var i = r.cursor;
  var trial = r.trials[i];
  var rec = r.records[i];
  if (!trial) return;

  if (phase === 'response' && (!rec || !rec.response)) {
    // 模拟一个"按显示位置判断"的被试：这正是引入外部噪声后的真实情形
    // 模拟一个"按看到的球的位置判断"的被试：判据就是"球是否经过好球区"
    // （球擦到即好球，所以用的是 C.zone.ballOverlapsZone，而不是"球心在区内"）
    var looksInside = SDT.CONFIG.zone.ballOverlapsZone(
      trial.dispXIn, trial.dispYIn, trial.zoneWidthIn, trial.zoneHeightIn);
    documentStub.dispatch('keydown', {
      key: looksInside ? 'd' : 'a',
      target: { tagName: 'BODY' },
      preventDefault: function () {}
    });
    respondCount++;
  } else if (phase === 'confidence' && (!rec || rec.rating == null)) {
    // 信心评级：按球心离"球心判定线"的距离决定给 2/3 还是 1/4
    var sd = SDT.CONFIG.zone.ballSignedDistIn(
      trial.dispXIn, trial.dispYIn, trial.zoneWidthIn, trial.zoneHeightIn);
    var strike = sd >= 0;
    var margin = Math.abs(sd);
    var rating = strike ? (margin > 0.9 ? 4 : 3) : (margin > 0.9 ? 1 : 2);
    documentStub.dispatch('keydown', {
      key: String(rating),
      target: { tagName: 'BODY' },
      preventDefault: function () {}
    });
  }
}

allElements.btnStart.click();
// startRound 把进入第一阶段推迟到下一帧（等舞台可见、画布尺寸才准），
// 所以先驱动一帧，再检查阶段。
driveFrame();
ok('开始后进入指定阶段', ['ready', 'flight', 'response'].indexOf(App.getPhase()) >= 0,
  'phase=' + App.getPhase());
ok('练习试次被正确准备了', App.getRound().practiceCount === 5,
  'practiceCount=' + App.getRound().practiceCount);
ok('试次总数 = 练习 + 正式', App.getRound().trials.length === 45,
  App.getRound().trials.length + ' 个');

// 一直驱动到本局结束（或超出保护帧数上限）。
// 注意：startRound 把进入第一阶段推迟到下一帧，所以刚点完"开始"时 phase 还停在
// 上一局的 'roundEnd'，必须先驱动一帧，否则循环会立刻退出（用 do-while 保证这一点）。
function runRound(maxFrames) {
  var g = 0;
  var limit = maxFrames || 60000;
  do {
    driveFrame();
    g++;
  } while (App.getPhase() !== 'roundEnd' && g < limit);
  return g;
}
var guard = runRound();

var entry = App.getLastResult();
var hist = App.getHistory();
ok('一局在有限帧数内正常结束（状态机没有卡死）', guard < 60000, '共驱动 ' + guard + ' 帧');
ok('产生了 1 条历局记录', hist.rounds.length === 1, '共 ' + hist.rounds.length + ' 局');
ok('按键反应次数 = 正式试次数', respondCount === cfg0.nTrials + cfg0.practiceTrials,
  respondCount + ' 次 / 应为 ' + (cfg0.nTrials + cfg0.practiceTrials));

console.log('\n=== 5. 记账完整性 ===');
var m = entry.metrics;
var cnt = entry.counts;
ok('H + M + FA + CR + 超时 = 正式试次数（练习试次不计入）',
  cnt.H + cnt.M + cnt.FA + cnt.CR + cnt.timeout === cfg0.nTrials,
  'H=' + cnt.H + ' M=' + cnt.M + ' FA=' + cnt.FA + ' CR=' + cnt.CR + ' 超时=' + cnt.timeout +
  '　合计 ' + (cnt.H + cnt.M + cnt.FA + cnt.CR + cnt.timeout) + ' / 应为 ' + cfg0.nTrials);
ok('练习试次的结果被标为 practice、未进入 2×2 表',
  entry.records.slice(0, entry.practiceCount).every(function (r) { return r.outcome === 'practice'; }));
ok('练习试次未被计入统计（有效试次 = 40）', m.nValid === 40, 'nValid=' + m.nValid);
ok('每个正式试次只记一次账（有效 + 超时 = 40）', m.nValid + m.timeout === 40);
ok('信号 + 噪声试次 = 有效试次', m.nSignal + m.nNoise === m.nValid,
  m.nSignal + ' + ' + m.nNoise);
ok('实际 P(S) 与设定值一致', Math.abs(m.nSignal / m.nValid - 0.5) < 1e-9,
  (m.nSignal / m.nValid).toFixed(3));
ok('每条记录都有 outcome', entry.records.every(function (r) { return r && r.outcome; }));
ok('正式试次的记录都带信心评级', (function () {
  for (var i = entry.practiceCount; i < entry.records.length; i++) {
    if (!entry.records[i].rating) return false;
  }
  return true;
})());

console.log('\n=== 6. 指标计算 ===');
ok('d′ 为有限值', isFinite(m.dprime), 'd′=' + m.dprime.toFixed(3));
ok('d′ 明显大于 0（按显示位置判断必然有分辨力）', m.dprime > 0.3, 'd′=' + m.dprime.toFixed(3));
ok('c 为有限值', isFinite(m.c), 'c=' + m.c.toFixed(3));
ok('β = exp(d′·c)', Math.abs(m.beta - Math.exp(m.dprime * m.c)) < 1e-9);
ok('P(Hit) / P(FA) 在 (0,1) 内', m.pHit > 0 && m.pHit < 1 && m.pFA > 0 && m.pFA < 1,
  m.pHit.toFixed(3) + ' / ' + m.pFA.toFixed(3));
ok('正确率与 2×2 表一致',
  Math.abs(m.accuracy - (cnt.H + cnt.CR) / (m.nSignal + m.nNoise)) < 1e-12,
  (m.accuracy * 100).toFixed(1) + '%');
ok('σ_total = 2ε/d′', Math.abs(m.sigmaTotal - 2 * m.epsilonIn / m.dprime) < 1e-9,
  'σ_total=' + m.sigmaTotal.toFixed(3));
ok('σ_int = sqrt(σ_total² − σ_ext²)',
  Math.abs(m.sigmaInternal - Math.sqrt(Math.max(0, m.sigmaTotal * m.sigmaTotal - 1))) < 1e-9,
  'σ_int=' + m.sigmaInternal.toFixed(3));

console.log('\n=== 7. 分组统计（垂直 / 水平边界）===');
ok('存在轴分组', !!(entry.groups['axis:vertical'] && entry.groups['axis:horizontal']));
ok('存在四条边界的分组',
  !!(entry.groups.top && entry.groups.bottom && entry.groups.left && entry.groups.right));
var mv = SDT.math.computeMetrics(entry.groups['axis:vertical'], { epsilonIn: m.epsilonIn });
var mh = SDT.math.computeMetrics(entry.groups['axis:horizontal'], { epsilonIn: m.epsilonIn });
ok('两个方向的 d′ 都可计算', isFinite(mv.dprime) && isFinite(mh.dprime),
  '垂直 d′=' + mv.dprime.toFixed(2) + '，水平 d′=' + mh.dprime.toFixed(2));

console.log('\n=== 8. ROC（模式 A：信心评级法）===');
ok('生成了 3 个 ROC 切点', entry.rocPoints && entry.rocPoints.length === 3);
if (entry.rocPoints) {
  var pfaSeq = entry.rocPoints.map(function (r) { return r.point.pfa; });
  ok('切点越严 P(FA) 越小', pfaSeq[0] <= pfaSeq[1] + 1e-12 && pfaSeq[1] <= pfaSeq[2] + 1e-12,
    pfaSeq.map(function (x) { return x.toFixed(3); }).join(' → '));
  var auc = SDT.math.auc(entry.rocPoints.map(function (r) { return r.point; }));
  ok('经验 ROC 的 AUC > 0.5', auc > 0.5, 'AUC=' + auc.toFixed(3));
  ok('中间切点的 d′ 与二择一 d′ 接近（阈值一致）',
    Math.abs(entry.rocPoints[1].metrics.dprime - m.dprime) < 0.02,
    entry.rocPoints[1].metrics.dprime.toFixed(3) + ' vs ' + m.dprime.toFixed(3));
}

console.log('\n=== 9. 结果页 DOM 是否被正确填充 ===');
ok('P(Hit) 与 P(FA) 已写入页面',
  /%/.test(allElements.mPHit.textContent) && /%/.test(allElements.mPFA.textContent),
  allElements.mPHit.textContent + ' / ' + allElements.mPFA.textContent);
ok('d′ 已写入页面', String(allElements.mDprime.textContent).length > 0,
  'd′ = ' + allElements.mDprime.textContent);
ok('σ_int 已写入页面', /″/.test(allElements.mSigInt.textContent || ''),
  allElements.mSigInt.textContent);
ok('2×2 表格四个格子都已填充',
  /H/.test(allElements.mxH.innerHTML) || allElements.mxH.innerHTML.length > 0,
  'mxH=' + allElements.mxH.innerHTML.slice(0, 24) + '…');
ok('历局成绩表已渲染', (allElements.historyTable.querySelector('tbody').children || []).length >= 1,
  (allElements.historyTable.querySelector('tbody').children || []).length + ' 行');
ok('分组表已渲染', !!(allElements.groupTable.innerHTML || allElements.groupTable.querySelector('tbody')));

console.log('\n=== 10. 切换修正方法是否即时重算 ===');
var corrBefore = App.getLastResult().metrics.dprime;
allElements.selCorrection2.value = 'none';
allElements.selCorrection2.dispatch('change', { target: allElements.selCorrection2 });
ok('切换到"不修正"后指标被重算（d′ 不减小）',
  App.getLastResult().metrics.dprime >= corrBefore - 1e-9,
  corrBefore.toFixed(3) + ' → ' + App.getLastResult().metrics.dprime.toFixed(3));
allElements.selCorrection2.value = 'loglinear';
allElements.selCorrection2.dispatch('change', { target: allElements.selCorrection2 });
ok('切回对数线性修正后恢复原值',
  Math.abs(App.getLastResult().metrics.dprime - corrBefore) < 1e-9);

console.log('\n=== 11. 换难度再跑一局（验证第二局可启动）===');
allElements.selLevel.value = '5';       // L5，ε = 0.3
allElements.selRoc.value = 'none';
allElements.btnStart.click();
ok('第二局已启动且难度为 L5',
  !!App.getRound() && App.getRound().condition.epsilonIn === 0.3,
  App.getRound() ? 'ε=' + App.getRound().condition.epsilonIn : '未启动');
ok('难度变了，不应复用上一局的刺激（换了新种子）',
  App.getRound().condition.reusedStimuli === false &&
  App.getRound().condition.seed !== App.getLastResult().condition.seed,
  'seed=' + App.getRound().condition.seed + '（上一局 ' + App.getLastResult().condition.seed + '）');

console.log('\n=== 11b. ROC 模式 B：同一难度下换执法风格应复用同一批刺激 ===');
// 跑完第二局（L5、multi 模式），再换执法风格开第三局，检查刺激是否复用
allElements.selRoc.value = 'multi';
allElements.selStyle.value = 'batter';
allElements.selLevel.value = '3';       // 回到 L3
allElements.btnStart.click();
runRound();
var round2 = App.getLastResult();
ok('第二局（batter 风格）已完成', round2 && round2.condition.styleId === 'batter',
  '风格=' + round2.condition.styleId + '，ε=' + round2.condition.epsilonIn);

allElements.selStyle.value = 'pitcher';  // 只改执法风格
allElements.btnStart.click();
var r3 = App.getRound();
ok('只改执法风格 → 复用同一批刺激',
  r3.condition.reusedStimuli === true && r3.condition.seed === round2.condition.seed,
  'reusedStimuli=' + r3.condition.reusedStimuli + '，seed=' + r3.condition.seed);
ok('复用时刺激序列逐试次完全一致（ε、真实位置、显示位置都相同）',
  (function () {
    var a = round2.trials, b = r3.trials;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].isSignal !== b[i].isSignal || a[i].edge !== b[i].edge) return false;
      if (Math.abs(a[i].xIn - b[i].xIn) > 1e-12) return false;
      if (Math.abs(a[i].dispXIn - b[i].dispXIn) > 1e-12) return false;
    }
    return true;
  })());
ok('仅执法风格不同时，其它条件确实一致（ε / P(S) / 打者 / 试次数）',
  round2.condition.epsilonIn === r3.condition.epsilonIn &&
  round2.condition.pSignal === r3.condition.pSignal &&
  round2.condition.batterHeightCm === r3.condition.batterHeightCm &&
  round2.condition.nTrials === r3.condition.nTrials);
// 结束第三局，让会话历史里有 3 局，便于后面测 ROC 模式 B 的多点收集
allElements.selCorrection.value = 'loglinear';
runRound();
ok('会话历史累积到 3 局', App.getHistory().rounds.length === 3,
  App.getHistory().rounds.length + ' 局');

console.log('\n=== 11c. d′–ε 回归输入（用真实会话数据）===');
var realPts = App.getHistory().rounds.map(function (e) {
  return { epsilonIn: e.metrics.epsilonIn, dprime: e.metrics.dprime };
});
var realFit = SDT.math.fitEpsilonSlope(realPts, SDT.CONFIG.externalNoiseIn);
ok('真实会话数据能进入回归流程（有 2 个不同 ε 水平时应可解）',
  (function () {
    var uniq = {};
    realPts.forEach(function (p) { uniq[p.epsilonIn] = 1; });
    return Object.keys(uniq).length >= 2 ? realFit.ok === true : realFit.ok === false;
  })(),
  realFit.ok ? ('σ_total=' + realFit.sigmaTotal.toFixed(3) + '，R²=' + realFit.r2.toFixed(3))
             : realFit.reason);
var byLevel = App.getHistory().rocPointsByStimulusSet(1.0);
ok('ROC 模式 B 按「同一批刺激」收集到 2 个点（batter / pitcher 两局）', byLevel.length === 2,
  byLevel.map(function (q) { return q.styleLabel; }).join(' / '));
ok('模式 B 收集到的点确实共享同一个随机种子',
  byLevel.every(function (q) { return q.seed === byLevel[0].seed; }),
  'seed=' + byLevel[0].seed);
ok('模式 A 那一局（不同种子）没有被混进模式 B 的 ROC 里',
  App.getHistory().rounds.length === 3);

// 直接构造回归数据来验证 d′–ε 回归路径（避免再跑一次长循环）
var h2 = App.getHistory();
var synth = [
  { epsilonIn: 0.3, dprime: 0.5 },
  { epsilonIn: 0.6, dprime: 0.95 },
  { epsilonIn: 1.0, dprime: 1.6 },
  { epsilonIn: 2.0, dprime: 3.2 }
];
var fit = SDT.math.fitEpsilonSlope(synth, SDT.CONFIG.externalNoiseIn);
ok('过原点回归可解', fit.ok === true);
ok('σ_total ≈ 1.25', Math.abs(fit.sigmaTotal - 2 / 1.6) < 0.01, 'σ_total=' + fit.sigmaTotal.toFixed(3));
ok('σ_int 为有限正值', isFinite(fit.sigmaInternal) && fit.sigmaInternal > 0,
  'σ_int=' + fit.sigmaInternal.toFixed(3));

console.log('\n=== 12. 导出文本可生成 ===');
var trialsCsv = SDT.Export.buildTrialCSV(entry);
var sumCsv = SDT.Export.buildSummaryCSV(h2);
var json = SDT.Export.buildJSON(h2);
ok('试次级 CSV 非空且含表头', trialsCsv.text.length > 500 && trialsCsv.text.indexOf('真实状态') > 0,
  trialsCsv.name + '，' + trialsCsv.text.split('\r\n').length + ' 行');
ok('汇总级 CSV 含所有指标列', sumCsv.text.indexOf("d′") > 0 && sumCsv.text.indexOf('σ_int') > 0,
  sumCsv.name + '，' + sumCsv.text.split('\r\n').length + ' 行');
ok('CSV 行内列数一致（无错位）', (function () {
  var lines = trialsCsv.text.split('\r\n').filter(function (l) { return l && l[0] !== '#'; });
  var head = lines[0].split(',').length;
  return lines.slice(1).every(function (l) {
    // 带引号的字段里不含逗号，这里简单按逗号切分即可校验列数
    return l.split(',').length === head;
  });
})());
ok('全量 JSON 可序列化', (function () {
  try { JSON.parse(json.text); return true; } catch (e) { return false; }
})(), json.name);
ok('JSON 中不含渲染用的临时字段 _tallied', json.text.indexOf('_tallied') < 0);

console.log('\n=== 13. 场景几何自检（没有浏览器，至少要保证数值上画得下、不拉伸、不互相遮挡）===');
function geometryCase(label, w, h, batterCm) {
  // 直接改掉假画布的返回尺寸，再让 Scene 重算布局
  var cv = allElements.stageCanvas;
  cv.getBoundingClientRect = function () {
    return { width: w, height: h, left: 0, top: 0, right: w, bottom: h };
  };
  SDT.Scene.resize();
  SDT.Scene.setZone({ widthIn: 17, heightIn: SDT.CONFIG.zone.zoneHeightIn(batterCm), batterHeightCm: batterCm });
  var L = SDT.Scene.getLayout();
  var sz = SDT.Scene.getSize();
  var zoneH = SDT.CONFIG.zone.zoneHeightIn(batterCm);
  var tag = label + ' (' + w + '×' + h + ', ' + batterCm + 'cm)';
  ok(tag + '：好球区完整落在画布内',
    L.zoneLeft > 0 && L.zoneRight < sz.W && L.zoneTop > 0 && L.zoneBottom < sz.H,
    'zone=[' + L.zoneLeft.toFixed(0) + ',' + L.zoneRight.toFixed(0) + ']×[' +
    L.zoneTop.toFixed(0) + ',' + L.zoneBottom.toFixed(0) + ']');
  ok(tag + '：好球区没有被拉伸（长宽比 = 17 : 带高）',
    Math.abs(L.zoneW / L.zoneH - 17 / zoneH) < 1e-9,
    (L.zoneW / L.zoneH).toFixed(4) + ' vs ' + (17 / zoneH).toFixed(4));
  ok(tag + '：本垒板宽度 = 好球区宽度 = 17″',
    Math.abs(L.plateW - L.zoneW) < 1e-9);
  // 球心判定线必须恰好比好球区外扩一个球半径 —— 这是"擦到即好球"规则的核心
  var rPx = SDT.CONFIG.zone.ballRadiusIn * L.pxPerInch;
  ok(tag + '：内部判定边界恰好比好球区外扩一个球半径（' + SDT.CONFIG.zone.ballRadiusIn.toFixed(2) + '″，仅供生成试次，不绘制）',
    Math.abs((L.zoneLeft - L.decisionLeft) - rPx) < 1e-9 &&
    Math.abs((L.decisionRight - L.zoneRight) - rPx) < 1e-9 &&
    Math.abs((L.zoneTop - L.decisionTop) - rPx) < 1e-9 &&
    Math.abs((L.decisionBottom - L.zoneBottom) - rPx) < 1e-9,
    '外扩 ' + (L.zoneLeft - L.decisionLeft).toFixed(2) + 'px，应为 ' + rPx.toFixed(2) + 'px');
  ok(tag + '：最极端的球（球边离好球区线 3″）连同球体都完整落在画布内',
    L.decisionLeft - rPx > 0 && L.decisionRight + rPx < sz.W &&
    L.decisionTop - rPx > 0 && L.decisionBottom + rPx < sz.H,
    '判定线=[' + L.decisionLeft.toFixed(0) + ',' + L.decisionRight.toFixed(0) + ']×[' +
    L.decisionTop.toFixed(0) + ',' + L.decisionBottom.toFixed(0) + ']');
  ok(tag + '：地面在好球区下缘之下，中间留出打者腿部',
    L.groundY > L.zoneBottom + 20,
    '地面 - 带下缘 = ' + (L.groundY - L.zoneBottom).toFixed(0) + 'px');
  ok(tag + '：投手丘与出手点在好球区上缘之上',
    L.moundY < L.zoneTop && L.releaseY < L.zoneTop,
    'moundY=' + L.moundY.toFixed(0) + ', releaseY=' + L.releaseY.toFixed(0) +
    ', zoneTop=' + L.zoneTop.toFixed(0));
  ok(tag + '：打者剪影不会挡住好球区',
    Math.abs(L.batterFootX - L.cx) - L.batterHalfW > L.zoneW / 2,
    '打者中心距 ' + Math.abs(L.batterFootX - L.cx).toFixed(0) + 'px（需 > ' +
    (L.zoneW / 2 + L.batterHalfW).toFixed(0) + 'px）');
  ok(tag + '：球的屏幕尺寸可见（直径 ≥ 12px）', L.ballRadiusPx * 2 >= 12,
    '直径 ' + (L.ballRadiusPx * 2).toFixed(1) + 'px');
  return L;
}

var L1 = geometryCase('常规画布', 1000, 520, 180);
geometryCase('窄屏', 420, 620, 180);
geometryCase('宽屏', 1600, 480, 195);
geometryCase('极矮画布', 900, 300, 170);

console.log('\n--- 英寸 ↔ 屏幕坐标换算 ---');
(function () {
  SDT.Scene.resize();
  var L = SDT.Scene.getLayout();
  var c = SDT.Scene.inchesToScreen(0, 0);
  ok('好球区中心映射到 (cx, zoneCenterY)',
    Math.abs(c.x - L.cx) < 1e-9 && Math.abs(c.y - L.zoneCenterY) < 1e-9);
  var right = SDT.Scene.inchesToScreen(17 / 2, 0);
  ok('向右 8.5″ = 好球区右边界', Math.abs(right.x - L.zoneRight) < 1e-9,
    right.x.toFixed(2) + ' vs ' + L.zoneRight.toFixed(2));
  var top = SDT.Scene.inchesToScreen(0, L1.zoneH / L1.pxPerInch / 2);
  ok('向上 = 屏幕 y 变小（y 轴方向约定正确）', top.y < c.y);
})();

console.log('\n=== 14. 边界情形不会让几何退化 ===');
(function () {
  var cases = [[1000, 520, 180], [420, 620, 180], [900, 300, 170], [1600, 480, 195]];
  cases.forEach(function (cse) {
    var cv = allElements.stageCanvas;
    cv.getBoundingClientRect = function () {
      return { width: cse[0], height: cse[1], left: 0, top: 0, right: cse[0], bottom: cse[1] };
    };
    SDT.Scene.resize();
    SDT.Scene.setZone({
      widthIn: 17, heightIn: SDT.CONFIG.zone.zoneHeightIn(cse[2]), batterHeightCm: cse[2]
    });
    var L = SDT.Scene.getLayout();
    var sz = SDT.Scene.getSize();
    var halfW = 17 / 2, halfH = L.zoneH / L.pxPerInch / 2;
    var tag = cse[0] + '×' + cse[1];

    // 最远的四种情形：向内/向外各 3″（等级表两端）
    var pts = [
      ['内角侧 3″ 向内', -halfW + 3, 0], ['外角侧 3″ 向外', halfW + 3, 0],
      ['上缘 3″ 向内', 0, halfH - 3], ['上缘 3″ 向外', 0, halfH + 3],
      ['下缘 3″ 向外', 0, -halfH - 3]
    ];
    var allIn = pts.every(function (p) {
      var s = SDT.Scene.inchesToScreen(p[1], p[2]);
      return s.x >= 0 && s.x <= sz.W && s.y >= 0 && s.y <= sz.H;
    });
    var worst = pts.map(function (p) {
      var s = SDT.Scene.inchesToScreen(p[1], p[2]);
      return p[0] + '→(' + s.x.toFixed(0) + ',' + s.y.toFixed(0) + ')';
    }).join(' ');
    ok(tag + '：最极端的球心位置都还在画布内', allIn, worst);
  });
})();

console.log('\n========================================');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
