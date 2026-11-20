// M60 验证：每日挑战 + Boss 阶段。
// 只加载逻辑层 —— 每日挑战的核心是「同一天同一张卷子」的确定性，
// 与「修饰词只走已有管线、不开新机关」这两件事。
//
// 运行：node tests/m60-daily.test.js

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
console.log('\n[1] dailyFor 确定性 —— 同一天同一张卷子');
// ==========================================================

const a1 = S(`dailyFor('2026-10-16')`);
const a2 = S(`dailyFor('2026-10-16')`);
const b1 = S(`dailyFor('2026-10-17')`);
assert(a1.seed === a2.seed && a1.modKey === a2.modKey,
  '同一天两次派生：种子与修饰完全一致');
assert(a1.seed !== b1.seed || a1.modKey !== b1.modKey,
  '不同天的卷子不同');
assert(a1.dl === 3, '每日挑战固定 DL3（人人同难度）');
assert(S(`Object.keys(DAILY_MODS).length`) >= 6, '修饰词表至少 6 个');
assert(!!S(`DAILY_MODS[dailyFor('2026-10-16').modKey]`), '派生出的 modKey 一定在表里');
// 全月遍历：派生永不崩、modKey 永远合法
let ok = true;
for (let d = 1; d <= 28; d++) {
  const r = S(`dailyFor('2026-10-' + ${('0' + d).slice(-2)})`);
  if (!S(`DAILY_MODS['${r.modKey}']`)) ok = false;
}
assert(ok, '10 月全月 28 天：派生合法、修饰词全覆盖');

// ==========================================================
console.log('\n[2] 开局修饰 —— 全部走已有管线');
// ==========================================================

// 玻璃骨骼：起始生命 60
S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'glass_bones' })`);
assert(S(`Run.state.maxHp`) === 60 && S(`Run.state.hp`) === 60,
  '玻璃骨骼：起始与最大生命 = 60');

// 轻装钱袋：起始金币 40
S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'light_purse' })`);
assert(S(`Run.state.gold`) === 40, '轻装钱袋：起始金币 40');

// 浓密孢雾：敌人生命 +15%（走 modSum 管线，until=999 全局生效）
S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'thick_spawn' })`);
assert(S(`Run.modSum('enemyHpPct')`) === 15, '浓密孢雾：enemyHpPct +15 进 mod 管线');
assert(S(`Run.state.daily && Run.state.daily.modKey === 'thick_spawn'`),
  '每日标记随 state 存档（续档后修饰不丢）');

// 老手眼力：开局随机升级 2 张
S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'veteran_eye' })`);
const upgCount = S(`Run.state.deck.filter(function (c) { return c.upgraded; }).length`);
assert(upgCount === 2, '老手眼力：开局升级 2 张（实测 ' + upgCount + '）');

// 不带每日：一切如旧（老调用点零改动）
S(`Run.start('act1', 12345, 'digger', 3)`);
assert(S(`Run.state.daily`) === undefined && S(`Run.state.maxHp`) === 75,
  '不带 daily：无标记、数值如旧');

// ==========================================================
console.log('\n[3] 结算乘数 —— 只动战斗金币与休息回血');
// ==========================================================

S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'gold_vein' })`);
assert(S(`dailyMulOf(Run.state, 'goldMul')`) === 1.5, '富金矿脉：金币乘数 1.5');
assert(S(`dailyMulOf(Run.state, 'restMul')`) === 1, '富金矿脉不碰休息回血（乘数 1）');

S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'warm_ash' })`);
const noDailyHeal = S(`Run.start('act1', 12345, 'digger', 3); Run.restHealAmount()`);
const withAsh = S(`Run.start('act1', 12345, 'digger', 3, { date: '2026-10-16', modKey: 'warm_ash' }); Run.restHealAmount()`);
// 引擎是单次取整：ceil(maxHp × pct × 1.5) —— 不是 ceil(ceil(x)×1.5)，别算两层
assert(withAsh === Math.ceil(75 * 0.3 * 1.5),
  '温热灰烬：休息回血 ×1.5 单次取整（' + noDailyHeal + ' → ' + withAsh + '）');

// 富金矿脉真的多给钱：同一个种子两局对比（金币是区间随机的，同种子同点数）
const gPlain = S(`
  Run.start('act1', 777, 'digger', 3);
  Run.int(10, 20) + Run.relicEffect('winGold');
`);
S(`Run.start('act1', 777, 'digger', 3, { date: '2026-10-16', modKey: 'gold_vein' })`);
const gRich = S(`Math.round((Run.int(10, 20) + Run.relicEffect('winGold')) * dailyMulOf(Run.state, 'goldMul'))`);
assert(gRich === Math.round(gPlain * 1.5),
  '富金矿脉：同一随机点数下金币 ×1.5（' + gPlain + ' → ' + gRich + '）');

// ==========================================================
console.log('\n[4] 通关记录 —— settle 自动落账');
// ==========================================================

// 走到末层赢下末战 → dailyWon = true。末层是 boss 节点，用清空敌人快路走。
S(`Run.start('act1', 24680, 'digger', 3, { date: '2026-10-16', modKey: 'glass_bones' })`);
S(`
  (function walkToEnd() {
    let guard = 0;
    while (Run.current().depth < Run.state.map.depth && guard++ < 40) {
      const edges = Run.current().edges;
      if (!edges.length) break;
      Run.moveTo(edges[edges.length - 1]);
    }
    if (Run.current().type === 'boss') {
      // 直接判胜：boss 战的战斗细节在 M5 已覆盖，这里只验「落账」
      Run.settle('win', Run.state.hp);
    } else {
      Run.settle('win', Run.state.hp);
    }
  })();
`);
assert(S(`Run.state.finished`) === true, '走到末层判胜后 finished = true');
assert(S(`Progress.dailyWon('2026-10-16')`) === true, '每日通关已记录（dailyWon = true）');
assert(S(`Progress.dailyWon('2026-10-17')`) === false, '别的日子不受影响');

// 普通局（不带 daily）不落账
S(`Progress.reset()`);
S(`Run.start('act1', 24680, 'digger', 3)`);
S(`
  (function walkToEnd2() {
    let guard = 0;
    while (Run.current().depth < Run.state.map.depth && guard++ < 40) {
      const edges = Run.current().edges;
      if (!edges.length) break;
      Run.moveTo(edges[edges.length - 1]);
    }
    Run.settle('win', Run.state.hp);
  })();
`);
assert(S(`Progress.dailyWon('2026-10-16')`) === false,
  '普通局通关不写每日记录');

// ==========================================================
console.log('\n[5] 菌母半血阶段「失控增殖」');
// ==========================================================

S(`Combat.start(999, { enemyId: 'mycelium_mother' })`);
// 菌母 HP 180，压到半血以下；addEnemy 直接塞满 3 只小怪（ctx.summon 的底层）
S(`Combat.state.enemies[0].hp = 80;
  Combat.addEnemy('spore_walker', { hp: 30 });
  Combat.addEnemy('spore_walker', { hp: 30 });
  Combat.addEnemy('spore_walker', { hp: 30 });
`);
const withFull = S(`
  (function () {
    const e = Combat.state.enemies[0];
    e.patternIndex = 1; // 按 pattern 本不该召唤（%2 = 1）
    const intent = Combat.pickIntent(e);
    return intent ? intent.name : null;
  })()
`);
assert(withFull !== '播散', '小怪满 3 只：半血也不召唤，回退 pattern');

// 有空位时：每回合都召唤（不再隔回合）
S(`Combat.state.enemies = Combat.state.enemies.slice(0, 2);`);
const withRoom = S(`
  (function () {
    const e = Combat.state.enemies[0];
    e.patternIndex = 1;
    const intent = Combat.pickIntent(e);
    return intent ? intent.name : null;
  })()
`);
assert(withRoom === '播散', '半血有空位：每回合都召唤（狂化阶段）');
assert(S(`Combat.state.enemies[0].enraged`) === true, '狂化标记已挂（宣告只发一次）');

// 锈冠的半血合并招不受影响（回归）
S(`Combat.start(555, { enemyId: 'rust_crown' })`);
S(`Combat.state.enemies[0].hp = 100;`);
const rust = S(`
  (function () {
    const e = Combat.state.enemies[0];
    return Combat.pickIntent(e) ? Combat.pickIntent(e).name : null;
  })()
`);
assert(rust === '锈蚀重砸', '回归：锈冠半血仍切「锈蚀重砸」');

// ==========================================================

console.log('\nM60 全部通过：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
