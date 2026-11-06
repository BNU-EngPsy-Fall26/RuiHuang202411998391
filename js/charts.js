/* ============================================================
   charts.js — 手写 SVG 图表（无依赖）
   风格：1px 线、无背景网格、铜色只标「改进条件」、个体点低透明度
   ============================================================ */

window.Charts = (function () {

  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  }

  function frame(container, height, pad) {
    const w = Math.max(320, container.clientWidth || 560);
    const h = height || 240;
    const m = Object.assign({ t: 18, r: 18, b: 38, l: 46 }, pad || {});
    const svg = svgEl('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      width: '100%',
      height: h,
      class: 'chart',
      role: 'img'
    });
    container.appendChild(svg);
    return { svg, w, h, m, iw: w - m.l - m.r, ih: h - m.t - m.b };
  }

  function text(parent, x, y, str, cls, anchor) {
    const t = svgEl('text', { x: x, y: y, class: cls || 'label' });
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    parent.appendChild(t);
    return t;
  }

  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const n = v / base;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * base;
  }

  function axisY(parent, g, max, fmt, ticks) {
    const n = ticks || 4;
    for (let i = 0; i <= n; i++) {
      const v = max * i / n;
      const y = g.m.t + g.ih - (i / n) * g.ih;
      parent.appendChild(svgEl('line', {
        x1: g.m.l, x2: g.m.l + g.iw, y1: y, y2: y,
        class: i === 0 ? 'axis' : 'tick', opacity: i === 0 ? 1 : 0.55
      }));
      text(parent, g.m.l - 10, y + 3, fmt ? fmt(v) : Math.round(v), 'label', 'end');
    }
  }

  function valueLabel(parent, x, y, str) {
    text(parent, x, y, str, 'value', 'middle');
  }

  /**
   * 柱状图 + 95% CI + 个体点
   * items: [{label, value, ci:[lo,hi], points:[], copper:bool}]
   */
  function bars(container, opts) {
    opts = opts || {};
    const items = opts.items || [];
    const g = frame(container, opts.height || 260, opts.pad);
    const max = niceMax(Math.max.apply(null, items.map(d =>
      Math.max(d.value, d.ci ? d.ci[1] : d.value, d.points ? Math.max.apply(null, d.points) : 0)
    ).concat([1])) * 1.12);

    axisY(g.svg, g, max, opts.yFmt);

    const step = g.iw / items.length;
    const bw = Math.min(74, step * 0.42);

    items.forEach((d, i) => {
      const cx = g.m.l + step * (i + 0.5);
      const h = Math.max(1, (d.value / max) * g.ih);
      const y = g.m.t + g.ih - h;

      const rect = svgEl('rect', {
        x: cx - bw / 2, y: y, width: bw, height: h,
        class: d.copper ? 'bar bar--copper' : 'bar'
      });
      g.svg.appendChild(rect);

      if (d.ci) {
        const yHi = g.m.t + g.ih - (d.ci[1] / max) * g.ih;
        const yLo = g.m.t + g.ih - (d.ci[0] / max) * g.ih;
        g.svg.appendChild(svgEl('line', {
          x1: cx, x2: cx, y1: yHi, y2: yLo, class: 'ci'
        }));
        g.svg.appendChild(svgEl('line', { x1: cx - 4, x2: cx + 4, y1: yHi, y2: yHi, class: 'ci' }));
        g.svg.appendChild(svgEl('line', { x1: cx - 4, x2: cx + 4, y1: yLo, y2: yLo, class: 'ci' }));
      }

      if (d.points && d.points.length) {
        d.points.forEach((v, k) => {
          const jx = cx + ((k / Math.max(1, d.points.length - 1)) - 0.5) * bw * 0.66;
          const py = g.m.t + g.ih - (v / max) * g.ih;
          g.svg.appendChild(svgEl('circle', {
            cx: jx, cy: py, r: 2,
            class: d.copper ? 'point point--copper' : 'point'
          }));
        });
      }

      if (opts.showValue !== false) {
        valueLabel(g.svg, cx, y - 8, (opts.valueFmt || (v => Math.round(v)))(d.value));
      }

      text(g.svg, cx, g.m.t + g.ih + 20, d.label, 'label', 'middle');
    });

    if (opts.yLabel) text(g.svg, 4, 10, opts.yLabel, 'label');
    return g;
  }

  /**
   * 两条（或多条）密度曲线
   * series: [{values:[], color, label, fill}]
   */
  function density(container, opts) {
    opts = opts || {};
    const series = (opts.series || []).filter(s => s.values && s.values.length);
    if (!series.length) return null;
    const g = frame(container, opts.height || 240, opts.pad);

    const all = [];
    series.forEach(s => all.push.apply(all, s.values));
    let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    const pad = (hi - lo) * 0.08 || 50;
    lo = Math.max(0, lo - pad); hi = hi + pad;

    const grid = [];
    const N = 90;
    for (let i = 0; i < N; i++) grid.push(lo + (hi - lo) * i / (N - 1));

    let ymax = 0;
    series.forEach(s => {
      const k = window.DDM.kde(s.values, grid);
      s.k = k;
      k.forEach(d => { if (d.y > ymax) ymax = d.y; });
    });
    ymax = ymax || 1;

    axisY(g.svg, g, ymax, v => (v === 0 ? '0' : v.toFixed(3)), 3);

    series.forEach(s => {
      const path = s.k.map((d, i) => {
        const x = g.m.l + (d.x - lo) / (hi - lo) * g.iw;
        const y = g.m.t + g.ih - (d.y / ymax) * g.ih * 0.94;
        return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      if (s.fill) {
        const first = g.m.l + (s.k[0].x - lo) / (hi - lo) * g.iw;
        const last = g.m.l + (s.k[s.k.length - 1].x - lo) / (hi - lo) * g.iw;
        const base = g.m.t + g.ih;
        g.svg.appendChild(svgEl('path', {
          d: path + ' L' + last + ',' + base + ' L' + first + ',' + base + ' Z',
          fill: s.color, opacity: 0.10
        }));
      }
      const p = svgEl('path', { d: path, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.25 });
      if (s.dash) p.setAttribute('stroke-dasharray', '4 3');
      g.svg.appendChild(p);
    });

    [lo, (lo + hi) / 2, hi].forEach(v => {
      text(g.svg, g.m.l + (v - lo) / (hi - lo) * g.iw, g.m.t + g.ih + 20, Math.round(v), 'label', 'middle');
    });
    if (opts.xLabel) text(g.svg, g.m.l + g.iw / 2, g.m.t + g.ih + 34, opts.xLabel, 'label', 'middle');
    return g;
  }

  /** Q-Q：预测分位数 vs 实测分位数 */
  function qq(container, opts) {
    opts = opts || {};
    const obs = opts.observed || [], pred = opts.predicted || [];
    const g = frame(container, opts.height || 230, opts.pad);
    const qs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const o = qs.map(q => window.S.quantile(obs, q));
    const p = qs.map(q => window.S.quantile(pred, q));
    const max = niceMax(Math.max.apply(null, o.concat(p)) * 1.05);

    g.svg.appendChild(svgEl('line', {
      x1: g.m.l, y1: g.m.t + g.ih, x2: g.m.l + g.iw, y2: g.m.t, class: 'diag'
    }));

    o.forEach((ox, i) => {
      const x = g.m.l + (ox / max) * g.iw;
      const y = g.m.t + g.ih - (p[i] / max) * g.ih;
      g.svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 2.4, class: 'point' }));
    });

    [0, max / 2, max].forEach(v => {
      text(g.svg, g.m.l + (v / max) * g.iw, g.m.t + g.ih + 20, Math.round(v), 'label', 'middle');
      text(g.svg, g.m.l - 10, g.m.t + g.ih - (v / max) * g.ih + 3, Math.round(v), 'label', 'end');
    });
    if (opts.xLabel) text(g.svg, g.m.l + g.iw / 2, g.m.t + g.ih + 34, opts.xLabel, 'label', 'middle');
    return g;
  }

  /**
   * 观察点 + 模型曲线
   * observed: [{x, y, group}]
   * curves: [{points:[{x,y}], color, dash}]
   */
  function curve(container, opts) {
    opts = opts || {};
    const g = frame(container, opts.height || 280, opts.pad);
    const xmax = opts.xMax || 100, ymax = opts.yMax || 100;

    // 对角线
    if (opts.diagonal !== false) {
      g.svg.appendChild(svgEl('line', {
        x1: g.m.l, y1: g.m.t + g.ih,
        x2: g.m.l + g.iw, y2: g.m.t + g.ih - g.ih,
        class: 'diag'
      }));
    }

    [0, 25, 50, 75, 100].forEach(v => {
      text(g.svg, g.m.l + (v / xmax) * g.iw, g.m.t + g.ih + 20, v, 'label', 'middle');
      text(g.svg, g.m.l - 10, g.m.t + g.ih - (v / ymax) * g.ih + 3, v, 'label', 'end');
    });

    (opts.curves || []).forEach(c => {
      const d = c.points.map((pt, i) => {
        const x = g.m.l + (pt.x / xmax) * g.iw;
        const y = g.m.t + g.ih - (pt.y / ymax) * g.ih;
        return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      const p = svgEl('path', { d: d, fill: 'none', stroke: c.color, 'stroke-width': 1.25 });
      if (c.dash) p.setAttribute('stroke-dasharray', '4 3');
      g.svg.appendChild(p);
    });

    (opts.observed || []).forEach(pt => {
      const x = g.m.l + (pt.x / xmax) * g.iw;
      const y = g.m.t + g.ih - (pt.y / ymax) * g.ih;
      g.svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: pt.r || 2.6,
        fill: pt.color || '#14110E', opacity: pt.opacity === undefined ? 0.55 : pt.opacity
      }));
    });

    if (opts.xLabel) text(g.svg, g.m.l + g.iw / 2, g.m.t + g.ih + 34, opts.xLabel, 'label', 'middle');
    if (opts.yLabel) text(g.svg, 4, 10, opts.yLabel, 'label');
    return g;
  }

  /** 简易图例 */
  function legend(container, items) {
    const box = document.createElement('div');
    box.className = 'legend';
    items.forEach(it => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      if (it.dot) i.className = 'dot';
      else if (it.dash) i.style.background = 'transparent';
      i.style.background = it.dash ? 'transparent' : it.color;
      if (it.dash) { i.style.borderTop = '1px dashed ' + it.color; i.style.height = '0'; }
      s.appendChild(i);
      s.appendChild(document.createTextNode(it.label));
      box.appendChild(s);
    });
    container.appendChild(box);
    return box;
  }

  return { bars, density, qq, curve, legend };
})();
