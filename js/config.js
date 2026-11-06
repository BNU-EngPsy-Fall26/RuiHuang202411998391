/* ============================================================
   config.js — 全部可调参数集中在这里
   唯一需要你手动改的是 PROJECT：把 /hw2 拿到的 6 位项目码填进来。
   下载密钥不要写进本文件。
   ============================================================ */

window.CONFIG = {

  /* ---------- 收数接口 ---------- */
  project: 'NLTYFA',                     // 6 位项目码（不是下载密钥）
  apiBase: 'https://attention-lab-production.up.railway.app',

  site: {
    title: '冲突与刻度',
    lab: 'CONFLICT & SCALE',
    labCn: '冲突与刻度',
    version: 'Vol.02 / 2026 秋',
    course: 'BNU · 工程心理学 · 作业二'
  },

  /* ---------- 实验一：Stroop ---------- */
  stroop: {
    id: 'stroop_sep',
    fixation: 500,          // 注视点 ms（500 ms 是计算机化 Stroop 的常用值）
    deadline: 2000,         // 反应窗口 ms：超时即结束该试次
    blank: 500,             // 反应后空屏 ms（试次间间隔的主体）
    blankJitter: 100,       // 空屏的随机抖动 0–100 ms，减少节奏预期
    countdown: 3,           // 每个区组开始前的 3-2-1 准备
    practiceN: 12,
    perBlock: 40,
    congruentPerBlock: 20,

    // 颜色（不含键位；键位由下面的映射决定，见 keyMaps）
    colors: [
      { name: '红', hex: '#E2483D' },
      { name: '黄', hex: '#E8B23A' },
      { name: '蓝', hex: '#4A7FE0' },
      { name: '绿', hex: '#3FA46A' }
    ],

    // 两套镜像键位映射，按被试编号平衡：
    // A：左手中指 D=红、食指 F=黄；右手食指 J=蓝、中指 K=绿
    // B：A 的左右镜像，把"食指更省力 / 中指更费力"从颜色上平衡掉
    keyMaps: [
      { id: 'A', keys: { '红': 'd', '黄': 'f', '蓝': 'j', '绿': 'k' } },
      { id: 'B', keys: { '红': 'k', '黄': 'j', '蓝': 'f', '绿': 'd' } }
    ],

    // 两个区组：整合（经典彩色词）与分离（灰词 + 上方色块）
    blocks: [
      { display: 'integrated', label: '整合显示' },
      { display: 'separated',  label: '分离显示' }
    ],

    // 区组内"同手 / 换手"过渡的目标范围（40 试次 → 39 次过渡）
    switchRange: [18, 21]
  },

  /* ---------- 实验二：比例判断 ---------- */
  prop: {
    id: 'prop_ticks',
    fixation: 300,
    blank: 500,
    blankJitter: 100,
    countdown: 3,
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
    maxRT: 2000,
    minAccuracy: 0.7,
    bootstrap: 10000
  }
};
