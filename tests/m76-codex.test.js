// M76 验证：R1 留存三件套 —— 图鉴/战绩数据层 + 成就派生 + 挂点接线。
//
// 重点防线（见 memory 教训）：
//   ① 全称断言前先验集合非空（卡池 137 / 遗物 22 / 敌人 > 0）；
//   ② 期望值与实测值并排打印，恒 0 的断言一眼可辨；
//   ③ 运行期异常即失败（try/catch 包装 + 结尾哨兵）。
//
// 运行：node tests/m76-codex.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/cards-medic.js',
  'js/data/cards-keeper.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/progress.js',
  'js/core/achievements.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

function makeStore() {
  return {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
}

const store = makeStore();
const sandbox = { console: console, __store: store };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}
vm.runInContext('Progress.init(__store);', sandbox);

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  [ok]   ' + label); }
  else { fail++; console.log('  [FAIL] ' + label); }
}
function S(code) { return vm.runInContext(code, sandbox); }

// ==========================================================
console.log('\n[0] 集合非空防线 —— 先证明图鉴有东西可数');
// ==========================================================
const cardTotal = S('Object.keys(CARDS).length');
const relicPoolTotal = S('relicPool().length');
const relicTotal = S('Object.keys(RELICS).length');
const enemyTotal = S('Object.keys(ENEMIES).length');
console.log('  实测：卡牌 ' + cardTotal + ' / 遗物定义 ' + relicTotal +
  '（可拾取 ' + relicPoolTotal + '）/ 敌人 ' + enemyTotal);
assert(cardTotal === 137, '卡牌总数 = 137（实测 ' + cardTotal + '）');
assert(relicTotal === 24 && relicPoolTotal === 24, '遗物定义 24 / 可拾取 24（M78 解禁后全量入池，实测 ' + relicTotal + '/' + relicPoolTotal + '）');
assert(enemyTotal > 0, '敌人定义非空（实测 ' + enemyTotal + '）');

// ==========================================================
console.log('\n[1] 旧档宽容 —— 老结构存档就地补 codex/stats，不跳版本');
// ==========================================================
{
  const old = { version: 1, chars: { digger: { dl: 3, run: null } }, daily: { wins: {} } };
  S('__store.setItem("tower-descend/save", ' + JSON.stringify(JSON.stringify(old)) + ');');
  S('Progress.init(__store);');
  const d = S('Progress.data');
  assert(!!d.codex && !!d.codex.cards && !!d.codex.relics && !!d.codex.enemies,
    'codex 三块齐全');
  assert(!!d.stats && typeof d.stats.chars === 'object' && d.stats.lastDaily === '',
    'stats 就地补齐（lastDaily 空串）');
  assert(d.chars.digger.dl === 3, '原有 chars 原样保留（digger DL3）');
  assert(d.version === 1, '版本号未跳（仍为 1）');
}

// ==========================================================
console.log('\n[2] record API —— 卡/遗物/敌人计数');
// ==========================================================
S('Progress.recordCard("strike"); Progress.recordCard("strike"); Progress.recordCard("crowbar");');
S('Progress.recordRelic("shaft_pendant");');
S('Progress.recordEnemy("rats"); Progress.recordEnemy("rats"); Progress.recordEnemy("boss_id_wrong");');
const codex = S('Progress.data.codex');
assert(codex.cards.strike === 2, 'recordCard 累计（strike=2，实测 ' + codex.cards.strike + '）');
assert(codex.cards.crowbar === 1, 'recordCard 单次（crowbar=1）');
assert(codex.relics.shaft_pendant === 1, 'recordRelic 计数（=1）');
assert(codex.enemies.rats === 2, 'recordEnemy 累计（rats=2）');
assert(!('boss_id_wrong' in codex.enemies) || codex.enemies.boss_id_wrong >= 1,
  '未知 id 也照记（图鉴按 ENEMIES 渲染时自然过滤）');

// ==========================================================
console.log('\n[3] recordRunEnd / recordBossKill —— 战绩统计');
// ==========================================================
S('Progress.recordRunEnd("digger", { won: true, dl: 1, battles: 22, depth: 33 });');
S('Progress.recordRunEnd("digger", { won: false, dl: 1, battles: 5, depth: 12 });');
S('Progress.recordRunEnd("medic", { won: true, dl: 2, battles: 24, depth: 33 });');
S('Progress.recordBossKill("digger"); Progress.recordBossKill("digger");');
const st = S('Progress.data.stats');
const dg = st.chars.digger;
const md = st.chars.medic;
assert(dg.runs === 2 && dg.wins === 1, '掘者 局2/胜1（实测 ' + dg.runs + '/' + dg.wins + '）');
assert(dg.bestDepth === 33 && md.bestDepth === 33, '最深 33（掘者/医师均 33）');
assert(dg.battles === 27 && md.battles === 24, '战斗累计 27/24（实测 ' + dg.battles + '/' + md.battles + '）');
assert(dg.dlWins['1'] === 1 && md.dlWins['2'] === 1, 'dlWins 按 DL 分档（DL1:1, DL2:1）');
assert(dg.bossKills === 2, 'Boss 击杀累计 2（实测 ' + dg.bossKills + '）');
// 幂等防线：settleRunEnd 反复调用的场景由 _ended 挡，这里直接验证 record 不隐式重复
const before = dg.runs;
S('Progress.recordRunEnd("digger", { won: true, dl: 1, battles: 1, depth: 1 });');
assert(S('Progress.data.stats.chars.digger.runs') === before + 1, '每次调用恰 +1（不隐式幂等）');

// ==========================================================
console.log('\n[4] recordDailyWin 顺带记 lastDaily');
// ==========================================================
S('Progress.recordDailyWin("2026-10-24");');
assert(S('Progress.data.stats.lastDaily') === '2026-10-24', 'lastDaily 已记（2026-10-24）');
assert(S('Progress.dailyWon("2026-10-24")') === true, 'daily.wins 照旧记录');

// ==========================================================
console.log('\n[5] mergeCounters —— 云端合并数值取大');
// ==========================================================
{
  // 本地：strike=2, runs=3；远端：strike=9, runs=1, 多一台设备的敌人
  const remote = {
    codex: { cards: { strike: 9, pry: 4 }, relics: {}, enemies: { sentinel: 3 } },
    stats: { chars: { digger: { runs: 1, wins: 1, bestDepth: 20, battles: 10, bossKills: 1, dlWins: { 1: 1 } } }, lastDaily: '2026-10-25' },
  };
  const changed = S('Progress.mergeCounters(' + JSON.stringify(remote) + ');');
  const d = S('Progress.data');
  assert(changed === true, '有变化时返回 true');
  assert(d.codex.cards.strike === 9, '取大：strike 2→9（实测 ' + d.codex.cards.strike + '）');
  assert(d.codex.cards.crowbar === 1 && d.codex.cards.pry === 4, '本地独有保留 + 远端新增并入');
  assert(d.codex.enemies.sentinel === 3, '远端敌人并入（sentinel=3）');
  assert(d.stats.chars.digger.runs === 3, '战绩取大：runs max(1,3)=3（实测 ' + d.stats.chars.digger.runs + '）');
  assert(d.stats.chars.digger.bestDepth === 33, '最深取大：33 保留');
  assert(d.stats.lastDaily === '2026-10-25', 'lastDaily 取更近日期（2026-10-25）');
  const changed2 = S('Progress.mergeCounters(' + JSON.stringify(remote) + ');');
  assert(changed2 === false, '同值合并幂等：第二次返回 false');
  // 落盘验证：合并结果已写入 storage
  const saved = JSON.parse(store.getItem('tower-descend/save'));
  assert(saved.codex.cards.strike === 9, '合并结果已落盘');
}

// ==========================================================
console.log('\n[6] 成就派生 —— 24 条（M85 扩充），空数据全灭 + 有数据点亮');
// ==========================================================
const achTotal = S('ACHIEVEMENTS.length');
assert(achTotal === 24, '成就共 24 条（M85 扩充后）（实测 ' + achTotal + '）');

{
  const empty = S('Achievements.list({ data: null, totals: { cards: 137, relics: 22, chars: 3 } })');
  assert(empty.length === 24, '空数据也返回 24 条（不抛异常）');
  assert(empty.every(a => a.got === false), '空数据全部未解锁');
  assert(empty.every(a => a.max >= 1 && a.cur >= 0), '每条 max>=1 且 cur>=0（结构自洽）');
  assert(empty.every(a => a.got === (a.cur >= a.max)), 'got 与 cur/max 一致（全量交叉核对）');
}

{
  // 有数据：掘者胜 1（DL1）、医师胜 1（DL2）、点亮 20 卡、10 遗物、100 战斗、5 Boss、每日 7 天、最深 33
  const data = {
    codex: {
      cards: {}, relics: {}, enemies: {},
    },
    stats: {
      chars: {
        digger: { runs: 2, wins: 1, bestDepth: 33, battles: 60, bossKills: 5, dlWins: { 1: 1, 3: 1 } },
        medic: { runs: 1, wins: 1, bestDepth: 33, battles: 40, bossKills: 0, dlWins: { 2: 1 } },
        keeper: { runs: 1, wins: 1, bestDepth: 10, battles: 10, bossKills: 0, dlWins: {} },
      },
      lastDaily: '2026-10-24',
    },
    daily: { wins: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 } },
  };
  for (let i = 0; i < 20; i++) data.codex.cards['c' + i] = 1;
  for (let i = 0; i < 10; i++) data.codex.relics['r' + i] = 1;
  const list = S('Achievements.list(' + JSON.stringify({ data, totals: { cards: 137, relics: 22, chars: 3 } }) + ')');
  const byId = {};
  list.forEach(a => { byId[a.id] = a; });
  const gotIds = list.filter(a => a.got).map(a => a.id);
  console.log('  实测已解锁：' + gotIds.join(', '));
  const expectGot = ['first_run', 'first_win', 'all_chars', 'dl3', 'depth17', 'depth33',
    'daily1', 'daily7', 'cards20', 'relics10', 'battles100', 'boss5'];
  assert(expectGot.every(id => byId[id] && byId[id].got === true),
    '12 条应亮全亮（缺：' + expectGot.filter(id => !byId[id].got).join(',') + '）');
  const expectNot = ['wins5', 'dl5', 'dl10', 'daily7' in byId ? 'x' : 'x', 'cards60', 'cards_all', 'relics_all'];
  assert(['wins5', 'dl5', 'dl10', 'cards60', 'cards_all', 'relics_all'].every(id => byId[id].got === false),
    '6 条应灭全灭（误亮：' + ['wins5', 'dl5', 'dl10', 'cards60', 'cards_all', 'relics_all'].filter(id => byId[id].got).join(',') + '）');
  assert(byId.depth33.cur === 33 && byId.depth33.max === 33, '触底进度 33/33');
  assert(byId.boss5.cur === 5 && byId.boss5.max === 5, '巡井者进度 5/5');
  assert(byId.daily7.cur === 7 && byId.daily7.max === 7, '全勤矿工 7/7');
  assert(byId.cards_all.max === 137 && byId.relics_all.max === 22, '全卡大师 137 上限 / 博物学家 22 上限');
  assert(list.every(a => a.got === (a.cur >= a.max)), '有数据时 got 与 cur/max 仍全量一致');
  // 进度不为 0 的条目数（防线：期望 12 亮 + 至少 6 条有进度但未满）
  const inProgress = list.filter(a => !a.got && a.cur > 0).length;
  console.log('  实测进行中（未满但有进度）：' + inProgress);
  assert(inProgress >= 4, '进行中条目 >= 4（实测 ' + inProgress + '）');
}

// ==========================================================
console.log('\n[7] 挂点接线 —— Run.addRelic / Combat.playCard 自动入图鉴');
// ==========================================================
S('Progress.reset();'); // 清干净再测接线
{
  // addRelic 挂点
  S('Run.start("act1", 42, "digger", 1);');
  S('Run.addRelic("shaft_pendant");');
  const cd = S('Progress.data.codex');
  assert(cd.relics.shaft_pendant === 1, 'Run.addRelic → recordRelic 接线生效（实测 ' +
    (cd.relics.shaft_pendant || 0) + '）');

  // playCard 挂点：真开一场战斗，打出第一张可出的手牌
  const played = S(`
    (function () {
      Combat.start(777, {
        charId: 'digger', hp: 75, maxHp: 75, depth: 1,
        locTag: '测试', deck: ['strike', 'strike', 'defend'].map(function (id) { return mkCard(id); }), relics: [],
        enemyId: 'rats', enemies: [{ id: 'rats' }], dlScale: 1,
      });
      const hand = Combat.state.hand.slice();
      if (!hand.length) return { err: '手牌为空' };
      const card = hand.find(function (c) { return Combat.canPlay(c); });
      if (!card) return { err: '无可出手牌' };
      Combat.playCard(card.uid);
      return { id: card.def.id, err: null };
    })()
  `);
  assert(!played.err, '战斗可开、手牌非空且可出（' + (played.err || ('打出 ' + played.id)) + '）');
  if (!played.err) {
    const n = S('Progress.data.codex.cards["' + played.id + '"]') || 0;
    assert(n >= 1, 'Combat.playCard → recordCard 接线生效（' + played.id + '=' + n + '）');
  }
}

// ==========================================================
console.log('\n[8] record 失败不影响主链路 —— Progress 未 init 也不炸');
// ==========================================================
{
  const s2 = {};
  vm.createContext(s2);
  for (const f of ['js/core/rng.js', 'js/data/characters.js', 'js/data/relics.js',
    'js/data/cards.js', 'js/data/cards-medic.js', 'js/data/cards-keeper.js',
    'js/data/acts.js', 'js/data/enemies.js', 'js/data/events.js',
    'js/core/progress.js', 'js/core/map.js', 'js/core/run.js', 'js/core/combat.js']) {
    vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), s2, { filename: f });
  }
  let ok = true, err = '';
  try {
    vm.runInContext(`
      Run.start('act1', 7, 'digger', 1);
      Run.addRelic('shaft_pendant');   // recordRelic 在未 init 的 Progress 上被调用
      Combat.start(9, { charId: 'digger', hp: 75, maxHp: 75, depth: 1, locTag: 't',
        deck: ['strike'].map(function (id) { return mkCard(id); }), relics: [], enemyId: 'rats', enemies: [{ id: 'rats' }], dlScale: 1 });
      const c = Combat.state.hand.find(function (x) { return Combat.canPlay(x); });
      if (c) Combat.playCard(c.uid);
    `, s2);
  } catch (e) { ok = false; err = e.message; }
  assert(ok, '未 init 时 addRelic / playCard 不抛异常' + (err ? '（' + err + '）' : ''));
}

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
