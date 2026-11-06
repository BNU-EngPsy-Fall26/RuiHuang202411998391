/* ============================================================
   upload.js — 与注意实验室收数接口通讯
   POST /api/hw2/submit  （每个实验结束一次）
   GET  /api/hw2/data?project=…  （结果页读全体匿名数据）
   ============================================================ */

window.Upload = (function () {

  function endpoint(path) { return window.CONFIG.apiBase + path; }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function parse(json) {
    if (json && typeof json === 'object' && !Array.isArray(json)) return json;
    return { data: json };
  }

  /**
   * 提交一个实验的全部试次
   * 返回 { ok, participants, warnings, record_id, error }
   */
  async function submit(payload) {
    const body = {
      project: window.CONFIG.project,
      experiment: payload.experiment,
      participant: payload.participant,
      condition: payload.condition || '',
      trials: payload.trials
    };

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await withTimeout(fetch(endpoint('/api/hw2/submit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }), 20000);

        const json = parse(await res.json());
        if (json.ok) {
          return {
            ok: true,
            participants: json.participants,
            warnings: json.warnings || null,
            warningDetails: json.warning_details || null,
            recordId: json.record_id
          };
        }
        // 后台明确拒绝（项目码错误等），重试无意义
        return { ok: false, error: json.msg || json.error || ('HTTP ' + res.status) };
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000));
      }
    }
    return { ok: false, error: (lastErr && lastErr.message) || 'network' };
  }

  function trialArray(rec) {
    const raw = rec.trials || rec.trial || rec.data || rec.rows;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }
    return [];
  }

  /** 把接口返回的各种形状统一成 [{participant, experiment, trial}] */
  function flatten(json) {
    const out = [];
    let records = [];
    if (Array.isArray(json)) records = json;
    else if (json && Array.isArray(json.records)) records = json.records;
    else if (json && Array.isArray(json.data)) records = json.data;
    else if (json && Array.isArray(json.results)) records = json.results;
    else if (json && json.data && Array.isArray(json.data.records)) records = json.data.records;

    records.forEach(rec => {
      const participant = rec.participant || rec.pid || rec.subject || '—';
      const experiment = rec.experiment || rec.exp || '';
      const trials = trialArray(rec);
      trials.forEach(t => {
        if (t && typeof t === 'object') {
          out.push({
            participant: String(participant),
            experiment: String(experiment),
            trial: t
          });
        }
      });
    });
    return out;
  }

  /** 读全体匿名数据（失败时返回 error，由调用方降级） */
  async function fetchAll() {
    try {
      const res = await withTimeout(fetch(
        endpoint('/api/hw2/data?project=' + encodeURIComponent(window.CONFIG.project))
      ), 15000);
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const json = parse(await res.json());
      const rows = flatten(json);
      return { ok: true, rows: rows, raw: json, participants: json.participants };
    } catch (e) {
      return { ok: false, error: e.message || 'network' };
    }
  }

  /* ---------- 本地备份 ---------- */

  function backupJSON(session) {
    const name = 'attnlab_backup_' + session.pid + '_' + U.timestamp() + '.json';
    U.download(name, JSON.stringify(session, null, 2), 'application/json');
    return name;
  }

  function backupCSV(experiment, trials, pid) {
    if (!trials || !trials.length) return null;
    const keys = Object.keys(trials[0]);
    const headers = ['participant', 'experiment'].concat(keys);
    const rows = trials.map(t => [pid, experiment].concat(keys.map(k => t[k])));
    const name = 'attnlab_' + experiment + '_' + pid + '_' + U.timestamp() + '.csv';
    U.download(name, U.toCSV(headers, rows), 'text/csv;charset=utf-8');
    return name;
  }

  return { submit, fetchAll, flatten, backupJSON, backupCSV };
})();
