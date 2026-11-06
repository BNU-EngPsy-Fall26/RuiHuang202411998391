/* ============================================================
   stroop.js — 实验一：Stroop 颜色命名（整合 vs 分离）
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

  /* ---------- 生成试次 ---------- */

  function makeTrial(display, congruent, orderTag) {
    const colors = COLORS();
    const ink = colors[U.randint(0, colors.length - 1)];
    let word = ink;
    if (!congruent) {
      const others = colors.filter(c => c.name !== ink.name);
      word = others[U.randint(0, others.length - 1)];
    }
    return {
      cond: (display === 'integrated' ? 'int' : 'sep') + '_' + (congruent ? 'cong' : 'incong'),
      congruency: congruent ? 'congruent' : 'incongruent',
      display: display,
      block: orderTag.block,
      block_order: orderTag.order,
      word: word.name,
      ink: ink.name,
      ink_hex: ink.hex,
      respKey: ink.key,
      correct_key: ink.key
    };
  }

  function shuffleWords(trials) {
    const a = U.shuffle(trials);
    for (let pass = 0; pass < 60; pass++) {
      let changed = false;
      for (let i = 1; i < a.length; i++) {
        if (a[i].word === a[i - 1].word) {
          const j = (i + 3) % a.length;
          const t = a[i]; a[i] = a[j]; a[j] = t;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return a;
  }

  function buildBlock(display, orderTag) {
    const colors = COLORS();
    const perColor = C().congruentPerBlock / colors.length;   // 每种颜色 5 次
    const congruent = [];
    const incongruent = [];

    colors.forEach(c => {
      for (let i = 0; i < perColor; i++) {
        congruent.push({
          cond: (display === 'integrated' ? 'int' : 'sep') + '_cong',
          congruency: 'congruent',
          display: display,
          block: orderTag.block,
          block_order: orderTag.order,
          word: c.name,
          ink: c.name,
          ink_hex: c.hex,
          respKey: c.key,
          correct_key: c.key
        });
        // 不一致：墨色固定为该色，词义从其余三色里轮换
        const others = colors.filter(o => o.name !== c.name);
        const w = others[(i + colors.indexOf(c)) % others.length];
        incongruent.push({
          cond: (display === 'integrated' ? 'int' : 'sep') + '_incong',
          congruency: 'incongruent',
          display: display,
          block: orderTag.block,
          block_order: orderTag.order,
          word: w.name,
          ink: c.name,
          ink_hex: c.hex,
          respKey: c.key,
          correct_key: c.key
        });
      }
    });

    return shuffleWords(congruent.concat(incongruent));
  }

  function practice() {
    const colors = COLORS();
    const list = [];
    for (let i = 0; i < C().practiceN; i++) {
      const display = i % 2 === 0 ? 'integrated' : 'separated';
      const congruent = i % 4 < 2;
      list.push(makeTrial(display, congruent, { block: 0, order: 'practice' }));
    }
    return U.shuffle(list);
  }

  /** 两个正式区组；区组顺序按被试编号哈希决定，保证平衡 */
  function formal(pid) {
    const order = U.hash(pid || 'x') % 2 === 0 ? [0, 1] : [1, 0];
    const blocks = order.map((idx, pos) => {
      const display = C().blocks[idx].display;
      const label = (pos + 1) + '/2 · ' + C().blocks[idx].label;
      return { label: label, display: display, trials: buildBlock(display, { block: pos + 1, order: pos + 1 }) };
    });
    return { order: order, blocks: blocks };
  }

  /* ---------- 刺激呈现 ---------- */

  function hint(trial) {
    return trial.display === 'separated' ? C().hintSeparated : C().hintIntegrated;
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
    const keys = ['d', 'f', 'j', 'k', 'Escape'];
    const waiter = Engine.waitKey({ onset: onset, keys: keys, deadline: C().deadline });

    return waiter.promise.then(res => {
      if (res.aborted) return res;
      if (res.timedOut) {
        return { key: null, rt: null, correct: 0, timeout: 1 };
      }
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
    const ink = COLORS().filter(c => c.name === trial.ink)[0];
    host.innerHTML = '';
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.gap = '18px';

    const word = document.createElement('span');
    word.className = 'word';
    word.style.color = trial.ink_hex;
    word.textContent = trial.ink;
    word.style.opacity = '0.9';

    const tag = document.createElement('span');
    tag.className = 'feedback ' + (ok ? 'feedback--ok' : 'feedback--bad');
    tag.textContent = ok ? '✓ 正确' : ('✗ 应为 ' + ink.name);

    box.appendChild(word);
    box.appendChild(tag);
    host.appendChild(box);
  }

  /* ---------- 小结 ---------- */

  function summarize(trials) {
    const formal = trials.filter(t => t.block_order !== 'practice');
    const valid = formal.filter(t => !t.timeout && t.correct === 1 && t.rt >= 150);
    const cell = cond => {
      const xs = valid.filter(t => t.cond === cond).map(t => t.rt);
      return { n: xs.length, rt: window.S.mean(xs), sd: window.S.sd(xs) };
    };
    const acc = cond => {
      const xs = formal.filter(t => t.cond === cond);
      return xs.length ? window.S.mean(xs.map(t => t.correct)) : NaN;
    };

    const c = {
      int_cong: cell('int_cong'), int_incong: cell('int_incong'),
      sep_cong: cell('sep_cong'), sep_incong: cell('sep_incong')
    };
    const interference = {
      integrated: c.int_incong.rt - c.int_cong.rt,
      separated: c.sep_incong.rt - c.sep_cong.rt
    };

    return {
      n: formal.length,
      accuracy: window.S.mean(formal.map(t => t.correct)),
      accuracyBy: {
        int_cong: acc('int_cong'), int_incong: acc('int_incong'),
        sep_cong: acc('sep_cong'), sep_incong: acc('sep_incong')
      },
      cells: c,
      interference: interference,
      timeoutRate: window.S.mean(formal.map(t => t.timeout || 0))
    };
  }

  /* ---------- 指导语 ---------- */

  function brief() {
    const colors = COLORS();
    const keys = colors.map(c =>
      '<span class="keymap__key"><kbd>' + c.key.toUpperCase() + '</kbd>' +
      '<i style="--c:' + c.hex + '"></i>' + c.name + '</span>'
    ).join('');

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
        { k: '计时', v: '刺激至按键，上限 2.5 s' }
      ],
      side: '若你无法区分红/绿，请先告诉实验者。键盘映射固定为 D F J K。'
    };
  }

  return { meta, brief, practice, formal, show, respond, clear, feedback, summarize, hint };
})();
