/* =============================================================================
 * stats.js —— 2×2 计数、分组统计、会话历史
 *
 * 依赖：config.js、sdt.js
 *
 * 计数定义（本场景）：
 *   H  命中   Hit   真好球 & 判好球
 *   M  漏报   Miss  真好球 & 判坏球
 *   FA 虚报   FA    真坏球 & 判好球   ← 误判好球，代价最大
 *   CR 正确拒绝 CR  真坏球 & 判坏球
 *   timeout    判定窗口内未按键（单独记录，默认不进入 SDT 计算）
 * ========================================================================== */
(function (global) {
  'use strict';

  var SDT = global.SDT = global.SDT || {};
  var CONFIG = SDT.CONFIG;

  /** 空计数表 */
  function emptyCounts() {
    return { H: 0, M: 0, FA: 0, CR: 0, timeout: 0, n: 0 };
  }

  /**
   * 把一个试次的结果计入计数表
   * @param {object} counts
   * @param {object} trial
   * @param {string} response 'strike' | 'ball' | 'timeout'
   * @param {string} timeoutPolicy 'exclude' | 'asNo'
   * @returns {string} 结果类型 'H'|'M'|'FA'|'CR'|'timeout'
   */
  function tally(counts, trial, response, timeoutPolicy) {
    timeoutPolicy = timeoutPolicy || CONFIG.trial.timeoutPolicy;

    var eff = response;
    if (response === 'timeout') {
      counts.timeout++;
      counts.n++;
      if (timeoutPolicy !== 'asNo') {
        // 默认策略：超时试次剔出 SDT 计算
        return 'timeout';
      }
      // 备选策略：把超时当作"判坏球"再进行归类
      eff = 'ball';
    }

    var outcome;
    if (trial.isSignal) {
      outcome = (eff === 'strike') ? 'H' : 'M';
    } else {
      outcome = (eff === 'strike') ? 'FA' : 'CR';
    }
    counts[outcome]++;
    if (response !== 'timeout') counts.n++;
    return outcome;
  }

  /** 合并两个计数表 */
  function mergeCounts(a, b) {
    var out = emptyCounts();
    ['H', 'M', 'FA', 'CR', 'timeout', 'n'].forEach(function (k) {
      out[k] = (a[k] || 0) + (b[k] || 0);
    });
    return out;
  }

  /**
   * 按某个键对试次分组统计
   * @param {Array} trials
   * @param {Array} records 与 trials 一一对应的 {response, rating, rtMs, outcome}
   * @param {function} keyFn (trial, record) => string | null（返回 null 表示跳过）
   * @param {string} timeoutPolicy
   * @returns {Object} { key: counts }
   */
  function groupCounts(trials, records, keyFn, timeoutPolicy) {
    var groups = {};
    for (var i = 0; i < trials.length; i++) {
      var key = keyFn(trials[i], records[i]);
      if (key == null) continue;
      if (!groups[key]) groups[key] = emptyCounts();
      tally(groups[key], trials[i], records[i].response, timeoutPolicy);
    }
    return groups;
  }

  /**
   * 由信心评级生成 ROC 点（rating method，ROC 模式 A）
   *
   * 4 级评级：1 肯定坏球 / 2 像坏球 / 3 像好球 / 4 肯定好球
   * 取三个累计切点（仅 4；≥3；≥2），每个切点得到一个 (P(FA), P(Hit))。
   * 每个切点都独立做对数线性修正，否则极端点会炸掉。
   *
   * @param {Array} trials
   * @param {Array} records 需含 rating 字段
   * @param {string} correction
   * @returns {Array<{cut:number,label:string,metrics:object,point:{pfa:number,phit:number}}>}
   */
  function rocFromRatings(trials, records, correction) {
    var out = [];
    var cuts = CONFIG.rocCutsFromRatings;
    for (var c = 0; c < cuts.length; c++) {
      var cut = cuts[c].cut;
      var counts = emptyCounts();
      for (var i = 0; i < trials.length; i++) {
        var r = records[i];
        if (r.response === 'timeout') { counts.timeout++; continue; }
        var rating = r.rating || CONFIG.confidenceStrikeThreshold;
        var resp = (rating >= cut) ? 'strike' : 'ball';
        tally(counts, trials[i], resp, 'exclude');
      }
      var m = SDT.math.computeMetrics(counts, { correction: correction });
      out.push({
        cut: cut,
        label: cuts[c].label,
        metrics: m,
        point: { pfa: m.pFA, phit: m.pHit }
      });
    }
    return out;
  }

  /**
   * 会话历史：保存每一局的成绩，用于多局对比、ROC 模式 B、d′–ε 回归
   */
  function History() {
    this.rounds = [];
  }

  History.prototype.add = function (entry) {
    entry.roundIndex = this.rounds.length + 1;
    this.rounds.push(entry);
    return entry;
  };

  History.prototype.clear = function () {
    this.rounds = [];
  };

  /**
   * 取出"条件一致"的局（执法风格、P(S)、打者身高都相同）——
   * 只有这些局之间的差异才能归因于 ε。
   * @param {object} cond {styleId, pSignal, batterHeightCm}
   */
  History.prototype.sameCondition = function (cond) {
    return this.rounds.filter(function (r) {
      var c = r.condition;
      if (c.styleId !== cond.styleId) return false;
      if (c.pSignal !== cond.pSignal) return false;
      if (c.batterHeightCm !== cond.batterHeightCm) return false;
      return true;
    });
  };

  /** 按 ρ(S)/执法风格/身高筛出用于 d′–ε 回归的点 */
  History.prototype.regressionPoints = function (cond) {
    return this.sameCondition(cond).map(function (r) {
      return { epsilonIn: r.metrics.epsilonIn, dprime: r.metrics.dprime, roundIndex: r.roundIndex };
    });
  };

  /**
   * 收集可用于 ROC 模式 B 的经验点（同一难度、**同一批刺激**、不同判断标准）。
   *
   * 关键点：不能只按 ε 筛选。同一难度下不同局若使用了不同的随机种子，
   * 刺激序列（球的位置、噪声）就不同，把这些点连成 ROC 会把抽样波动
   * 误当作判断标准的效应。因此这里按 **随机种子** 分组，取局数最多的那一组 ——
   * 也就是在同一批刺激上跑过的多个判断标准，这才是干净的标准操纵。
   *
   * @param {number} epsilonIn
   * @returns {Array<{styleId,styleLabel,pfa,phit,dprime,c,seed}>}
   */
  History.prototype.rocPointsByStimulusSet = function (epsilonIn) {
    var groups = {};
    this.rounds.forEach(function (r) {
      if (Math.abs(r.metrics.epsilonIn - epsilonIn) > 1e-6) return;
      if (!isFinite(r.metrics.pFA) || !isFinite(r.metrics.pHit)) return;
      var key = String(r.condition.seed);
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        styleId: r.condition.styleId,
        styleLabel: CONFIG.getStyle(r.condition.styleId).label,
        pfa: r.metrics.pFA,
        phit: r.metrics.pHit,
        dprime: r.metrics.dprime,
        c: r.metrics.c,
        seed: r.condition.seed
      });
    });

    var best = [];
    Object.keys(groups).forEach(function (k) {
      if (groups[k].length > best.length) best = groups[k];
    });
    return best;
  };

  /** 兼容旧名（按难度收集，内部已改为按刺激集分组） */
  History.prototype.rocPointsByLevel = function (epsilonIn) {
    return this.rocPointsByStimulusSet(epsilonIn);
  };

  /** 本会话用过的所有 ε 值（去重、升序） */
  History.prototype.usedEpsilons = function () {
    var seen = {}, out = [];
    this.rounds.forEach(function (r) {
      var e = r.metrics.epsilonIn;
      if (!seen[e]) { seen[e] = 1; out.push(e); }
    });
    return out.sort(function (a, b) { return a - b; });
  };

  SDT.Stats = {
    emptyCounts: emptyCounts,
    tally: tally,
    mergeCounts: mergeCounts,
    groupCounts: groupCounts,
    rocFromRatings: rocFromRatings,
    History: History
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDT.Stats;
  }
})(typeof window !== 'undefined' ? window : globalThis);
