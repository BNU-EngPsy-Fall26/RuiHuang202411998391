/* ============================================================
   config.js — 全部可调参数集中在这里
   唯一需要你手动改的是 PROJECT：把 /hw2 拿到的 6 位项目码填进来。
   ============================================================ */

window.CONFIG = {

  /* ---------- 收数接口 ---------- */
  project: 'ABC234',                     // ← 改成你的 6 位项目码（不要用下载密钥）
  apiBase: 'https://attention-lab-production.up.railway.app',

  site: {
    title: '冲突与比例',
    lab: 'ATTENTION LAB',
    labCn: '注意实验室',
    version: 'Vol.02 / 2026 秋',
    course: 'BNU · 工程心理学 · 作业二'
  },

  /* ---------- 实验一：Stroop ---------- */
  stroop: {
    id: 'stroop_sep',
    fixation: 500,          // 注视点 ms
    deadline: 2500,         // 反应上限 ms
    blank: 400,             // 试次间隔 ms
    practiceN: 12,
    perBlock: 40,
    congruentPerBlock: 20,

    // 颜色 → 按键。键位固定，降低被试的映射负担
    colors: [
      { name: '红', key: 'd', hex: '#E2483D' },
      { name: '黄', key: 'f', hex: '#E8B23A' },
      { name: '蓝', key: 'j', hex: '#4A7FE0' },
      { name: '绿', key: 'k', hex: '#3FA46A' }
    ],

    // 两个区组：整合（经典彩色词）与分离（灰词 + 上方色块）
    blocks: [
      { display: 'integrated', label: '整合显示' },
      { display: 'separated',  label: '分离显示' }
    ],

    minus: '2400',          // 按键提示
    hintIntegrated: 'D 红 · F 黄 · J 蓝 · K 绿',
    hintSeparated: 'D 红 · F 黄 · J 蓝 · K 绿 · 判断色块'
  },

  /* ---------- 实验二：比例判断 ---------- */
  prop: {
    id: 'prop_ticks',
    fixation: 300,
    blank: 400,
    deadline: null,          // 不限时
    practiceN: 4,
    reps: 10,

    // 10 个比例值，四个条件完全交叉；刻意避开 25 / 50 / 75
    pool: [5, 12, 22, 33, 41, 58, 67, 78, 88, 95],

    conditions: [
      { id: 'pie_none', chart: 'pie', ticks: 0, label: '饼图 · 无刻度' },
      { id: 'pie_tick', chart: 'pie', ticks: 1, label: '饼图 · 有刻度' },
      { id: 'bar_none', chart: 'bar', ticks: 0, label: '条形 · 无刻度' },
      { id: 'bar_tick', chart: 'bar', ticks: 1, label: '条形 · 有刻度' }
    ],

    pieSize: 320,
    barW: 560,
    barH: 96,
    sliderStart: 50
  },

  /* ---------- 图表配色 ---------- */
  chart: {
    ink: '#14110E',
    copper: '#A66A3C',
    muted: '#6E6659',
    line: '#DCD5C7',
    paper: '#F7F4ED'
  },

  /* ---------- 统计与展示 ---------- */
  analysis: {
    minRT: 150,
    maxRT: 2500,
    minAccuracy: 0.7,
    bootstrap: 10000
  }
};
