// M55 验证：主菜单的开局自选难度刻痕（DL 覆盖）。
// 只加载逻辑层，不加载任何 ui/ 文件 —— Run 的 DL 冻结必须在 Node 里无 DOM 跑。
//
// 防呆自检（本套件的三条底线）：
//   1. 所有「对集合的全称断言」前先断言集合非空 —— 空集会让全称断言真空成立；
//   2. 断言的期望值与实测值必须自洽（恒为 0 的断言不会体现在失败计数里）；
//   3. 每段测试都真跑到了末尾（尾部断言 passTotal 才算跑完）。
//
// 运行：node tests/m55-menu.test.js

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

function suite() {
  let pass = 0;
  let fail = 0;

  function assert(cond, label) {
    if (cond) {
      pass++;
      console.log('  [ok]   ' + label);
    } else {
      fail++;
      console.log('  [FAIL] ' + label);
    }
  }

  function reopen() { Progress.init(__store); }

  // ==========================================================
  console.log('\n[1] Run.start 的 DL 覆盖（dlWanted 第 4 参）');

  Progress.init(__store);
  Progress.reset();
  Progress.setDl('digger', 5);

  // 不传 = 沿用角色刻痕（老调用点零改动）
  const r0 = Run.start('act1', 777, 'digger');
  assert(r0.dl === 5, '不传 dlWanted → 冻结角色当前刻痕 DL5（实测 ' + r0.dl + '）');
  assert(r0.map && Object.keys(r0.map.nodes).length > 0, '地图正常生成（节点数 ' +
    Object.keys(r0.map.nodes).length + ' > 0）');

  // 自选低难度：冻进 state，curDl 读它
  const r2 = Run.start('act1', 777, 'digger', 2);
  assert(r2.dl === 2, '自选 DL2（角色已是 DL5）→ state.dl = 2（实测 ' + r2.dl + '）');
  assert(Run.curDl() === 2, 'curDl() 读冻结值 = 2（实测 ' + Run.curDl() + '）');

  // 非法值一律退回角色刻痕
  [0, -3, 11, 99, NaN, undefined].forEach(function (bad) {
    const r = Run.start('act1', 777, 'digger', bad);
    assert(r.dl === 5, 'dlWanted=' + bad + '（非法）→ 退回 DL5（实测 ' + r.dl + '）');
  });

  // Run 层不拦高选（UI 负责限制 ≤ 当前刻痕）：层契约就是「1–10 内照冻」
  const r7 = Run.start('act1', 777, 'digger', 7);
  assert(r7.dl === 7, 'dlWanted=7 > 角色刻痕 → Run 层照冻（UI 负责拦，实测 ' + r7.dl + '）');

  // ==========================================================
  console.log('\n[2] curDl() 的兜底链');

  // 老快照没有 dl 字段 → 退回角色刻痕，行为与 M55 前一致
  const rs = Run.start('act1', 777, 'digger', 2);
  const snap = Run.toSnapshot();
  assert(snap.dl === 2, '快照带上本局冻结的 DL2（实测 ' + snap.dl + '）');
  delete snap.dl;
  assert(Run.fromSnapshot(snap) === true, '删掉 dl 的老快照能装回（向后兼容）');
  assert(Run.curDl() === 5, '老快照 curDl() 退回角色刻痕 DL5（实测 ' + Run.curDl() + '）');

  // 完整往返：dl 不丢
  const rs2 = Run.start('act1', 777, 'digger', 3);
  assert(Run.fromSnapshot(JSON.parse(JSON.stringify(Run.toSnapshot()))) === true, 'JSON 往返装回');
  assert(Run.curDl() === 3, 'JSON 往返后 curDl() 仍是冻结的 DL3（实测 ' + Run.curDl() + '）');

  // ==========================================================
  console.log('\n[3] 本局机制全部跟随所选 DL');

  // 掉落池上限（dlCap = max(2, curDl)）
  const rA = Run.start('act1', 777, 'digger', 2);
  const capA = Run.dlCap();
  assert(capA === 2, 'DL2 局的掉落池上限 = 2（实测 ' + capA + '）');
  const poolA = rewardPool('digger', capA);
  assert(poolA.length > 0, 'DL2 掉落池非空（' + poolA.length + ' 张）');
  assert(poolA.every(function (k) { return (CARDS[k].dl || 0) <= 2; }),
    '池内每张卡 dl ≤ 2（全称断言，池非空才成立）');

  const rB = Run.start('act1', 777, 'digger', 7);
  assert(Run.dlCap() === 7, 'DL7 局的掉落池上限 = 7（实测 ' + Run.dlCap() + '）');

  // 休息回血（§3.1 第 3 条：DL9 起 −25%）
  const rC = Run.start('act1', 777, 'digger', 1);
  assert(Run.restHealAmount() === Math.ceil(75 * 0.3),
    'DL1 局休息回血 30% = ' + Math.ceil(75 * 0.3) + '（实测 ' + Run.restHealAmount() + '）');
  const rD = Run.start('act1', 777, 'digger', 9);
  assert(Run.restHealAmount() === Math.ceil(75 * 0.23),
    'DL9 局休息回血 23% = ' + Math.ceil(75 * 0.23) + '（实测 ' + Run.restHealAmount() + '）');

  // DL10 诅咒开局跟随所选档：自选 DL10 才有，自选 DL9 没有
  const rE = Run.start('act1', 777, 'digger', 10);
  assert(rE.deck.some(function (c) { return c.def.id === 'cursed_lung'; }),
    '自选 DL10 → 开局带诅咒');
  const rF = Run.start('act1', 777, 'digger', 9);
  assert(!rF.deck.some(function (c) { return c.def.id === 'cursed_lung'; }),
    '自选 DL9 → 开局不带诅咒（角色刻痕 5 也一样，诅咒只看本局 DL）');

  // ==========================================================
  console.log('\n[4] 存档与续局');

  Progress.setDl('digger', 5);
  Run.start('act1', 777, 'digger', 2);
  Run.moveTo(Run.current().edges[0]);
  Run.settle('win', 60);
  Progress.saveRun('digger', Run.toSnapshot());
  reopen(); // 「关掉浏览器再打开」

  const loaded = Progress.loadRun('digger');
  assert(loaded && loaded.dl === 2, '存档里的冻结 DL2 落盘（实测 ' + (loaded && loaded.dl) + '）');
  assert(Run.fromSnapshot(loaded) === true && Run.curDl() === 2,
    '续局后 curDl() 仍是所选的 DL2（实测 ' + Run.curDl() + '）');

  // 三个角色互不串档：医师的冻结 DL 与掘者无关
  Progress.setDl('medic', 4);
  const rM = Run.start('act1', 777, 'medic', 1);
  assert(rM.dl === 1 && Run.curDl() === 1,
    '医师自选 DL1 → curDl()=1（实测 ' + rM.dl + ' / ' + Run.curDl() + '）');

  // 收尾哨兵：这一段不跑到，前面的 pass/fail 都是假象
  assert(pass > 0, '测试真实执行（通过 ' + pass + ' 条）');

  return { pass: pass, fail: fail };
}

const r = vm.runInContext('(' + suite.toString() + ')()', sandbox);
console.log('\n' + r.pass + ' 通过 / ' + r.fail + ' 失败');
process.exit(r.fail ? 1 : 0);
