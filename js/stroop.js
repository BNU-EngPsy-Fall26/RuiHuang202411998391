/* ============================================================
   stroop.js — 实验一：Stroop 颜色命名（整合 vs 分离）

   顺序效应的处理（两类）：
   1) 区组顺序：整合先 / 分离先，按被试编号哈希平衡，并记在 block_order 里；
   2) 按键顺序：D/K 是中指、F/J 是食指；同一只手连按与换手的转换成本不同。
      - 键位映射按被试编号在 A / B 两套镜像映射之间平衡，
        让"食指省力 / 中指费力"不固定绑在某几个颜色上；
      - 每个区组内"同手 / 换手"的过渡次数被约束在 18–21 次（共 39 次过渡），
        并逐试次记录 prev_key / hand / hand_switch，分析时可作协变量或分层检查。
   ============================================================ */

window.Stroop = (function () {

  const C = () => window.CONFIG.stroop;
  const COLORS = () => window.CONFIG.stroop.colors;

  const meta = {
    id: 'stroop_sep',
    no: '01',
    title: 'Stroop 颜色命名',
    en: 'Colour Naming',
    tag: '复现 + 改进',
    desc: '判断字呈现的颜色，忽略字本身的意思。一半区组里颜色直接涂在字上，另一半里颜色被移到字上方的独立色块中。',
    minutes: 6,
    trials: 80
  };

  /* ---------- 键位映射 ---------- */

  function mappingFor(pid) {
    const maps = C().keyMaps;
    const idx = U.hash((pid || 'x') + '|keymap') % maps.length;
    return maps[idx];
  }

  function colorByKey(map) {
    const out = {};
    Object.keys(map.keys).forEach(function (name) { out[map.keys[name]] = name; });
    return out;
  }

  function handOf(key) { return (key === 'd' || key === 'f') ? 'L' : 'R'; }
  function fingerOf(key) { return (key === 'f' || key === 'j') ? 'index' : 'middle'; }

  /** 按物理键顺序生成提示文本，例如 D 红 · F 黄 · J 蓝 · K 绿 */
  function legend(map) {
    const byKey = colorByKey(map);
    return ['d', 'f', 'j', 'k'].map(k =>
      k.toUpperCase() + ' ' + byKey[k]
    ).join(' · ');
  }

  /* ---------- 顺序生成 ---------- */

  /**
   * 40 个试次的"手"序列：左右各 20 次，同手/换手过渡尽量各半。
   * 目标：39 次过渡中，换手 18–21 次（随机排列的期望约 20 次）。
   */
  function handSequence() {
    const n = C().perBlock;
    const base = [];
    for (let i = 0; i < n / 2; i++) base.push('L');
    for (let i = 0; i < n / 2; i++) base.push('R');
    const range = C().switchRange || [18, 21];

    for (let attempt = 0; attempt < 800; attempt++) {
      const s = U.shuffle(base);
      let sw = 0;
      for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) sw++;
      if (sw >= range[0] && sw <= range[1]) return s;
    }
    return U.shuffle(base);
  }

  /** 在每段同手序列内部交替使用两个键：D/F 或 J/K，各 10 次，且不连续重复 */
  function keySequence(hands) {
    const pair = { L: ['d', 'f'], R: ['j', 'k'] };
    const count = { L: 0, R: 0 };
    return hands.map(function (h) {
      const k = pair[h][count[h] % 2];
      count[h]++;
      return k;
    });
  }

  function buildBlock(display, orderTag, map) {
    const colors = COLORS();
    const byKey = colorByKey(map);
    const hands = handSequence();
    const keys = keySequence(hands);

    // 每个颜色 5 次一致、5 次不一致，顺序随机
    const flags = {};
    colors.forEach(c => { flags[c.name] = U.shuffle([1, 1, 1, 1, 1, 0, 0, 0, 0, 0]); });
    const seen = {};
    const wordCursor = {};

    const trials = [];
    let prevKey = null;

    keys.forEach(function (key, i) {
      const ink = byKey[key];
      const inkHex = colors.filter(c => c.name === ink)[0].hex;

      if (!seen[ink]) seen[ink] = 0;
      const congruent = flags[ink].pop() === 1;
      let word = ink;

      if (!congruent) {
        const others = colors.filter(c => c.name !== ink).map(c => c.name);
        const cur = wordCursor[ink] || 0;
        word = others[cur % others.length];
        wordCursor[ink] = cur + 1;
      }

      const hand = handOf(key);
      trials.push({
        cond: (display === 'integrated' ? 'int' : 'sep') + '_' + (congruent ? 'cong' : 'incong'),
        congruency: congruent ? 'congruent' : 'incongruent',
        display: display,
        block: orderTag.block,
        block_order: orderTag.order,
        word: word,
        ink: ink,
        ink_hex: inkHex,
        respKey: key,
        correct_key: key,
        map: map.id,
        hand: hand,
        finger: fingerOf(key),
        hand_switch: prevKey === null ? 0 : (handOf(prevKey) === hand ? 0 : 1),
        prev_key: prevKey || '',
        pos: i + 1
      });
      prevKey = key;
      seen[ink]++;
    });

    return trials;
  }

  function practice(pid) {
    const map = mappingFor(pid);
    const byKey = colorByKey(map);
    const colors = COLORS();
    const keys = ['d', 'f', 'j', 'k'];
    const list = [];

    for (let i = 0; i < C().practiceN; i++) {
      const display = i % 2 === 0 ? 'integrated' : 'separated';
      const congruent = i % 4 < 2;
      const key = keys[U.randint(0, 3)];
      const ink = byKey[key];
      const others = colors.filter(c => c.name !== ink);
      list.push({
        cond: (display === 'integrated' ? 'int' : 'sep') + '_' + (congruent ? 'cong' : 'incong'),
        congruency: congruent ? 'congruent' : 'incongruent',
        display: display,
        block: 0,
        block_order: 'practice',
        word: congruent ? ink : others[U.randint(0, 2)].name,
        ink: ink,
        ink_hex: colors.filter(c => c.name === ink)[0].hex,
        respKey: key,
        correct_key: key,
        map: map.id,
        hand: handOf(key),
        finger: fingerOf(key),
        hand_switch: 0,
        prev_key: '',
        pos: i + 1
      });
    }
    return U.shuffle(list);
  }

  /** 两个正式区组；区组顺序与键位映射用不同的哈希，避免两者绑定 */
  function formal(pid) {
    const p = pid || 'x';
    const map = mappingFor(p);
    const order = U.hash(p + '|order') % 2 === 0 ? [0, 1] : [1, 0];
    const blocks = order.map(function (idx, pos) {
      const display = C().blocks[idx].display;
      return {
        label: (pos + 1) + '/2 · ' + C().blocks[idx].label,
        display: display,
        trials: buildBlock(display, { block: pos + 1, order: pos + 1 }, map)
      };
    });
    return { order: order, blocks: blocks, map: map };
  }

  /* ---------- 刺激呈现 ---------- */

  function hint(trial) {
    const maps = C().keyMaps;
    const map = maps.filter(m => m.id === trial.map)[0] || maps[0];
    return legend(map) + (trial.display === 'separated' ? ' · 判断色块' : '');
  }

  async function show(trial, host) {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';

    if (trial.display === 'separated') {
      const patch = document.createElement('span');
      patch.className = 'patch';
      patch.style.background = trial.ink_hex;
      wrap.appendChild(patch);
      const w = document.createElement('span');
      w.className = 'word word--separated';
      w.textContent = trial.word;
      wrap.appendChild(w);
    } else {
      const w = document.createElement('span');
      w.className = 'word';
      w.style.color = trial.ink_hex;
      w.textContent = trial.word;
      wrap.appendChild(w);
    }

    host.appendChild(wrap);
    await Engine.nextFrame();
    return Engine.now();
  }

  function respond(trial, onset) {
    const waiter = Engine.waitKey({
      onset: onset,
      keys: ['d', 'f', 'j', 'k', 'Escape'],
      deadline: C().deadline
    });

    return waiter.promise.then(function (res) {
      if (res.aborted) return res;
      if (res.timedOut) return { key: null, rt: null, correct: 0, timeout: 1 };
      if (res.key === 'Escape') return { aborted: true };
      return {
        key: res.key,
        rt: Math.round(res.rt),
        correct: res.key === trial.respKey ? 1 : 0,
        timeout: 0
      };
    });
  }

  function clear(host) { host.innerHTML = ''; }

  function feedback(host, ok, trial) {
    host.innerHTML = '';
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.gap = '18px';

    const word = document.createElement('span');
    word.className = 'word';
    word.style.color = trial.ink_hex;
    word.style.opacity = '0.9';
    word.textContent = trial.ink;

    const tag = document.createElement('span');
    tag.className = 'feedback ' + (ok ? 'feedback--ok' : 'feedback--bad');
    tag.textContent = ok ? '✓ 正确' : ('✗ 应为 ' + trial.ink);

    box.appendChild(word);
    box.appendChild(tag);
    host.appendChild(box);
  }

  /* ---------- 小结 ---------- */

  function summarize(trials) {
    const formal = trials.filter(t => t.block_order !== 'practice');
    const valid = formal.filter(t => !t.timeout && t.correct === 1 && t.rt >= 150);
    const cell = function (cond) {
      const xs = valid.filter(t => t.cond === cond).map(t => t.rt);
      return { n: xs.length, rt: window.S.mean(xs), sd: window.S.sd(xs) };
    };
    const acc = function (cond) {
      const xs = formal.filter(t => t.cond === cond);
      return xs.length ? window.S.mean(xs.map(t => t.correct)) : NaN;
    };

    const c = {
      int_cong: cell('int_cong'), int_incong: cell('int_incong'),
      sep_cong: cell('sep_cong'), sep_incong: cell('sep_incong')
    };

    // 顺序检查：同手 / 换手 的平均 RT 与试次数
    const order = { same: { n: 0, rt: NaN }, switch: { n: 0, rt: NaN } };
    ['same', 'switch'].forEach(function (k) {
      const want = k === 'switch' ? 1 : 0;
      const xs = valid.filter(t => Number(t.hand_switch) === want).map(t => t.rt);
      order[k] = { n: xs.length, rt: window.S.mean(xs) };
    });

    return {
      n: formal.length,
      accuracy: window.S.mean(formal.map(t => t.correct)),
      accuracyBy: {
        int_cong: acc('int_cong'), int_incong: acc('int_incong'),
        sep_cong: acc('sep_cong'), sep_incong: acc('sep_incong')
      },
      cells: c,
      interference: {
        integrated: c.int_incong.rt - c.int_cong.rt,
        separated: c.sep_incong.rt - c.sep_cong.rt
      },
      order: order,
      timeoutRate: window.S.mean(formal.map(t => t.timeout || 0))
    };
  }

  /* ---------- 指导语 ---------- */

  function brief(pid) {
    const map = mappingFor(pid);
    const byKey = colorByKey(map);
    const colors = COLORS();
    const keys = ['d', 'f', 'j', 'k'].map(function (k) {
      const name = byKey[k];
      const hex = colors.filter(c => c.name === name)[0].hex;
      return '<span class="keymap__key"><kbd>' + k.toUpperCase() + '</kbd>' +
        '<i style="--c:' + hex + '"></i>' + name + '</span>';
    }).join('');

    return {
      kicker: 'Experiment 01 · Stroop',
      title: 'Stroop 颜色命名',
      html:
        '<p><b>你要做的：</b>屏幕上会出现一个颜色词。请判断<b>它显示的颜色</b>，'
        + '不要管这个字写的是什么。</p>'
        + '<div class="keymap">' + keys + '</div>'
        + '<p class="rule">又快又准。按错不用改，直接进入下一题。</p>'
        + '<p>实验分两段。第一段里，颜色直接涂在字上（经典 Stroop）；第二段里，'
        + '字变成灰色，颜色被移到字上方的方块里——两段都请判断<b>颜色</b>，'
        + '而不是字义。</p>'
        + '<p>每段 40 次，段间可以休息。先做 12 次带反馈的练习。</p>',
      facts: [
        { k: '试次', v: '80 正式 + 12 练习' },
        { k: '时长', v: '约 5–6 分钟' },
        { k: '设计', v: '2×2 被试内' },
        { k: '改进', v: '分离显示' },
        { k: '键位', v: '按编号平衡的两套映射之一' },
        { k: '计时', v: '刺激至按键，上限 2.5 s' }
      ],
      side: '若你无法区分红/绿，请先告诉实验者。键位以屏幕上方的提示为准。'
    };
  }

  return { meta, brief, practice, formal, show, respond, clear, feedback, summarize, hint, mappingFor };
})();
