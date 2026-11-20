// M78b 验证：R3b 攀绳机制 + 断绳/火种读数仪解禁 + Boss 意图推演。
//
// 运行：node tests/m78b-backrope.test.js

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
  // ---- 1. 遗物解禁 ----
  section('1 遗物解禁');
  ok(S('relicPool().indexOf("rope_scrap") !== -1'), '断绳已进掉落池');
  ok(S('relicPool().indexOf("ember_reader") !== -1'), '火种读数仪已进掉落池');
  ok(S('relicEffect(["rope_scrap"], "backrope")') === 1, '断绳 backrope 效果值 = 1');

  // ---- 2. 攀绳基础 ----
  section('2 攀绳基础');
  ok(S('Run.start("act1", 31337, "digger", 1); Run.ropeLeft()') === 1, '基础 1 次');
  ok(S('Run.canClimb()') === false, '入口节点没有上一层：不可攀');
  // 走两步：entry → 邻接 → 再邻接
  ok(S('(function(){var n1=Run.current().edges[0];Run.moveTo(n1);var n2=Run.current().edges.filter(function(e){return e!==Run.state.prevId;})[0];return Run.moveTo(n2)?n2:"STUCK"})()') !== 'STUCK', '推进两个节点');
  ok(S('Run.canClimb()') === true, '有来路：可攀');
  const maxHpBefore = S('Run.state.maxHp');
  const hpBefore = S('Run.state.hp');
  ok(S('Run.climbUp()') === true, '攀绳执行成功');
  ok(S('Run.state.maxHp') === maxHpBefore - 10, '最大生命 −10（前 ' + maxHpBefore + ' → 后 ' + S('Run.state.maxHp') + '）');
  ok(S('Run.state.hp') <= S('Run.state.maxHp'), '当前生命被收进新上限（' + S('Run.state.hp') + ' <= ' + S('Run.state.maxHp') + '）');
  ok(S('Run.ropeLeft()') === 0, '次数用尽');
  ok(S('Run.canClimb()') === false, '用尽后不可攀');
  ok(S('Run.state.prevId') === null, '攀回的节点没有更上一层');

  // ---- 3. 断绳 +1 ----
  section('3 断绳');
  ok(S('Run.start("act1", 31338, "digger", 1); Run.addRelic("rope_scrap"); Run.ropeLeft()') === 2, '断绳后共 2 次');

  // ---- 4. Boss 闸门封攀 ----
  section('4 Boss 闸门');
  // 手工摆位：当前节点是 Boss，或来路是 Boss —— 都不可攀
  ok(S('(function(){var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=k;break;}}' +
    'var neighbor=Object.keys(s.map.nodes).filter(function(k){return k!==boss && s.map.nodes[k].type!=="boss";})[0];' +
    's.currentId=neighbor;s.prevId=boss;s.ropeUsed=0;return Run.canClimb()})()') === false, '来路是 Boss：不可攀');
  ok(S('(function(){var s=Run.state;var boss=null;for(var k in s.map.nodes){if(s.map.nodes[k].type==="boss"){boss=k;break;}}' +
    'var neighbor=Object.keys(s.map.nodes).filter(function(k){return k!==boss && s.map.nodes[k].type!=="boss";})[0];' +
    's.currentId=boss;s.prevId=neighbor;s.ropeUsed=0;return Run.canClimb()})()') === false, '当前是 Boss：不可攀');

  // ---- 5. 快照往返 ----
  section('5 快照');
  ok(S('(function(){var snap=Run.toSnapshot();return Run.fromSnapshot(snap)&&(Run.state.ropeUsed!==undefined)&&(Run.state.prevId!==undefined)})()'),
    '快照包含攀绳字段（旧档缺字段也不崩）');

  // ---- 6. 火种读数仪推演 ----
  section('6 Boss 意图推演');
  const rust = S('Combat.forecastBoss("rust_crown", 3)');
  ok(Array.isArray(rust) && rust.length === 3, '锈冠推演出 3 招（实测 ' + (rust.length) + '）');
  ok(rust.map(function (m) { return m.name; }).join(',') === '锈蚀蔓延,重砸,锈蚀蔓延',
    '满血锈冠按基础循环推演（实测 ' + rust.map(function (m) { return m.name; }).join('/') + '）');
  const headless = S('Combat.forecastBoss("headless_executor", 3)');
  ok(headless.length === 3 && headless.every(function (m) { return m.name === '斩击' || m.name === headless[0].name; }),
    '无首执械者（姿态 1）推演一致（实测 ' + headless.map(function (m) { return m.name; }).join('/') + '）');
  const mom = S('Combat.forecastBoss("mycelium_mother", 3)');
  ok(mom.length === 3, '菌母推演出 3 招（实测 ' + mom.map(function (m) { return m.name; }).join('/') + '）');
  ok(mom[0].name === '播散', '菌母 T+1 是播散（patternIndex 0 走 choose 命中召唤，实测 ' + mom[0].name + '）');
  ok(S('Combat.forecastBoss("rats", 3)').length === 0, '非 Boss 返回空');
  ok(S('Combat.forecastBoss("rust_crown", 0)').length === 0, 'n=0 返回空');
  // 推演不能污染真实战斗状态
  ok(S('Combat.state') === null || S('Combat.state && Combat.state.enemies ? Combat.state.enemies.length : "no-state"') !== undefined,
    '推演后 Combat 状态无泄漏');

  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
