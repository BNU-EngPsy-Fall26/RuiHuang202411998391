/* ============================================================
   propjudge.js — 实验二：Cleveland–McGill 比例判断（有无刻度）
   ============================================================ */

window.PropJudge = (function () {

  const C = () => window.CONFIG.prop;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const meta = {
    id: 'prop_ticks',
    no: '02',
    title: '比例判断',
    en: 'Proportion Judgement',
    tag: '复现 + 改进',
    desc: '看一个图形（饼图或条形），估计高亮部分占整体的比例。一半试次带 25/50/75 刻度线，另一半没有。',
    minutes: 5,
    trials: 40
  };

  /* ---------- 生成试次 ---------- */

  function makeTrials(pool, conditions, reps) {
    const out = [];
    conditions.forEach(cond => {
      const props = U.shuffle(pool).slice(0, reps);
      props.forEach(p => {
        out.push({
          cond: cond.id,
          chart: cond.chart,
          ticks: cond.ticks,
          true_prop: p,
          block_order: 'main'
        });
      });
    });
    return U.shuffle(out);
  }

  function formal() {
    return makeTrials(C().pool, C().conditions, C().reps);
  }

  function practice() {
    const props = [20, 60, 40, 80];
    return C().conditions.map((cond, i) => ({
      cond: cond.id,
      chart: cond.chart,
      ticks: cond.ticks,
      true_prop: props[i],
      block_order: 'practice'
    }));
  }

  /* ---------- 图形 ---------- */

  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  }

  function polar(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function pieSVG(prop, ticks) {
    const size = C().pieSize + 60;
    const cx = size / 2, cy = size / 2, r = C().pieSize / 2;
    const svg = svgEl('svg', {
      viewBox: '0 0 ' + size + ' ' + size,
      width: size, height: size
    });

    svg.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: '#E8E3D8', stroke: '#DCD5C7', 'stroke-width': 1
    }));

    const p = prop / 100;
    const [sx, sy] = polar(cx, cy, r, 0);
    const [ex, ey] = polar(cx, cy, r, 360 * p);
    const large = p > 0.5 ? 1 : 0;
    const d = p >= 0.999
      ? 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy +
        ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx - r) + ' ' + cy + ' Z'
      : 'M ' + cx + ' ' + cy + ' L ' + sx.toFixed(2) + ' ' + sy.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + ex.toFixed(2) + ' ' + ey.toFixed(2) + ' Z';

    svg.appendChild(svgEl('path', { d: d, fill: '#A66A3C' }));

    if (ticks) {
      [0.25, 0.5, 0.75].forEach(t => {
        const a1 = polar(cx, cy, r + 7, 360 * t);
        const a2 = polar(cx, cy, r + 20, 360 * t);
        svg.appendChild(svgEl('line', {
          x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1],
          stroke: '#6E6659', 'stroke-width': 1
        }));
      });
    }
    return svg;
  }

  function barSVG(prop, ticks) {
    const w = C().barW + 80, h = C().barH + 100;
    const x = 40, y = 50, bw = C().barW, bh = C().barH;
    const svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h });

    svg.appendChild(svgEl('rect', {
      x: x, y: y, width: bw, height: bh,
      fill: '#E8E3D8', stroke: '#DCD5C7', 'stroke-width': 1
    }));
    svg.appendChild(svgEl('rect', {
      x: x, y: y, width: Math.max(1, bw * prop / 100), height: bh,
      fill: '#A66A3C'
    }));

    if (ticks) {
      [0.25, 0.5, 0.75].forEach(t => {
        const tx = x + bw * t;
        svg.appendChild(svgEl('line', {
          x1: tx, y1: y - 16, x2: tx, y2: y + bh + 16,
          stroke: '#6E6659', 'stroke-width': 1
        }));
      });
    }
    return svg;
  }

  /* ---------- 呈现与作答 ---------- */

  let ui = null;

  function hint(trial) {
    return trial.chart === 'pie'
      ? '估计铜色扇区占整个圆的百分比 · 拖动滑块 · 空格确认'
      : '估计铜色部分占整条的比例 · 拖动滑块 · 空格确认';
  }

  async function show(trial, host) {
    host.innerHTML = '';

    const plate = document.createElement('div');
    plate.className = 'plate';
    plate.appendChild(trial.chart === 'pie'
      ? pieSVG(trial.true_prop, trial.ticks)
      : barSVG(trial.true_prop, trial.ticks));
    host.appendChild(plate);

    const wrap = document.createElement('div');
    wrap.className = 'answer';

    const row = document.createElement('div');
    row.className = 'answer__row';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(C().sliderStart);
    input.setAttribute('aria-label', '判断比例');

    const val = document.createElement('span');
    val.className = 'answer__value';
    val.innerHTML = String(C().sliderStart) + '<small>%</small>';

    row.appendChild(input);
    row.appendChild(val);

    const btn = document.createElement('button');
    btn.className = 'btn answer__confirm';
    btn.type = 'button';
    btn.textContent = '确认（空格）';

    const hintEl = document.createElement('p');
    hintEl.className = 'answer__hint';
    hintEl.textContent = '拖动滑块 · 按空格确认';

    wrap.appendChild(row);
    wrap.appendChild(btn);
    wrap.appendChild(hintEl);
    host.appendChild(wrap);

    input.addEventListener('input', function () {
      val.innerHTML = input.value + '<small>%</small>';
    });

    ui = { input: input, val: val, btn: btn };

    await Engine.nextFrame();
    return Engine.now();
  }

  function respond(trial, onset) {
    return new Promise(resolve => {
      let done = false;

      function cleanup() {
        window.removeEventListener('keydown', onKey);
        if (ui && ui.btn) ui.btn.removeEventListener('click', submit);
      }

      function finish(res) {
        if (done) return;
        done = true;
        cleanup();
        resolve(res);
      }

      function submit() {
        const judged = Number(ui.input.value);
        finish({
          key: 'space',
          rt: Math.round(Engine.now() - onset),
          judged: judged,
          err: judged - trial.true_prop,
          correct: null,
          timeout: 0
        });
      }

      function onKey(e) {
        if (e.repeat) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') {
          finish({ aborted: true });
        }
      }

      window.addEventListener('keydown', onKey);
      if (ui && ui.btn) ui.btn.addEventListener('click', submit);
      if (ui && ui.input) ui.input.focus();
    });
  }

  function clear(host) { host.innerHTML = ''; ui = null; }

  function feedback(host, ok, trial) {
    const judged = ok && typeof ok === 'number' ? ok : null;
    host.innerHTML = '';
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.gap = '10px';

    const real = document.createElement('div');
    real.className = 'feedback feedback--ok';
    real.textContent = '实际 ' + trial.true_prop + '%';

    box.appendChild(real);
    host.appendChild(box);
  }

  /* ---------- 小结 ---------- */

  function summarize(trials) {
    const formalTrials = trials.filter(t => t.block_order !== 'practice');
    const conds = C().conditions.map(c => c.id);
    const by = {};
    conds.forEach(id => {
      const xs = formalTrials.filter(t => t.cond === id);
      const errs = xs.map(t => Math.abs(t.judged - t.true_prop));
      const signed = xs.map(t => t.judged - t.true_prop);
      by[id] = {
        n: xs.length,
        mae: window.S.mean(errs),
        bias: window.S.mean(signed),
        errs: errs,
        signed: signed
      };
    });
    return {
      n: formalTrials.length,
      by: by,
      overallMAE: window.S.mean(formalTrials.map(t => Math.abs(t.judged - t.true_prop)))
    };
  }

  /* ---------- 指导语 ---------- */

  function brief() {
    return {
      kicker: 'Experiment 02 · Proportion',
      title: '比例判断',
      html:
        '<p><b>你要做的：</b>屏幕上会出现一个饼图或一条横条，其中一部分是<b>铜色</b>。'
        + '请估计铜色部分占整体的<b>百分之多少</b>。</p>'
        + '<p>拖动下方的滑块，数字会跟着变；按<b>空格</b>确认。没有时间限制，请尽量准确。</p>'
        + '<p class="rule">有些图带 25 / 50 / 75 的刻度线，有些没有。刻度只给参照，不标数字。</p>'
        + '<p>共 40 次，先做 4 次带反馈的练习。</p>',
      facts: [
        { k: '试次', v: '40 正式 + 4 练习' },
        { k: '时长', v: '约 4–5 分钟' },
        { k: '设计', v: '2×2 被试内' },
        { k: '改进', v: '加 25/50/75 刻度' },
        { k: '节奏', v: '注视 0.3 s → 图形（不限时）→ 空屏 0.5 s' },
        { k: '作答', v: '滑块 + 空格' }
      ],
      side: '判断的是「铜色占整体多少」，不是「铜色比另一部分大多少」。'
    };
  }

  return { meta, brief, practice, formal, show, respond, clear, feedback, summarize, hint };
})();
