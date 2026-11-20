// M76 成就（R1 留存三件套之三）—— 18 条全部由本机数据**运行时派生**，零独立存储。
//
// 为什么不做成就存档：成就是统计的影子。存一份「已解锁集合」就要处理
// 补档追溯、云合并、改阈值迁移三件事；派生则改文案/阈值不用迁移任何数据。
// 唯一代价是每次打开成就页重算一遍 —— 18 条纯数值运算，微不足道。
//
// 依赖隔离：本文件不引用任何全局（CARDS / CHARACTERS 一概不碰），
// 全部数量经 ctx 注入 —— Node 无头可测，浏览器由 app.js 提供 totals。
//   ctx = { data: Progress.data, totals: { cards, relics, chars } }
// data 为空 / 结构缺失时全部按未解锁处理，绝不抛异常。

// 便捷读取：都按「缺了当 0」处理，容忍旧档与新档。
function stSum(data, key) {
  const chars = data && data.stats && data.stats.chars ? data.stats.chars : {};
  let t = 0;
  Object.keys(chars).forEach(function (k) {
    t += (chars[k] && chars[k][key]) || 0;
  });
  return t;
}

function stMax(data, key) {
  const chars = data && data.stats && data.stats.chars ? data.stats.chars : {};
  let mx = 0;
  Object.keys(chars).forEach(function (k) {
    const v = (chars[k] && chars[k][key]) || 0;
    if (v > mx) mx = v;
  });
  return mx;
}

// 有通关记录的角色数（三线勘探）
function stCharsWon(data) {
  const chars = data && data.stats && data.stats.chars ? data.stats.chars : {};
  let n = 0;
  Object.keys(chars).forEach(function (k) {
    if ((chars[k].wins || 0) >= 1) n += 1;
  });
  return n;
}

// codex[kind] 计数总和（获得瓶数等「累计量」，区别于 codexKinds 的「种类数」）
function codexSum(data, kind) {
  const c = data && data.codex ? data.codex[kind] : null;
  if (!c || typeof c !== 'object') return 0;
  let n = 0;
  Object.keys(c).forEach(function (k) { n += c[k] || 0; });
  return n;
}

// 事件链后续已解锁的种类数（同一事件遭遇 ≥2 次 = 后续文本已见过）
function chainUnlocked(data) {
  const c = data && data.codex ? data.codex.events : null;
  if (!c || typeof c !== 'object') return 0;
  let n = 0;
  Object.keys(c).forEach(function (k) { if ((c[k] || 0) >= 2) n += 1; });
  return n;
}

// 任一角色在指定 DL 通关过（深度适应 / 老练下潜者 / 井的主宰）
function stDlWon(data, dl) {
  const chars = data && data.stats && data.stats.chars ? data.stats.chars : {};
  let n = 0;
  Object.keys(chars).forEach(function (k) {
    const w = chars[k].dlWins;
    if (w && (w[dl] || 0) >= 1) n += 1;
  });
  return n;
}

function dailyCount(data) {
  const w = data && data.daily && data.daily.wins ? data.daily.wins : null;
  return w ? Object.keys(w).length : 0;
}

// 图鉴点亮数：只数计数 > 0 的条目（计数不可能为 0，防御式写法）
function codexKinds(data, kind) {
  const c = data && data.codex ? data.codex[kind] : null;
  if (!c || typeof c !== 'object') return 0;
  let n = 0;
  Object.keys(c).forEach(function (k) { if (c[k] > 0) n += 1; });
  return n;
}

const ACHIEVEMENTS = [
  // ---- 下潜（7）----
  { id: 'first_run', name: '初次下潜', group: '下潜',
    desc: '完成第 1 局下潜。',
    cur: function (d) { return stSum(d, 'runs'); }, max: 1 },
  { id: 'first_win', name: '井底之光', group: '下潜',
    desc: '任一角色首次通关。',
    cur: function (d) { return stSum(d, 'wins'); }, max: 1 },
  { id: 'wins5', name: '熟练工', group: '下潜',
    desc: '累计通关 5 次。',
    cur: function (d) { return stSum(d, 'wins'); }, max: 5 },
  { id: 'all_chars', name: '三线勘探', group: '下潜',
    desc: '三个角色各通关 1 次。',
    cur: function (d) { return stCharsWon(d); }, maxOf: function (d, t) { return t.chars; } },
  { id: 'dl3', name: '深度适应', group: '下潜',
    desc: 'DL3 难度下通关。',
    cur: function (d) { return stDlWon(d, 3); }, max: 1 },
  { id: 'dl5', name: '老练下潜者', group: '下潜',
    desc: 'DL5 难度下通关。',
    cur: function (d) { return stDlWon(d, 5); }, max: 1 },
  { id: 'dl10', name: '井的主宰', group: '下潜',
    desc: 'DL10 难度下通关。',
    cur: function (d) { return stDlWon(d, 10); }, max: 1 },

  // ---- 深度（2）----
  { id: 'depth17', name: '半途', group: '深度',
    desc: '单局抵达第 17 层。',
    cur: function (d) { return stMax(d, 'bestDepth'); }, max: 17 },
  { id: 'depth33', name: '触底', group: '深度',
    desc: '单局抵达第 33 层（通关即得）。',
    cur: function (d) { return stMax(d, 'bestDepth'); }, max: 33 },

  // ---- 每日（2）----
  { id: 'daily1', name: '日常巡查', group: '每日',
    desc: '每日挑战首次通关。',
    cur: function (d) { return dailyCount(d); }, max: 1 },
  { id: 'daily7', name: '全勤矿工', group: '每日',
    desc: '每日挑战累计通关 7 天。',
    cur: function (d) { return dailyCount(d); }, max: 7 },

  // ---- 图鉴（5）----
  { id: 'cards20', name: '初识井壁', group: '图鉴',
    desc: '图鉴点亮 20 张卡牌。',
    cur: function (d) { return codexKinds(d, 'cards'); }, max: 20 },
  { id: 'cards60', name: '卡牌学者', group: '图鉴',
    desc: '图鉴点亮 60 张卡牌。',
    cur: function (d) { return codexKinds(d, 'cards'); }, max: 60 },
  { id: 'cards_all', name: '全卡大师', group: '图鉴',
    desc: '图鉴点亮全部卡牌。',
    cur: function (d) { return codexKinds(d, 'cards'); }, maxOf: function (d, t) { return t.cards; } },
  { id: 'relics10', name: '收藏家', group: '图鉴',
    desc: '收集 10 件遗物。',
    cur: function (d) { return codexKinds(d, 'relics'); }, max: 10 },
  { id: 'relics_all', name: '博物学家', group: '图鉴',
    desc: '收集全部可拾取遗物。',
    cur: function (d) { return codexKinds(d, 'relics'); }, maxOf: function (d, t) { return t.relics; } },
  { id: 'potion1', name: '初试药石', group: '图鉴',
    desc: '首次获得药水。',
    cur: function (d) { return codexKinds(d, 'potions'); }, max: 1 },
  { id: 'potion5', name: '药箱渐满', group: '图鉴',
    desc: '累计获得 5 瓶药水。',
    cur: function (d) { return codexSum(d, 'potions'); }, max: 5 },
  { id: 'potions_all', name: '尝遍百草', group: '图鉴',
    desc: '图鉴集齐全部药水。',
    cur: function (d) { return codexKinds(d, 'potions'); }, maxOf: function (d, t) { return t.potions; } },

  // ---- 战斗（2）----
  { id: 'battles100', name: '百战', group: '战斗',
    desc: '累计完成 100 场战斗。',
    cur: function (d) { return stSum(d, 'battles'); }, max: 100 },
  { id: 'boss5', name: '巡井者', group: '战斗',
    desc: '累计击杀 Boss 5 次。',
    cur: function (d) { return stSum(d, 'bossKills'); }, max: 5 },

  // ---- 见闻（3，M85 / G3）----
  { id: 'climb1', name: '知返', group: '见闻',
    desc: '首次攀绳退回上一层。',
    cur: function (d) { return (d && d.stats && d.stats.climbs) || 0; }, max: 1 },
  { id: 'chain1', name: '弦外之音', group: '见闻',
    desc: '任一事件链解锁后续（同一事件第二次遭遇）。',
    cur: function (d) { return chainUnlocked(d); }, max: 1 },
  { id: 'chain_all', name: '井史学者', group: '见闻',
    desc: '解锁全部事件链的后续。',
    cur: function (d) { return chainUnlocked(d); }, maxOf: function (d, t) { return t.chains; } },
];

const Achievements = {
  // 返回 [{id, name, desc, group, cur, max, got}]，顺序 = ACHIEVEMENTS 定义序。
  // totals 缺项时 maxOf 兜底为 cur+1（永不误亮），而不是抛异常。
  list(ctx) {
    ctx = ctx || {};
    const data = ctx.data || null;
    const totals = ctx.totals || {};
    return ACHIEVEMENTS.map(function (a) {
      let cur = 0, max = a.max;
      try { cur = a.cur(data, totals) || 0; } catch (e) { cur = 0; }
      if (a.maxOf) {
        try {
          const m = a.maxOf(data, totals);
          max = (typeof m === 'number' && m >= 1) ? m : cur + 1;
        } catch (e) { max = cur + 1; }
      }
      return {
        id: a.id, name: a.name, desc: a.desc, group: a.group,
        cur: cur, max: max, got: cur >= max,
      };
    });
  },
};
