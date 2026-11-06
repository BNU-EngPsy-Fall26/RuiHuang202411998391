/* ============================================================
   app.js — 路由、知情同意、设备检查、实验编排、结束页
   ============================================================ */

window.App = (function () {

  const $ = U.$;
  const SCREENS = ['home', 'consent', 'check', 'brief', 'run', 'done', 'results', 'method'];

  const state = {
    expId: null,
    adapter: null,
    running: false,
    stopped: false,
    paused: false,
    trials: [],
    practiceTrials: [],
    startedAt: null,
    hiddenEvents: 0
  };

  const ADAPTERS = {
    stroop_sep: () => window.Stroop,
    prop_ticks: () => window.PropJudge
  };

  /* ---------- 会话 ---------- */

  function session() { return U.store.read(); }

  function ensurePid() {
    const url = new URLSearchParams(location.search);
    const fromUrl = url.get('pid');
    const s = session();
    let pid = fromUrl || s.pid;
    if (!pid) pid = U.pid();
    if (pid !== s.pid || fromUrl) U.store.patch({ pid: pid });
    return pid;
  }

  function saveSession(patch) {
    const s = session();
    U.store.write(Object.assign({}, s, patch));
  }

  function saveExperiment(id, data) {
    const s = session();
    const sessions = s.sessions || {};
    sessions[id] = Object.assign({}, sessions[id] || {}, data);
    U.store.patch({ sessions: sessions });
  }

  /* ---------- 路由 ---------- */

  function parseHash() {
    const raw = location.hash || '#/';
    const clean = raw.replace(/^#\/?/, '');
    const [path, qs] = clean.split('?');
    const params = new URLSearchParams(qs || '');
    return { path: path || 'home', params: params };
  }

  function showScreen(name) {
    SCREENS.forEach(function (s) {
      const el = document.getElementById('screen-' + s);
      if (el) el.hidden = (s !== name);
    });
    window.scrollTo(0, 0);
  }

  function go(path) { location.hash = '#/' + path; }

  function route() {
    const { path, params } = parseHash();
    const expId = params.get('exp');
    if (path === 'results') {
      showScreen('results');
      window.Results.render();
      return;
    }
    if (path === 'method') { showScreen('method'); return; }
    if (path === 'brief' && expId && ADAPTERS[expId]) {
      state.expId = expId;
      state.adapter = ADAPTERS[expId]();
      renderBrief(state.adapter);
      showScreen('brief');
      return;
    }
    if (path === 'run') { return; }        // 运行中不通过路由切换
    showScreen('home');
    if (path === 'consent') { renderConsent(); showScreen('consent'); return; }
    if (path === 'check') { showScreen('check'); checkWindow(); return; }
    renderHome();
  }

  function enterExperiment(expId) {
    state.expId = expId;
    state.adapter = ADAPTERS[expId]();
    const s = session();
    if (!s.consent) { go('consent?exp=' + expId); return; }
    if (!s.checked) { go('check?exp=' + expId); return; }
    go('brief?exp=' + expId);
  }

  /* ---------- 首页 ---------- */

  function renderHome() {
    const pid = ensurePid();
    const s = session();
    const box = $('#home-cards');
    U.clear(box);

    [window.Stroop.meta, window.PropJudge.meta].forEach(function (m) {
      const done = !!(s.sessions && s.sessions[m.id] && s.sessions[m.id].trials && s.sessions[m.id].trials.length);
      const card = U.el('a', {
        class: 'exp-card',
        href: 'javascript:void(0)',
        onclick: function (e) { e.preventDefault(); enterExperiment(m.id); }
      },
        U.el('div', { class: 'exp-card__top' },
          U.el('span', { class: 'exp-card__no', text: m.no + ' / 02' }),
          done
            ? U.el('span', { class: 'exp-card__tag', text: '已完成 ✓' })
            : U.el('span', { class: 'exp-card__tag', text: m.tag })
        ),
        U.el('h2', { class: 'exp-card__title', text: m.title }),
        U.el('p', { class: 'exp-card__en', text: m.en }),
        U.el('p', { class: 'exp-card__desc', text: m.desc }),
        U.el('div', { class: 'exp-card__meta' },
          U.el('span', { text: m.trials + ' 试次' }),
          U.el('span', { text: '约 ' + m.minutes + ' 分钟' }),
          U.el('span', { text: '2×2 被试内' })
        ),
        U.el('div', { class: 'exp-card__cta' },
          U.el('span', { text: done ? '再做一次' : '开始实验' }),
          U.el('i', { text: '→' })
        )
      );
      box.appendChild(card);
    });

    const status = $('#home-status');
    const doneIds = Object.keys(s.sessions || {}).filter(k => s.sessions[k].trials && s.sessions[k].trials.length);
    if (doneIds.length) {
      status.hidden = false;
      status.innerHTML = '本机已完成 ' + doneIds.length + ' / 2 个实验 · 匿名编号 <b class="mono">' + U.esc(pid) +
        '</b> · <a href="#/results" style="border-bottom:1px solid var(--copper)">查看结果</a>';
      if (doneIds.length === 2) status.innerHTML += ' · 两个都做完了，谢谢。';
    } else {
      status.hidden = true;
    }
  }

  /* ---------- 知情同意 ---------- */

  function renderConsent() {
    $('#consent-pid').textContent = ensurePid();
    const check = $('#consent-check');
    const btn = $('#consent-continue');
    btn.disabled = !check.checked;
    check.onchange = function () { btn.disabled = !check.checked; };
    btn.onclick = function () {
      saveSession({ consent: true, consentAt: new Date().toISOString() });
      const { params } = parseHash();
      const exp = params.get('exp');
      if (exp) go('check?exp=' + exp); else go('check');
    };
  }

  /* ---------- 设备检查 ---------- */

  const keyHits = {};

  function checkWindow() {
    const ok = window.innerWidth >= 1000 && window.innerHeight >= 620;
    const item = $('#check-window');
    item.classList.toggle('is-ok', ok);
    item.classList.toggle('is-bad', !ok);
    $('#check-window-value').textContent = window.innerWidth + ' × ' + window.innerHeight +
      (ok ? ' · 合适' : ' · 窗口太小或不是电脑');
    updateCheckButton();
  }

  function bindCheck() {
    window.addEventListener('keydown', function (e) {
      if (parseHash().path !== 'check') return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['d', 'f', 'j', 'k'].indexOf(k) >= 0) {
        keyHits[k] = true;
        const pad = document.querySelector('.keypads span[data-key="' + k + '"]');
        if (pad) pad.classList.add('is-hit');
        const all = ['d', 'f', 'j', 'k'].every(x => keyHits[x]);
        $('#check-keys').classList.toggle('is-ok', all);
        $('#check-keys-value').textContent = all ? '四个键都通了' : '还差：' +
          ['d', 'f', 'j', 'k'].filter(x => !keyHits[x]).map(x => x.toUpperCase()).join(' ');
        updateCheckButton();
      }
    });

    $('#color-yes').onclick = function () {
      $('#check-color').classList.add('is-ok');
      $('#check-color').classList.remove('is-bad');
      $('#check-color').dataset.ok = '1';
      updateCheckButton();
    };
    $('#color-no').onclick = function () {
      $('#check-color').classList.remove('is-ok');
      $('#check-color').classList.add('is-bad');
      $('#check-color').dataset.ok = '0';
      $('#check-note').textContent = '你报告无法清楚区分四种颜色。请先告诉实验者；如果仍要继续，数据会在分析时单独标注。';
      updateCheckButton();
    };

    $('#check-continue').onclick = function () {
      saveSession({ checked: true, device: { w: window.innerWidth, h: window.innerHeight, ua: navigator.userAgent } });
      const { params } = parseHash();
      const exp = params.get('exp');
      if (exp) go('brief?exp=' + exp); else go('');
    };

    window.addEventListener('resize', function () {
      if (parseHash().path === 'check') checkWindow();
    });
  }

  function updateCheckButton() {
    const keysOk = ['d', 'f', 'j', 'k'].every(x => keyHits[x]);
    const sizeOk = window.innerWidth >= 1000 && window.innerHeight >= 620;
    const colorOk = $('#check-color').dataset.ok;
    $('#check-continue').disabled = !(keysOk && sizeOk && colorOk);
  }

  /* ---------- 指导语 ---------- */

  function renderBrief(adapter) {
    const b = adapter.brief();
    $('#brief-kicker').textContent = b.kicker;
    $('#brief-title').textContent = b.title;
    $('#brief-instructions').innerHTML = b.html;
    const facts = $('#brief-facts');
    U.clear(facts);
    const dl = U.el('dl');
    b.facts.forEach(f => {
      dl.appendChild(U.el('dt', { text: f.k }));
      dl.appendChild(U.el('dd', { text: f.v }));
    });
    facts.appendChild(dl);
    if (b.side) facts.appendChild(U.el('p', { class: 'fine', text: b.side }));

    $('#brief-start').onclick = function () { startExperiment(adapter); };
    $('#brief-start').disabled = false;
  }

  /* ---------- 运行 ---------- */

  function timing(adapter) {
    const c = adapter.meta.id === 'prop_ticks' ? window.CONFIG.prop : window.CONFIG.stroop;
    return { fixation: c.fixation, blank: c.blank };
  }

  function runUI(adapter) {
    $('#run-label').textContent = adapter.meta.no + ' · ' + adapter.meta.title;
    $('#stage-hint').textContent = '';
    $('#run-count').textContent = '0 / 0';
    $('#run-progress').style.width = '0%';
  }

  function setProgress(i, n) {
    $('#run-count').textContent = i + ' / ' + n;
    $('#run-progress').style.width = (n ? (i / n * 100) : 0) + '%';
  }

  function overlay(opts) {
    const el = $('#run-overlay');
    el.hidden = false;
    el.innerHTML = '';
    const box = U.el('div', { class: 'run-overlay__box' });
    if (opts.kicker) box.appendChild(U.el('p', { class: 'kicker', text: opts.kicker }));
    box.appendChild(U.el('h2', { class: 'title title--small', text: opts.title || '' }));
    if (opts.text) box.appendChild(U.el('p', { class: 'lede lede--small', text: opts.text }));

    const actions = U.el('div', { class: 'actions' });
    (opts.buttons || []).forEach(function (b, i) {
      const btn = U.el('button', {
        class: 'btn ' + (b.primary ? 'btn--primary' : 'btn--ghost'),
        text: b.label
      });
      btn.onclick = function () { closeOverlay(); b.onClick && b.onClick(); };
      actions.appendChild(btn);
      if (i === 0) setTimeout(() => btn.focus(), 30);
    });
    box.appendChild(actions);
    el.appendChild(box);
    return new Promise(function (resolve) {
      overlay._resolve = resolve;
    });
  }

  function closeOverlay() {
    $('#run-overlay').hidden = true;
    if (overlay._resolve) { const r = overlay._resolve; overlay._resolve = null; r(); }
  }

  function bindOverlayKeys() {
    window.addEventListener('keydown', function (e) {
      if ($('#run-overlay').hidden) return;
      if (e.key === ' ' || e.key === 'Enter') {
        const btn = $('#run-overlay .btn--primary');
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });
  }

  async function startExperiment(adapter) {
    state.adapter = adapter;
    state.expId = adapter.meta.id;
    state.running = true;
    state.stopped = false;
    state.paused = false;
    state.trials = [];
    state.practiceTrials = [];
    state.startedAt = new Date().toISOString();

    showScreen('run');
    runUI(adapter);

    const host = $('#stage-inner');
    const pid = ensurePid();

    // ---- 练习 ----
    let redo = true;
    while (redo) {
      const trials = adapter.practice();
      state.practiceTrials = [];
      $('#stage-hint').textContent = adapter.hint(trials[0]) || '';
      setProgress(0, trials.length);

      const res = await Engine.runBlock({
        host: host,
        trials: trials,
        adapter: adapter,
        fixation: timing(adapter).fixation,
        blank: timing(adapter).blank,
        practice: true,
        shouldStop: () => state.stopped,
        onTrial: t => { state.practiceTrials.push(t); $('#stage-hint').textContent = adapter.hint(t) || ''; },
        onProgress: setProgress
      });

      if (state.stopped || res.stopped) return abortRun();

      const acc = state.practiceTrials.length
        ? window.S.mean(state.practiceTrials.map(t => t.correct === null ? 1 : t.correct))
        : 1;
      const text = adapter.meta.id === 'prop_ticks'
        ? '你已经熟悉流程。正式部分没有对错反馈，请尽量准确。'
        : '练习正确率 ' + U.pct(acc) + '。' + (acc < 0.7 ? '有点低，建议再做一次练习。' : '不错，进入正式部分。');

      const again = await new Promise(function (resolve) {
        overlay({
          kicker: 'Practice complete',
          title: '练习结束',
          text: text,
          buttons: [
            { label: '开始正式部分', primary: true, onClick: () => resolve(false) },
            { label: '再做一次练习', onClick: () => resolve(true) }
          ]
        });
      });
      redo = again;
      if (state.stopped) return abortRun();
    }

    // ---- 正式 ----
    $('#run-count').textContent = '0 / 0';

    if (adapter.meta.id === 'stroop_sep') {
      const plan = adapter.formal(pid);
      for (let b = 0; b < plan.blocks.length; b++) {
        if (b > 0) {
          await overlay({
            kicker: 'Break',
            title: '休息一下',
            text: '已完成 ' + b + ' / ' + plan.blocks.length + ' 段。接下来是「' +
              (plan.blocks[b].display === 'separated' ? '分离显示' : '整合显示') +
              '」，规则不变：判断颜色。',
            buttons: [{ label: '继续', primary: true }]
          });
          if (state.stopped) return abortRun();
        }
        const block = plan.blocks[b];
        $('#stage-hint').textContent = '';
        setProgress(0, block.trials.length);
        $('#run-label').textContent = block.label;

        const res = await Engine.runBlock({
          host: host,
          trials: block.trials,
          adapter: adapter,
          fixation: timing(adapter).fixation,
          blank: timing(adapter).blank,
          practice: false,
          shouldStop: () => state.stopped,
          onTrial: t => { state.trials.push(t); },
          onProgress: setProgress
        });
        if (state.stopped || res.stopped) return abortRun();
      }
    } else {
      const trials = adapter.formal();
      $('#stage-hint').textContent = adapter.hint(trials[0]) || '';
      setProgress(0, trials.length);
      const res = await Engine.runBlock({
        host: host,
        trials: trials,
        adapter: adapter,
        fixation: timing(adapter).fixation,
        blank: timing(adapter).blank,
        practice: false,
        shouldStop: () => state.stopped,
        onTrial: t => { state.trials.push(t); },
        onProgress: setProgress
      });
      if (state.stopped || res.stopped) return abortRun();
    }

    finish();
  }

  function abortRun() {
    state.running = false;
    state.stopped = true;
    closeOverlay();
    $('#stage-inner').innerHTML = '';
    go('');
    setTimeout(function () {
      const s = $('#home-status');
      if (s) { s.hidden = false; s.textContent = '已退出，本次没有上传数据。可以重新开始。'; }
    }, 60);
  }

  /* ---------- 结束 ---------- */

  async function finish() {
    state.running = false;
    const adapter = state.adapter;
    const trials = state.trials;
    const summary = adapter.summarize(trials);

    const meta = {
      expId: adapter.meta.id,
      pid: ensurePid(),
      startedAt: state.startedAt,
      endedAt: new Date().toISOString(),
      trials: trials,
      summary: summary,
      device: session().device || null,
      hiddenEvents: state.hiddenEvents
    };
    saveExperiment(adapter.meta.id, { trials: trials, summary: summary, meta: meta, at: new Date().toISOString() });

    showScreen('done');
    renderDone(adapter, summary, trials);
    submit(adapter.meta.id, trials);
  }

  function renderDone(adapter, summary, trials) {
    $('#done-kicker').textContent = 'Session complete · ' + adapter.meta.no;
    $('#done-title').textContent = '这一段完成了';

    const box = $('#done-summary');
    U.clear(box);
    const pid = ensurePid();

    const stats = [];
    if (adapter.meta.id === 'stroop_sep') {
      stats.push({ k: '整合·干扰量', v: U.fmt(summary.interference.integrated, 0), u: 'ms' });
      stats.push({ k: '分离·干扰量', v: U.fmt(summary.interference.separated, 0), u: 'ms' });
      stats.push({ k: '正确率', v: U.pct(summary.accuracy, 0), u: '' });
      stats.push({ k: '完成试次', v: String(summary.n), u: '' });
    } else {
      stats.push({ k: '总体平均误差', v: U.fmt(summary.overallMAE, 1), u: 'pp' });
      stats.push({ k: '饼图 · 无刻度', v: U.fmt(summary.by.pie_none.mae, 1), u: 'pp' });
      stats.push({ k: '饼图 · 有刻度', v: U.fmt(summary.by.pie_tick.mae, 1), u: 'pp' });
      stats.push({ k: '完成试次', v: String(summary.n), u: '' });
    }
    stats.forEach(s => {
      box.appendChild(U.el('div', {},
        U.el('dt', { text: s.k }),
        U.el('dd', { html: U.esc(s.v) + (s.u ? '<small>' + s.u + '</small>' : '') })
      ));
    });

    const actions = $('#done-actions');
    U.clear(actions);
    actions.appendChild(U.el('a', { class: 'btn btn--primary', href: '#/results', text: '查看结果' }));

    const other = adapter.meta.id === 'stroop_sep' ? window.PropJudge : window.Stroop;
    const s = session();
    const otherDone = s.sessions && s.sessions[other.meta.id] && s.sessions[other.meta.id].trials;
    const next = U.el('button', {
      class: 'btn',
      text: otherDone ? '再做一次「' + other.meta.title + '」' : '再做一个：' + other.meta.title
    });
    next.onclick = function () { enterExperiment(other.meta.id); };
    actions.appendChild(next);

    const csv = U.el('button', { class: 'btn btn--ghost', text: '下载 CSV 备份' });
    csv.onclick = function () { window.Upload.backupCSV(adapter.meta.id, trials, pid); };
    actions.appendChild(csv);

    const json = U.el('button', { class: 'btn btn--ghost', text: '下载 JSON 备份' });
    json.onclick = function () { window.Upload.backupJSON(session()); };
    actions.appendChild(json);

    $('#done-upload').className = 'upload-status';
    $('#done-upload').innerHTML = '<span class="upload-status__dot"></span> 准备上传…';
  }

  async function submit(expId, trials) {
    const box = $('#done-upload');
    box.className = 'upload-status is-warn';
    box.innerHTML = '<span class="upload-status__dot"></span> 正在上传试次数据…';

    const res = await window.Upload.submit({
      experiment: expId,
      participant: ensurePid(),
      trials: trials
    });

    const s = session();
    const sessions = s.sessions || {};
    sessions[expId] = Object.assign({}, sessions[expId] || {}, {
      submit: { ok: !!res.ok, at: new Date().toISOString(), error: res.error || null, recordId: res.recordId || null }
    });
    U.store.patch({ sessions: sessions });

    if (res.ok) {
      box.className = 'upload-status is-ok';
      box.innerHTML = '<span class="upload-status__dot"></span> 已上传 · 记录 <span class="mono">' +
        U.esc(res.recordId || 'ok') + '</span>' +
        (res.participants ? ' · 本项目已有 <b>' + res.participants + '</b> 份数据' : '') +
        (res.warnings ? '<br><span class="mono">warnings: ' + U.esc(res.warnings) + '</span>' : '');
      if (res.warnings) box.classList.add('is-warn');
    } else {
      box.className = 'upload-status is-bad';
      box.innerHTML = '<span class="upload-status__dot"></span> 上传失败：' + U.esc(res.error) +
        '。数据仍保存在本机，请先下载备份，再点「重试上传」。';
      const actions = $('#done-actions');
      const retry = U.el('button', { class: 'btn btn--copper', text: '重试上传' });
      retry.onclick = function () { retry.remove(); submit(expId, trials); };
      actions.insertBefore(retry, actions.firstChild);
    }
  }

  /* ---------- 可见性 / 退出 ---------- */

  function bindVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (state.running) state.hiddenEvents++;
      } else if (state.running && state.hiddenEvents) {
        // 回到页面时提示一次；不打断当前试次
        const hint = $('#stage-hint');
        if (hint) hint.textContent = '检测到切换窗口：这段时间的反应时会变长，分析时会被剔除。';
      }
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.running) {
        state.stopped = true;
        closeOverlay();
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.running && state.trials.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ---------- 启动 ---------- */

  function init() {
    ensurePid();
    bindCheck();
    bindOverlayKeys();
    bindVisibility();
    $('#results-tabs').addEventListener('click', function (e) {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const name = btn.dataset.tab;
      U.$$('.tab', $('#results-tabs')).forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      ['stroop', 'prop', 'overview'].forEach(t => {
        $('#tab-' + t).hidden = (t !== name);
      });
      if (name !== 'overview') window.Results.plot(name);
    });
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { go: go, state: state, session: session };
})();
