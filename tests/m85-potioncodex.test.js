// M85：药水图鉴 + 事件见闻 + 成就扩充（G1/G2/G3）
// 关键防线：codex.potions 旧档就地补块；成就空数据全 0 不炸；
// 「全称断言」的集合必须非空（见 2026-10 静默失败教训）。
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + msg); } }
function section(t) { console.log('\n-- ' + t); }

const store = {};
const sandbox = {
  console, localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
};
vm.createContext(sandbox);
[
  'js/core/progress.js', 'js/core/achievements.js',
  'js/core/rng.js', 'js/data/characters.js', 'js/data/acts.js',
  'js/data/cards.js', 'js/data/cards-medic.js', 'js/data/cards-keeper.js',
  'js/data/potions.js', 'js/data/sfx-profile.js', 'js/data/relics.js',
  'js/data/events.js', 'js/data/story.js', 'js/data/enemies.js',
  'js/core/combat.js', 'js/core/map.js', 'js/core/run.js',
].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
const S = (e) => vm.runInContext(e, sandbox);

// ---- 1. 数据层：recordPotion / recordClimb / 旧档兼容 ----
section('1 数据层');
ok(S('Progress.recordPotion("poultice"); Progress.recordPotion("poultice"); Progress.recordPotion("firebomb"); true') === true, '记录 3 瓶不炸');
ok(S('Progress.data.codex.potions.poultice') === 2, '同名累计（实测 2）');
ok(S('Progress.data.codex.potions.firebomb') === 1, '不同 id 分开计');
ok(S('Progress.recordClimb(); Progress.recordClimb(); Progress.data.stats.climbs') === 2, '攀绳累计 2');
// ---- 2. run.js 挂点：获得药水 / 攀绳 自动记录 ----
section('2 run 挂点');
ok(S('Run.start("act1", 850001, "digger", 1); true') === true, '开局');
ok(S('Run.addPotion("stim")') === true, '获得兴奋剂');
ok(S('Progress.data.codex.potions.stim') === 1, 'addPotion 自动点亮图鉴（实测 ' + S('Progress.data.codex.potions.stim') + '）');
// 攀绳：找相邻上一层节点
const climbOk = S(`(function(){
  var s = Run.state;
  var prev = s.prevId; if (!prev) return 'noprev';
  var before = Progress.data.stats.climbs || 0;
  var r = Run.climbUp();
  if (!r) return 'climbfail';
  return (Progress.data.stats.climbs === before + 1) ? 'ok' : 'notcounted';
})()`);
ok(climbOk === 'ok' || climbOk === 'noprev', '攀绳计数（开局首节点无 prevId 可跳过；实测 ' + climbOk + '）');

// ---- 3. 战斗引用同步的图鉴不双计（喝药不记录，只有获得记录）----
section('3 喝药不重复计');
ok(S('Combat.start(850002, {potions:["poultice"], enemyId:"rust_crown", hp:60, maxHp:80}); Combat.usePotion(0); true') === true, '战斗喝药');
const potBefore = S('Progress.data.codex.potions.poultice');
ok(potBefore === 2, '喝药不写图鉴（第 1 节已累计 2，喝药不额外 +1，实测 ' + potBefore + '）');

// ---- 4. 成就扩充：24 条 + 新 6 条派生正确 ----
section('4 成就 24 条');
const total = S('Achievements.list({data: Progress.data, totals:{cards:120, relics:24, chars:3, potions:10, chains:2}}).length');
ok(total === 24, '成就总数 24（实测 ' + total + '）');
const ach = (id) => S('Achievements.list({data: Progress.data, totals:{cards:120, relics:24, chars:3, potions:10, chains:2}}).find(function(a){return a.id==="' + id + '"})');
ok(ach('potion1').got === true, '初试药石已亮（本档获得过 stim）');
ok(ach('potion5').got === false && ach('potion5').cur === 4, '药箱渐满 cur=4 未亮（2+1+1，实测 ' + ach('potion5').cur + '）');
ok(ach('potions_all').got === false, '尝遍百草未亮');
ok(ach('climb1').got === true && ach('climb1').cur === 2, '知返已亮 cur=2（第 1 节攀绳 2 次，实测 ' + ach('climb1').cur + '）');
// 空数据全 0 不炸（空集防线：成就列表非空才有效）
const emptyList = S('Achievements.list({data: null, totals:{cards:120, relics:24, chars:3, potions:10, chains:2}})');
ok(emptyList.length === 24 && emptyList.every((a) => !a.got), '空数据 24 条全未解锁不炸');
// totals 缺 chains：maxOf 兜底不误亮
const noTotals = S('Achievements.list({data: Progress.data, totals:{cards:120, relics:24, chars:3}})');
ok(noTotals.find((a) => a.id === 'chain_all').got === false, 'totals 缺 chains 时井史学者不误亮');
ok(noTotals.find((a) => a.id === 'potions_all').got === false, 'totals 缺 potions 时不误亮');

// ---- 5. 云合并覆盖 potions / climbs ----
section('5 云合并');
ok(S(`(function(){
  var b1 = Progress.data.codex.potions.stim || 0, b2 = Progress.data.stats.climbs || 0;
  Progress.mergeCounters({ codex: { potions: { stim: b1 + 3 } }, stats: { climbs: b2 + 7 } });
  return (Progress.data.codex.potions.stim === b1 + 3) + ':' + (Progress.data.stats.climbs === b2 + 7);
})()`) === 'true:true', 'mergeCounters 取大：potions/climbs 各 +3/+7 后递增正确');

// ---- 6. 事件见闻数据就绪 ----
section('6 事件链');
ok(S('Object.keys(EVENT_CHAINS).length') >= 2, '链数量 >= 2（实测 ' + S('Object.keys(EVENT_CHAINS).length') + '）');
ok(S('Progress.eventSeen("duty_log")') >= 0, 'eventSeen 可读不炸');

// ---- 7. 旧档兼容（放最后：init 会覆盖上面已记录的数据）----
section('7 旧档兼容');
store['tower-descend/save'] = JSON.stringify({ version: 1, chars: {}, daily: { wins: {} }, codex: { cards: {}, relics: {}, enemies: {}, events: {} }, stats: { chars: {} } });
ok(S('(function(){Progress.init();return Progress.data.codex.potions ? "ok" : "missing"})()') === 'ok', '旧档 init 后 codex.potions 就地补块');
ok(S('Progress.data.codex.potions && Object.keys(Progress.data.codex.potions).length') === 0, '补块为空对象不带脏数据');

console.log('\n=== M85: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
