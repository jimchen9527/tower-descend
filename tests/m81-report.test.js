// M81 验证：R6 —— 战报文本（纯函数）+ 药水/攀绳等既有功能联跑冒烟。
//
// 运行：node tests/m81-report.test.js

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
  // ---- 1. 通关战报 ----
  section('1 通关战报');
  ok(S('Run.start("act1", 515151, "medic", 3); true') === true, '起局');
  ok(S('Run.state.battles = 42; Run.state.gold = 143; true') === true, '造战绩');
  const rep = S('Run.resultText()');
  ok(rep.indexOf('《竖井》下潜战报') === 0, '战报以标题开头');
  ok(rep.indexOf('医师') !== -1 && rep.indexOf('DL3') !== -1, '含角色与 DL（实测首两行：' + rep.split('\n')[1] + '）');
  ok(rep.indexOf('战斗 42 场') !== -1 && rep.indexOf('seed 515151') !== -1, '含场数与种子');
  ok(rep.indexOf('· 到底') !== -1, '满血视为到底');
  ok(rep.split('\n').length === 5, '恰好 5 行（实测 ' + rep.split('\n').length + '）');

  // ---- 2. 陨落战报 ----
  section('2 陨落战报');
  const repLose = S('Run.state.hp = 0; Run.resultText()');
  ok(repLose.indexOf('· 陨落') !== -1, '陨落标记正确');
  ok(repLose.indexOf('血 0/') !== -1, '血量下限夹到 0');

  // ---- 3. 每日挑战战报 ----
  section('3 每日战报');
  ok(S('(function(){Run.state.daily={date:"2026-10-24",modKey:"thick_spawn"};return true})()') === true, '挂每日修饰');
  const repD = S('Run.resultText()');
  ok(repD.indexOf('每日挑战 2026-10-24「浓密孢雾」') !== -1, '含日期与修饰词名');

  // ---- 4. 每局确定：同状态重出同文本 ----
  section('4 确定性');
  ok(S('Run.resultText()') === repD, '同状态两次生成一致');

  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
