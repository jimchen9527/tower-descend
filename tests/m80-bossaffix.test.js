// M80 验证：R5 内容深度 —— Boss 形态词条（DL5+）+ 词缀池隔离 + 图鉴数据。
//
// 运行：node tests/m80-bossaffix.test.js

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
  'js/data/potions.js',
  'js/data/sfx-profile.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/story.js',
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
  // ---- 1. 词条定义 ----
  section('1 词条定义');
  const bossAf = S('Run.bossAffixPool()');
  ok(bossAf.length >= 3, 'Boss 词条池 >= 3（实测 ' + bossAf.length + '）');
  ok(bossAf.every(function (id) { return S('AFFIXES["' + id + '"].bossOnly') === true; }),
    '池内词条都标了 bossOnly');
  ok(S('Run.affixPool().some(function(k){return AFFIXES[k].bossOnly})') === false,
    '普通词缀池不含 bossOnly 词条（隔离干净）');
  ok(S('Run.affixPool().length') >= 6, '普通词缀池仍有货（实测 ' + S('Run.affixPool().length') + '）');

  // ---- 2. DL 阈值 ----
  section('2 DL 阈值');
  // DL1：Boss 无词条
  ok(S('Run.start("act1", 606060, "digger", 1); (function(){var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=s.map.nodes[k];break;}}s.currentId=boss.id;s.visited[boss.id]=true;n=boss;return 1})(), Run.rollEncounter(Run.current()).enemyAffixes[0].length') === 0,
    'DL1 Boss 无词条');
  // DL5：Boss 恰好 1 枚，且来自 boss 池
  ok(S('(function(){Run.start("act1", 606061, "digger", 5);var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=s.map.nodes[k];break;}}return JSON.stringify(Run.rollEncounter(boss).enemyAffixes[0])})()').indexOf('[') === 0,
    'DL5 Boss 生成词条数组');
  const dl5af = S('(function(){var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=s.map.nodes[k];break;}}var af=Run.rollEncounter(boss).enemyAffixes[0];return af.length===1&&Run.bossAffixPool().indexOf(af[0])>=0})()');
  ok(dl5af === true, 'DL5 Boss 恰好 1 枚且来自 Boss 池');

  // ---- 3. 词条真实生效 ----
  section('3 词条生效');
  // affixes 走 opts.enemies[i].affixes（app.startBattle 同款形状）
  ok(S('Combat.start(313131, {enemies:[{id:"rust_crown", hpMul:1, variant:null, affixes:["bulwark"]}]}); Combat.targetUnit().block') === 15,
    '磐垒 Boss 进场 15 格挡（实测 ' + S('Combat.targetUnit().block') + '）');
  ok(S('Combat.start(313132, {enemies:[{id:"rust_crown", hpMul:1, variant:null, affixes:["overload"]}]}); Combat.targetUnit().dmgAdd') === 4,
    '过载 Boss dmgAdd +4（实测 ' + S('Combat.targetUnit().dmgAdd') + '）');
  ok(S('(function(){Combat.start(313133, {enemies:[{id:"rust_crown", hpMul:1, variant:null, affixes:["wrath"]}]});return Combat.targetUnit().buffs.str||0})()') === 3,
    '暴怒 Boss 进场 3 力量');

  // ---- 4. 推演不受词条影响 ----
  section('4 读数仪兼容');
  ok(S('Combat.forecastBoss("rust_crown", 3).length') === 3, '带词条的 Boss 照常可推演');
  ok(S('Combat.forecastBoss("rust_crown", 3).map(function(m){return m.name}).join(",")') === '锈蚀蔓延,重砸,锈蚀蔓延',
    '推演结果与无词条一致（词条不改招式循环）');

  // ---- 5. 编队写回节点（重打不变）----
  section('5 节点写回');
  ok(S('(function(){Run.start("act1", 606062, "digger", 7);var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=s.map.nodes[k];break;}}' +
    'var from=Object.keys(s.map.nodes).filter(function(k){return s.map.nodes[k].edges.indexOf(boss.id)>=0;})[0];' +
    's.currentId=from;s.visited[from]=true;' +
    'var n=Run.moveTo(boss.id);return n&&n.enemyId?1:0})()') === 1,
    'Boss 节点 moveTo 写回编队');
  ok(S('(function(){var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=s.map.nodes[k];break;}}var af=boss.encounter&&boss.encounter.enemyAffixes[0];return af&&af.length===1})()'),
    '节点上的 Boss 恰好 1 枚词条（随存档走，重打同词条）');

  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
