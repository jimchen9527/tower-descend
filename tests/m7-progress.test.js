// M7 验证：等级进度（DL1–DL10）与存档。
// 只加载逻辑层，不加载任何 ui/ 文件 —— 存档逻辑必须能在 Node 里无 DOM 跑。
//
// 本文件的重点是两类**容易蒙混过去**的断言：
//   1. 快照里的卡是「活的」—— card.def 是对 CARDS 的引用，而 def.play 是函数，
//      JSON 会把函数丢掉。只比对 def.id 是查不出这个的，必须真的打出那张牌。
//   2. DL 系数只作用在**敌人**身上 —— 玩家卡牌走同一个伤害出口（rawDamage），
//      如果在那里统乘，玩家的牌会一起变强，而这一点从数值上看很难发现。
//
// 运行：node tests/m7-progress.test.js

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

// 内存版 storage。Progress 只认 getItem / setItem —— 所以「关掉浏览器再打开」
// 在这个测试里就是「不重建 store、只重新 init 一次 Progress」。
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

  // 「关掉浏览器再打开」＝ 存储没变，Progress 重新读一遍
  function reopen() { Progress.init(__store); }

  // 走最近的某类型节点（找不到就原地不动）
  function walkToType(type) {
    let guard = 0;
    while (Run.current().type !== type && guard++ < 40) {
      const edges = Run.current().edges;
      if (!edges.length) break;
      let next = null;
      for (let i = 0; i < edges.length; i++) {
        if (Run.node(edges[i]).type === type) { next = edges[i]; break; }
      }
      Run.moveTo(next || edges[0]);
      Run.settle('done', Run.state.hp);
    }
    return Run.current();
  }

  function hpFor(enemyId, depth, dlScale) {
    Combat.start(424242, { enemyId: enemyId, depth: depth, hp: 75, maxHp: 75, dlScale: dlScale });
    return Combat.state.enemies[0].maxHp;
  }

  // ==========================================================
  console.log('\n[1] 难度系数曲线（§3.1：1 + 0.15 × (DL − 1)）');

  Progress.init(__store);
  Progress.reset();

  const curve = [];
  for (let d = 1; d <= 10; d++) {
    Progress.setDl('digger', d);
    curve.push(Progress.difficulty('digger'));
  }
  assert(Math.abs(curve[0] - 1.0) < 1e-9, 'DL1 = 1.00（起始不吃加成）');
  assert(Math.abs(curve[9] - 2.35) < 1e-9, 'DL10 = 2.35');
  assert(Math.abs(curve[1] - 1.15) < 1e-9, 'DL2 = 1.15');
  assert(curve.every((v, i) => Math.abs(v - (1 + 0.15 * i)) < 1e-9),
    'DL1–DL10 逐级都对上公式（' + curve.map(v => v.toFixed(2)).join(' / ') + '）');
  assert(curve.every((v, i) => i === 0 || Math.abs((v - curve[i - 1]) - 0.15) < 1e-9),
    '严格线性：相邻两级差恒为 0.15');

  // ==========================================================
  console.log('\n[2] 等级升降与三角色独立');

  Progress.reset();
  assert(Progress.dl('digger') === 1, '新玩家掘者从 DL1 起步');
  assert(Progress.gainDl('digger') === true, 'gainDl 成功时返回 true');
  assert(Progress.dl('digger') === 2, '打通一次 → DL +1');

  Progress.setDl('digger', 10);
  assert(Progress.gainDl('digger') === false, '已满级时 gainDl 返回 false');
  assert(Progress.dl('digger') === 10, '满级后不再上涨');

  Progress.setDl('digger', 99);
  assert(Progress.dl('digger') === 10, 'setDl 超上限被夹到 10');
  Progress.setDl('digger', -5);
  assert(Progress.dl('digger') === 1, 'setDl 低于下限被夹到 1');

  Progress.reset();
  Progress.setDl('medic', 6);
  assert(Progress.dl('medic') === 6, '医师的等级能单独设定');
  assert(Progress.dl('digger') === 1 && Progress.dl('keeper') === 1,
    '医师涨到 6 不影响另外两个角色（三份进度独立）');

  // ==========================================================
  console.log('\n[3] 角色解锁链（§3.1：任一角色达到 DLn）');

  Progress.reset();
  assert(CHARACTERS.digger.unlockDl === 0, '数据层：掘者阈值 0');
  assert(CHARACTERS.medic.unlockDl === 2, '数据层：医师阈值 2');
  assert(CHARACTERS.keeper.unlockDl === 4, '数据层：引火者阈值 4');

  assert(Progress.isUnlocked('digger') === true, '掘者开局就可用');
  assert(Progress.isUnlocked('medic') === false, '医师初始锁着');
  assert(Progress.isUnlocked('keeper') === false, '引火者初始锁着');

  Progress.setDl('digger', 2);
  assert(Progress.isUnlocked('medic') === true, '掘者到 DL2 → 医师解锁');
  assert(Progress.isUnlocked('keeper') === false, 'DL2 还不够引火者');

  Progress.setDl('medic', 4);
  assert(Progress.isUnlocked('keeper') === true,
    '换另一个角色到 DL4 也能解锁引火者（证明是「任一角色」，不是只看当前角色）');
  assert(Progress.bestDl() === 4, 'bestDl 取三角色的最大值');

  // ==========================================================
  console.log('\n[4] 快照往返：状态逐字段一致');

  Progress.reset();
  Progress.init(__store);
  Run.start('act1', 20260923, 'digger');

  // 造点非初始状态，否则「一致」没什么说服力
  walkToType('monster');
  const entered = Object.keys(Run.state.map.nodes).filter(k => Run.state.map.nodes[k].enemyId);
  Run.settle('win', 58);
  Run.addGold(37);
  Run.addRelic(relicPool()[0]);
  Run.addCard(cardsByDl(1, 'digger')[0]);
  Run.addCard(cardsByDl(1, 'digger')[1]);
  const lastCard = Run.state.deck[Run.state.deck.length - 1];
  Run.upgradeCardById(lastCard.uid);
  Run.rand(); Run.rand();

  const before = {
    depth: Run.current().depth,
    hp: Run.state.hp,
    gold: Run.state.gold,
    battles: Run.state.battles,
    rngCount: Run.state.rngCount,
    relics: Run.state.relics.slice(),
    deck: Run.state.deck.map(c => c.def.id + (c.upgraded ? '+' : '')),
    enemyIds: entered.map(k => [k, Run.state.map.nodes[k].enemyId]),
  };

  const json = JSON.stringify(Run.toSnapshot());
  assert(json.length > 1000, '快照能被 JSON 序列化（' + (json.length / 1024).toFixed(1) + ' KB）');
  assert(Run.fromSnapshot(JSON.parse(json)) === true, '从 JSON 回来的快照能装回 Run');

  const s2 = Run.state;
  assert(s2.map.nodes[s2.currentId].depth === before.depth, '深度一致');
  assert(s2.hp === before.hp, '血量一致');
  assert(s2.gold === before.gold, '金币一致');
  assert(s2.battles === before.battles, '战斗场次一致');
  assert(s2.rngCount === before.rngCount, 'rngCount 一致（整局能继续复现）');
  assert(JSON.stringify(s2.relics) === JSON.stringify(before.relics), '遗物一致');
  assert(JSON.stringify(s2.deck.map(c => c.def.id + (c.upgraded ? '+' : ''))) ===
    JSON.stringify(before.deck), '卡组一致（含升级标记）');

  // ==========================================================
  console.log('\n[5] 重建出来的卡必须是「活的」');

  assert(s2.deck.length === before.deck.length, '卡组张数一致（' + s2.deck.length + ' 张）');
  assert(s2.deck.every(c => typeof c.def.play === 'function'),
    '每张卡的 def.play 都还是函数 —— 直接存卡对象的话这里会全是 undefined');

  // 真的打出一张，证明不是"看着像卡"
  const probe = s2.deck[0];
  const attackCard = s2.deck.find(c => c.def.type === 'attack') || probe;
  Combat.start(999, {
    charId: s2.charId, hp: s2.hp, maxHp: s2.maxHp, depth: 1,
    deck: s2.deck, enemyId: 'rats',
  });
  const cs = Combat.state;
  const enemyHpBefore = cs.enemies[0].hp;
  assert(s2.deck.every(c => c.def === CARDS[c.def.id]),
    '重建的卡 def 指回 CARDS 里的同一个对象（不是 JSON 出来的副本）');

  // 不靠抽牌运气：把整副牌直接摆到手上再打
  cs.hand = s2.deck.slice();
  cs.drawPile = [];
  cs.discardPile = [];
  cs.player.energy = 99;
  const playable = cs.hand.find(c => c.def.id === attackCard.def.id);
  Combat.playCard(playable.uid); // ⚠️ playCard 收的是 uid，不是手牌下标
  assert(cs.enemies[0].hp < enemyHpBefore,
    '读档后的卡真的能打出效果（' + playable.def.name + '：敌人 ' +
    enemyHpBefore + ' → ' + cs.enemies[0].hp + ' 血）');

  const upgradedProbe = s2.deck.filter(c => c.upgraded);
  assert(upgradedProbe.length === 1, '升级标记被完整带回（' + upgradedProbe.length + ' 张已升级）');
  assert(upgradedProbe[0].v && Object.keys(upgradedProbe[0].v).length > 0,
    '升级卡的数值 v 也带回来了（不是空对象）');

  // ==========================================================
  console.log('\n[6] 地图往返：节点上的 enemyId 不能丢');

  assert(Object.keys(s2.map.nodes).length === Object.keys(Run.state.map.nodes).length,
    '节点总数一致（' + Object.keys(s2.map.nodes).length + ' 个）');
  assert(s2.map.lanes === 4 && s2.map.depth === 33, 'lanes / depth 与当前规格一致（4 × 33）');
  assert(before.enemyIds.length > 0, '走过的战斗节点确实带了 enemyId（' + before.enemyIds.length + ' 个）');
  assert(before.enemyIds.every(pair => s2.map.nodes[pair[0]].enemyId === pair[1]),
    'enemyId 全部原样保留 —— 从 seed 重新生成地图会把它丢掉，重打就换怪了');

  // ==========================================================
  console.log('\n[7] 卡池按角色 DL 过滤');

  Progress.setDl('digger', 1);
  const d1 = rewardPool('digger', Progress.dl('digger'));
  Progress.setDl('digger', 2);
  const d2 = rewardPool('digger', Progress.dl('digger'));
  assert(d1.length === 3, '掘者 DL1 时奖励池 3 张（' + d1.map(k => CARDS[k].name).join('/') + '）');
  assert(d2.length === 10, '掘者 DL2 时奖励池 10 张（DL1 的 3 张 + DL2 的 7 张：M32 震波 + M33b 配重校准 + M64 重防轴 2 张）');
  assert(d1.every(k => (CARDS[k].dl || 0) <= 1), 'DL1 池里不含更高等级的卡');
  assert(d2.some(k => CARDS[k].dl === 2), 'DL2 池里出现了 dl=2 的卡');
  assert(rewardPool('digger').length === 40,
    '不传 maxDl = 不过滤（掘者非 basic 非 curse 共 40 张，M65 夯击 +1 后）');

  Progress.setDl('medic', 1);
  assert(rewardPool('medic', 1).every(k => (CARDS[k].dl || 0) <= 1), '医师 DL1 池同样被过滤');
  assert(rewardPool('medic', 1).length === 3, '医师 DL1 奖励池也是 3 张');

  // 真的从 Run 走一遍，确认**掉落池**的两条出口都传了 maxDl。
  // 口径（§17 第 25 条）：DL 过滤只管掉落池 —— 战斗奖励、商店货架；
  // 事件里的固定选卡不过滤，否则 §10 承诺的「3 张稀有卡」在 DL1–DL6 会抽到 0 张。
  Progress.setDl('digger', 1);
  Run.start('act1', 777, 'digger');
  let loot1 = [];
  for (let i = 0; i < 30; i++) loot1 = loot1.concat(Run.rollShop().cards.map(c => c.id));
  assert(loot1.every(k => (CARDS[k].dl || 0) <= 2), 'DL1 时商店货架出 dl≤2 的卡（掉落池下限抬到 DL2）');

  const reward1 = Run.rollBattleReward(Run.current()).cards;
  assert(reward1.every(k => (CARDS[k].dl || 0) <= 2), 'DL1 时战斗奖励出 dl≤2 的卡（掉落池下限抬到 DL2）');
  assert(reward1.length === 3, '战斗奖励仍给 3 张候选卡');

  // M16 回归：DL1 掉落池下限抬到 DL2 后，池子 3 → 6 张，抽 3 张不再固定。
  // 连续抽 30 轮，收集到的「3 张卡组合」必须不止 1 种 —— 旧版池 3 张时永远是同一种组合。
  const combos = {};
  for (let r = 0; r < 30; r++) {
    const c = Run.rollBattleReward(Run.current()).cards.slice().sort().join(',');
    combos[c] = true;
  }
  assert(Object.keys(combos).length > 1,
    'DL1 时战斗掉落有多组随机组合（实际 ' + Object.keys(combos).length + ' 种，旧版只有 1 种）');

  // 事件选卡：**不受 DL 限制** —— 稀有卡全是 dl7–10，一过滤就是空列表
  const rareAtDl1 = Run.rollCardIds(3, 'rare');
  assert(rareAtDl1.length === 3, 'DL1 时事件选卡仍能抽满 3 张（不被 DL 过滤）');
  assert(rareAtDl1.every(k => CARDS[k].rarity === 'rare'), '抽出来的确实是稀有卡');

  Progress.setDl('digger', 2);
  let loot2 = [];
  for (let j = 0; j < 30; j++) loot2 = loot2.concat(Run.rollShop().cards.map(c => c.id));
  assert(loot2.some(k => CARDS[k].dl === 2), 'DL2 时掉落池会出 dl=2 的卡');

  // M64 回归：announce 卡不吃掉落池下限的照顾 —— DL1 局虽然借用 DL2 的卡，
  // 但承重墙 / 带伤作业绝不出现；升到 DL2 才进池，收尾面板的「新卡入池」才是真话。
  Progress.setDl('digger', 1);
  Run.start('act1', 777, 'digger', 1);
  let strictLoot = [];
  for (let i = 0; i < 30; i++) strictLoot = strictLoot.concat(Run.rollBattleReward(Run.current()).cards);
  for (let i = 0; i < 20; i++) strictLoot = strictLoot.concat(Run.rollShop().cards.map(c => c.id));
  assert(strictLoot.length >= 100, '严格门样本非空（实际 ' + strictLoot.length + ' 张，防空集真空通过）');
  assert(strictLoot.every(k => !CARDS[k].announce),
    'DL1 掉落池不出 announce 新卡（承重墙 / 带伤作业深度 2 才解锁）');
  Progress.setDl('digger', 2);
  Run.start('act1', 777, 'digger', 2);
  let dl2Loot = [];
  for (let i = 0; i < 30; i++) dl2Loot = dl2Loot.concat(Run.rollBattleReward(Run.current()).cards);
  assert(dl2Loot.some(k => CARDS[k].announce), 'DL2 起两张新卡进掉落池');

  // ==========================================================
  console.log('\n[8] DL 系数作用在敌人 HP（含大 Boss）');

  const base = hpFor('rats', 1, 1);
  assert(hpFor('rats', 1, 2) === Math.max(1, Math.round(base * 2)),
    '小怪 HP 随系数线性放大（' + base + ' → ' + hpFor('rats', 1, 2) + '）');
  assert(hpFor('rats', 1, 2.35) === Math.max(1, Math.round(base * 2.35)),
    'DL10 系数 2.35 正确作用（→ ' + hpFor('rats', 1, 2.35) + '）');

  const deepOnly = hpFor('rats', 33, 1);
  assert(hpFor('rats', 33, 2) === Math.max(1, Math.round(base * 2.6 * 2)),
    '深压与 DL 是两层、相乘（D33 × DL2 = ' + hpFor('rats', 33, 2) + '）');
  assert(deepOnly === Math.max(1, Math.round(base * 2.6)), 'D33 单吃深压 = ×2.60');

  const boss1 = hpFor('rust_crown', 20, 1);
  assert(boss1 === 220, '锈冠不吃深压：D20 仍是 220 血');
  assert(hpFor('rust_crown', 20, 2) === Math.max(1, Math.round(boss1 * 2)),
    '但大 Boss 吃 DL 系数（220 → ' + hpFor('rust_crown', 20, 2) + '）');
  assert(hpFor('rust_crown', 33, 1) === boss1, '锈冠在 D33 也仍不吃深压');

  assert(hpFor('rats', 1, undefined) === base, '不传 dlScale 时与老行为完全一致');

  // ==========================================================
  console.log('\n[9] DL 系数作用在敌人伤害（玩家的牌不受影响）');

  Combat.start(424242, { enemyId: 'rats', depth: 1, hp: 75, maxHp: 75, dlScale: 3 });
  const s3 = Combat.state;
  assert(Combat.rawDamage(s3.enemies[0], s3.player, 10) === 30, '敌人 10 伤 × 系数 3 = 30');
  assert(Combat.rawDamage(s3.player, s3.enemies[0], 10) === 10,
    '玩家 10 伤不受系数影响（同一个出口，必须按 attacker 判断）');

  Combat.start(424242, { enemyId: 'rats', depth: 1, hp: 75, maxHp: 75 });
  assert(Combat.state.dlScale === 1, '不传 dlScale 时 state 里默认是 1');
  assert(Combat.rawDamage(Combat.state.enemies[0], Combat.state.player, 10) === 10,
    '不传 dlScale 时敌人伤害不变（零回归的根据）');

  // 虚弱 / 脆弱与 DL 的先后：乘在力量之后、减益之前
  Combat.start(424242, { enemyId: 'rats', depth: 1, hp: 75, maxHp: 75, dlScale: 2 });
  const s4 = Combat.state;
  Combat.addBuff(s4.enemies[0], 'weak', 1);
  assert(Combat.rawDamage(s4.enemies[0], s4.player, 10) === 15,
    '敌人 10 伤 × DL2(20) 再过虚弱 = 15');
  Combat.addBuff(s4.player, 'vulnerable', 1);
  assert(Combat.rawDamage(s4.enemies[0], s4.player, 10) === 22,
    '再过脆弱 = 22（20 × 0.75 × 1.5 向下取整）');

  // M89：意图是玩家做决策的唯一依据，必须与结算同源 —— 修复前这里会显示 10。
  s4.enemies[0].intent = { kind: 'attack', value: 10 };
  assert(Combat.intentDamage(s4.enemies[0]) === 22,
    '意图与实际同源：DL2 + 虚弱 + 脆弱 = 22（不是 10）');

  // ==========================================================
  console.log('\n[10] 坏档 / 版本不符 / storage 抛错都不能把游戏带崩');

  Progress.init(__store);
  Progress.reset();
  Progress.setDl('digger', 3);
  const good = __store.getItem('tower-descend/save');
  assert(good !== null, '先留一份正常存档做对照');

  const bads = [
    ['整块不是 JSON', 'not-json-at-all'],
    ['JSON 但不是对象', '"just a string"'],
    ['版本号对不上', '{"version":99,"chars":{"digger":{"dl":10}}}'],
    ['缺 chars 字段', '{"version":1}'],
    ['chars 是数组', '{"version":1,"chars":[]}'],
  ];
  bads.forEach(function (pair) {
    __store.setItem('tower-descend/save', pair[1]);
    Progress.init(__store);
    assert(Progress.dl('digger') === 1,
      '坏档[' + pair[0] + '] → 当成新玩家（DL1），不抛异常');
  });

  __store.setItem('tower-descend/save', good);
  Progress.init(__store);
  assert(Progress.dl('digger') === 3, '把好档放回去，进度原样回来（DL3）');

  // storage 整个不可用（隐私模式 / 配额满）
  const boom = {
    getItem: function () { throw new Error('storage disabled'); },
    setItem: function () { throw new Error('quota exceeded'); },
  };
  Progress.init(boom);
  Progress.gainDl('digger');
  assert(Progress.dl('digger') === 2, 'storage 抛错时进度仍能在内存里推进（1 → 2）');
  assert(Progress.loadRun('digger') === null, '此时读存档返回 null，而不是把异常抛给调用方');
  Progress.init(__store); // 回到可用存储，免得影响后面的断言

  // ==========================================================
  console.log('\n[11] 存 / 读 / 清：进行中的那一局');

  Progress.init(__store);
  Progress.reset();
  Run.start('act1', 31337, 'digger');
  Run.state.hp = 44;
  Progress.saveRun('digger', Run.toSnapshot());

  const raw = __store.getItem('tower-descend/save');
  assert(raw !== null, '存档真的落到了 storage 里');
  assert(raw.indexOf('31337') >= 0, '落盘内容里看得到这一局的种子');
  assert(raw.indexOf('"hp":44') >= 0, '也看得到当前血量');

  // 「关掉浏览器再打开」：内存里的 state 丢掉，只从 storage 重新读
  Run.state = null;
  Progress.init(__store);
  const snap = Progress.loadRun('digger');
  assert(!!snap, '重开后拿得到进行中的那一局');
  assert(Run.fromSnapshot(snap) === true, '快照装得回 Run');
  assert(Run.state.seed === 31337, '续上的是同一局（种子一致）');
  assert(Run.state.hp === 44, '血量也续上了');
  assert(Progress.loadRun('medic') === null, '另一个角色没有进行中的局（各存各的）');

  Progress.saveRun('medic', { actId: 'act1', seed: 555, charId: 'medic',
    currentId: Run.state.currentId, map: Run.state.map, deck: [] });
  assert(Progress.loadRun('medic').seed === 555 &&
    Progress.loadRun('digger').seed === 31337, '两个角色同时各存着一局，互不覆盖');

  Progress.clearRun('digger');
  assert(Progress.loadRun('digger') === null, '清档后读回 null（这局结束了）');
  assert(Progress.loadRun('medic').seed === 555, '清一个角色的档不影响另一个');

  assert(Run.fromSnapshot(null) === false, '空快照被拒');
  assert(Run.fromSnapshot({ map: Run.state.map, charId: 'digger' }) === false, '缺 currentId 被拒');
  assert(Run.fromSnapshot({ map: Run.state.map, charId: 'digger',
    currentId: Run.state.currentId, deck: [{ id: 'no_such_card' }] }) === false,
    '卡 id 已不存在时整档作废（不装出半坏的状态）');

  // ==================== §3.1 四条每级特殊调整（M31）====================

  // ① DL3 起中 Boss（精英）权重 +1
  Progress.reset();
  const mapsDl1 = [], mapsDl5 = [];
  for (let i = 0; i < 300; i++) mapsDl1.push(MapGen.generate('act1', 7000 + i * 13, 1));
  for (let i = 0; i < 300; i++) mapsDl5.push(MapGen.generate('act1', 7000 + i * 13, 5));
  function countElite(maps) {
    let n = 0;
    maps.forEach(function (m) {
      Object.keys(m.nodes).forEach(function (id) { if (m.nodes[id].type === 'elite') n++; });
    });
    return n;
  }
  const e1 = countElite(mapsDl1), e5 = countElite(mapsDl5);
  assert(mapsDl1[0].eliteBonus === 0 && mapsDl5[0].eliteBonus === 1,
    'DL1 不加精英权重、DL5 加（eliteBonus 随 DL 写入地图）');
  assert(e5 > e1, 'DL5 的精英总数多于 DL1（' + e1 + ' → ' + e5 + '，同 300 张图同种子）');
  assert(mapsDl1[0].dl === 1 && mapsDl5[0].dl === 5, '生成时的 DL 被记进地图（存档要带着）');
  // 不传 dl 的老调用点（M3–M6 测试）行为不变
  const oldMap = MapGen.generate('act1', 7000);
  assert(oldMap.eliteBonus === 0 && oldMap.dl === 1, '不传 dl 时按 DL1 处理（老调用点零改动）');

  // ② DL7 起事件的「惩罚选项占比提升」
  //    注意：rollEvent() 每次都会推进 RNG（this.pick），两次连调必抽到不同事件 ——
  //    所以不能用「同种子抽同一个事件」来对比。这里改为遍历抽到的事件，
  //    对每个事件分别比对「DL1 作者原排」与「DL7 处理后的选项列表」。
  //
  //    ⚠️ 本条的落地方式换过一次：最初实现成「把代价型排到最前」，实测对全部 8 个
  //    事件都是恒等操作（作者本来就把代价型写在 index 0）—— 零效果、等级白升。
  //    现实现是**从含代价型的事件里削掉 1 条非代价型选项**，下面按这个语义断言。
  Progress.reset();
  // M55 起 DL 冻结进本局 —— 改 DL 旋钮后必须重开一局才生效（特性本身）
  Run.start('act1', 12345, 'digger');

  function collectByDl(dl) {
    Progress.setDl('digger', dl);
    Run.start('act1', 12345, 'digger'); // 重开：让冻结的 DL 跟上旋钮
    const seen = {};
    for (let i = 0; i < 200; i++) {
      Run.state.eventsUsed = {}; // 每轮清空，保证池子始终是全量
      const ev = Run.rollEvent();
      if (!seen[ev.id]) seen[ev.id] = ev;
    }
    return seen;
  }
  const atDl1 = collectByDl(1);
  const atDl7 = collectByDl(7);
  const evIds = Object.keys(atDl1);
  assert(evIds.length >= 5, '遍历覆盖到的事件数足够（' + evIds.length + ' 个）');

  let riskyEvents = 0, shrunkEvents = 0, untouchedEvents = 0;
  evIds.forEach(function (id) {
    const a = atDl1[id], b = atDl7[id];
    const hadRisky = a.options.some(function (o) { return o.risky; });

    // 不增项：DL7 只削不加
    assert(b.options.length <= a.options.length,
      '事件 ' + id + ' 在 DL7 下选项只减不增');

    if (!hadRisky) {
      // 纯安全事件（carving）：不该被削弱 —— 削它不叫「惩罚占比提升」
      assert(b.options.length === a.options.length,
        '事件 ' + id + ' 无代价型选项，DL7 下不动它（实测 ' +
        a.options.length + ' → ' + b.options.length + ' 项）');
      untouchedEvents++;
      return;
    }
    riskyEvents++;

    // 有代价型：DL7 下必然少 1 条，且至少留 2 条
    assert(b.options.length === a.options.length - 1,
      '事件 ' + id + ' 在 DL7 下削掉 1 条选项（' +
      a.options.length + ' → ' + b.options.length + ' 项）');
    assert(b.options.length >= 2, '事件 ' + id + ' 削完至少留 2 条选项');
    shrunkEvents++;

    // 代价型选项一条都不能少（削的必须是安全那条）
    assert(a.options.filter(function (o) { return o.risky; }).length ===
      b.options.filter(function (o) { return o.risky; }).length,
      '事件 ' + id + ' 的代价型选项一条都没被削');
    // 剩下的选项必然是原选项的子集，且顺序不乱
    const aLabels = a.options.map(function (o) { return o.label; });
    const bLabels = b.options.map(function (o) { return o.label; });
    assert(JSON.stringify(bLabels.slice().sort()) ===
      JSON.stringify(aLabels.filter(function (l) { return bLabels.indexOf(l) >= 0; }).sort()),
      '事件 ' + id + ' 剩下的选项都是原有的（不换内容）');
    assert(bLabels.every(function (l, i) {
      return i === 0 || aLabels.indexOf(bLabels[i - 1]) < aLabels.indexOf(l);
    }), '事件 ' + id + ' 削项后仍保持作者原顺序');
    // 代价型被提到最前（归一化：原排已如此则不变）
    assert(b.options[0].risky === true,
      '事件 ' + id + ' 在 DL7 下第一个选项是代价型');
  });

  assert(riskyEvents >= 5, '带代价型选项的事件至少 5 个（实测 ' + riskyEvents + ' 个）');
  // 硬门槛：削项对**每一个**含代价型的事件都必须生效 —— 若有事件没被削，
  // 说明它的安全项既非零代价、又没被兜底规则捞到，DL7 对它就是零效果。
  assert(shrunkEvents === riskyEvents,
    'DL7 削项对全部含代价型的事件都生效（' + shrunkEvents + ' / ' + riskyEvents + ' 个）');
  assert(untouchedEvents >= 1, '至少 1 个纯安全事件在 DL7 下不动（实测 ' + untouchedEvents + ' 个）');

  // DL1 / DL6 边界：都不削（DL7 才是分界）
  const atDl6 = collectByDl(6);
  Object.keys(atDl6).forEach(function (id) {
    assert(atDl6[id].options.length === atDl1[id].options.length,
      '事件 ' + id + ' 在 DL6 下与 DL1 完全一致（DL7 才是分界）');
  });

  // ③ DL9 起休息点回血 −25%（30% → 23%）
  Progress.reset();
  Progress.setDl('digger', 8);
  Run.start('act1', 999, 'digger');
  const h8 = Run.restHealAmount();
  Progress.setDl('digger', 9);
  Run.start('act1', 999, 'digger'); // 重开：DL 冻结进本局
  const h9 = Run.restHealAmount();
  assert(h8 === Math.ceil(75 * 0.3), 'DL8 休息回血仍是 30%（' + h8 + '）');
  assert(h9 === Math.ceil(75 * 0.23), 'DL9 休息回血降到 23%（' + h9 + '，−25%）');
  assert(h9 < h8, 'DL9 回血确实变少（' + h8 + ' → ' + h9 + '）');

  // ④ DL10 开局带 1 张诅咒
  Progress.reset();
  Progress.setDl('digger', 9);
  const run9 = Run.start('act1', 555, 'digger');
  const deck9 = run9.deck.length;
  const curse9 = run9.deck.filter(function (c) { return c.def.id === 'cursed_lung'; }).length;
  Progress.setDl('digger', 10);
  const run10 = Run.start('act1', 555, 'digger');
  const deck10 = run10.deck.length;
  const curse10 = run10.deck.filter(function (c) { return c.def.id === 'cursed_lung'; }).length;
  assert(curse9 === 0, 'DL9 开局卡组里没有诅咒');
  assert(curse10 === 1, 'DL10 开局带 1 张诅咒（疫尘入肺）');
  assert(deck10 === deck9 + 1, 'DL10 卡组只多这一张（' + deck9 + ' → ' + deck10 + '）');
  assert(run10.deck[deck10 - 1].def.rarity === 'curse', '加进去的是货真价实的诅咒卡');

  return { pass: pass, fail: fail };
}

const r = vm.runInContext('(' + suite.toString() + ')()', sandbox);
console.log('\n' + r.pass + ' 通过 / ' + r.fail + ' 失败');
