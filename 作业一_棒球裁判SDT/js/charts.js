/* =============================================================================
 * charts.js —— 全部图表用 Canvas 手绘（概念可视化 / ROC / 多局对比）
 *
 * 依赖：config.js、sdt.js
 *
 * 为什么不用现成的图表库：
 *   1. 作业要求"纯前端、双击 index.html 即可运行"，引用 CDN 在断网或被墙时
 *      会直接白屏；本地引入又会增加 clone 后的文件体积与路径风险。
 *   2. 三张图都是标准正态 / ROC 的解析曲线，手绘只需几十行，且能完全控制
 *      标注（c 竖线、d′ 箭头、σ 反推数值），比图表库更贴合教学表达。
 *
 * 三张图：
 *   drawDistributions —— 信号/噪声双正态分布 + 判断标准 c 竖线（随 ε 与 c 实时变化）
 *   drawROC           —— 理论 ROC 曲线 + 经验 ROC 点
 *   drawRegression    —— d′ 对 ε 的回归（过原点），并标注反推的 σ
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var C = SDT.CONFIG;

  /* =====================================================================
   * 通用绘图工具
   * ================================================================== */

  /** 按 devicePixelRatio 准备画布，返回逻辑尺寸与 ctx */
  function prep(canvas) {
    var dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var W = Math.max(240, Math.round(rect.width || 360));
    var H = Math.max(160, Math.round(rect.height || 220));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }

  function plotBox(W, H, m) {
    m = m || { l: 52, r: 16, t: 24, b: 36 };
    return { x: m.l, y: m.t, w: W - m.l - m.r, h: H - m.t - m.b };
  }

  function mapX(box, min, max) {
    return function (v) { return box.x + (v - min) / (max - min) * box.w; };
  }
  function mapY(box, min, max) {
    return function (v) { return box.y + box.h - (v - min) / (max - min) * box.h; };
  }

  /** 生成"整齐"的刻度值 */
  function niceTicks(min, max, n) {
    var span = max - min;
    if (!(span > 0)) return [min];
    var step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = span / n / step;
    if (err >= 5) step *= 5; else if (err >= 2) step *= 2;
    var out = [];
    var v = Math.ceil(min / step) * step;
    for (; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
    return out;
  }

  function fmt(v, d) {
    if (!isFinite(v)) return '—';
    return v.toFixed(d == null ? 2 : d);
  }

  /** 画坐标框、网格、刻度与轴标签 */
  function drawFrame(ctx, box, xr, yr, xLabel, yLabel, xDigits, yDigits) {
    ctx.save();
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = C.colors.textDim;
    ctx.strokeStyle = C.colors.grid;
    ctx.lineWidth = 1;

    var xt = niceTicks(xr[0], xr[1], 5);
    var yt = niceTicks(yr[0], yr[1], 5);
    var X = mapX(box, xr[0], xr[1]);
    var Y = mapY(box, yr[0], yr[1]);

    // 网格
    xt.forEach(function (v) {
      var px = X(v);
      ctx.beginPath(); ctx.moveTo(px, box.y); ctx.lineTo(px, box.y + box.h); ctx.stroke();
    });
    yt.forEach(function (v) {
      var py = Y(v);
      ctx.beginPath(); ctx.moveTo(box.x, py); ctx.lineTo(box.x + box.w, py); ctx.stroke();
    });

    // 刻度文字
    ctx.fillStyle = C.colors.textDim;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.forEach(function (v) { ctx.fillText(fmt(v, xDigits), X(v), box.y + box.h + 6); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.forEach(function (v) { ctx.fillText(fmt(v, yDigits), box.x - 8, Y(v)); });

    // 边框
    ctx.strokeStyle = C.colors.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    // 轴标签
    ctx.fillStyle = C.colors.text;
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (xLabel) ctx.fillText(xLabel, box.x + box.w / 2, box.y + box.h + 30);
    if (yLabel) {
      ctx.save();
      ctx.translate(13, box.y + box.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    return { X: X, Y: Y };
  }

  /** 画一条折线 */
  function polyline(ctx, pts, color, width, dash) {
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  function dot(ctx, x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function legend(ctx, entries, x, y) {
    ctx.save();
    ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    entries.forEach(function (e, i) {
      var yy = y + i * 16;
      if (e.dash) {
        ctx.save();
        ctx.setLineDash(e.dash);
        ctx.strokeStyle = e.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 18, yy); ctx.stroke();
        ctx.restore();
      } else if (e.point) {
        dot(ctx, x + 9, yy, 4, e.color);
      } else {
        ctx.fillStyle = e.color;
        ctx.fillRect(x, yy - 2, 18, 4);
      }
      ctx.fillStyle = C.colors.textDim;
      ctx.fillText(e.label, x + 24, yy);
    });
    ctx.restore();
  }

  /* =====================================================================
   * 图一：信号 / 噪声双正态分布 + 判断标准 c
   *
   * 横轴是"主观感觉到的球相对边界的偏移量"（内部决策变量）：
   *   · 噪声（坏球）分布  ~ N(−ε, σ_total)
   *   · 信号（好球）分布  ~ N(+ε, σ_total)
   *   · 判断标准 k = c · σ_total，主审在 k 处竖一条线：k 右侧判好球
   *   · 两个分布均值间距 = 2ε，d′ = 2ε / σ_total
   * 图中被竖线切出的两块面积就分别是 P(Hit) 与 P(FA)。
   * ================================================================== */
  function drawDistributions(canvas, opts) {
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx;

    var eps = opts.epsilonIn || 1.0;
    var sigma = opts.sigmaTotalIn || 1.0;
    var c = (typeof opts.c === 'number' && isFinite(opts.c)) ? opts.c : 0;
    var dprime = (typeof opts.dprime === 'number' && isFinite(opts.dprime)) ? opts.dprime : 2 * eps / sigma;
    var k = c * sigma;                          // 判断标准（英寸）

    var span = Math.max(eps + 3.2 * sigma, Math.abs(k) + 3.2 * sigma, 2.5);
    var xr = [-span, span];

    // 纵轴范围：略高于两条曲线的峰值
    var peak = SDT.math.phi(0) / sigma;
    var yr = [0, peak * 1.28];

    var box = plotBox(p.W, p.H, { l: 44, r: 16, t: 26, b: 38 });
    var scales = drawFrame(ctx, box, xr, yr, '主观感觉到的球相对边界的偏移量（英寸）', '概率密度', 1, 2);
    var X = scales.X, Y = scales.Y;

    var N = 160;
    var noisePts = [], sigPts = [];
    for (var i = 0; i <= N; i++) {
      var x = xr[0] + (xr[1] - xr[0]) * i / N;
      noisePts.push({ x: X(x), y: Y(SDT.math.phi((x + eps) / sigma) / sigma) });
      sigPts.push({ x: X(x), y: Y(SDT.math.phi((x - eps) / sigma) / sigma) });
    }

    // ---- 面积：竖线右侧的两块（P(FA) 与 P(Hit)）----
    function shadeRight(mean, color) {
      var pts = [{ x: X(k), y: Y(0) }];
      for (var j = 0; j <= N; j++) {
        var xx = xr[0] + (xr[1] - xr[0]) * j / N;
        if (xx < k) continue;
        pts.push({ x: X(xx), y: Y(SDT.math.phi((xx - mean) / sigma) / sigma) });
      }
      pts.push({ x: X(xr[1]), y: Y(0) });
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var q = 1; q < pts.length; q++) ctx.lineTo(pts[q].x, pts[q].y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }
    shadeRight(-eps, 'rgba(229,83,75,0.28)');   // P(FA)：噪声分布被判"好球"的部分
    shadeRight(+eps, 'rgba(63,185,80,0.28)');   // P(Hit)：信号分布被判"好球"的部分

    // ---- 两条曲线 ----
    polyline(ctx, noisePts, C.colors.noise, 2.2);
    polyline(ctx, sigPts, C.colors.signal, 2.2);

    // ---- 判断标准 c 竖线 ----
    if (k >= xr[0] && k <= xr[1]) {
      polyline(ctx, [{ x: X(k), y: Y(0) }, { x: X(k), y: Y(peak * 1.22) }],
        C.colors.criterion, 2, [6, 4]);
      ctx.save();
      ctx.font = 'bold 11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = C.colors.criterion;
      ctx.textAlign = 'left';
      ctx.fillText('判断标准 c = ' + fmt(c, 2) + (c > 0.01 ? '（保守）' : c < -0.01 ? '（冒进）' : '（中立）'),
        X(k) + 5, Y(peak * 1.22) + 4);
      ctx.restore();
    }

    // ---- 分布均值标记 ----
    ctx.save();
    ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = C.colors.noise;
    ctx.fillText('噪声（坏球）', X(-eps), Y(peak * 1.20));
    ctx.fillStyle = C.colors.signal;
    ctx.fillText('信号（好球）', X(+eps), Y(peak * 1.20));
    ctx.restore();

    // ---- d′ 双向箭头：从 −ε 到 +ε ----
    var ay = Y(0) + 14;
    ctx.save();
    ctx.strokeStyle = C.colors.text;
    ctx.fillStyle = C.colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(-eps), ay); ctx.lineTo(X(eps), ay); ctx.stroke();
    [[X(-eps), 1], [X(eps), -1]].forEach(function (a) {
      ctx.beginPath();
      ctx.moveTo(a[0], ay);
      ctx.lineTo(a[0] + 7 * a[1], ay - 4);
      ctx.lineTo(a[0] + 7 * a[1], ay + 4);
      ctx.closePath(); ctx.fill();
    });
    ctx.font = 'bold 11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('2ε = ' + fmt(2 * eps, 2) + '″　→　d′ = 2ε/σ = ' + fmt(dprime, 2),
      (X(-eps) + X(eps)) / 2, ay - 7);
    ctx.restore();

    legend(ctx, [
      { color: C.colors.noise, label: '噪声分布 N(−ε, σ)，上方红区 = P(FA)' },
      { color: C.colors.signal, label: '信号分布 N(+ε, σ)，上方绿区 = P(Hit)' },
      { color: C.colors.criterion, dash: [6, 4], label: '判断标准线 k = c·σ' }
    ], box.x + 6, box.y + box.h - 40);

    // 左上角参数摘要
    ctx.save();
    ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = C.colors.textDim;
    ctx.textAlign = 'right';
    ctx.fillText('ε = ' + fmt(eps, 2) + '″, σ = ' + fmt(sigma, 2) + '″', box.x + box.w, box.y + box.h - 6);
    ctx.restore();
  }

  /* =====================================================================
   * 图二：ROC 曲线
   *   · 理论曲线 P(Hit) = Φ( d′ + z(P(FA)) )
   *   · 经验点（信心评级法的三个切点，或多局不同判断标准）
   * ================================================================== */
  function drawROC(canvas, opts) {
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx;

    var box = plotBox(p.W, p.H, { l: 46, r: 16, t: 26, b: 38 });
    var scales = drawFrame(ctx, box, [0, 1], [0, 1], 'P(FA)　虚报率', 'P(Hit)　命中率', 1, 1);
    var X = scales.X, Y = scales.Y;

    // 对角线（d′ = 0，完全无分辨力）
    polyline(ctx, [{ x: X(0), y: Y(0) }, { x: X(1), y: Y(1) }], 'rgba(30,50,75,0.22)', 1.4, [5, 5]);

    // 理论 ROC（以实测 d′ 为准）
    var dprime = opts.dprime;
    if (typeof dprime === 'number' && isFinite(dprime)) {
      var curve = SDT.math.rocCurve(dprime, 120);
      polyline(ctx, curve.map(function (q) { return { x: X(q.pfa), y: Y(q.phit) }; }),
        C.colors.accentLine, 2);
    }

    // 经验点
    var pts = (opts.points || []).filter(function (q) {
      return isFinite(q.pfa) && isFinite(q.phit);
    });
    if (pts.length >= 2) {
      var sorted = pts.slice().sort(function (a, b) { return a.pfa - b.pfa; });
      polyline(ctx, sorted.map(function (q) { return { x: X(q.pfa), y: Y(q.phit) }; }),
        'rgba(224,139,44,0.9)', 2);
    }
    pts.forEach(function (q) {
      dot(ctx, X(q.pfa), Y(q.phit), 5, C.colors.criterion, '#ffffff');
      if (q.label) {
        ctx.save();
        ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.fillStyle = C.colors.textDim;
        ctx.textAlign = 'left';
        ctx.fillText(q.label, X(q.pfa) + 8, Y(q.phit) - 7);
        ctx.restore();
      }
    });

    legend(ctx, [
      { color: C.colors.accentLine, label: '理论 ROC（d′ = ' + fmt(dprime, 2) + '）' },
      { color: C.colors.criterion, point: true, label: '经验 ROC 点（' + pts.length + ' 个）' },
      { color: 'rgba(30,50,75,0.30)', dash: [5, 5], label: '对角线（d′ = 0，瞎猜）' }
    ], box.x + 8, box.y + 12);

    if (isFinite(dprime)) {
      ctx.save();
      ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = C.colors.textDim;
      ctx.textAlign = 'right';
      ctx.fillText('AUC(经验) = ' + fmt(SDT.math.auc(pts), 3), box.x + box.w - 6, box.y + box.h - 6);
      ctx.restore();
    } else {
      ctx.save();
      ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = C.colors.textDim;
      ctx.textAlign = 'center';
      ctx.fillText('尚无可用于计算 d′ 的数据', box.x + box.w / 2, box.y + box.h / 2);
      ctx.restore();
    }
  }

  /* =====================================================================
   * 图三：d′ 对 ε 的回归（过原点）
   *   SDT 预测 d′ = (2/σ)·ε —— 一条过原点的直线，斜率即 2/σ。
   *   由斜率反推 σ_total，再剥离外部噪声得到被试自身的知觉噪声 σ_int。
   * ================================================================== */
  function drawRegression(canvas, opts) {
    opts = opts || {};
    var p = prep(canvas);
    var ctx = p.ctx;

    var pts = (opts.points || []).filter(function (q) {
      return isFinite(q.epsilonIn) && isFinite(q.dprime);
    });
    var fit = SDT.math.fitEpsilonSlope(pts, opts.sigmaExtIn);

    var maxE = 0.5, maxD = 1;
    pts.forEach(function (q) {
      maxE = Math.max(maxE, q.epsilonIn);
      maxD = Math.max(maxD, q.dprime);
    });
    if (fit.ok && fit.slope > 1e-9) {
      maxE = Math.max(maxE, (2 / fit.slope) * 0.6);
      maxD = Math.max(maxD, fit.slope * maxE);
    }
    maxE = Math.min(maxE, 1e4);
    maxD = Math.min(maxD, 1e4);
    var xr = [0, maxE * 1.18];
    var yr = [0, maxD * 1.18];

    var box = plotBox(p.W, p.H, { l: 48, r: 16, t: 26, b: 38 });
    var scales = drawFrame(ctx, box, xr, yr, 'ε　球边到好球区线的距离（英寸）', 'd′　分辨力', 1, 1);
    var X = scales.X, Y = scales.Y;

    // 过原点回归线
    if (fit.ok) {
      polyline(ctx, [
        { x: X(0), y: Y(0) },
        { x: X(xr[1]), y: Y(fit.slope * xr[1]) }
      ], C.colors.criterion, 2);
    }

    // 数据点（同一 ε 可能有多局，取平均后画点，并标注局数）
    var byEps = {};
    pts.forEach(function (q) {
      if (!byEps[q.epsilonIn]) byEps[q.epsilonIn] = [];
      byEps[q.epsilonIn].push(q.dprime);
    });
    Object.keys(byEps).forEach(function (key) {
      var e = parseFloat(key);
      var arr = byEps[key];
      var mean = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      // 每一局的原始点（小空心点）
      arr.forEach(function (dv) { dot(ctx, X(e), Y(dv), 3, null, 'rgba(28,139,214,0.45)'); });
      // 均值点（大实心点）
      dot(ctx, X(e), Y(mean), 5.5, C.colors.accentLine, '#ffffff');
      ctx.save();
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = C.colors.textDim;
      ctx.textAlign = 'center';
      ctx.fillText(mean.toFixed(2), X(e), Y(mean) - 12);
      ctx.restore();
    });

    // 说明文字
    ctx.save();
    ctx.font = '11.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = C.colors.text;
    ctx.textAlign = 'left';
    if (fit.ok) {
      ctx.fillText('斜率 = ' + fmt(fit.slope, 3) + ' = 2/σ　→　σ总 = ' + fmt(fit.sigmaTotal, 3) + '″',
        box.x + 8, box.y + 14);
      ctx.fillStyle = C.colors.textDim;
      ctx.fillText('σ自身 = ' + fmt(fit.sigmaInternal, 3) + '″（已剥离外部噪声 ' +
        fmt(opts.sigmaExtIn != null ? opts.sigmaExtIn : C.externalNoiseIn, 2) + '″）　R² = ' + fmt(fit.r2, 3),
        box.x + 8, box.y + 30);
    } else {
      ctx.fillStyle = C.colors.textDim;
      ctx.fillText(fit.reason || '暂无可拟合数据', box.x + 8, box.y + 14);
      ctx.fillText('提示：换不同难度各跑一局，即可得到 d′ 随 ε 变化的函数关系。',
        box.x + 8, box.y + 30);
    }
    ctx.restore();
  }

  SDT.Charts = {
    drawDistributions: drawDistributions,
    drawROC: drawROC,
    drawRegression: drawRegression
  };
})(typeof window !== 'undefined' ? window : globalThis);
