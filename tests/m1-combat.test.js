// M1 战斗逻辑的无头验证。combat.js 是纯逻辑不碰 DOM，所以能直接在 Node 里跑。
// 只加载逻辑层（rng / cards / enemies / combat），不加载 render.js。
//
// 运行：node tests/m1-combat.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/cards.js',
  'js/data/relics.js',
  'js/data/enemies.js',
  'js/data/sfx-profile.js',   // M40：打击画像（纯函数，combat 只做透传）
  'js/core/combat.js',
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

  const S = () => Combat.state;

  function reset(hp) {
    Combat.start(12345);
    S().enemy.hp = hp;
    S().enemy.maxHp = hp;
  }

  // 允许用中文卡名或英文 id 指定卡牌，测试写起来更贴近策划案
  function defOf(key) {
    if (CARDS[key]) return CARDS[key];
    const hit = Object.keys(CARDS)
      .map((k) => CARDS[k])
      .filter((d) => d.name === key)[0];
    if (!hit) throw new Error('找不到卡牌：' + key);
    return hit;
  }

  function setHand(keys) {
    S().hand = keys.map((k) => mkCard(defOf(k).id));
  }

  function findCard(name) {
    return S().hand.filter((c) => c.def.name === name)[0];
  }

  function playByName(name) {
    const c = findCard(name);
    if (!c) throw new Error('手牌里没有：' + name);
    Combat.playCard(c.uid);
  }

  console.log('\n[1] 打击造成 6 点伤害');
  reset(50);
  setHand(['打击']);
  playByName('打击');
  assert(S().enemy.hp === 44, '敌人 50 → 44');
  assert(S().player.energy === 2, '能量 3 → 2');

  console.log('\n[2] 撬棍：无格挡时 9 点');
  reset(50);
  setHand(['撬棍']);
  playByName('撬棍');
  assert(S().enemy.hp === 41, '敌人 50 → 41');

  console.log('\n[3] 撬棍：有格挡时 13 点');
  reset(50);
  setHand(['防御', '撬棍']);
  playByName('防御');
  assert(S().player.block === 5, '防御给 5 点格挡');
  playByName('撬棍');
  assert(S().enemy.hp === 37, '敌人 50 → 37');
  assert(S().player.block === 5, '格挡未被消耗');

  console.log('\n[4] 格挡吸收伤害，新回合清零');
  reset(50);
  setHand(['防御']);
  playByName('防御');
  Combat.endTurn();
  assert(S().player.hp === 75, '5 点伤害被 5 点格挡完全吸收');
  assert(S().player.block === 0, '新回合格挡归零');

  console.log('\n[5] 鼠群集结后，咬的伤害提升到 7');
  reset(50);
  setHand([]);
  Combat.endTurn();
  assert(S().player.hp === 70, '第 1 回合咬 5 点');
  Combat.endTurn();
  assert(S().enemy.buffs.str === 2, '鼠群集结 +2 力量');
  assert(Combat.intentDamage() === 7, '意图显示 7（含力量加成）');
  Combat.endTurn();
  assert(S().player.hp === 63, '第 3 回合咬 7 点');

  console.log('\n[6] 抽牌堆抽空后洗回弃牌堆');
  reset(50);
  assert(S().drawPile.length === 5, '开局抽牌堆 5 张');
  Combat.endTurn();
  assert(S().drawPile.length === 0 && S().discardPile.length === 5, '第 2 回合把抽牌堆抽空');
  Combat.endTurn();
  assert(
    S().drawPile.length === 5 && S().discardPile.length === 0 && S().hand.length === 5,
    '第 3 回合洗回弃牌堆后重新抽满 5 张'
  );

  console.log('\n[7] 能量不足时无法出牌');
  reset(50);
  setHand(['打击', '打击', '打击', '打击']);
  playByName('打击');
  playByName('打击');
  playByName('打击');
  assert(S().player.energy === 0, '3 点能量出完 3 张');
  assert(S().hand.length === 1, '手牌剩 1 张');
  assert(Combat.canPlay(findCard('打击')) === false, '剩余手牌不可打出');

  console.log('\n[8] 击杀敌人');
  reset(14);
  setHand(['打击', '打击', '打击']);
  playByName('打击');
  playByName('打击');
  assert(S().enemy.hp === 2 && S().phase === 'player', '12 点伤害后剩 2 血');
  playByName('打击');
  assert(S().phase === 'win', '血量归零 → 胜利');
  assert(Combat.canPlay({ def: CARDS.strike }) === false, '胜利后不能继续出牌');

  console.log('\n[9] 玩家死亡');
  Combat.start(999);
  S().player.hp = 3;
  setHand([]);
  Combat.endTurn();
  assert(S().phase === 'lose', '3 血被咬 5 点 → 失败');
  assert(S().player.hp === 0, '血量不会变成负数');

  console.log('\n[10] 敌人行为循环：咬 → 鼠群集结 → 重复');
  reset(50);
  setHand([]);
  const seq = [];
  for (let i = 0; i < 6; i++) {
    seq.push(S().enemy.intent.name);
    Combat.endTurn();
  }
  assert(
    seq.join(' → ') === '咬 → 鼠群集结 → 咬 → 鼠群集结 → 咬 → 鼠群集结',
    '6 回合意图序列正确：' + seq.join(' → ')
  );

  console.log('\n[11] 同一种子可复现');
  const snap = () =>
    S().enemy.hp + '|' + S().hand.map((c) => c.def.id).join(',');
  Combat.start(777);
  const a = snap();
  Combat.start(777);
  const b = snap();
  assert(a === b, '相同种子得到相同的敌人血量与起手牌（' + a + '）');

  console.log('\n[12] 消化牌堆：能力牌打出一次后本场消失');
  reset(50);
  setHand(['井架支撑']);
  playByName('井架支撑');
  assert(S().exhaustPile.length === 1, '能力牌进入消化牌堆');
  assert(S().exhaustPile[0].def.id === 'derrick', '消化堆里就是刚打的那张');
  assert(S().discardPile.length === 0, '不进弃牌堆');
  assert(S().hand.length === 0, '手牌里移除');
  let cameBack = false;
  for (let i = 0; i < 6; i++) {
    Combat.endTurn();
    if (S().hand.some((c) => c.def.id === 'derrick')) cameBack = true;
  }
  assert(!cameBack, '连续 6 回合洗牌也不会回到手牌');
  assert(S().exhaustPile.length === 1, '消化堆始终只有它');

  console.log('\n[13] 力量上升 → 攻击对应增加');
  reset(50);
  setHand(['打击']);
  S().player.buffs.str = 3;
  playByName('打击');
  assert(S().enemy.hp === 50 - 9, '打击 6 + 力量 3 = 9 点（50 → 41）');

  console.log('\n[14] 力量下降 → 攻击对应减少（含钳 0）');
  reset(50);
  setHand(['打击']);
  S().player.buffs.str = -2;
  playByName('打击');
  assert(S().enemy.hp === 50 - 4, '打击 6 − 力量 2 = 4 点（50 → 46）');
  reset(50);
  setHand(['打击']);
  S().player.buffs.str = -6;
  playByName('打击');
  assert(S().enemy.hp === 50, '力量 −6 抵消全部基础伤害，伤害钳在 0');

  console.log('\n[15] 卡牌链路验证：力量经真实卡牌增减');
  // 负重前行：格挡转力量（skill），验证「力量增加 → 攻击增加」
  reset(50);
  setHand(['防御', '负重前行', '打击']);
  playByName('防御');
  playByName('负重前行');
  assert(S().player.buffs.str === 1, '5 点格挡 → +1 力量');
  playByName('打击');
  assert(S().enemy.hp === 50 - 7, '力量 +1 后打击 7 点（50 → 43）');
  // 重锤作业：降敌方力量（attack），验证「力量减少 → 敌人攻击减少」
  reset(50);
  setHand(['重锤作业']);
  playByName('重锤作业');
  assert(S().enemy.hp === 40, '重锤作业造成 10 点（50 → 40）');
  assert(S().enemy.buffs.str === -3, '敌人力量 −3');
  Combat.endTurn();
  assert(S().player.hp === 75 - 2, '敌人咬 5 − 3 力量 = 2 点（75 → 73）');

  console.log('\n[16] 敏捷上升 → 格挡对应增加');
  reset(50);
  setHand(['防御']);
  S().player.buffs.dex = 2;
  playByName('防御');
  assert(S().player.block === 7, '防御 5 + 敏捷 2 = 7 点格挡');

  console.log('\n[17] 敏捷下降 → 格挡对应减少（含钳 0）');
  reset(50);
  setHand(['防御']);
  S().player.buffs.dex = -2;
  playByName('防御');
  assert(S().player.block === 3, '防御 5 − 敏捷 2 = 3 点（50 点对手不受影响）');
  reset(50);
  setHand(['防御']);
  S().player.buffs.dex = -6;
  playByName('防御');
  assert(S().player.block === 0, '敏捷 −6 抵消全部基础格挡，钳在 0');

  console.log('\n[18] 卡牌链路验证：敏捷经真实卡牌增减');
  // 钢板护体：先 +1 敏捷再获 12 格挡，本张牌自己就吃到加成
  reset(50);
  setHand(['钢板护体']);
  playByName('钢板护体');
  assert(S().player.buffs.dex === 1, '钢板护体 +1 敏捷');
  assert(S().player.block === 13, '12 点格挡 + 1 敏捷自加成 = 13 点');
  // 敌方「锈蚀蔓延」走同一个 addBuff 出口降玩家敏捷 → 加防卡缩水
  reset(50);
  setHand(['防御']);
  Combat.addBuff(S().player, 'dex', -2);
  assert(S().player.buffs.dex === -2, 'addBuff 允许负值（锈蚀语义）');
  playByName('防御');
  assert(S().player.block === 3, '敏捷 −2 后防御只给 3 点');

  console.log('\n[19] M36 打击材质：不同卡的 impact 进动作日志');
  reset(50);
  setHand(['打击']);
  playByName('打击');
  let acts19 = Combat.takeActs();
  assert(acts19.length === 1 && acts19[0].impact === 'blunt', '打击 → blunt');

  reset(50);
  setHand(['震地锤']);
  playByName('震地锤');
  acts19 = Combat.takeActs();
  assert(acts19.length === 1 && acts19[0].impact === 'hammer', '震地锤 → hammer');

  reset(50);
  setHand(['撬棍']);
  playByName('撬棍');
  acts19 = Combat.takeActs();
  assert(acts19.length === 1 && acts19[0].impact === 'metal', '撬棍 → metal');

  console.log('\n[20] M40 打击画像：材质之外还有「力度」与「卡片特质」');
  // 这一节钉的是**可听辨的差别**，不是「函数返回了个对象」。
  // ① 同材质的轻重必须不同 —— 这是 M36/M38 最大的漏洞：「打击」（6 伤）与
  //    「铁拳」（13 伤）共用一个 blunt 材质，听起来一模一样。
  reset(50);
  setHand(['打击']);
  playByName('打击');
  let acts20 = Combat.takeActs();
  assert(!!acts20[0].sfx && acts20[0].sfx.impact === 'blunt', '打击 → 画像存在，材质 blunt');
  assert(acts20[0].sfx.dmg === 6 && acts20[0].sfx.weight === 0, '打击 6 伤 → 力度 0（最轻一档）');
  assert(acts20[0].dmg === 6, '动作日志带上真实伤害（dmg=6）');

  reset(50);
  setHand(['铁拳']);
  playByName('铁拳');
  const pFist = Combat.takeActs()[0].sfx;
  assert(pFist.impact === 'blunt' && pFist.weight > 0.3,
    '铁拳 13 伤 → 同材质但力度 ' + pFist.weight.toFixed(2) + '（与「打击」拉开听感）');

  // ② 特质只认卡面写着的机制，不做语义猜测
  reset(50);
  setHand(['连环凿']);
  playByName('连环凿');
  acts20 = Combat.takeActs();
  assert(acts20.length === 3, '连环凿 5×3 → 同一帧留下 3 条动作（连击该响三下）');
  assert(acts20[0].sfx.traits.indexOf('multi') >= 0, '连环凿 → 画像带 multi（连击）');

  reset(50);
  setHand(['双持撬棍']);
  playByName('双持撬棍');
  const pDual = Combat.takeActs()[0].sfx;
  assert(pDual.impact === 'metal' && pDual.traits.indexOf('multi') >= 0,
    '双持撬棍 → metal + multi（材质与特质是两个独立维度）');

  reset(50);
  setHand(['防御']);
  playByName('防御');
  assert(Combat.takeActs().length === 0, '防御（技能牌）不产生打击动作 —— 画像不凭空造声音');

  // ③ 敌人不得继承玩家上一张卡的特质：串味 = 谎报机制
  reset(50);
  setHand(['连环凿']);
  playByName('连环凿');
  Combat.takeActs();
  S().enemy.intent = {
    kind: 'attack', value: 8, name: '测试击',
    run: function (c) { c.dealDamage(c.enemy, c.player, 8); },
  };
  Combat.endTurn();
  const enemyActs = Combat.takeActs().filter((a) => a.src === S().enemy);
  assert(enemyActs.length > 0 && enemyActs.every((a) => a.sfx === null),
    '敌人行动 → 画像为 null（不继承玩家卡的 multi / 力度）');

  console.log('\n' + (fail === 0 ? '全部通过' : '存在失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败\n');
  if (fail > 0) throw new Error('M1 战斗逻辑测试未全部通过');
}

vm.runInContext('(' + suite.toString() + ')()', sandbox);
