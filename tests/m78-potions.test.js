// M78 验证：R3a 药水系统 —— 数据表 + Run 背包 + Combat 饮用 + 商店/宝箱/快照。
//
// 防线（memory 教训）：
//   ① 全称断言前先验集合非空（药水池 >= 8）；
//   ② 期望值与实测值并排打印；
//   ③ try/catch + 结尾哨兵。
//
// 运行：node tests/m78-potions.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/glossary.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/cards-medic.js',
  'js/data/cards-keeper.js',
  'js/data/potions.js',
  'js/data/sfx-profile.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/progress.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

const sandbox = { console: console };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}
const S = function (expr) { return vm.runInContext(expr, sandbox); };

let failed = 0, ran = 0;
function ok(cond, msg) {
  ran++;
  if (!cond) { failed++; console.log('  FAIL ' + msg); }
}
function section(name) { console.log('[' + name + ']'); }

try {
  // ---- 1. 药水表 ----
  section('1 药水表');
  const pool = S('potionPool()');
  ok(pool.length >= 8, '药水池非空且 >= 8（实测 ' + pool.length + '）');
  ok(S('(function(){var bad=[];for(var k in POTIONS){var p=POTIONS[k];' +
    'if(!p.name||!p.icon||!p.desc||typeof p.use!=="function"||typeof p.price!=="number")bad.push(k);}return bad})()')
    .length === 0, '每瓶药水都有 name/icon/desc/price/use');
  ok(S('(function(){var bad=[];for(var k in POTIONS){if(POTIONS[k].price<50||POTIONS[k].price>75)bad.push(k+"="+POTIONS[k].price);}return bad})()')
    .length === 0, '价格全在 50–75 区间（§11）');

  // ---- 2. Run 背包 ----
  section('2 Run 背包');
  ok(S('Run.start("act1", 20261024, "digger", 1); Run.state.potions.length') === 0, '新局药水为空');
  ok(S('Run.addPotion("poultice")') === true, 'addPotion 收下第 1 瓶');
  ok(S('Run.addPotion("no_such_potion")') === false, '未知 id 拒收');
  S('Run.addPotion("cell"); Run.addPotion("firebomb")');
  ok(S('Run.potionSpace()') === 0, '3 槽装满后空间为 0（实测 ' + S('Run.potionSpace()') + '）');
  ok(S('Run.addPotion("stim")') === false, '槽满拒收第 4 瓶');
  ok(S('Run.removePotion(1)') === 'cell', 'removePotion 按索引取出');
  ok(S('Run.state.potions.join(",")') === 'poultice,firebomb', '取出后剩余正确（实测 ' + S('Run.state.potions.join(",")') + '）');
  ok(S('Run.removePotion(9)') === null, '索引越界返回 null');

  // ---- 3. 快照往返 + 旧档兼容 ----
  section('3 快照');
  ok(S('(function(){var snap=Run.toSnapshot();return Run.fromSnapshot(snap)&&Run.state.potions.join(",")})()')
    === 'poultice,firebomb', '快照往返保留药水');
  ok(S('(function(){var snap=Run.toSnapshot();delete snap.potions;return Run.fromSnapshot(snap)&&Run.state.potions.length})()')
    === 0, '旧档缺 potions 字段 → 就地补空数组');

  // ---- 4. 战斗中饮用 ----
  section('4 Combat.usePotion');
  // 用 Boss 当靶子：血厚，22 伤不会把它打死导致 phase 翻转
  ok(S('Combat.start(777, {potions: ["poultice","firebomb","stim"], enemyId: "rust_crown", hp: 50, maxHp: 75}); Combat.state.phase') === 'player', '战斗开局为玩家回合');
  // 同一数组引用：Run 的背包应同步收缩
  const beltRef = S('Combat.state.potions');
  ok(beltRef.length === 3, '战斗带着 3 瓶进场（实测 ' + beltRef.length + '）');
  const hpBefore = S('Combat.state.player.hp');
  ok(S('Combat.usePotion(0)') === 'poultice', '喝止血敷料返回 id');
  ok(S('Combat.state.player.hp') === Math.min(75, hpBefore + 18), '回血 18（前 ' + hpBefore + ' → 后 ' + S('Combat.state.player.hp') + '）');
  ok(beltRef.length === 2, '引用同步：背包剩 2 瓶（实测 ' + beltRef.length + '）');
  const ehpBefore = S('Combat.targetUnit().hp');
  ok(S('Combat.usePotion(0)') === 'firebomb', '喝燃烧瓶返回 id');
  ok(S('Combat.targetUnit().hp') === ehpBefore - 22, '对目标 22 伤（前 ' + ehpBefore + ' → 后 ' + S('Combat.targetUnit().hp') + '）');
  ok(S('Combat.usePotion(0)') === 'stim', '喝兴奋剂返回 id');
  ok(S('Combat.state.player.buffs.str || 0') === 2, '力量 +2（实测 ' + S('Combat.state.player.buffs.str || 0') + '）');
  ok(beltRef.length === 0, '3 瓶喝完背包清空（实测 ' + beltRef.length + '）');
  ok(S('Combat.usePotion(5)') === null, '索引越界返回 null');
  ok(S('Combat.state.log.some(function(l){return String(l).indexOf("喝下") !== -1})'),
    '动作日志有喝药记录');

  // ---- 5. 非玩家回合禁喝 ----
  section('5 回合锁定');
  ok(S('Combat.start(555, {potions: ["poultice"], enemyId: "rust_crown", hp: 50, maxHp: 75}); true') === true, '重开一场');
  ok(S('(function(){Combat.state.phase="enemy";return Combat.usePotion(0)})()') === null, '敌方回合禁喝');
  ok(S('(function(){Combat.state.phase="win";return Combat.usePotion(0)})()') === null, '胜利阶段禁喝');
  ok(S('Combat.state.potions.length') === 1, '禁喝不消耗药水（实测 ' + S('Combat.state.potions.length') + '）');

  // ---- 6. 商店货架 ----
  section('6 商店');
  ok(S('Run.start("act1", 424242, "digger", 1); (function(){var n=Run.current();})(), Run.rollShop() && Run.state.shop.potions.length') === 1,
    '商店常备 1 瓶药水（实测 ' + S('Run.rollShop(); Run.state.shop.potions.length') + '）');
  ok(S('(function(){var p=Run.state.shop.potions[0];return p.price>=50&&p.price<=75&&POTIONS[p.id]!==undefined&&!p.sold})()'),
    '货架药水价格 50–75 且是已知药水');
  ok(S('(function(){var p=Run.state.shop.potions[0];var g=Run.state.gold;Run.state.gold=999;var ok=Run.spendGold(p.price)&&Run.addPotion(p.id);Run.state.gold=g;return ok})()'),
    '花金币 + addPotion 购买链路可用');

  // ---- 7. 宝箱 ----
  section('7 宝箱');
  // 宝箱是随机出口：跑 200 次统计分布，只断言「kind 合法 + 无崩溃 + 药水时背包真的装了」
  S('Run.start("act1", 888888, "digger", 1)');
  const kinds = S('(function(){var seen={};for(var i=0;i<200;i++){Run.state.potions=[];Run.state.relics=[];var r=Run.openChest();seen[r.kind]=(seen[r.kind]||0)+1;' +
    'if(r.kind==="potion"&&Run.state.potions.indexOf(r.potionId)<0)return "BAD:potion not added";}return seen})()');
  ok(typeof kinds === 'object', '宝箱 200 开无崩溃（分布 ' + JSON.stringify(kinds) + '）');
  ok(kinds.relic > 0 && kinds.potion > 0, '宝箱能出遗物也能出药水（relic=' + kinds.relic + ' potion=' + kinds.potion + '）—— 非空集防线');
  ok(S('(function(){Run.state.potions=["poultice","cell","firebomb"];var r=Run.openChest();return r.kind==="potion"})()') === false,
    '满槽时宝箱不再掉药水');

  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
