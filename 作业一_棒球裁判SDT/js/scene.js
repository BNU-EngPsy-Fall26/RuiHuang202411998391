/* =============================================================================
 * scene.js —— Canvas 场景绘制（主审视角：从捕手后方看向投手）
 *
 * 依赖：config.js
 *
 * 坐标约定：
 *   · 逻辑坐标（与 trial.js 一致）= 英寸，原点在好球区中心，x 右为正、y 上为正
 *   · 屏幕坐标 = 像素，原点在画布左上角，y 向下为正
 *   两者通过 layout.pxPerInch 与 cx / zoneCenterY 换算，见 inchesToScreen()
 *
 * 画面上**只有一条线**：好球区（宽 17″ = 本垒板宽，高 = 0.115×身高）。
 *
 * 判定规则是"球的任何一部分经过好球区的任何一部分即为好球"，所以判据是
 * **球本身与这个矩形是否相交**，而不是球心落在哪里。反馈阶段会把整颗球画在
 * 真实位置，擦没擦到一眼就能看出来 —— 因此不需要、也不应该再画一条抽象的
 * "球心判定线"。少了那条线，画面干净很多，规则反而更直观。
 *
 * ε 的直观含义因此就是：**球边到好球区线的那一小段距离**
 *   好球试次 → 球边越过了线 ε（压线深度）
 *   坏球试次 → 球边离线的空隙是 ε
 * 反馈阶段会把这一段用一条短粗线直接标出来。
 *
 * 几何是"真实"的：
 *   本垒板在地面（groundY），好球区下缘在打者膝下缘（≈0.26×身高）之上，
 *   上缘再往上一个 zoneHeightIn。因此好球区框与地面、打者腿部的相对高度是
 *   按人体测量比例绘制的，而不是随手画一个方框。
 *
 * 关于"会不会从画面里偷看到答案"：
 *   · 判定窗口内**不绘制球**（球已被捕手接住），避免被试靠定格回放作答；
 *   · 判定窗口内捕手手套画在好球区中心（真实的 framing 行为就是把手套"捞"回中间），
 *     既不泄漏落点，又符合真实棒球情境；
 *   · 反馈阶段只揭示「真实位置」，并把球边到好球区线的那一小段 ε 标出来。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var C = SDT.CONFIG;

  var canvas = null;
  var ctx = null;
  var dpr = 1;
  var W = 0, H = 0;              // 逻辑像素尺寸（CSS 像素）
  var zone = { widthIn: 17, heightIn: 20.7 };
  var batter = { heightCm: 180, hand: 'right' };
  var layout = {};

  /* =====================================================================
   * 初始化与尺寸
   * ================================================================== */

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    resize();
  }

  /** 按 CSS 尺寸与 devicePixelRatio 重设画布分辨率，避免高分屏模糊 */
  function resize() {
    if (!canvas) return;
    dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    W = Math.max(320, Math.round(rect.width || 960));
    H = Math.max(260, Math.round(rect.height || 520));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }

  /** 设定好球区尺寸与打者信息 */
  function setZone(cfg) {
    if (cfg.widthIn) zone.widthIn = cfg.widthIn;
    if (cfg.heightIn) zone.heightIn = cfg.heightIn;
    if (cfg.batterHeightCm) batter.heightCm = cfg.batterHeightCm;
    if (cfg.hand) batter.hand = cfg.hand;
    computeLayout();
  }

  /**
   * 计算画面几何。
   *
   * 需要完整画进画面的最远范围：
   *   竖直：地面 → 好球区上缘 → 外扩一个球半径 → 极端噪声 3″ → 球半径
   *   水平：同上，左右各一份
   * 由这两个约束反推 pxPerInch（取较小者），从而保证：
   *   ① 好球区永不变形（横纵用同一个 pxPerInch）；
   *   ② 任何 legally 生成的球（含最极端的噪声球）完整落在画面内。
   */
  function computeLayout() {
    var r = C.zone.ballRadiusIn;
    var margin = C.zone.extremeMarginIn;

    var heightIn = batter.heightCm / 2.54;               // 打者身高（英寸）
    var zoneBottomAboveGroundIn = 0.26 * heightIn;       // 膝下缘距地面（人体测量近似）
    var zoneTopAboveGroundIn = zoneBottomAboveGroundIn + zone.heightIn;

    var groundY = H * 0.93;
    var topMargin = H * 0.14;
    var availV = groundY - topMargin;

    // 需要容纳到"最高那颗球的上边缘"
    var needTopIn = zoneTopAboveGroundIn + r + margin + r;
    var pxV = availV / needTopIn;

    // 需要容纳到"最外侧那颗球的左右边缘"
    var needHalfWIn = zone.widthIn / 2 + r + margin + r;
    var pxH = (W / 2 - W * 0.05) / needHalfWIn;
    var px = Math.min(pxV, pxH);

    var zoneBottomY = groundY - zoneBottomAboveGroundIn * px;
    var zoneTopY = groundY - zoneTopAboveGroundIn * px;
    var rPx = r * px;

    layout = {
      pxPerInch: px,
      cx: W / 2,
      zoneCenterY: (zoneTopY + zoneBottomY) / 2,
      zoneW: zone.widthIn * px,
      zoneH: zone.heightIn * px,
      zoneLeft: W / 2 - zone.widthIn * px / 2,
      zoneRight: W / 2 + zone.widthIn * px / 2,
      zoneTop: zoneTopY,
      zoneBottom: zoneBottomY,
      groundY: groundY,
      ballRadiusPx: rPx,
      ballRIn: r,
      // 内部几何：球心判定线（= 好球区外扩一个球半径）。仅供生成试次使用，不绘制。
      decisionLeft: W / 2 - (zone.widthIn / 2 + r) * px,
      decisionRight: W / 2 + (zone.widthIn / 2 + r) * px,
      decisionTop: zoneTopY - rPx,
      decisionBottom: zoneBottomY + rPx,
      plateW: zone.widthIn * px,
      plateH: Math.max(6, 1.0 * px),
      moundY: H * 0.075,
      releaseX: W / 2 + 0.28 * zone.widthIn * px,
      releaseY: H * 0.125,
      releaseR: Math.max(3, 0.30 * px)
    };

    // 打者站位（供绘制与自检共用同一套数值，避免两处公式各写一遍）
    var sign = (batter.hand === 'left') ? +1 : -1;
    layout.batterFootX = layout.cx + sign * 1.30 * layout.zoneW;
    layout.batterTotalH = heightIn * px;
    layout.batterHalfW = layout.zoneW * 0.35;
  }

  /** 逻辑坐标（英寸，原点=好球区中心）→ 屏幕坐标（像素） */
  function inchesToScreen(xIn, yIn) {
    return {
      x: layout.cx + xIn * layout.pxPerInch,
      y: layout.zoneCenterY - yIn * layout.pxPerInch
    };
  }

  /* =====================================================================
   * 基础绘制工具
   * ================================================================== */

  function fillRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function ellipse(x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** 带浅色底的文字，保证压在任何背景上都读得清 */
  function label(text, x, y, color, align, font) {
    ctx.save();
    ctx.font = font || '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width;
    var padX = 6, h = 18;
    var bx = (ctx.textAlign === 'center') ? x - w / 2 - padX
      : (ctx.textAlign === 'right') ? x - w - padX : x - padX;
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(bx, y - h / 2, w + padX * 2, h, 5); }
    else { ctx.rect(bx, y - h / 2, w + padX * 2, h); }
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  /* =====================================================================
   * 背景：天空、看台、草皮、投手丘（明亮的日间球场）
   * ================================================================== */

  function drawBackground() {
    // 天空
    var sky = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    sky.addColorStop(0, C.colors.sky1);
    sky.addColorStop(1, C.colors.sky2);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 看台：一条浅灰带，上面点一些"观众"小点
    var standTop = H * 0.02, standBottom = H * 0.12;
    fillRect(0, standTop, W, standBottom - standTop, C.colors.stands);
    ctx.fillStyle = C.colors.standsDot;
    for (var i = 0; i < 6; i++) {
      for (var j = 0; j < 110; j++) {
        var sx = (j + 0.5) * (W / 110);
        var sy = standTop + 4 + i * ((standBottom - standTop - 8) / 6);
        ctx.fillRect(sx, sy, 2.5, 2.5);
      }
    }
    // 看台与草皮之间的一条亮线（球场围栏）
    fillRect(0, standBottom, W, 2.5, C.colors.grassEdge);

    // 外野草皮：横向条带模拟割草纹
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, standBottom + 2.5, W, H - standBottom - 2.5);
    ctx.clip();
    var stripes = 13;
    for (var s = 0; s < stripes; s++) {
      var y0 = standBottom + (H - standBottom) * (s / stripes);
      var y1 = standBottom + (H - standBottom) * ((s + 1) / stripes);
      fillRect(0, y0, W, y1 - y0 + 1, s % 2 === 0 ? C.colors.grass1 : C.colors.grass2);
    }
    ctx.restore();

    // 内野土：以本垒板为中心的一块椭圆
    ellipse(layout.cx, layout.groundY + layout.pxPerInch * 6,
      layout.zoneW * 3.0, layout.pxPerInch * 8.5, C.colors.dirt);

    // 投手丘
    ellipse(layout.cx, layout.moundY + layout.pxPerInch * 1.0,
      layout.zoneW * 1.4, layout.pxPerInch * 1.4, C.colors.mound);
  }

  /** 投手（远景剪影）；windup 为 0~1 的蓄力比例 */
  function drawPitcher(windup) {
    var x = layout.cx;
    var y = layout.moundY;
    var s = layout.pxPerInch * 0.40;
    var lean = 0.18 * s * (windup || 0);

    ctx.save();
    ctx.fillStyle = C.colors.silhouette;
    ctx.beginPath();
    ctx.ellipse(x - lean, y - s * 1.5, s * 0.62, s * 1.15, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ellipse(x - lean * 1.4, y - s * 2.85, s * 0.34, s * 0.38, C.colors.silhouette);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.35, y - s * 0.55);
    ctx.lineTo(x - s * 0.55, y + s * 0.5);
    ctx.lineTo(x - s * 0.15, y + s * 0.5);
    ctx.lineTo(x + s * 0.05, y - s * 0.55);
    ctx.closePath();
    ctx.fill();
    // 投球手（蓄力时抬高）
    ctx.beginPath();
    ctx.moveTo(x + s * 0.45, y - s * 2.1);
    ctx.lineTo(x + s * 1.5 - lean, y - s * 2.6 - s * 1.2 * (windup || 0));
    ctx.lineWidth = s * 0.32;
    ctx.strokeStyle = C.colors.silhouette;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  /** 打者（侧身剪影，从地面向上绘制，顶部被画布裁掉 —— 与主审视角一致） */
  function drawBatter() {
    var totalH = layout.batterTotalH;
    var footX = layout.batterFootX;
    var groundY = layout.groundY;
    var sign = (batter.hand === 'left') ? +1 : -1;

    ctx.save();
    ctx.fillStyle = C.colors.silhouette;

    // 腿
    ctx.beginPath();
    ctx.moveTo(footX - 0.30 * layout.zoneW, groundY);
    ctx.lineTo(footX - 0.16 * layout.zoneW, groundY - totalH * 0.48);
    ctx.lineTo(footX + 0.20 * layout.zoneW, groundY - totalH * 0.48);
    ctx.lineTo(footX + 0.34 * layout.zoneW, groundY);
    ctx.closePath();
    ctx.fill();

    // 躯干（前倾）
    ctx.beginPath();
    ctx.moveTo(footX - 0.20 * layout.zoneW, groundY - totalH * 0.44);
    ctx.lineTo(footX - 0.30 * layout.zoneW, groundY - totalH * 0.94);
    ctx.lineTo(footX + 0.16 * layout.zoneW, groundY - totalH * 0.96);
    ctx.lineTo(footX + 0.30 * layout.zoneW, groundY - totalH * 0.46);
    ctx.closePath();
    ctx.fill();

    // 双臂与球棒
    ctx.lineWidth = Math.max(4, 0.13 * layout.zoneW);
    ctx.strokeStyle = C.colors.silhouette;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(footX + 0.05 * layout.zoneW, groundY - totalH * 0.88);
    ctx.lineTo(footX + sign * 0.55 * layout.zoneW, groundY - totalH * 1.02);
    ctx.stroke();
    ctx.lineWidth = Math.max(3, 0.075 * layout.zoneW);
    ctx.beginPath();
    ctx.moveTo(footX + sign * 0.5 * layout.zoneW, groundY - totalH * 1.05);
    ctx.lineTo(footX + sign * 1.35 * layout.zoneW, groundY - totalH * 1.42);
    ctx.stroke();

    ctx.restore();
  }

  /** 捕手（画面下方的前景剪影）+ 手套 */
  function drawCatcher(mittX, mittY) {
    var px = layout.pxPerInch;
    ctx.save();
    ctx.fillStyle = C.colors.catcher;
    ctx.beginPath();
    ctx.moveTo(layout.cx - layout.zoneW * 1.05, H);
    ctx.quadraticCurveTo(layout.cx - layout.zoneW * 0.90, H - px * 5.0,
      layout.cx - layout.zoneW * 0.44, H - px * 5.4);
    ctx.quadraticCurveTo(layout.cx, H - px * 5.9, layout.cx + layout.zoneW * 0.44, H - px * 5.4);
    ctx.quadraticCurveTo(layout.cx + layout.zoneW * 0.90, H - px * 5.0,
      layout.cx + layout.zoneW * 1.05, H);
    ctx.closePath();
    ctx.fill();
    ellipse(layout.cx, H - px * 3.1, layout.zoneW * 0.32, px * 1.45, C.colors.catcher);

    // 手套
    var mr = layout.ballRadiusPx * 2.3;
    ctx.beginPath();
    ctx.ellipse(mittX, mittY, mr, mr * 0.78, -0.25, 0, Math.PI * 2);
    ctx.fillStyle = C.colors.mitt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.colors.mittLine;
    ctx.stroke();
    ellipse(mittX, mittY, mr * 0.45, mr * 0.34, 'rgba(16,24,34,0.75)');
    ctx.restore();
  }

  /** 本垒板（五边形，17 英寸宽） */
  function drawPlate() {
    var w = layout.plateW, h = layout.plateH;
    var x = layout.cx, y = layout.groundY;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h * 1.1);
    ctx.lineTo(x + w / 2, y - h * 1.1);
    ctx.lineTo(x + w / 2, y - h * 0.4);
    ctx.lineTo(x, y);
    ctx.lineTo(x - w / 2, y - h * 0.4);
    ctx.closePath();
    ctx.fillStyle = C.colors.plateFace;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.colors.plateEdge;
    ctx.stroke();
    ctx.restore();
  }

  /* =====================================================================
   * 好球区 —— 画面上**唯一**的一条线
   *
   * 规则是"球的任何一部分经过好球区的任何一部分即为好球"，所以判定依据是
   * **球本身**与这个矩形是否相交，而不是球心落在哪里。反馈阶段会把整个球画在
   * 真实位置，擦没擦到一眼就能看出来，因此不需要再画任何"球心判定线"。
   * 画面上只保留这一个矩形，避免一堆线互相干扰。
   * ================================================================== */

  function drawZone(showLabels) {
    var boxX = layout.zoneLeft, boxY = layout.zoneTop;
    var boxW = layout.zoneW, boxH = layout.zoneH;

    ctx.save();

    // 极淡的内部填充，帮助看清区域范围
    ctx.fillStyle = C.colors.zoneFill;
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // 一条干净利落的白色实线；先描一圈深色，保证压在明亮草皮上也看得清
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.colors.zoneEdge;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.colors.zoneLine;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // 标注
    if (showLabels !== false) {
      label('好球区 ' + zone.widthIn.toFixed(0) + '″ × ' + zone.heightIn.toFixed(1) + '″',
        boxX, boxY - 14, '#2c3e52', 'left', 'bold 12.5px system-ui, sans-serif');
      label((batter.hand === 'left' ? '左打者' : '右打者') + ' ' + batter.heightCm + ' cm',
        boxX + boxW, boxY - 14, '#2c3e52', 'right');
    }

    ctx.restore();
  }

  /* =====================================================================
   * 球
   * ================================================================== */

  /**
   * 画球。
   * @param {number} x,y   屏幕坐标（球心）
   * @param {number} r     半径（像素）
   * @param {number} alpha 不透明度
   * @param {Array}  trail 拖影点 [{x,y,r,a}]
   *
   * 注意：这里刻意**不**按 σ_ext 加高斯模糊 —— σ_ext 完全由"位置抖动"实现
   * （见 trial.js），这样显示的球心位置方差恰好等于 σ_ext²，数学上是干净的。
   * 球的柔边是固定渲染细节，各难度一致，带来的定位不确定度相对 σ_ext = 1.0″
   * 只有约 2% 的方差贡献，可忽略。
   */
  function drawBall(x, y, r, alpha, trail) {
    ctx.save();

    if (trail && trail.length) {
      for (var i = 0; i < trail.length; i++) {
        var t = trail[i];
        ctx.globalAlpha = (alpha == null ? 1 : alpha) * t.a;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }

    ctx.globalAlpha = (alpha == null) ? 1 : alpha;

    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.68, C.colors.ball);
    g.addColorStop(1, C.colors.ballShade);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(120,134,150,0.55)';
    ctx.stroke();

    // 红色缝线
    ctx.strokeStyle = C.colors.seam;
    ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.beginPath();
    ctx.arc(x - r * 0.42, y, r * 0.62, -1.1, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.42, y, r * 0.62, Math.PI - 1.1, Math.PI + 1.1);
    ctx.stroke();

    ctx.restore();
  }

  /* =====================================================================
   * 反馈：真实位置 + 一小段 ε + 一句"判断正确 / 误判"
   * ================================================================== */

  /**
   * 反馈：只做两件事 ——
   *   ① 把球画在它的**真实位置**（叠在好球区上，"好球还是坏球"一目了然）；
   *   ② 在球边与好球区线之间标出那一小段 ε（= 压线深度 / 空隙）。
   *
   * 刻意**不画**的东西：
   *   · 不画任何球心标记 —— 球本身就是判据，标个中心点只会让人以为要判球心；
   *   · 不画"你看到的位置"（真实位置 + 外部噪声那个点）—— 反馈只需要说清
   *     "真实发生在哪里"，再叠一层虚影只会让画面变乱。
   *
   * 结论文字也只写"判断正确 / 误判"，不再重复好球坏球：球画在正确位置之后，
   * 好球还是坏球本身就是一眼的事。
   */
  function drawFeedback(trial, called) {
    var tt = inchesToScreen(trial.xIn, trial.yIn);          // 真实球心
    var rPx = layout.ballRadiusPx;

    var boxX = layout.zoneLeft, boxY = layout.zoneTop;
    var boxW = layout.zoneW, boxH = layout.zoneH;

    // 球边（朝好球区那一侧）的落点：球心沿法线方向向区内走一个球半径
    var edgePt = { x: tt.x, y: tt.y };
    var linePt = { x: tt.x, y: tt.y };   // 好球区线上对应的点
    if (trial.edge === 'left')       { edgePt.x = tt.x + rPx; linePt.x = boxX; }
    else if (trial.edge === 'right') { edgePt.x = tt.x - rPx; linePt.x = boxX + boxW; }
    else if (trial.edge === 'top')   { edgePt.y = tt.y + rPx; linePt.y = boxY; }
    else                             { edgePt.y = tt.y - rPx; linePt.y = boxY + boxH; }

    // 判罚结果：正确 / 误判 / 超时
    var judged = (called === 'strike' || called === 'ball');
    var correct = judged && ((called === 'strike') === trial.isSignal);
    var mainColor = !judged ? C.colors.timeout
      : (correct ? C.colors.signal : C.colors.noise);

    ctx.save();

    // ---- ① 真实位置：整颗球（"擦到即好球"一眼可见）----
    drawBall(tt.x, tt.y, rPx, 0.98, null);

    // ---- ② 球边 ←→ 好球区线：这一段的长度就是 ε ----
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = mainColor;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(linePt.x, linePt.y);
    ctx.lineTo(edgePt.x, edgePt.y);
    ctx.stroke();

    var dist = Math.abs(trial.signedDistIn);
    var distTxt = trial.isSignal ? '压线 ' + dist.toFixed(2) + '″' : '差 ' + dist.toFixed(2) + '″';
    var lx = (linePt.x + edgePt.x) / 2;
    var ly = (linePt.y + edgePt.y) / 2;
    if (trial.edge === 'left' || trial.edge === 'right') {
      label(distTxt, lx + (trial.edge === 'right' ? 16 : -16), ly - 16, mainColor,
        trial.edge === 'right' ? 'left' : 'right', 'bold 12.5px system-ui, sans-serif');
    } else {
      label(distTxt, lx + 16, ly + (trial.edge === 'top' ? -12 : 14), mainColor, 'left',
        'bold 12.5px system-ui, sans-serif');
    }

    // ---- 结论：只写判断正确 / 误判 ----
    var verdict = !judged ? '限时内没有按键' : (correct ? '判断正确' : '误判');
    var mark = !judged ? '⏱' : (correct ? '✓' : '✗');
    label(mark + '  ' + verdict, layout.cx, layout.zoneTop - rPx - 40,
      mainColor, 'center', 'bold 21px system-ui, -apple-system, "Microsoft YaHei", sans-serif');

    ctx.restore();
  }

  /* =====================================================================
   * 主绘制入口
   * ================================================================== */

  /**
   * @param {object} state
   *   state.phase            'idle'|'ready'|'flight'|'response'|'confidence'|'feedback'|'roundEnd'
   *   state.flightProgress   0~1
   *   state.trial            当前试次对象（真实位置 + 显示位置，后者只用于投球动画）
   *   state.called           'strike'|'ball'|'timeout'|null
   *   state.showZone         是否绘制好球区
   *   state.dim              整体压暗程度 0~1
   *   state.hint             画布上的中央提示文字（未开始时用）
   */
  function draw(state) {
    if (!ctx) return;
    state = state || {};
    var trial = state.trial;
    var phase = state.phase || 'idle';
    var rPx = layout.ballRadiusPx;

    ctx.clearRect(0, 0, W, H);
    drawBackground();

    var windup = (phase === 'ready') ? Math.min(1, state.flightProgress || 0) : 0;
    drawPitcher(windup);
    drawBatter();
    drawPlate();

    // ---- 球与手套 ----
    var ballVisible = false;
    var ballX = 0, ballY = 0, ballR = rPx;
    var trail = [];

    if (phase === 'flight' && trial) {
      var p = Math.max(0, Math.min(1, state.flightProgress || 0));
      var end = inchesToScreen(trial.dispXIn, trial.dispYIn);

      // 深度：出手点远、本垒板近；屏幕位置按 1/z 透视插值。
      // （3D 直线投影后仍是直线，但这样的速度感更接近真实。）
      var zFar = 4.6, zNear = 1.0;
      var worldX0 = (layout.releaseX - layout.cx) * zFar;
      var worldY0 = (layout.releaseY - layout.zoneCenterY) * zFar;
      var worldX1 = (end.x - layout.cx) * zNear;
      var worldY1 = (end.y - layout.zoneCenterY) * zNear;

      // 变速球的横向"尾劲"：让路径略带弧度，避免被试靠早期轨迹完美外推落点
      var breakSeed = Math.sin((trial.index + 1) * 12.9898) * 43758.5453;
      var breakAmt = ((breakSeed - Math.floor(breakSeed)) - 0.5) * layout.pxPerInch * 1.4;

      var z = zFar + (zNear - zFar) * p;
      var wx = worldX0 + (worldX1 - worldX0) * p + breakAmt * zNear * Math.sin(Math.PI * p) * 0.8;
      var wy = worldY0 + (worldY1 - worldY0) * p;
      ballX = layout.cx + wx / z;
      ballY = layout.zoneCenterY + wy / z;
      ballR = layout.releaseR + (rPx - layout.releaseR) * p * p;
      ballVisible = true;

      for (var k = 1; k <= 5; k++) {
        var pp = Math.max(0, p - k * 0.045);
        var zz = zFar + (zNear - zFar) * pp;
        var wxx = worldX0 + (worldX1 - worldX0) * pp +
          breakAmt * zNear * Math.sin(Math.PI * pp) * 0.8;
        var wyy = worldY0 + (worldY1 - worldY0) * pp;
        trail.push({
          x: layout.cx + wxx / zz,
          y: layout.zoneCenterY + wyy / zz,
          r: (layout.releaseR + (rPx - layout.releaseR) * pp * pp) * 0.82,
          a: 0.28 * (1 - k / 6)
        });
      }

    } else if (phase === 'feedback' && trial) {
      ballVisible = false;   // 反馈里单独用 drawBall 画真实的球

    } else if (phase === 'response' || phase === 'confidence') {
      // 判定窗口：球已入套，不绘制（不给"定格回放"的机会）
      ballVisible = false;
    }

    // 手套位置：
    //   · 反馈阶段 → 停在捕获点下方，与标记一致，便于对照
    //   · 其它阶段 → 停在好球区中心，模拟捕手的 framing（同时避免泄漏落点）
    var mitt;
    if (phase === 'feedback' && trial) {
      mitt = inchesToScreen(trial.xIn, trial.yIn);
      mitt.y += rPx * 1.6;
    } else {
      mitt = { x: layout.cx, y: layout.zoneCenterY + rPx * 1.5 };
    }
    drawCatcher(mitt.x, mitt.y);

    if (ballVisible) drawBall(ballX, ballY, ballR, 1, trail.length ? trail : null);

    // ---- 好球区（画面上唯一的线）----
    if (state.showZone !== false) drawZone(true);

    // ---- 反馈标注 ----
    if (phase === 'feedback' && trial) drawFeedback(trial, state.called);

    // ---- 中央提示 ----
    if (state.hint) {
      label(state.hint, W / 2, layout.zoneTop - rPx - 40, '#1f2d3d', 'center',
        'bold 15px system-ui, sans-serif');
    }

    // ---- 整体压暗 ----
    if (state.dim) {
      ctx.fillStyle = 'rgba(240,246,252,' + state.dim + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  SDT.Scene = {
    init: init,
    resize: resize,
    setZone: setZone,
    computeLayout: computeLayout,
    inchesToScreen: inchesToScreen,
    draw: draw,
    getLayout: function () { return layout; },
    getSize: function () { return { W: W, H: H }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
