// M4 节点验证：事件 / 商店 / 休息 / 宝箱 / 战斗奖励 + 遗物、卡组、临时修正。
// 只加载逻辑层（含 combat.js 与 run.js），不加载任何 render-*.js。
//
// 这一层验的是"数值与规则"：事件给的东西有没有真的进卡组、临时修正有没有在
// 正确的层数失效、商店扣钱对不对、遗物在战斗里有没有真的生效。
// UI 只负责把这些显示出来，另由 ui-probe-node.js 验证。
//
// 运行：node tests/m4-nodes.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

const sandbox = { console: console };
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

  function newRun(seed) {
    return Run.start('act1', seed === undefined ? 20260924 : seed);
  }

  // 直接跳到某一层（测试专用，绕过 canMoveTo）
  function goDepth(d) {
    Run.state.currentId = Run.state.map.layers[d - 1][0].id;
  }

  // ==========================================================
  console.log('\n[1] 开局状态与资源');
  newRun();
  const S = Run.state;
  assert(S.hp === 75 && S.maxHp === 75, '起始生命 75（§14）');
  assert(S.gold === 99, '起始金币 99（§14）');
  assert(S.deck.length === 10, '起始卡组 10 张');
  assert(S.relics.length === 0 && S.mods.length === 0, '开局没有遗物、没有临时修正');

  Run.loseHp(30);
  assert(S.hp === 45, 'loseHp 扣血正确');
  Run.heal(100);
  assert(S.hp === 75, 'heal 不会超过最大生命');
  Run.loseHp(9999);
  assert(S.hp === 1, '事件造成的生命流失保底留 1 点（不会当场判死）');

  newRun();
  Run.raiseMaxHp(5);
  assert(Run.state.maxHp === 80 && Run.state.hp === 80, '提升最大生命会同步补当前生命');
  Run.lowerMaxHp(50);
  assert(Run.state.maxHp === 30 && Run.state.hp === 30, '降低最大生命会把当前生命压到上限内');

  assert(Run.spendGold(50) === true && Run.state.gold === 49, '金币够时能花出去');
  assert(Run.spendGold(999) === false && Run.state.gold === 49, '金币不够时花不出去，也不扣钱');

  // ==========================================================
  console.log('\n[2] 卡组增删改');
  newRun();
  const added = Run.addCard('bottom_hammer');
  assert(Run.state.deck.length === 11, '加卡后卡组 11 张');
  assert(Run.state.deck[10].def.id === 'bottom_hammer', '加进去的是指定的那张卡');

  assert(Run.upgradeCardById(added.uid) === true, '升级卡成功');
  assert(added.upgraded === true && added.v.dmg === 32, '升级后数值换成 upV（26 → 32）');
  assert(Run.upgradeCardById(added.uid) === false, '同一张卡不能升级两次');

  const removed = Run.removeCard(added.uid);
  assert(removed !== null && Run.state.deck.length === 10, '移除卡成功');
  assert(Run.removeCard(999999) === null, '移除不存在的 uid 返回 null');
  assert(Run.upgradableCards().length === 10, '起始 10 张都可升级');

  // 诅咒卡：能进卡组，但不可升级
  const curse = Run.addCard('cursed_lung');
  assert(curse.def.unplayable === true, '诅咒卡标了 unplayable');
  assert(Run.upgradeCardById(curse.uid) === false, '诅咒卡不能被升级');

  // ==========================================================
  console.log('\n[3] 本局随机可复现');
  Run.start('act1', 777);
  const seqA = [Run.rand(), Run.rand(), Run.rand()];
  Run.start('act1', 777);
  const seqB = [Run.rand(), Run.rand(), Run.rand()];
  assert(JSON.stringify(seqA) === JSON.stringify(seqB), '同种子下的 rand 序列一致');

  Run.start('act1', 888);
  const evA = [Run.rollEvent().id, Run.rollEvent().id, Run.rollEvent().id];
  Run.start('act1', 888);
  const evB = [Run.rollEvent().id, Run.rollEvent().id, Run.rollEvent().id];
  assert(JSON.stringify(evA) === JSON.stringify(evB), '同种子抽出的事件序列一致');
  assert(evA[0] !== evA[1] && evA[1] !== evA[2] && evA[0] !== evA[2], '同一局内事件不重复');

  // 抽满整个池子后允许重复，但不能返回空
  Run.start('act1', 999);
  const drained = [];
  for (let i = 0; i < Object.keys(EVENTS).length + 3; i++) {
    const e = Run.rollEvent();
    if (e) drained.push(e.id);
  }
  assert(drained.length === Object.keys(EVENTS).length + 3, '池子耗尽后仍能给出事件（不会开天窗）');

  // ==========================================================
  console.log('\n[4] 奖励池抽取');
  newRun();
  const three = Run.rollCardIds(3);
  assert(three.length === 3, '一次抽 3 张');
  assert(new Set(three).size === 3, '同一次三选一里不重复');
  assert(
    three.every((id) => CARDS[id].rarity !== 'basic' && CARDS[id].rarity !== 'curse'),
    '不会抽出基础卡或诅咒卡'
  );

  const rares = Run.rollCardIds(3, 'rare');
  assert(rares.length === 3 && rares.every((id) => CARDS[id].rarity === 'rare'), '指定稀有度抽卡生效');
  assert(Run.pickOneCard('common') !== null, '抽单张普通卡正常');

  // 权重：稀有卡在池里占比不低，但被抽到的比例明显更低
  newRun(4242);
  const tally = { common: 0, uncommon: 0, rare: 0 };
  const N = 3000;
  for (let i = 0; i < N; i++) tally[CARDS[Run.rollCardIds(1)[0]].rarity]++;
  const poolCount = { common: 0, uncommon: 0, rare: 0 };
  rewardPool().forEach((k) => poolCount[CARDS[k].rarity]++);
  const drawRare = tally.rare / N;
  const poolRare = poolCount.rare / rewardPool().length;
  console.log('         稀有卡：池中占比 ' + (poolRare * 100).toFixed(1) +
              '%，抽到占比 ' + (drawRare * 100).toFixed(1) + '%');
  assert(drawRare > 0.02 && drawRare < 0.25, '稀有卡出现率在合理区间（权重生效）');
  assert(tally.common + tally.uncommon + tally.rare === N, '抽卡结果分布完整');

  // ==========================================================
  console.log('\n[5] 事件：结构 + 全选项可执行');
  const evIds = Object.keys(EVENTS);
  assert(evIds.length >= 8, '事件池 ≥8 个（§10 要求 8–12，实际 ' + evIds.length + '）');

  let shapeErr = null;
  evIds.forEach(function (id) {
    const e = EVENTS[id];
    if (!e.id || e.id !== id || !e.name || !e.text) shapeErr = id + ' 缺字段';
    if (!e.options || e.options.length < 2) shapeErr = id + ' 选项少于 2 个';
    e.options.forEach(function (o) {
      if (!o.label || !o.hint || typeof o.run !== 'function') {
        shapeErr = id + ' / ' + (o.label || '?') + ' 选项不合法';
      }
    });
  });
  assert(shapeErr === null, '每个事件都有 id / name / text 和 ≥2 个带 run 的选项' +
    (shapeErr ? ' — ' + shapeErr : ''));

  // 每个选项都要能在"只剩 5 血"的最坏情况下跑通，且不能把玩家弄死
  let optErr = null;
  evIds.forEach(function (id) {
    EVENTS[id].options.forEach(function (o, oi) {
      newRun(5000 + oi);
      Run.loseHp(70); // 只剩 5 血
      let out;
      try {
        out = o.run(Run.eventCtx());
      } catch (e) {
        optErr = id + ' / ' + o.label + '：' + e.message;
        return;
      }
      if (typeof out === 'string') {
        if (!out) optErr = id + ' / ' + o.label + '：结果文本为空';
      } else if (!out || !out.text) {
        optErr = id + ' / ' + o.label + '：返回了非法的后续结构';
      }
      if (Run.state.hp <= 0) optErr = id + ' / ' + o.label + '：把玩家打死了';
      if (Run.state.maxHp <= 0) optErr = id + ' / ' + o.label + '：最大生命被扣到 0';
    });
  });
  assert(optErr === null, '所有选项在最坏血量下都能跑通且不会致死' + (optErr ? ' — ' + optErr : ''));

  // ---- §10 三个样例的具体数值 ----
  newRun();
  EVENTS.seepage.options[0].run(Run.eventCtx()); // 喝一口
  assert(Run.state.hp === 75, '喝一口：满血时回复量被上限吃掉');
  Run.loseHp(30);
  EVENTS.seepage.options[0].run(Run.eventCtx());
  assert(Run.state.hp === 60, '喝一口：回复 15 生命');
  assert(Run.state.deck.some((c) => c.def.id === 'cursed_lung'), '喝一口：诅咒卡真的进了卡组');

  newRun();
  Run.state.gold = 10;
  const poor = EVENTS.faceless_trader.options[0].run(Run.eventCtx());
  assert(typeof poor === 'string' && Run.state.gold === 10, '无面商贩：钱不够时不扣钱也不给卡');

  Run.state.gold = 99;
  const paid = EVENTS.faceless_trader.options[0].run(Run.eventCtx());
  assert(Run.state.gold === 39, '无面商贩：买卡扣 60 金币');
  assert(paid.pick && paid.pick.mode === 'add' && paid.pick.rarity === 'rare',
    '无面商贩：买卡后要玩家从 3 张稀有卡里选 1');

  newRun();
  EVENTS.faceless_trader.options[1].run(Run.eventCtx()); // 换血
  assert(Run.state.hp === 60 && Run.state.deck.length === 9, '无面商贩：换血 −15 生命、卡组少 1 张');

  // ---- 临时修正按层数过期（§10 值班日志「留一盏灯」）----
  newRun();
  EVENTS.duty_log.options[2].run(Run.eventCtx());
  assert(Run.modSum('enemyHpPct') === -10, '留一盏灯：小怪生命 −10% 立刻生效');
  goDepth(4);
  assert(Run.modSum('enemyHpPct') === -10, '第 4 层时修正仍有效（往下三层）');
  goDepth(5);
  assert(Run.modSum('enemyHpPct') === 0, '第 5 层时修正已过期');

  // ---- 随机分支不空转：至少有一个种子能拿到渗水层的遗物 ----
  let gotRelic = 0;
  for (let i = 0; i < 40; i++) {
    newRun(7000 + i);
    EVENTS.seepage.options[1].run(Run.eventCtx());
    if (Run.hasRelic('alloy_compass')) gotRelic++;
  }
  assert(gotRelic > 0 && gotRelic < 40, '渗水层打捞：50% 分支两边都能走到（' + gotRelic + '/40）');

  // ==========================================================
  console.log('\n[6] 遗物');
  assert(relicPool().length === 24, '可掉落遗物 24 个（M78：攀绳/读数仪解禁后全量入池）');
  const notReady = Object.keys(RELICS).filter((id) => !RELICS[id].ready);
  assert(notReady.every((id) => RELICS[id].pending), '未实装的遗物都标了 pending，说明等哪个里程碑');

  newRun();
  assert(Run.addRelic('alloy_compass') === true, '首次获得遗物成功');
  assert(Run.addRelic('alloy_compass') === false, '同一遗物不会重复获得');
  assert(Run.addRelic('not_a_relic') === false, '不存在的遗物 id 不会被塞进来');
  assert(Run.relicEffect('battleStartDraw') === 1, 'relicEffect 能读出效果值');

  newRun();
  Run.addRelic('shaft_shard');
  const hpBefore = Run.state.maxHp;
  Run.moveTo(Run.current().edges[0]);
  assert(Run.state.maxHp === hpBefore + 1, '井壁碎片：深入 1 层最大生命 +1');
  assert(Run.state.hp === Run.state.maxHp, '新加的生命同时补进当前血量');

  newRun();
  relicPool().forEach((id) => Run.addRelic(id));
  assert(Run.grantRandomRelic() === null, '遗物全拿到后不再产出');

  // ---- M58 P1 扩容的 6 个新效果键 ----
  // startBlock：战斗开始先手格挡（黄铜齿轮 4）
  Combat.start(777, { deck: Run.state.deck, relics: ['brass_gear'] });
  assert(Combat.state.player.block === 4, '黄铜齿轮：战斗开始获得 4 格挡');
  // 挂在「获得时」的 gainMaxHp 不该影响战斗内数值（这里是独立 start，maxHp 来自传参）
  Combat.start(777, { hp: 30, maxHp: 30, deck: Run.state.deck, relics: ['brass_gear', 'wide_belt'] });
  assert(Combat.state.player.maxHp === 30, 'startBlock / handSize 遗物不改战斗 maxHp');

  // handSize：手牌上限 5→6（宽背带），且与罗盘叠加时首回合 = 5+1+1 = 7
  Combat.start(777, { deck: Run.state.deck, relics: ['wide_belt'] });
  assert(Combat.state.hand.length === 6, '宽背带：每回合手牌上限 6');
  Combat.start(777, { deck: Run.state.deck, relics: ['wide_belt', 'alloy_compass'] });
  assert(Combat.state.hand.length === 7, '宽背带 + 锈蚀罗盘：首回合手牌 7（5+1+1）');

  // gainMaxHp：获得时一次性 +8 并连带回血（raiseMaxHp 同步加当前血量）
  newRun();
  const mh = Run.state.maxHp;
  const hp0 = Run.state.hp;
  Run.addRelic('leather_strap');
  assert(Run.state.maxHp === mh + 8, '皮质绑带：获得时最大生命 +8');
  assert(Run.state.hp === Math.min(mh + 8, hp0 + 8), '绑带加的 8 点同时补进当前血量');

  // winGold / winHeal：战斗胜利结算
  newRun();
  Run.addRelic('old_lamp');
  Run.addRelic('wax_seal');
  Run.state.hp = 40; // 留出血量空间
  const g0 = Run.state.gold;
  const rw2 = Run.rollBattleReward(ENEMIES.rats);
  assert(Run.state.gold === g0 + rw2.gold && rw2.gold >= 16, '老油灯：胜利金币 = 击杀 +6（并进展示值）');
  assert(Run.state.hp === 43, '火漆印：胜利回 3 血');

  // shopDiscount：只折物品价，删牌服务不折
  newRun();
  Run.addRelic('ledger_page');
  const sh2 = Run.rollShop();
  assert(sh2.relics.every((it) => it.price >= 98 && it.price <= 140), '账目残页：遗物价 140–200 打七折');
  assert(sh2.removePrice === 75, '账目残页：删牌服务不折扣');
  newRun();
  Run.addRelic('chalk_mark');
  Run.addRelic('ledger_page');
  const sh3 = Run.rollShop();
  assert(sh3.relics.every((it) => it.price >= 77 && it.price <= 110),
    '两件折扣遗物叠加（15%+30%=45%）：遗物价落在 140–200 × 0.55');

  // ==========================================================
  console.log('\n[7] 战斗接入：本局卡组 / 遗物 / 临时修正');
  newRun();
  Run.addCard('cursed_lung');
  const orderBefore = Run.state.deck.map((c) => c.def.id).join(',');

  Combat.start(12345, { hp: Run.state.hp, maxHp: Run.state.maxHp, depth: 1, deck: Run.state.deck });
  assert(Combat.state.hand.length + Combat.state.drawPile.length === 11, '战斗拿到本局的 11 张卡');

  for (let i = 0; i < 5; i++) Combat.endTurn();
  assert(Run.state.deck.map((c) => c.def.id).join(',') === orderBefore,
    '打了几回合后本局卡组顺序没变（战斗拿的是副本）');
  assert(Run.state.deck.length === 11, '战斗不会改到本局卡组的张数');

  // 锈蚀罗盘：首回合多抽 1 张
  Combat.start(999, { deck: Run.state.deck, relics: ['alloy_compass'] });
  assert(Combat.state.hand.length === 6, '锈蚀罗盘：首回合手牌 6 张');

  // 井壁吊坠：只有第 1 回合 +1 能量
  Combat.start(999, { deck: Run.state.deck, relics: ['shaft_pendant'] });
  assert(Combat.state.player.energy === 4, '井壁吊坠：第 1 回合能量 4');
  Combat.endTurn();
  assert(Combat.state.turn === 2 && Combat.state.player.energy === 3, '井壁吊坠不影响第 2 回合');

  // 苔藓护符：玩家回合内没掉血就回 2 点。
  // 两个细节：
  //   血量必须在 start 时就给到 50 —— 判定基准是"玩家回合开始时的血量"，
  //   start 之后再改 hp 等于"这一回合掉了 25 血"，反而测不到本来想测的东西；
  //   另外要给足格挡，否则敌人回合的 5 点会混进结果里。
  Combat.start(999, { hp: 50, maxHp: 75, deck: Run.state.deck, relics: ['moss_charm'] });
  Combat.state.player.block = 99;
  Combat.state.hand = []; // 手上没牌 → 本回合不会因诅咒掉血
  Combat.endTurn();
  assert(Combat.state.player.hp === 52, '苔藓护符：整回合没被消耗 → 回 2 点');

  Combat.start(999, { hp: 50, maxHp: 75, deck: Run.state.deck, relics: ['moss_charm'] });
  Combat.state.player.block = 99;
  Combat.state.hand = [mkCard('cursed_lung')]; // 诅咒牌回合末扣 2 血
  Combat.endTurn();
  assert(Combat.state.player.hp === 48, '苔藓护符：本回合被诅咒消耗过 → 不回血');

  // 诅咒牌本身
  Combat.start(999, { deck: Run.state.deck });
  Combat.state.hand = [mkCard('cursed_lung')];
  Combat.state.player.energy = 3;
  assert(Combat.canPlay(Combat.state.hand[0]) === false, '诅咒牌不可打出（哪怕 0 费）');
  Combat.playCard(Combat.state.hand[0].uid);
  assert(Combat.state.hand.length === 1, '强行 playCard 也不会把它打出去');

  // 临时修正进战斗
  Combat.start(555, { deck: Run.state.deck, enemyHpPct: -50 });
  const half = Combat.state.enemy.maxHp;
  Combat.start(555, { deck: Run.state.deck });
  assert(half < Combat.state.enemy.maxHp, 'enemyHpPct 生效：−50% 的敌人比原版低');
  Combat.start(555, { deck: Run.state.deck, enemyHpPct: -999 });
  assert(Combat.state.enemy.maxHp === 1, 'enemyHpPct 再离谱也不会把敌人打成 0 血');

  // ==========================================================
  console.log('\n[8] 商店');
  newRun();
  const shop = Run.rollShop();
  assert(shop.cards.length === 3, '商店摆 3 张卡');
  assert(shop.relics.length === 2, '商店摆 2 个遗物');
  assert(Run.state.shop === shop, '货品存在 state.shop 上（重绘不会重抽）');
  assert(Run.rollShop() !== shop, '再调一次才会重新生成');

  const priceOk = shop.cards.every(function (it) {
    const r = CARDS[it.id].rarity;
    const range = r === 'rare' ? [120, 150] : r === 'uncommon' ? [75, 95] : [45, 60];
    return it.price >= range[0] && it.price <= range[1];
  });
  assert(priceOk, '卡牌价格落在 §11 的区间内');
  assert(shop.relics.every((it) => it.price >= 140 && it.price <= 200), '遗物价格落在 140–200');
  assert(shop.removePrice === 75, '删牌首次 75 金（§11）');

  // 买卡
  newRun();
  Run.state.gold = 500;
  const sh = Run.rollShop();
  const deckN = Run.state.deck.length;
  const cardPrice = sh.cards[0].price;
  assert(Run.spendGold(cardPrice) === true, '买卡扣钱成功');
  Run.addCard(sh.cards[0].id);
  sh.cards[0].sold = true;
  assert(Run.state.deck.length === deckN + 1, '买下的卡进了卡组');
  assert(Run.state.gold === 500 - cardPrice, '金币被正确扣减');

  // 钱不够买不了
  Run.state.gold = 6;
  assert(Run.spendGold(sh.cards[1].price) === false, '钱不够时买不了');

  // 删牌价格递增
  newRun();
  assert(Run.removePrice() === 75, '删牌第 1 次 75 金');
  Run.state.removedCount++;
  assert(Run.removePrice() === 100, '删牌第 2 次 100 金（每删一次 +25）');

  // 商店不会卖已拥有的遗物：可掉落池全拿到 → 货架空
  newRun();
  relicPool().forEach((id) => Run.addRelic(id));
  assert(Run.rollShop().relics.length === 0, '遗物全拿到后商店不再卖遗物');

  // ==========================================================
  console.log('\n[9] 战斗奖励与宝箱');
  newRun();
  const rw = Run.rollBattleReward(ENEMIES.rats);
  assert(rw.gold >= 10 && rw.gold <= 20, '腐蚀鼠群掉落金币 10–20（§9.1）');
  assert(Run.state.gold === 99 + rw.gold, '奖励金币直接入账');
  assert(rw.cards.length === 3, '奖励给 3 张候选卡');
  assert(new Set(rw.cards).size === 3, '候选卡不重复');

  newRun();
  const chest = Run.openChest();
  assert(chest.kind === 'relic' && Run.hasRelic(chest.relicId), '宝箱开出遗物并入账');

  newRun();
  relicPool().forEach((id) => Run.addRelic(id));
  const goldBefore = Run.state.gold;
  const chest2 = Run.openChest();
  assert(chest2.kind === 'gold' && Run.state.gold === goldBefore + 150, '遗物拿满后宝箱改给 150 金币');

  // ==========================================================
  console.log('\n[10] 节点结算');
  newRun();
  const n2 = Run.current().edges[0];
  Run.moveTo(n2);
  assert(Run.state.currentId === n2, '移动到下一层节点');
  Run.settle('done');
  assert(Run.state.cleared[n2] === 'done', '非战斗节点结算为 done');
  assert(Run.state.battles === 0, '非战斗节点不计入战斗场次');

  const n3 = Run.current().edges[0];
  Run.moveTo(n3);
  Run.settle('win', 60);
  assert(Run.state.cleared[n3] === 'win' && Run.state.battles === 1, '战斗节点结算为 win 并计数');
  assert(Run.state.hp === 60, '战后血量写回本局');

  // 走到末层 = 本大关结束
  newRun();
  Run.state.currentId = Run.state.map.layers[Run.state.map.depth - 2][0].id;
  Run.moveTo(Run.current().edges[0]);
  Run.settle('done');
  assert(Run.state.finished === true, '走到末层后本局结束');

  // 失败即结束
  newRun();
  Run.moveTo(Run.current().edges[0]);
  Run.settle('lose', 0);
  assert(Run.state.finished === true && Run.state.hp === 0, '战斗失败立即结束本局');

  // ==========================================================
  console.log('\n' + (fail === 0 ? 'M4 节点逻辑全部通过' : 'M4 节点逻辑存在失败项') +
              '：' + pass + ' 通过 / ' + fail + ' 失败\n');

  if (fail > 0) throw new Error(fail + ' 项失败');
}

vm.runInContext('(' + suite.toString() + ')()', sandbox, { filename: 'm4-suite.js' });
