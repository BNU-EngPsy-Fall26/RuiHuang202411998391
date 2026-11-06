/* =============================================================================
 * game.js —— 实验主控：状态机、计时、输入、HUD、结果页
 *
 * 依赖：config.js, sdt.js, trial.js, stats.js, scene.js, charts.js, export.js
 *
 * 试次流程状态机：
 *   ready（投手蓄力，800ms）
 *     → flight（球飞行，450ms）
 *       → response（判定窗口开启，限时 1000/1500/2000ms）
 *           ├─ 被试按键 ──→ [confidence（信心评级，仅 ROC 模式 A）] → feedback
 *           └─ 超时 ─────→ feedback（记为"未响应"）
 *             → feedback（800ms，揭示真实位置与显示位置）
 *               → ISI → 下一试次 ……→ roundEnd
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT;
  var C = SDT.CONFIG;
  var M = SDT.math, S = SDT.Stats, T = SDT.Trial;
  var Scene = SDT.Scene, Charts = SDT.Charts, Export = SDT.Export;

  /* =====================================================================
   * 状态
   * ================================================================== */
  var DOM = {};
  var history = new S.History();
  var round = null;              // 当前局
  var lastResult = null;         // 最近一局的完整记录（结果页使用）
  var phase = 'setup';
  var phaseStart = 0;
  var responseStart = 0;
  var rafId = null;
  var running = false;

  function $(id) { return document.getElementById(id); }

  /* =====================================================================
   * 初始化
   * ================================================================== */

  function init() {
    [
      'setupPanel', 'stagePanel', 'resultPanel', 'introCard',
      'selLevel', 'levelNote', 'selPrior', 'selStyle', 'styleHint', 'selBatter',
      'selTrials', 'selWindow', 'selRoc', 'selCorrection', 'setupPreview',
      'btnStart', 'practiceNote', 'howtoWindow',
      'hudTrial', 'hudLevel', 'hudPrior', 'hudStyle', 'hudBatter', 'hudTally', 'hudLast',
      'stageCanvas', 'practiceBadge', 'timerWrap', 'timerFill', 'timerLabel',
      'phaseHint', 'btnBall', 'btnStrike', 'confidenceRow', 'confBtns', 'btnAbort',
      'resTitle', 'resCondition', 'mxH', 'mxFA', 'mxM', 'mxCR', 'mxTimeout',
      'mPHit', 'mPFA', 'mDprime', 'mC', 'mBeta', 'mAcc', 'mTimeout',
      'mEps', 'mTheo', 'mSigTotal', 'mSigInt', 'corrNote', 'selCorrection2', 'resNotes',
      'distCanvas', 'distNote', 'rocCanvas', 'rocNote', 'regCanvas',
      'groupTable', 'groupNote', 'historyTable',
      'btnAgain', 'btnBackToSetup', 'btnExportTrials', 'btnExportSummary', 'btnClearHistory'
    ].forEach(function (id) { DOM[id] = $(id); });

    fillSelects();
    bindEvents();

    Scene.init(DOM.stageCanvas);

    // 初始渲染一次静态场景（未开始时也显示球场，避免空白画布）
    Scene.draw({ phase: 'idle', showZone: true });

    updatePreview();
    startLoop();
  }

  /* =====================================================================
   * 表单
   * ================================================================== */

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillSelects() {
    // 难度等级
    C.difficultyLevels.forEach(function (lv) {
      DOM.selLevel.appendChild(option(lv.id,
        lv.label + '　ε = ' + lv.epsilonIn.toFixed(1) + '″　（理论 d′ 上限 ' +
        C.theoreticalDprime(lv.epsilonIn).toFixed(1) + '）'));
    });
    DOM.selLevel.value = String(C.defaultLevelId);

    // 先验概率
    C.priorOptions.forEach(function (p) { DOM.selPrior.appendChild(option(p.value, p.label)); });
    DOM.selPrior.value = String(C.defaultPrior);

    // 执法风格
    C.styles.forEach(function (s) { DOM.selStyle.appendChild(option(s.id, s.label)); });
    DOM.selStyle.value = C.defaultStyleId;

    // 打者身高
    C.zone.batterHeightsCm.forEach(function (h) {
      DOM.selBatter.appendChild(option(h, h + ' cm　（好球区高 ' + C.zone.zoneHeightIn(h).toFixed(1) + '″）'));
    });
    DOM.selBatter.value = String(C.zone.defaultBatterHeightCm);

    // 试次数
    C.trial.trialsOptions.forEach(function (n) {
      DOM.selTrials.appendChild(option(n, n + ' 试次' + (n === 20 ? '（不推荐：d′ 估计极不稳定）' : '')));
    });
    DOM.selTrials.value = String(C.trial.trialsPerRound);

    // 判定窗口
    C.responseWindowOptions.forEach(function (ms) {
      DOM.selWindow.appendChild(option(ms, ms + ' ms'));
    });
    DOM.selWindow.value = String(C.timing.responseWindowMs);

    // ROC 模式
    C.rocModes.forEach(function (r) { DOM.selRoc.appendChild(option(r.id, r.label)); });
    DOM.selRoc.value = C.defaultRocMode;

    // 修正方法（两处下拉共用同一组选项）
    var corrOptions = [
      ['loglinear', '对数线性修正（Hautus 1995，推荐）'],
      ['oneOver2N', '1/(2N) 修正（传统做法）'],
      ['none', '不修正（仅用于演示 d′ 会炸成极大值）']
    ];
    corrOptions.forEach(function (c) {
      DOM.selCorrection.appendChild(option(c[0], c[1]));
      DOM.selCorrection2.appendChild(option(c[0], c[1]));
    });
    DOM.selCorrection.value = C.trial.correction;
    DOM.selCorrection2.value = C.trial.correction;

    // 信心评级按钮
    C.confidenceLevels.forEach(function (lv) {
      var b = document.createElement('button');
      b.className = 'conf-btn';
      b.dataset.value = lv.value;
      b.innerHTML = '<span class="conf-key">' + lv.short + '</span><span>' + lv.label + '</span>';
      DOM.confBtns.appendChild(b);
    });

    DOM.practiceNote.textContent = '每局开始有 ' + C.trial.practiceTrials +
      ' 个练习试次（更容易，不计入统计）。判定窗口默认 ' + C.timing.responseWindowMs + ' ms。';
  }

  /** 读取设置面板 → 本轮条件 */
  function readSetup() {
    var levelId = parseInt(DOM.selLevel.value, 10);
    var level = C.getLevel(levelId);
    var batterHeightCm = parseInt(DOM.selBatter.value, 10);
    return {
      levelId: levelId,
      epsilonIn: level.epsilonIn,
      pSignal: parseFloat(DOM.selPrior.value),
      styleId: DOM.selStyle.value,
      batterHeightCm: batterHeightCm,
      nTrials: parseInt(DOM.selTrials.value, 10),
      responseWindowMs: parseInt(DOM.selWindow.value, 10),
      rocMode: DOM.selRoc.value,
      correction: DOM.selCorrection.value,
      practiceTrials: C.trial.practiceTrials,
      sigmaExtIn: C.externalNoiseIn,
      zoneWidthIn: C.zone.plateWidthIn,
      zoneHeightIn: C.zone.zoneHeightIn(batterHeightCm),
      hand: C.zone.hand
    };
  }

  /** 设置面板下方的即时预览 */
  function updatePreview() {
    var cfg = readSetup();
    var style = C.getStyle(cfg.styleId);
    var n = cfg.nTrials + cfg.practiceTrials;
    var est = n * ((C.timing.readyMs + C.timing.flightMs + cfg.responseWindowMs * 0.45 +
      C.timing.feedbackMs + C.timing.isiMs) / 60000);
    DOM.levelNote.textContent = C.getLevel(cfg.levelId).note +
      '　好球区高 ' + cfg.zoneHeightIn.toFixed(1) + '″';
    DOM.styleHint.textContent = style.hint;
    DOM.howtoWindow.textContent = cfg.responseWindowMs;

    DOM.setupPreview.innerHTML =
      '<div class="pv"><span>信号 / 噪声</span><b>好球（球擦到好球区） / 坏球（球与好球区分开）</b></div>' +
      '<div class="pv"><span>ε（球边到好球区线）</span><b>' + cfg.epsilonIn.toFixed(2) + '″　≈ ' +
      (cfg.epsilonIn / C.zone.ballDiameterIn).toFixed(2) + ' 个球直径</b></div>' +
      '<div class="pv"><span>d′ 理论上限</span><b>' + C.theoreticalDprime(cfg.epsilonIn).toFixed(2) +
      '　（σ<sub>ext</sub> = ' + cfg.sigmaExtIn.toFixed(1) + '″）</b></div>' +
      '<div class="pv"><span>先验 P(S)</span><b>' + cfg.pSignal.toFixed(2) + '</b></div>' +
      '<div class="pv"><span>判断标准预期</span><b>' + (style.kIn > 0 ? 'c &gt; 0（保守，偏向判坏球）' :
        style.kIn < 0 ? 'c &lt; 0（冒进，偏向判好球）' : 'c ≈ 0（中立）') + '</b></div>' +
      '<div class="pv"><span>好球区</span><b>' + C.zone.plateWidthIn + '″ × ' +
      cfg.zoneHeightIn.toFixed(1) + '″（' + cfg.batterHeightCm + ' cm 打者）</b></div>' +
      '<div class="pv"><span>试次</span><b>练习 ' + cfg.practiceTrials + ' + 正式 ' + cfg.nTrials +
      ' 次　预计 ' + est.toFixed(1) + ' 分钟</b></div>';
  }

  /* =====================================================================
   * 事件绑定
   * ================================================================== */

  function bindEvents() {
    ['selLevel', 'selPrior', 'selStyle', 'selBatter', 'selTrials', 'selWindow', 'selRoc']
      .forEach(function (id) { DOM[id].addEventListener('change', updatePreview); });

    DOM.selCorrection.addEventListener('change', function () {
      C.trial.correction = DOM.selCorrection.value;
      DOM.selCorrection2.value = DOM.selCorrection.value;
    });

    DOM.btnStart.addEventListener('click', function () {
      C.trial.correction = DOM.selCorrection.value;
      startRound(readSetup());
    });

    DOM.btnBall.addEventListener('click', function () { onResponse('ball'); });
    DOM.btnStrike.addEventListener('click', function () { onResponse('strike'); });

    DOM.confBtns.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.conf-btn') : null;
      if (btn) onConfidence(parseInt(btn.dataset.value, 10));
    });

    DOM.btnAbort.addEventListener('click', function () {
      if (!running) return;
      if (global.confirm('确定要中止本局吗？本局数据将不会保存。')) abortRound();
    });

    DOM.btnAgain.addEventListener('click', function () {
      startRound(lastResult ? lastResult.condition : readSetup());
    });

    DOM.btnBackToSetup.addEventListener('click', function () {
      DOM.resultPanel.classList.add('hidden');
      DOM.setupPanel.classList.remove('hidden');
      Scene.setZone({
        widthIn: readSetup().zoneWidthIn,
        heightIn: readSetup().zoneHeightIn,
        batterHeightCm: readSetup().batterHeightCm,
        hand: C.zone.hand
      });
      updatePreview();
      renderStatic();
    });

    DOM.selCorrection2.addEventListener('change', function () {
      if (lastResult) renderResultMetrics(lastResult, DOM.selCorrection2.value, true);
    });

    DOM.btnExportTrials.addEventListener('click', function () {
      if (!lastResult) return;
      var f = Export.buildTrialCSV(lastResult);
      Export.download(f.name, f.text);
    });

    DOM.btnExportSummary.addEventListener('click', function () {
      if (!history.rounds.length) { global.alert('还没有任何一局数据。'); return; }
      var f = Export.buildSummaryCSV(history);
      Export.download(f.name, f.text);
    });

    DOM.btnClearHistory.addEventListener('click', function () {
      if (!history.rounds.length) return;
      if (!global.confirm('清空本次会话的全部历局成绩？（已导出的 CSV 不受影响）')) return;
      history.clear();
      renderHistoryTable();
      renderCharts(lastResult);
    });

    document.addEventListener('keydown', onKeyDown);
    global.addEventListener('resize', onResize);
  }

  function onKeyDown(e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      if (phase === 'response') { e.preventDefault(); onResponse('ball'); }
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      if (phase === 'response') { e.preventDefault(); onResponse('strike'); }
    } else if (phase === 'confidence' && /^[1-4]$/.test(k)) {
      e.preventDefault();
      onConfidence(parseInt(k, 10));
    }
  }

  function onResize() {
    Scene.resize();
    if (phase === 'setup' || phase === 'roundEnd' || !round) {
      renderStatic();
    } else {
      render(performance.now());
    }
    if (lastResult && !DOM.resultPanel.classList.contains('hidden')) {
      renderCharts(lastResult);
    }
  }

  /* =====================================================================
   * 局的开始与结束
   * ================================================================== */

  function startRound(cfg) {
    var c = {};
    for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) c[k] = cfg[k];

    // ---- 是否需要复用上一局的刺激序列？----
    // ROC 模式 B 的核心是"同一批试次、只改变判断标准 c"，所以当除执法风格以外
    // 的所有条件都没变时，沿用上一局的随机种子，让三个 ROC 点来自完全相同的刺激。
    // 这样三条点之间的差异才能干净地归因于 c，而不是抽样波动。
    var prev = lastResult ? lastResult.condition : null;
    c.reusedStimuli = !!(prev && c.rocMode === 'multi' && prev.rocMode === 'multi' &&
      prev.styleId !== c.styleId &&
      prev.epsilonIn === c.epsilonIn &&
      prev.pSignal === c.pSignal &&
      prev.batterHeightCm === c.batterHeightCm &&
      prev.nTrials === c.nTrials &&
      prev.responseWindowMs === c.responseWindowMs);

    c.seed = c.reusedStimuli ? prev.seed : ((Date.now() % 1000000) | 0);
    c.zoneWidthIn = c.zoneWidthIn || C.zone.plateWidthIn;
    c.zoneHeightIn = c.zoneHeightIn || C.zone.zoneHeightIn(c.batterHeightCm);

    Scene.setZone({
      widthIn: c.zoneWidthIn, heightIn: c.zoneHeightIn,
      batterHeightCm: c.batterHeightCm, hand: c.hand || C.zone.hand
    });

    // 正式试次
    var mainTrials = T.buildRound({
      nTrials: c.nTrials, pSignal: c.pSignal, epsilonIn: c.epsilonIn,
      jitter: C.trial.epsilonJitter,
      zoneWidthIn: c.zoneWidthIn, zoneHeightIn: c.zoneHeightIn,
      edgeInsetIn: C.zone.edgeInsetIn, sigmaExtIn: c.sigmaExtIn, seed: c.seed
    });
    mainTrials.forEach(function (t) { t.isPractice = false; });

    // 练习试次：ε 更大（更容易），不计入统计
    var pracTrials = T.buildRound({
      nTrials: c.practiceTrials, pSignal: 0.5,
      epsilonIn: Math.max(c.epsilonIn * 2, 2.0),
      jitter: 0,
      zoneWidthIn: c.zoneWidthIn, zoneHeightIn: c.zoneHeightIn,
      edgeInsetIn: C.zone.edgeInsetIn, sigmaExtIn: c.sigmaExtIn, seed: c.seed + 7919
    });
    pracTrials.forEach(function (t) { t.isPractice = true; });

    round = {
      condition: c,
      practiceCount: pracTrials.length,
      trials: pracTrials.concat(mainTrials),
      records: [],
      counts: S.emptyCounts(),
      cursor: 0,
      strikes: 0,
      balls: 0,
      startedAt: new Date()
    };

    running = true;
    DOM.setupPanel.classList.add('hidden');
    DOM.resultPanel.classList.add('hidden');
    DOM.stagePanel.classList.remove('hidden');
    DOM.hudLast.textContent = '—';

    // 等一帧，确保舞台可见后画布尺寸才准
    global.requestAnimationFrame(function () {
      Scene.resize();
      updateHud();
      enterReady();
    });
  }

  function abortRound() {
    running = false;
    round = null;
    phase = 'setup';
    DOM.stagePanel.classList.add('hidden');
    DOM.setupPanel.classList.remove('hidden');
    renderStatic();
  }

  function endRound() {
    running = false;
    phase = 'roundEnd';
    var cfg = round.condition;

    // 排除练习试次后的数据
    var mainTrials = [], mainRecords = [];
    for (var i = round.practiceCount; i < round.trials.length; i++) {
      mainTrials.push(round.trials[i]);
      mainRecords.push(round.records[i] || { response: 'timeout' });
    }

    var metrics = M.computeMetrics(round.counts, {
      correction: cfg.correction,
      epsilonIn: cfg.epsilonIn,
      sigmaExtIn: cfg.sigmaExtIn
    });

    var groups = {};
    var byEdge = S.groupCounts(mainTrials, mainRecords, function (t) { return t.edge; }, C.trial.timeoutPolicy);
    var byAxis = S.groupCounts(mainTrials, mainRecords, function (t) { return t.axis; }, C.trial.timeoutPolicy);
    for (var k in byEdge) if (Object.prototype.hasOwnProperty.call(byEdge, k)) groups[k] = byEdge[k];
    for (var k2 in byAxis) if (Object.prototype.hasOwnProperty.call(byAxis, k2)) groups['axis:' + k2] = byAxis[k2];

    var rocPoints = (cfg.rocMode === 'rating')
      ? S.rocFromRatings(mainTrials, mainRecords, cfg.correction)
      : null;

    var entry = {
      condition: cfg,
      counts: round.counts,
      metrics: metrics,
      groups: groups,
      trials: round.trials,
      records: round.records,
      practiceCount: round.practiceCount,
      rocPoints: rocPoints,
      finishedAt: new Date()
    };
    history.add(entry);
    lastResult = entry;

    showResults(entry);
  }

  /* =====================================================================
   * 状态机
   * ================================================================== */

  function setPhase(p) {
    phase = p;
    phaseStart = performance.now();
    updatePhaseUI();
  }

  function enterReady() {
    DOM.practiceBadge.classList.toggle('hidden', !currentTrial().isPractice);
    setPhase('ready');
  }
  function enterFlight() { setPhase('flight'); }
  function enterResponse() {
    responseStart = performance.now();
    setPhase('response');
  }
  function enterConfidence() {
    DOM.confidenceRow.classList.remove('hidden');
    setPhase('confidence');
  }
  function enterFeedback() {
    // 在这里完成记账（而不是在渲染循环里），保证每次试次只记一次，
    // 也不会往记录对象里塞渲染用的临时标记（那些标记会污染导出的 CSV/JSON）。
    if (round && round.records[round.cursor]) {
      tallyCurrent();
      DOM.hudLast.textContent = describeOutcome(round.records[round.cursor], currentTrial());
    }
    setPhase('feedback');
  }

  function currentTrial() { return round.trials[round.cursor]; }
  function currentRecord() { return round.records[round.cursor]; }

  function onResponse(called) {
    if (phase !== 'response' || !running) return;
    var rec = currentRecord() || (round.records[round.cursor] = {});
    rec.response = called;
    rec.rtMs = performance.now() - responseStart;
    rec.rating = null;
    if (called === 'strike') round.strikes++; else round.balls++;
    updateHud();

    if (round.condition.rocMode === 'rating') enterConfidence();
    else enterFeedback();
  }

  function onTimeout() {
    if (phase !== 'response' || !running) return;
    round.records[round.cursor] = { response: 'timeout', rtMs: null, rating: null };
    updateHud();
    enterFeedback();
  }

  function onConfidence(rating) {
    if (phase !== 'confidence' || !running) return;
    var rec = currentRecord();
    if (rating == null) {
      // 未在信心窗口内作答：退回到与二择一反应一致的最小置信等级
      rating = (rec.response === 'strike') ? C.confidenceStrikeThreshold
        : (C.confidenceStrikeThreshold - 1);
    }
    rec.rating = rating;
    DOM.confidenceRow.classList.add('hidden');
    enterFeedback();
  }

  /** 试次结束：记账 → 反馈 */
  function tallyCurrent() {
    var trial = currentTrial();
    var rec = currentRecord();
    if (trial.isPractice) {
      rec.outcome = 'practice';
      return;
    }
    rec.outcome = S.tally(round.counts, trial, rec.response, C.trial.timeoutPolicy);
  }

  function advance() {
    round.cursor++;
    if (round.cursor >= round.trials.length) { endRound(); return; }
    updateHud();
    enterReady();
  }

  /* =====================================================================
   * 主循环
   * ================================================================== */

  function startLoop() {
    if (rafId) return;
    var loop = function (now) {
      rafId = global.requestAnimationFrame(loop);
      if (round && running) tick(now);
    };
    rafId = global.requestAnimationFrame(loop);
  }

  function tick(now) {
    var t = now - phaseStart;
    var cfg = round.condition;

    switch (phase) {
      case 'ready':
        if (t >= C.timing.readyMs) enterFlight();
        break;
      case 'flight':
        if (t >= C.timing.flightMs) enterResponse();
        break;
      case 'response':
        if (t >= cfg.responseWindowMs) { onTimeout(); }
        break;
      case 'confidence':
        if (t >= C.timing.confidenceMs) onConfidence(null);
        break;
      case 'feedback':
        if (t >= (currentTrial().isPractice ? C.timing.practiceFeedbackMs : C.timing.feedbackMs)) {
          advance();
          return;
        }
        break;
    }
    render(now);
  }

  /** 绘制一帧 */
  function render(now) {
    if (!round) return;
    var trial = round.trials[round.cursor] || null;
    var cfg = round.condition;
    var t = now - phaseStart;
    var rec = round.records[round.cursor];

    var state = {
      phase: phase,
      trial: trial,
      called: rec ? rec.response : null,
      showZone: true,
      dim: 0
    };
    if (phase === 'ready') state.flightProgress = Math.min(1, t / C.timing.readyMs);
    if (phase === 'flight') state.flightProgress = Math.min(1, t / C.timing.flightMs);

    Scene.draw(state);

    // ---- 限时条 ----
    var frac = 1, mode = 'armed';
    if (phase === 'response') {
      var remain = cfg.responseWindowMs - t;
      frac = Math.max(0, remain / cfg.responseWindowMs);
      mode = 'live';
      DOM.timerWrap.classList.toggle('warn', remain <= C.timing.warnMs);
    } else if (phase === 'ready' || phase === 'flight') {
      frac = 1; mode = 'armed';
      DOM.timerWrap.classList.remove('warn');
    } else {
      frac = 0; mode = 'done';
      DOM.timerWrap.classList.remove('warn');
    }
    DOM.timerFill.style.width = (frac * 100).toFixed(2) + '%';
    DOM.timerWrap.dataset.mode = mode;
    DOM.timerLabel.textContent = (phase === 'response')
      ? '判定窗口　剩余 ' + Math.max(0, Math.round(cfg.responseWindowMs - t)) + ' ms'
      : (phase === 'flight' ? '球还在飞……' : (phase === 'feedback' ? '本试次已结束' : '准备'));

    updatePhaseUI();
  }

  /** 只画静态场景（未开始 / 结束时） */
  function renderStatic() {
    Scene.draw({ phase: 'idle', showZone: true, dim: 0 });
  }

  /* =====================================================================
   * HUD 与提示文字
   * ================================================================== */

  function updateHud() {
    if (!round) return;
    var cfg = round.condition;
    var n = round.trials.length - round.practiceCount;
    var i = round.cursor - round.practiceCount + 1;
    DOM.hudTrial.textContent = currentTrial() && currentTrial().isPractice
      ? '练习 ' + (round.cursor + 1) + ' / ' + round.practiceCount
      : Math.max(1, Math.min(n, i)) + ' / ' + n;
    DOM.hudLevel.textContent = 'L' + cfg.levelId + '（ε = ' + cfg.epsilonIn.toFixed(1) + '″）';
    DOM.hudPrior.textContent = cfg.pSignal.toFixed(2);
    DOM.hudStyle.textContent = C.getStyle(cfg.styleId).label;
    DOM.hudBatter.textContent = cfg.batterHeightCm + ' cm（带高 ' + cfg.zoneHeightIn.toFixed(1) + '″）';
    DOM.hudTally.textContent = '好球 ' + round.strikes + ' / 坏球 ' + round.balls;
  }

  function updatePhaseUI() {
    if (!round) {
      DOM.phaseHint.textContent = '点击"开始实验"';
      DOM.responseRow.classList.add('disabled');
      return;
    }
    var text = '';
    switch (phase) {
      case 'ready': text = '准备……'; break;
      case 'flight': text = '看球！'; break;
      case 'response': text = '判！　A / ← 判坏球　　D / → 判好球'; break;
      case 'confidence': text = '先给你的判断打个确信度（1–4）'; break;
      case 'feedback': text = shortVerdict(currentRecord(), currentTrial()); break;
      default: text = '';
    }
    DOM.phaseHint.textContent = text;
  }

  /**
   * 反馈时给被试看的**最短**结论：只讲判对还是判错。
   *
   * 刻意不再重复"好球 / 坏球"：球已经被画在它的真实位置上，一眼就能看出它擦到
   * 还是没擦到好球区，再写一遍结论反而是冗余。
   *
   * 四个结果 H / M / FA / CR 的名称与含义放在画面上方那行小字（"上一球"）和结果页的
   * 2×2 计数表里，不占用主画面的注意力。
   */
  function shortVerdict(rec, trial) {
    if (!rec || rec.response == null || rec.response === 'timeout') return '⏱ 限时内没有按键';
    var correct = (rec.response === 'strike') === trial.isSignal;
    return (correct ? '✓ 判断正确' : '✗ 误判') + (trial.isPractice ? '（练习）' : '');
  }

  /** 顶部"上一球"那一行小字：保留 H / M / FA / CR 的术语，方便与结果页对照 */
  function describeOutcome(rec, trial) {
    if (!rec || !rec.outcome) return '—';
    if (rec.outcome === 'practice') {
      return '练习球：' + (trial.isSignal ? '真实是好球' : '真实是坏球') +
        '，你判了' + (rec.response === 'strike' ? '好球' : '坏球');
    }
    var info = C.outcomeText[rec.outcome];
    if (!info) return '—';
    var icon = (rec.outcome === 'H' || rec.outcome === 'CR') ? '✅'
      : (rec.outcome === 'timeout') ? '⏱' : '❌';
    return icon + ' ' + info.name;
  }

  /* =====================================================================
   * 结果页
   * ================================================================== */

  function showResults(entry) {
    DOM.stagePanel.classList.add('hidden');
    DOM.resultPanel.classList.remove('hidden');
    DOM.selCorrection2.value = entry.condition.correction;

    DOM.resTitle.textContent = '第 ' + entry.roundIndex + ' 局结果';
    var cfg = entry.condition;
    DOM.resCondition.textContent =
      '难度 ' + 'L' + cfg.levelId + '（ε = ' + cfg.epsilonIn.toFixed(2) + '″，理论 d′ 上限 ' +
      C.theoreticalDprime(cfg.epsilonIn, cfg.sigmaExtIn).toFixed(2) + '）　·　' +
      'P(S) = ' + cfg.pSignal.toFixed(2) + '　·　' +
      '执法风格：' + C.getStyle(cfg.styleId).label + '　·　' +
      '打者 ' + cfg.batterHeightCm + ' cm（好球区 ' + C.zone.plateWidthIn + '″ × ' +
      cfg.zoneHeightIn.toFixed(1) + '″）　·　' +
      '判定窗口 ' + cfg.responseWindowMs + ' ms　·　' +
      '正式试次 ' + cfg.nTrials + ' 次（另有 ' + entry.practiceCount + ' 个练习试次未计入）' +
      (cfg.reusedStimuli ? '　·　本局复用了上一局的刺激序列（种子 ' + cfg.seed +
        '），以便与不同执法风格直接比较' : '');

    renderResultMetrics(entry, cfg.correction, false);
    renderGroupTable(entry);
    renderHistoryTable();

    // 等布局稳定后再画图（隐藏元素上 getBoundingClientRect 为 0）
    global.requestAnimationFrame(function () {
      global.requestAnimationFrame(function () { renderCharts(entry); });
    });
  }

  function pct(v, d) {
    return isFinite(v) ? (v * 100).toFixed(d == null ? 1 : d) + '%' : '—';
  }
  function num(v, d) {
    return isFinite(v) ? v.toFixed(d == null ? 2 : d) : '—';
  }

  /** 重算并刷新指标区（修正方法可切换） */
  function renderResultMetrics(entry, correction, redrawCharts) {
    var metrics = M.computeMetrics(entry.counts, {
      correction: correction,
      epsilonIn: entry.condition.epsilonIn,
      sigmaExtIn: entry.condition.sigmaExtIn
    });
    entry.metrics = metrics;

    DOM.mxH.innerHTML = '<b>' + metrics.H + '</b><br><small>' + C.outcomeText.H.name + '</small>';
    DOM.mxFA.innerHTML = '<b>' + metrics.FA + '</b><br><small>' + C.outcomeText.FA.name + '</small>';
    DOM.mxM.innerHTML = '<b>' + metrics.M + '</b><br><small>' + C.outcomeText.M.name + '</small>';
    DOM.mxCR.innerHTML = '<b>' + metrics.CR + '</b><br><small>' + C.outcomeText.CR.name + '</small>';
    DOM.mxTimeout.textContent = '信号试次 ' + metrics.nSignal + ' 个，噪声试次 ' + metrics.nNoise +
      ' 个，参与 SDT 计算的有效试次 ' + metrics.nValid + ' 个；' +
      '未响应（超时）' + metrics.timeout + ' 个' +
      (C.trial.timeoutPolicy === 'exclude' ? '，已剔除' : '，已按"判坏球"计入');

    DOM.mPHit.textContent = pct(metrics.pHit) + '　（原始 ' + pct(metrics.pHitRaw) + '）';
    DOM.mPFA.textContent = pct(metrics.pFA) + '　（原始 ' + pct(metrics.pFARaw) + '）';
    DOM.mDprime.textContent = num(metrics.dprime, 2);
    DOM.mC.textContent = num(metrics.c, 2) +
      (isFinite(metrics.c) ? (metrics.c > 0.01 ? '（保守，偏向判坏球）' :
        metrics.c < -0.01 ? '（冒进，偏向判好球）' : '（中立）') : '');
    DOM.mBeta.textContent = num(metrics.beta, 3);
    DOM.mAcc.textContent = pct(metrics.accuracy);
    DOM.mTimeout.textContent = pct(metrics.timeoutRate);
    DOM.mEps.textContent = num(metrics.epsilonIn, 2) + '″';
    DOM.mTheo.textContent = num(metrics.theoreticalDprime, 2);
    DOM.mSigTotal.textContent = num(metrics.sigmaTotal, 3) + '″';
    DOM.mSigInt.textContent = num(metrics.sigmaInternal, 3) + '″';

    DOM.corrNote.textContent = metrics.valid
      ? (metrics.correctionApplied
        ? '本局的 P(Hit) 或 P(FA) 触及 0 或 1，已触发修正。'
        : '本局未触及 0/1 极端值，三种修正方法结果相同。')
      : '数据不足，无法计算。';

    var notes = (metrics.notes || []).slice();
    if (!metrics.valid) notes.unshift('本局无法计算 d′。');
    if (isFinite(metrics.sigmaInternal) && metrics.sigmaInternal === 0 && metrics.valid) {
      notes.push('σ_int 被钳制为 0：你的实测 d′ 已经达到或超过理想观察者的理论上限，' +
        '可能是猜答、反应偏向，或本局难度过低导致天花板效应。');
    }
    DOM.resNotes.textContent = notes.length ? '提示：' + notes.join('　') : '';

    if (redrawCharts) renderCharts(entry);
  }

  function renderGroupTable(entry) {
    var tbody = DOM.groupTable.querySelector('tbody');
    tbody.innerHTML = '';
    var rows = [
      ['axis:vertical', '垂直（上缘 / 下缘）'],
      ['axis:horizontal', '水平（内角 / 外角）'],
      ['top', '上缘'],
      ['bottom', '下缘'],
      ['left', '内角侧'],
      ['right', '外角侧']
    ];
    rows.forEach(function (r) {
      var c = entry.groups[r[0]];
      if (!c) return;
      var m = M.computeMetrics(c, {
        correction: entry.condition.correction,
        epsilonIn: entry.condition.epsilonIn,
        sigmaExtIn: entry.condition.sigmaExtIn
      });
      var tr = document.createElement('tr');
      tr.innerHTML = '<th>' + r[1] + '</th>' +
        '<td>' + m.nValid + '</td>' +
        '<td>' + pct(m.pHit) + '</td>' +
        '<td>' + pct(m.pFA) + '</td>' +
        '<td><b>' + num(m.dprime, 2) + '</b></td>' +
        '<td>' + num(m.c, 2) + '</td>';
      tbody.appendChild(tr);
    });

    var gv = entry.groups['axis:vertical'], gh = entry.groups['axis:horizontal'];
    if (gv && gh) {
      var mv = M.computeMetrics(gv, { correction: entry.condition.correction, epsilonIn: entry.condition.epsilonIn, sigmaExtIn: entry.condition.sigmaExtIn });
      var mh = M.computeMetrics(gh, { correction: entry.condition.correction, epsilonIn: entry.condition.epsilonIn, sigmaExtIn: entry.condition.sigmaExtIn });
      if (isFinite(mv.dprime) && isFinite(mh.dprime)) {
        var diff = mh.dprime - mv.dprime;
        DOM.groupNote.textContent = (Math.abs(diff) < 0.3
          ? '本局高低与内外方向的 d′ 差别不大（相差 ' + diff.toFixed(2) + '）。单局试次有限，' +
            '这可能只是抽样波动；多跑几局取平均会更可靠。'
          : (diff > 0
            ? '本局复现了真实棒球的模式：高低方向（d′ = ' + mv.dprime.toFixed(2) +
              '）比内外方向（d′ = ' + mh.dprime.toFixed(2) + '）更难判，相差 ' + diff.toFixed(2) + '。'
            : '本局出现了与真实棒球数据相反的模式：内外方向（d′ = ' + mh.dprime.toFixed(2) +
              '）反而比高低方向（d′ = ' + mv.dprime.toFixed(2) + '）更难判。单局样本较小，可作为讨论点。'));
      }
    }
  }

  function renderHistoryTable() {
    var tbody = DOM.historyTable.querySelector('tbody');
    tbody.innerHTML = '';
    if (!history.rounds.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="dim center">本次会话还没有跑过任何一局。</td></tr>';
      return;
    }
    history.rounds.forEach(function (e) {
      var m = e.metrics;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + e.roundIndex + '</td>' +
        '<td>L' + e.condition.levelId + '</td>' +
        '<td>' + num(e.condition.epsilonIn, 2) + '</td>' +
        '<td>' + e.condition.pSignal.toFixed(2) + '</td>' +
        '<td>' + C.getStyle(e.condition.styleId).label + '</td>' +
        '<td>' + e.condition.batterHeightCm + 'cm</td>' +
        '<td>' + pct(m.pHit) + '</td>' +
        '<td>' + pct(m.pFA) + '</td>' +
        '<td><b>' + num(m.dprime, 2) + '</b></td>' +
        '<td>' + num(m.c, 2) + '</td>' +
        '<td>' + pct(m.accuracy) + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* =====================================================================
   * 图表
   * ================================================================== */

  function buildRocPoints(entry) {
    var cfg = entry.condition;

    // 模式 A：本局信心评级法的三个累计切点
    if (cfg.rocMode === 'rating' && entry.rocPoints && entry.rocPoints.length) {
      return {
        points: entry.rocPoints.map(function (r) {
          return { pfa: r.point.pfa, phit: r.point.phit, label: '切点 ≥' + r.cut };
        }),
        source: '模式 A（信心评级法）：本局 4 级信心评级的三个累计切点，一局即可画出 ROC。'
      };
    }

    // 模式 B：同一难度、同一批刺激下多局不同执法风格
    var byLevel = history.rocPointsByStimulusSet(entry.metrics.epsilonIn);
    if (byLevel.length >= 2) {
      return {
        points: byLevel.map(function (q) {
          return { pfa: q.pfa, phit: q.phit, label: q.styleLabel };
        }),
        source: '模式 B（多局不同判断标准）：同一 ε = ' + entry.metrics.epsilonIn.toFixed(2) +
          '″、同一批刺激（种子 ' + byLevel[0].seed + '）下共 ' + byLevel.length +
          ' 局，只有执法风格不同 —— 这正是干净的标准操纵。'
      };
    }

    return {
      points: [{ pfa: entry.metrics.pFA, phit: entry.metrics.pHit, label: '本局' }],
      source: '目前只有 1 个经验点。要画出 ROC 曲线，请：① 在设置里把 ROC 模式选为'
        + '「模式 A：单局 4 级信心评级法」，一局即可得到 3 个点；'
        + '或 ② 用「模式 B」把同一难度下的打者友好 / 中立 / 投手友好各跑一局。'
    };
  }

  function renderCharts(entry) {
    if (!entry) return;
    var m = entry.metrics;

    // ---- 双正态分布图 ----
    var sigma = isFinite(m.sigmaTotal) && m.sigmaTotal > 0 ? m.sigmaTotal : entry.condition.sigmaExtIn;
    Charts.drawDistributions(DOM.distCanvas, {
      epsilonIn: entry.condition.epsilonIn,
      sigmaTotalIn: sigma,
      c: m.c,
      dprime: m.dprime
    });
    DOM.distNote.innerHTML = 'σ 取本局反推值 ' + num(sigma, 2) + '″（σ = 2ε/d′，由你的成绩反推）。' +
      '若实测 d′ 与理论上限差距大，说明 σ_int 较大 —— 也就是说，球"看不清"主要发生在你的知觉里，' +
      '而不是屏幕上。反馈阶段画出的"显示位置 vs 真实位置"连线，就是外部噪声 σ_ext 的直接可视化。';

    // ---- ROC ----
    var roc = buildRocPoints(entry);
    Charts.drawROC(DOM.rocCanvas, { dprime: m.dprime, points: roc.points });
    DOM.rocNote.textContent = roc.source;

    // ---- d′–ε 回归 ----
    var pts = history.rounds.map(function (e) {
      return { epsilonIn: e.metrics.epsilonIn, dprime: e.metrics.dprime, roundIndex: e.roundIndex };
    });
    Charts.drawRegression(DOM.regCanvas, { points: pts, sigmaExtIn: C.externalNoiseIn });
  }

  /* =====================================================================
   * 启动
   * ================================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露给控制台，便于调试与助教核对
  global.SDTApp = {
    getRound: function () { return round; },
    getPhase: function () { return phase; },
    getHistory: function () { return history; },
    getLastResult: function () { return lastResult; },
    startRound: startRound,
    readSetup: readSetup
  };
})(typeof window !== 'undefined' ? window : globalThis);
