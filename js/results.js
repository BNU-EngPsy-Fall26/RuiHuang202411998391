/* ============================================================
   results.js — 结果页：汇总分析、图表、与原文对比、模型预测
   数据来源：GET /api/hw2/data（全体匿名）；失败时退回本机数据
   ============================================================ */

window.Results = (function () {

  const $ = U.$;
  const A = () => window.CONFIG.analysis;

  let state = {
    rows: [],
    scope: 'local',
    loaded: false,
    stroop: null,
    prop: null
  };

  /* ---------- 取数 ---------- */

  function localRows() {
    const s = U.store.read();
    const sessions = s.sessions || {};
    const rows = [];
    Object.keys(sessions).forEach(function (exp) {
      const trials = sessions[exp].trials || [];
      trials.forEach(function (t) {
        rows.push({ participant: s.pid || 'local', experiment: exp, trial: t });
      });
    });
    return rows;
  }

  async function load() {
    const res = await window.Upload.fetchAll();
    if (res.ok && res.rows.length) {
      state.rows = res.rows;
      state.scope = 'remote';
    } else {
      state.rows = localRows();
      state.scope = 'local';
    }
    state.loaded = true;
  }

  /* ---------- 数据清洗 ---------- */

  function num(v) { return Number(v); }

  function stroopTrials() {
    return state.rows
      .filter(r => String(r.experiment).toLowerCase().indexOf('stroop') >= 0)
      .map(r => {
        const t = r.trial;
        const rt = num(t.rt), correct = num(t.correct), timeout = num(t.timeout) || 0;
        return {
          pid: r.participant,
          cond: t.cond || (t.display === 'separated' ? 'sep' : 'int') + '_' + (t.congruency === 'congruent' ? 'cong' : 'incong'),
          rt: rt,
          correct: correct,
          timeout: timeout,
          display: t.display,
          congruency: t.congruency,
          practice: String(t.block_order) === 'practice',
          valid: isFinite(rt) && rt >= A().minRT && rt <= A().maxRT && timeout !== 1 && correct === 1
        };
      })
      .filter(t => !t.practice);
  }

  function propTrials() {
    return state.rows
      .filter(r => String(r.experiment).toLowerCase().indexOf('prop') >= 0)
      .map(r => {
        const t = r.trial;
        const judged = num(t.judged);
        const trueP = num(t.true_prop);
        return {
          pid: r.participant,
          cond: t.cond,
          chart: t.chart,
          ticks: num(t.ticks),
          true_prop: trueP,
          judged: judged,
          err: isFinite(judged) ? Math.abs(judged - trueP) : NaN,
          practice: String(t.block_order) === 'practice'
        };
      })
      .filter(t => !t.practice && isFinite(t.judged) && isFinite(t.true_prop));
  }

  /* ---------- Stroop 分析 ---------- */

  function analyzeStroop(allTrials) {
    const trials = allTrials.filter(t => t.valid);
    const conds = ['int_cong', 'int_incong', 'sep_cong', 'sep_incong'];
    const byPid = new Map();
    trials.forEach(t => {
      if (!byPid.has(t.pid)) byPid.set(t.pid, {});
      const cell = byPid.get(t.pid);
      if (!cell[t.cond]) cell[t.cond] = [];
      cell[t.cond].push(t.rt);
    });

    const subjects = [];
    byPid.forEach((cell, pid) => {
      const ok = conds.every(c => (cell[c] || []).length >= 3);
      if (!ok) return;
      const means = {};
      conds.forEach(c => { means[c] = window.S.mean(cell[c]); });
      subjects.push({ pid: pid, means: means });
    });

    const intArr = subjects.map(s => s.means.int_incong - s.means.int_cong);
    const sepArr = subjects.map(s => s.means.sep_incong - s.means.sep_cong);
    const diffs = subjects.map(s => s.means.int_incong - s.means.int_cong - (s.means.sep_incong - s.means.sep_cong));

    const density = {};
    conds.forEach(c => { density[c] = trials.filter(t => t.cond === c).map(t => t.rt); });

    const ddm = {};
    conds.forEach(c => {
      const rt = density[c];
      // 正确率的分母是该条件的全部试次（含错误与超时），否则 EZ 会得到 Pc≈1
      const nTotal = Math.max(allTrials.filter(t => t.cond === c).length, rt.length, 1);
      ddm[c] = window.DDM.fitCondition(rt, nTotal, 1500);
    });

    const anovaCells = subjects.map(s => [
      [s.means.int_cong, s.means.int_incong],
      [s.means.sep_cong, s.means.sep_incong]
    ]);

    return {
      nSubs: subjects.length,
      nTrials: trials.length,
      subjects: subjects,
      intArr: intArr,
      sepArr: sepArr,
      interference: {
        int: { mean: window.S.mean(intArr), ci: window.S.bootstrapCI(intArr, null, A().bootstrap), points: intArr },
        sep: { mean: window.S.mean(sepArr), ci: window.S.bootstrapCI(sepArr, null, A().bootstrap), points: sepArr }
      },
      diff: window.S.paired(intArr, sepArr),
      anova: subjects.length >= 2 ? window.S.anova2x2(anovaCells) : null,
      density: density,
      ddm: ddm,
      conds: conds
    };
  }

  /* ---------- 比例分析 ---------- */

  function analyzeProp(trials) {
    const conds = ['pie_none', 'pie_tick', 'bar_none', 'bar_tick'];

    const byPid = new Map();
    trials.forEach(t => {
      if (!byPid.has(t.pid)) byPid.set(t.pid, {});
      const cell = byPid.get(t.pid);
      if (!cell[t.cond]) cell[t.cond] = [];
      cell[t.cond].push(t);
    });

    const subjects = [];
    byPid.forEach((cell, pid) => {
      const ok = conds.every(c => (cell[c] || []).length >= 5);
      if (!ok) return;
      const means = {};
      conds.forEach(c => { means[c] = window.S.mean(cell[c].map(x => x.err)); });
      subjects.push({ pid: pid, means: means });
    });

    const mae = {};
    conds.forEach(c => {
      const xs = trials.filter(t => t.cond === c).map(t => t.err);
      const subjMeans = subjects.map(s => s.means[c]);
      const forCI = subjMeans.length >= 2 ? subjMeans : xs;
      mae[c] = {
        mean: window.S.mean(xs),
        ci: window.S.bootstrapCI(forCI, null, Math.min(5000, A().bootstrap * 2)),
        points: subjMeans.length ? subjMeans : xs
      };
    });

    const bias = {};
    conds.forEach(c => {
      const list = trials.filter(t => t.cond === c);
      const byP = new Map();
      list.forEach(t => {
        const k = t.true_prop;
        if (!byP.has(k)) byP.set(k, []);
        byP.get(k).push(t.judged);
      });
      const points = [];
      byP.forEach((js, p) => {
        points.push({ p: p / 100, j: window.S.mean(js) / 100, n: js.length });
      });
      points.sort((a, b) => a.p - b.p);
      bias[c] = { points: points, fit: window.PM.fit(points) };
    });

    const anovaCells = subjects.map(s => [
      [s.means.pie_none, s.means.pie_tick],
      [s.means.bar_none, s.means.bar_tick]
    ]);

    return {
      nSubs: subjects.length,
      nTrials: trials.length,
      subjects: subjects,
      mae: mae,
      anova: subjects.length >= 2 ? window.S.anova2x2(anovaCells) : null,
      bias: bias
    };
  }

  /* ---------- 渲染 ---------- */

  async function render() {
    const scope = $('#results-scope');
    scope.textContent = '正在读取数据…';
    ['stroop', 'prop', 'overview'].forEach(t => { $('#tab-' + t).innerHTML = ''; });

    await load();

    const st = stroopTrials();
    const pt = propTrials();
    state.stroop = st.length ? analyzeStroop(st) : null;
    state.prop = pt.length ? analyzeProp(pt) : null;
    if (state.stroop && !state.stroop.nSubs) state.stroop = null;
    if (state.prop && !state.prop.nSubs) state.prop = null;

    const parts = window.Upload.participants;
    scope.innerHTML = state.scope === 'remote'
      ? '数据来源：课程收数接口（全体匿名汇总）· 共 ' + state.rows.length +
        ' 条试次记录' + (window.Upload.participants ? ' · ' + window.Upload.participants + ' 名被试' : '')
      : '数据来源：本机缓存（接口未返回数据，可能是网络或项目码问题）· 共 ' + state.rows.length + ' 条试次记录';

    renderStroop();
    renderProp();
    renderOverview();
    $('#tab-stroop').hidden = false;
    $('#tab-prop').hidden = true;
    $('#tab-overview').hidden = true;
    U.$$('.tab', $('#results-tabs')).forEach((b, i) => b.setAttribute('aria-selected', String(i === 0)));
    plot('stroop');
  }

  function noData(host, what) {
    host.innerHTML = '<p class="lede lede--small">还没有可分析的「' + what + '」数据。' +
      '完成实验并上传后，这里会自动出现结果。</p>';
  }

  function statRow(items) {
    const box = U.el('dl', { class: 'stats-row' });
    items.forEach(it => {
      box.appendChild(U.el('div', { class: 'stat' },
        U.el('dt', { text: it.k }),
        U.el('dd', { html: it.v + (it.u ? '<small>' + it.u + '</small>' : '') })
      ));
    });
    return box;
  }

  function panel(title, note, cls) {
    const p = U.el('section', { class: 'panel ' + (cls || '') });
    p.appendChild(U.el('div', { class: 'panel__head' },
      U.el('h3', { class: 'panel__title', text: title }),
      U.el('span', { class: 'panel__note', text: note || '' })
    ));
    return p;
  }

  function fmtCI(ci, digits) {
    return '[' + U.fmt(ci[0], digits) + ', ' + U.fmt(ci[1], digits) + ']';
  }

  /* ---------- Stroop 面板 ---------- */

  function renderStroop() {
    const host = $('#tab-stroop');
    U.clear(host);
    const d = state.stroop;
    if (!d) { noData(host, 'Stroop'); return; }

    host.appendChild(statRow([
      { k: '被试', v: String(d.nSubs), u: '人' },
      { k: '有效试次', v: String(d.nTrials), u: '' },
      { k: '整合 · 干扰', v: U.fmt(d.interference.int.mean, 0), u: 'ms' },
      { k: '分离 · 干扰', v: U.fmt(d.interference.sep.mean, 0), u: 'ms' },
      { k: '干扰差', v: U.fmt(d.diff.mean, 0), u: 'ms' }
    ]));

    const grid = U.el('div', { class: 'panel-grid' });

    // 干扰量
    const p1 = panel('干扰量：整合 vs 分离', '95% CI · 个体点');
    const host1 = U.el('div', { id: 'chart-stroop-int' });
    p1.appendChild(host1);
    p1.appendChild(U.el('p', {
      class: 'panel__caption',
      html: '整合 ' + U.fmt(d.interference.int.mean, 0) + ' ms ' + fmtCI(d.interference.int.ci) +
        '；分离 ' + U.fmt(d.interference.sep.mean, 0) + ' ms ' + fmtCI(d.interference.sep.ci) +
        '。配对差 ' + U.fmt(d.diff.mean, 0) + ' ms，dz = ' + U.fmt(d.diff.dz, 2) +
        (d.diff.p < 0.05 ? '，p = ' + U.fmt(d.diff.p, 3) : '，p = ' + U.fmt(d.diff.p, 2)) + '。'
    }));
    grid.appendChild(p1);

    // 密度
    const p2 = panel('反应时分布', '正确试次');
    p2.appendChild(U.el('div', { id: 'chart-stroop-density' }));
    grid.appendChild(p2);

    // Q-Q
    const p3 = panel('模型：EZ-DDM 预测 vs 实测', '不一致条件');
    p3.appendChild(U.el('div', { id: 'chart-stroop-qq' }));
    p3.appendChild(U.el('p', {
      class: 'panel__caption',
      html: '用正确率、平均 RT、RT 方差反解漂移率 v 与边界 a，再模拟 1500 次，比较分位数。' +
        (d.ddm.int_incong ? '整合-不一致：v = ' + U.fmt(d.ddm.int_incong.params.v, 2) +
          '，a = ' + U.fmt(d.ddm.int_incong.params.a, 2) +
          '，Ter = ' + U.fmt(d.ddm.int_incong.params.Ter * 1000, 0) + ' ms。' : '')
    }));
    grid.appendChild(p3);

    // 方差分析表
    const p4 = panel('2×2 重复测量方差分析（RT）', 'n=' + d.nSubs);
    const table = U.el('table', { class: 'table table--tight' });
    table.innerHTML = '<thead><tr><th>效应</th><th>F</th><th>p</th><th>η²p</th></tr></thead>';
    const tbody = U.el('tbody');
    if (d.anova) {
      [['显示方式', 'A'], ['一致性', 'B'], ['交互', 'AB']].forEach(row => {
        tbody.appendChild(U.el('tr', {},
          U.el('td', { text: row[0] }),
          U.el('td', { text: U.fmt(d.anova.F[row[1]], 2) }),
          U.el('td', { text: U.fmt(d.anova.p[row[1]], 3) }),
          U.el('td', { text: U.fmt(d.anova.eta[row[1]], 2) })
        ));
      });
    } else {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: '4', text: '被试太少，无法计算' })));
    }
    table.appendChild(tbody);
    p4.appendChild(U.el('div', { class: 'table-wrap' }, table));
    grid.appendChild(p4);

    // 与原文对比
    const p5 = panel('与 Stroop (1935) 对比', '口径不同，只比方向与相对大小', 'panel--wide');
    p5.appendChild(U.el('div', { class: 'compare' },
      U.el('div', {},
        U.el('dt', { text: '原文（Exp. 2，口头命名 100 项）' }),
        U.el('dd', { text: '色块 63.3 s → 冲突词 110.3 s；干扰 +47.0 s，即 +470 ms/项（+74.3%）。' })
      ),
      U.el('div', {},
        U.el('dt', { text: '本实验（按键，逐试次）' }),
        U.el('dd', { text: '整合条件干扰 ' + U.fmt(d.interference.int.mean, 0) + ' ms（' +
          fmtCI(d.interference.int.ci) + '），约为原文量级的 ' +
          U.fmt(d.interference.int.mean / 470 * 100, 0) + '%。' })
      ),
      U.el('div', {},
        U.el('dt', { text: '差异从哪来' }),
        U.el('dd', { text: '口头命名与四选一按键、卡片式连续命名与逐试次呈现、错误纠正与练习、以及比例一致性，都会改变绝对量级；方向（不一致更慢）与原文一致。' })
      )
    ));
    grid.appendChild(p5);

    host.appendChild(grid);

    if (state.scope === 'local') {
      host.appendChild(U.el('p', { class: 'note', text: '当前只有本机数据（n 很小），图表仅用于自检；正式结论以收数接口汇总为准。' }));
    }
  }

  /* ---------- 比例面板 ---------- */

  function renderProp() {
    const host = $('#tab-prop');
    U.clear(host);
    const d = state.prop;
    if (!d) { noData(host, '比例判断'); return; }

    host.appendChild(statRow([
      { k: '被试', v: String(d.nSubs), u: '人' },
      { k: '有效试次', v: String(d.nTrials), u: '' },
      { k: '饼图 · 无刻度', v: U.fmt(d.mae.pie_none.mean, 1), u: 'pp' },
      { k: '饼图 · 有刻度', v: U.fmt(d.mae.pie_tick.mean, 1), u: 'pp' },
      { k: '条形 · 无刻度', v: U.fmt(d.mae.bar_none.mean, 1), u: 'pp' },
      { k: '条形 · 有刻度', v: U.fmt(d.mae.bar_tick.mean, 1), u: 'pp' }
    ]));

    const grid = U.el('div', { class: 'panel-grid' });

    const p1 = panel('平均绝对误差（百分点）', '95% CI · 个体点');
    p1.appendChild(U.el('div', { id: 'chart-prop-mae' }));
    p1.appendChild(U.el('p', {
      class: 'panel__caption',
      html: '饼图 ' + U.fmt(d.mae.pie_none.mean, 1) + ' → ' + U.fmt(d.mae.pie_tick.mean, 1) +
        '；条形 ' + U.fmt(d.mae.bar_none.mean, 1) + ' → ' + U.fmt(d.mae.bar_tick.mean, 1) + '。'
    }));
    grid.appendChild(p1);

    const p2 = panel('判断偏差与周期幂模型', '横轴真实比例，纵轴判断值');
    p2.appendChild(U.el('div', { id: 'chart-prop-bias' }));
    p2.appendChild(U.el('p', {
      class: 'panel__caption',
      html: 'β 越接近 1，偏差越小。' + ['pie_none', 'pie_tick', 'bar_none', 'bar_tick'].map(c =>
        (c === 'pie_none' ? '饼图无刻度' : c === 'pie_tick' ? '饼图有刻度' : c === 'bar_none' ? '条形无刻度' : '条形有刻度') +
        ' β=' + (d.bias[c].fit ? U.fmt(d.bias[c].fit.beta, 2) : '—')
      ).join('；') + '。'
    }));
    grid.appendChild(p2);

    const p3 = panel('2×2 重复测量方差分析（MAE）', 'n=' + d.nSubs);
    const table = U.el('table', { class: 'table table--tight' });
    table.innerHTML = '<thead><tr><th>效应</th><th>F</th><th>p</th><th>η²p</th></tr></thead>';
    const tbody = U.el('tbody');
    if (d.anova) {
      [['图形', 'A'], ['刻度', 'B'], ['交互', 'AB']].forEach(row => {
        tbody.appendChild(U.el('tr', {},
          U.el('td', { text: row[0] }),
          U.el('td', { text: U.fmt(d.anova.F[row[1]], 2) }),
          U.el('td', { text: U.fmt(d.anova.p[row[1]], 3) }),
          U.el('td', { text: U.fmt(d.anova.eta[row[1]], 2) })
        ));
      });
    } else {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: '4', text: '被试太少，无法计算' })));
    }
    table.appendChild(tbody);
    p3.appendChild(U.el('div', { class: 'table-wrap' }, table));
    grid.appendChild(p3);

    const p4 = panel('与 Cleveland–McGill (1984) 对比', '误差口径不同，只比排序', 'panel--wide');
    p4.appendChild(U.el('div', { class: 'compare' },
      U.el('div', {},
        U.el('dt', { text: '原文' }),
        U.el('dd', { text: '基本知觉任务层级：位置（共同刻度）> 长度 > 角度/面积，误差依次增大；C&M 用对数比误差，不能与百分点直接比较。' })
      ),
      U.el('div', {},
        U.el('dt', { text: '本实验' }),
        U.el('dd', { text: '饼图（角度）' + U.fmt(d.mae.pie_none.mean, 1) + ' pp vs 条形（位置/长度）' +
          U.fmt(d.mae.bar_none.mean, 1) + ' pp；比值 ' +
          U.fmt(d.mae.pie_none.mean / d.mae.bar_none.mean, 2) + '。' })
      ),
      U.el('div', {},
        U.el('dt', { text: '刻度改进' }),
        U.el('dd', { text: '饼图误差下降 ' + U.fmt(d.mae.pie_none.mean - d.mae.pie_tick.mean, 1) +
          ' pp，条形下降 ' + U.fmt(d.mae.bar_none.mean - d.mae.bar_tick.mean, 1) + ' pp。' })
      )
    ));
    grid.appendChild(p4);

    host.appendChild(grid);
  }

  /* ---------- 总览 ---------- */

  function renderOverview() {
    const host = $('#tab-overview');
    U.clear(host);
    const rs = U.store.read();
    const sessions = rs.sessions || {};

    host.appendChild(statRow([
      { k: '数据来源', v: state.scope === 'remote' ? '收数接口' : '本机', u: '' },
      { k: '试次记录', v: String(state.rows.length), u: '' },
      { k: 'Stroop 被试', v: String(state.stroop ? state.stroop.nSubs : 0), u: '人' },
      { k: '比例被试', v: String(state.prop ? state.prop.nSubs : 0), u: '人' }
    ]));

    const grid = U.el('div', { class: 'panel-grid' });
    const p1 = panel('本机会话', 'localStorage');
    const t1 = U.el('table', { class: 'table table--tight' });
    t1.innerHTML = '<thead><tr><th>实验</th><th>试次</th><th>上传</th></tr></thead>';
    const b1 = U.el('tbody');
    ['stroop_sep', 'prop_ticks'].forEach(function (id) {
      const s = sessions[id] || {};
      const n = (s.trials || []).length;
      const sub = s.submit && s.submit.ok ? '✓' : (s.submit ? '失败' : '—');
      b1.appendChild(U.el('tr', {},
        U.el('td', { text: id }),
        U.el('td', { text: String(n) }),
        U.el('td', { text: sub })
      ));
    });
    t1.appendChild(b1);
    p1.appendChild(t1);
    grid.appendChild(p1);

    const p2 = panel('数据检查清单', '上传后自查');
    p2.appendChild(U.el('ul', {
      class: 'note',
      html: '<li>每人每实验的试次数是否等于设计值（80 / 40）</li>' +
        '<li>有没有 warnings（截断、改名、非有限值）</li>' +
        '<li>测试数据是否用 test_ 前缀并已清空</li>' +
        '<li>手机/窄窗数据是否已排除</li>'
    }));
    const btn = U.el('button', { class: 'btn btn--small', text: '重新读取数据' });
    btn.onclick = function () { render(); };
    p2.appendChild(btn);
    grid.appendChild(p2);

    host.appendChild(grid);
  }

  /* ---------- 作图 ---------- */

  function plot(name) {
    if (name === 'stroop' && state.stroop) plotStroop();
    if (name === 'prop' && state.prop) plotProp();
  }

  function plotStroop() {
    const d = state.stroop;
    const hostInt = $('#chart-stroop-int');
    if (hostInt) {
      U.clear(hostInt);
      window.Charts.bars(hostInt, {
        height: 250,
        items: [
          { label: '整合', value: d.interference.int.mean, ci: d.interference.int.ci, points: d.interference.int.points },
          { label: '分离', value: d.interference.sep.mean, ci: d.interference.sep.ci, points: d.interference.sep.points, copper: true }
        ],
        yFmt: v => Math.round(v),
        valueFmt: v => Math.round(v) + ' ms'
      });
    }

    const hostDen = $('#chart-stroop-density');
    if (hostDen) {
      U.clear(hostDen);
      const colors = { int_cong: '#14110E', int_incong: '#6E6659', sep_cong: '#A66A3C', sep_incong: '#C89A6E' };
      const labels = { int_cong: '整合·一致', int_incong: '整合·不一致', sep_cong: '分离·一致', sep_incong: '分离·不一致' };
      window.Charts.density(hostDen, {
        height: 240,
        series: d.conds.map(c => ({ values: d.density[c], color: colors[c], label: labels[c] })).filter(s => s.values.length),
        xLabel: '反应时 (ms)'
      });
      window.Charts.legend(hostDen, d.conds.map(c => ({ label: labels[c], color: colors[c] })));
    }

    const hostQQ = $('#chart-stroop-qq');
    if (hostQQ && d.ddm.int_incong) {
      U.clear(hostQQ);
      window.Charts.qq(hostQQ, {
        height: 230,
        observed: d.ddm.int_incong.observed,
        predicted: d.ddm.int_incong.sim,
        xLabel: '实测 RT (ms)'
      });
    }
  }

  function plotProp() {
    const d = state.prop;
    const hostMAE = $('#chart-prop-mae');
    if (hostMAE) {
      U.clear(hostMAE);
      window.Charts.bars(hostMAE, {
        height: 250,
        items: [
          { label: '饼图·无', value: d.mae.pie_none.mean, ci: d.mae.pie_none.ci, points: d.mae.pie_none.points },
          { label: '饼图·有', value: d.mae.pie_tick.mean, ci: d.mae.pie_tick.ci, points: d.mae.pie_tick.points, copper: true },
          { label: '条形·无', value: d.mae.bar_none.mean, ci: d.mae.bar_none.ci, points: d.mae.bar_none.points },
          { label: '条形·有', value: d.mae.bar_tick.mean, ci: d.mae.bar_tick.ci, points: d.mae.bar_tick.points, copper: true }
        ],
        yFmt: v => Math.round(v),
        valueFmt: v => U.fmt(v, 1)
      });
    }

    const hostBias = $('#chart-prop-bias');
    if (hostBias) {
      U.clear(hostBias);
      const colors = { pie_none: '#14110E', pie_tick: '#A66A3C', bar_none: '#6E6659', bar_tick: '#C89A6E' };
      const observed = [];
      const curves = [];
      ['pie_none', 'pie_tick', 'bar_none', 'bar_tick'].forEach(c => {
        const b = d.bias[c];
        b.points.forEach(pt => observed.push({ x: pt.p * 100, y: pt.j * 100, color: colors[c], r: 2.6 }));
        if (b.fit) {
          curves.push({
            color: colors[c],
            dash: c.indexOf('none') >= 0,
            points: window.PM.curve(b.fit.beta, 50).map(pt => ({ x: pt.p * 100, y: pt.j * 100 }))
          });
        }
      });
      window.Charts.curve(hostBias, {
        height: 300,
        xMax: 100, yMax: 100,
        observed: observed,
        curves: curves,
        xLabel: '真实比例 (%)',
        yLabel: '判断值 (%)'
      });
      window.Charts.legend(hostBias, [
        { label: '饼图·无刻度', color: colors.pie_none },
        { label: '饼图·有刻度', color: colors.pie_tick },
        { label: '条形·无刻度', color: colors.bar_none },
        { label: '条形·有刻度', color: colors.bar_tick }
      ]);
    }
  }

  return { render, plot };
})();
