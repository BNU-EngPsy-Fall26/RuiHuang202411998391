/* =============================================================================
 * export.js —— 数据导出（CSV / JSON）
 *
 * 依赖：config.js
 *
 * 全部使用 Blob + URL.createObjectURL + <a download>，在 file:// 下同样可用，
 * 不依赖任何后端。CSV 前面加 UTF-8 BOM，保证 Excel 打开中文不乱码。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var C = SDT.CONFIG;

  /** 单元格转义：含逗号/引号/换行时用双引号包裹 */
  function cell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** 二维数组 → CSV 文本 */
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(cell).join(',');
    }).join('\r\n');
  }

  /** 触发下载 */
  function download(filename, text, mime) {
    var blob = new Blob(['\ufeff' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 立刻 revoke 在部分浏览器上会打断下载，延后释放
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  /** 时间戳字符串，用于文件名 */
  function stamp(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function outcomeLabel(o) {
    var t = C.outcomeText[o];
    return t ? t.name : (o || '');
  }

  function styleLabel(id) { return C.getStyle(id).label; }

  function axisLabel(a) {
    return a === 'vertical' ? '垂直（高低）' : a === 'horizontal' ? '水平（内外）' : a;
  }
  function edgeLabel(e) {
    return { left: '内角侧', right: '外角侧', top: '上缘', bottom: '下缘' }[e] || e;
  }

  /* =====================================================================
   * 试次级 CSV
   * ================================================================== */
  function buildTrialCSV(entry) {
    var cfg = entry.condition;
    var m = entry.metrics;
    var rows = [];

    // 文件头注释（用   前缀，便于人读；Excel 里会显示为一列）
    rows.push(['# 棒球主审 SDT 实验 · 试次级数据']);
    rows.push(['# 导出时间', new Date().toLocaleString('zh-CN')]);
    rows.push(['# 场景', '信号=好球（球心在好球区内），噪声=坏球（球心在好球区外）']);
    rows.push(['# 好球区', cfg.batterHeightCm + 'cm 打者 → 宽 ' + C.zone.plateWidthIn +
      '″ × 高 ' + cfg.zoneHeightIn.toFixed(2) + '″（球心判定）']);
    rows.push(['# 条件', 'ε=' + cfg.epsilonIn + '″, P(S)=' + cfg.pSignal +
      ', 执法风格=' + styleLabel(cfg.styleId) + ', 打者=' + cfg.batterHeightCm + 'cm' +
      ', 判定窗口=' + cfg.responseWindowMs + 'ms, ROC模式=' + cfg.rocMode +
      ', 随机种子=' + cfg.seed + (cfg.reusedStimuli ? '(复用上一局刺激)' : '')]);
    rows.push(['# 外部噪声', 'σ_ext = ' + cfg.sigmaExtIn + '″（显示端位置抖动，被试无法归因）']);
    rows.push(['# 修正方法', m.correctionMethod + (m.correctionApplied ? '（本局已触发修正）' : '（本局未触发修正）')]);
    rows.push(['# 超时策略', C.trial.timeoutPolicy === 'exclude' ? 'exclude（超时剔除，不进入 SDT 计算）' : 'asNo（超时按判坏球计入）']);
    rows.push([]);

    rows.push([
      '局次', '试次序号', '练习试次', '真实状态', '参照边界', '边界方向',
      '基准ε(″)', '实际ε(″)', '好球区高(″)',
      '真实球心x(″)', '真实球心y(″)', '显示球心x(″)', '显示球心y(″)',
      '外部噪声x(″)', '外部噪声y(″)', '噪声位移量(″)', '显示位置看起来是否界内',
      '你的判罚', '结果类型', '是否正确', '反应时(ms)', '信心评级'
    ]);

    for (var i = 0; i < entry.trials.length; i++) {
      var t = entry.trials[i];
      var r = entry.records[i] || {};
      var isPractice = i < entry.practiceCount;
      var noiseR = Math.sqrt(t.noiseXIn * t.noiseXIn + t.noiseYIn * t.noiseYIn);
      var correct = (r.outcome === 'H' || r.outcome === 'CR') ? '正确'
        : (r.outcome === 'M' || r.outcome === 'FA') ? '错误'
        : (r.outcome === 'timeout') ? '未响应' : '';

      rows.push([
        entry.roundIndex,
        i + 1,
        isPractice ? '是' : '否',
        t.isSignal ? '好球(Signal)' : '坏球(Noise)',
        edgeLabel(t.edge),
        axisLabel(t.axis),
        cfg.epsilonIn,
        t.epsilonIn.toFixed(4),
        t.zoneHeightIn.toFixed(3),
        t.xIn.toFixed(4), t.yIn.toFixed(4),
        t.dispXIn.toFixed(4), t.dispYIn.toFixed(4),
        t.noiseXIn.toFixed(4), t.noiseYIn.toFixed(4),
        noiseR.toFixed(4),
        t.displayLooksInside ? '是' : '否',
        r.response === 'strike' ? '判好球' : r.response === 'ball' ? '判坏球' : '未响应',
        outcomeLabel(r.outcome),
        correct,
        (r.rtMs != null) ? Math.round(r.rtMs) : '',
        (r.rating != null) ? r.rating : ''
      ]);
    }

    return { text: toCSV(rows), name: 'SDT_棒球主审_试次级_第' + entry.roundIndex + '局_' + stamp() + '.csv' };
  }

  /* =====================================================================
   * 汇总级 CSV（整个会话的所有局）
   * ================================================================== */
  function buildSummaryCSV(history) {
    var rows = [];
    rows.push(['# 棒球主审 SDT 实验 · 汇总级数据']);
    rows.push(['# 导出时间', new Date().toLocaleString('zh-CN')]);
    rows.push(['# 指标公式', 'd′ = z(P(Hit)) − z(P(FA))；c = −½[z(P(Hit)) + z(P(FA))]（c>0 保守）；β = exp(d′·c)']);
    rows.push(['# 说明', '超时试次策略：' + C.trial.timeoutPolicy]);
    rows.push([]);

    rows.push([
      '局次', '完成时间', '难度', '基准ε(″)', '实际平均ε(″)', 'P(S)实际值',
      '执法风格', '打者身高(cm)', '好球区高(″)', '每局试次数', '有效试次',
      'H', 'M', 'FA', 'CR', '超时',
      'P(Hit)', 'P(FA)', 'd′', 'c', 'β', '正确率', '超时率',
      'd′理论上限', 'σ_total(″)', 'σ_int(″)', '修正方法', 'ROC模式',
      'd′_垂直边界', 'd′_水平边界'
    ]);

    history.rounds.forEach(function (e) {
      var m = e.metrics;
      var gv = e.groups['axis:vertical'], gh = e.groups['axis:horizontal'];
      var mv = gv ? SDT.math.computeMetrics(gv, { correction: e.condition.correction, epsilonIn: m.epsilonIn, sigmaExtIn: m.sigmaExtIn }) : null;
      var mh = gh ? SDT.math.computeMetrics(gh, { correction: e.condition.correction, epsilonIn: m.epsilonIn, sigmaExtIn: m.sigmaExtIn }) : null;
      var epsAvg = 0, cnt = 0;
      for (var i = e.practiceCount; i < e.trials.length; i++) { epsAvg += e.trials[i].epsilonIn; cnt++; }
      epsAvg = cnt ? epsAvg / cnt : NaN;
      var pSActual = (m.nSignal + m.nNoise) ? m.nSignal / (m.nSignal + m.nNoise) : NaN;

      rows.push([
        e.roundIndex,
        e.finishedAt.toLocaleString('zh-CN'),
        'L' + e.condition.levelId,
        e.condition.epsilonIn,
        isFinite(epsAvg) ? epsAvg.toFixed(4) : '',
        isFinite(pSActual) ? pSActual.toFixed(4) : '',
        styleLabel(e.condition.styleId),
        e.condition.batterHeightCm,
        e.condition.zoneHeightIn.toFixed(3),
        e.condition.nTrials,
        m.nValid,
        m.H, m.M, m.FA, m.CR, m.timeout,
        isFinite(m.pHit) ? m.pHit.toFixed(4) : '',
        isFinite(m.pFA) ? m.pFA.toFixed(4) : '',
        isFinite(m.dprime) ? m.dprime.toFixed(4) : '',
        isFinite(m.c) ? m.c.toFixed(4) : '',
        isFinite(m.beta) ? m.beta.toFixed(4) : '',
        isFinite(m.accuracy) ? m.accuracy.toFixed(4) : '',
        m.timeoutRate.toFixed(4),
        isFinite(m.theoreticalDprime) ? m.theoreticalDprime.toFixed(4) : '',
        isFinite(m.sigmaTotal) ? m.sigmaTotal.toFixed(4) : '',
        isFinite(m.sigmaInternal) ? m.sigmaInternal.toFixed(4) : '',
        m.correctionMethod,
        e.condition.rocMode,
        (mv && isFinite(mv.dprime)) ? mv.dprime.toFixed(4) : '',
        (mh && isFinite(mh.dprime)) ? mh.dprime.toFixed(4) : ''
      ]);
    });

    // ---- 附：d′–ε 过原点回归 ----
    var pts = history.rounds.map(function (e) {
      return { epsilonIn: e.metrics.epsilonIn, dprime: e.metrics.dprime };
    });
    var fit = SDT.math.fitEpsilonSlope(pts, C.externalNoiseIn);
    rows.push([]);
    rows.push(['# d′–ε 过原点回归（SDT 预测 d′ = 2ε/σ）']);
    if (fit.ok) {
      rows.push(['# 数据点个数', fit.n]);
      rows.push(['# 斜率', fit.slope.toFixed(5), '= 2/σ_total']);
      rows.push(['# σ_total (″)', fit.sigmaTotal.toFixed(5)]);
      rows.push(['# σ_ext   (″)', fit.sigmaExtIn.toFixed(5), '（已知的外部显示噪声）']);
      rows.push(['# σ_int   (″)', fit.sigmaInternal.toFixed(5), '（被试自身知觉噪声）']);
      rows.push(['# R²', isFinite(fit.r2) ? fit.r2.toFixed(5) : '']);
    } else {
      rows.push(['# 未能拟合', fit.reason || '']);
    }

    return { text: toCSV(rows), name: 'SDT_棒球主审_汇总级_' + stamp() + '.csv' };
  }

  /** JSON 全量导出（含逐试次明细，便于自己用别的工具分析） */
  function buildJSON(history) {
    var payload = {
      exportedAt: new Date().toISOString(),
      scene: {
        signal: '好球（球心在好球区内）',
        noise: '坏球（球心在好球区外）',
        zoneWidthIn: C.zone.plateWidthIn,
        zoneHeightRule: 'zoneHeightIn = ' + C.zone.zoneHeightPerCm + ' × 身高(cm)',
        edgeInsetIn: C.zone.edgeInsetIn,
        externalNoiseIn: C.externalNoiseIn,
        timeoutPolicy: C.trial.timeoutPolicy
      },
      rounds: history.rounds.map(function (e) {
        return {
          roundIndex: e.roundIndex,
          finishedAt: e.finishedAt.toISOString(),
          condition: e.condition,
          counts: e.counts,
          metrics: e.metrics,
          rocPoints: e.rocPoints,
          trials: e.trials,
          records: e.records,
          practiceCount: e.practiceCount
        };
      })
    };
    return { text: JSON.stringify(payload, null, 2), name: 'SDT_棒球主审_全量_' + stamp() + '.json' };
  }

  SDT.Export = {
    toCSV: toCSV,
    download: download,
    buildTrialCSV: buildTrialCSV,
    buildSummaryCSV: buildSummaryCSV,
    buildJSON: buildJSON,
    stamp: stamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
