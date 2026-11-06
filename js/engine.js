/* ============================================================
   engine.js — 试次引擎：注视点 → 刺激 → 反应 → 空屏
   计时用 performance.now()；刺激在 requestAnimationFrame 回调里绘制，
   并在同一帧记下 onset，避免把绘制延迟算进反应时。

   实验模块需要提供 adapter：
     show(trial, host)      → 绘制刺激，返回 onset（ms）
     respond(trial, onset)  → Promise<{rt, key, correct, aborted}>
     clear(host)            → 清屏
     feedback(host, ok, trial) → 练习时的反馈（可选）
   ============================================================ */

window.Engine = (function () {

  const now = () => performance.now();
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));

  function fixation(host) {
    host.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'fixation';
    host.appendChild(d);
  }

  function blank(host) { host.innerHTML = ''; }

  /** 统一按键监听：忽略长按重复，阻止空格/方向键滚动页面 */
  function onKeys(handler) {
    function fn(e) {
      if (e.repeat) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(k) >= 0) e.preventDefault();
      handler(k, e);
    }
    window.addEventListener('keydown', fn, { passive: false });
    return function off() { window.removeEventListener('keydown', fn); };
  }

  /**
   * 跑一个区组
   * opts = { host, trials, adapter, deadline, fixation, blank, practice,
   *          onTrial, onProgress, shouldStop, shouldPause, waitResume }
   */
  async function runBlock(opts) {
    const host = opts.host;
    const adapter = opts.adapter;
    const trials = opts.trials || [];
    const fixationMs = opts.fixation === undefined ? 500 : opts.fixation;
    const blankMs = opts.blank === undefined ? 500 : opts.blank;
    const jitterMs = opts.jitter || 0;

    for (let i = 0; i < trials.length; i++) {
      if (opts.shouldStop && opts.shouldStop()) return { stopped: true, done: i };
      if (opts.shouldPause && opts.shouldPause()) {
        await (opts.waitResume ? opts.waitResume() : sleep(100));
        if (opts.shouldStop && opts.shouldStop()) return { stopped: true, done: i };
      }

      const trial = trials[i];

      blank(host);
      fixation(host);
      await sleep(fixationMs);
      if (opts.shouldStop && opts.shouldStop()) return { stopped: true, done: i };

      const onset = await adapter.show(trial, host);
      const res = await adapter.respond(trial, onset);

      adapter.clear(host);

      if (res && res.aborted) {
        return { stopped: true, done: i };
      }

      const record = Object.assign({}, trial, res, { trial_index: i + 1 });
      if (opts.practice && adapter.feedback) {
        adapter.feedback(host, res.correct, trial);
        await sleep(650);
        adapter.clear(host);
      }

      if (opts.onTrial) opts.onTrial(record);
      if (opts.onProgress) opts.onProgress(i + 1, trials.length);

      await sleep(blankMs + (jitterMs ? Math.random() * jitterMs : 0));
    }
    return { stopped: false, done: trials.length };
  }

  /**
   * 等一个按键（或超时）
   * opts = {onset, keys, deadline, extra}
   * 返回 { promise, cancel }；promise 解析为 {key, rt, timedOut} 或 {aborted:true}
   */
  function waitKey(opts) {
    const onset = opts.onset;
    const keys = opts.keys;
    const deadline = opts.deadline;
    const extra = opts.extra || {};
    let cancel = function () {};

    const promise = new Promise(resolve => {
      let done = false;
      let timer = null;

      const off = onKeys(function (k) {
        if (done) return;
        if (keys && keys.indexOf(k) < 0) return;
        done = true;
        cleanup();
        resolve(Object.assign({ key: k, rt: now() - onset, timedOut: false }, extra));
      });

      function cleanup() {
        off();
        if (timer) clearTimeout(timer);
      }

      cancel = function () {
        if (done) return;
        done = true;
        cleanup();
        resolve({ key: null, rt: null, aborted: true });
      };

      if (deadline) {
        timer = setTimeout(function () {
          if (done) return;
          done = true;
          cleanup();
          resolve({ key: null, rt: null, timedOut: true });
        }, deadline);
      }
    });

    return { promise: promise, cancel: function () { cancel(); } };
  }

  return { now, sleep, nextFrame, fixation, blank, onKeys, runBlock, waitKey };
})();
