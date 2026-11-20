// M2 卡池验证：40 张掘者卡逐张核对机制 + 本轮新增的引擎特性。
// 只加载逻辑层，不加载 render.js。
//
// 运行：node tests/m2-cards.test.js

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

  // 干净的战斗状态：能量管够、手牌可控、敌人血厚到打不死
  function fresh(enemyHp, depth) {
    Combat.start(20260923);
    const s = S();
    s.enemy.hp = enemyHp === undefined ? 300 : enemyHp;
    s.enemy.maxHp = s.enemy.hp;
    s.enemy.buffs = {};
    s.enemy.block = 0;
    s.player.hp = 75;
    s.player.maxHp = 75;
    s.player.block = 0;
    s.player.energy = 99;
    s.player.buffs = {};
    s.depth = depth === undefined ? 1 : depth;
    s.hand = [];
    s.drawPile = [];
    s.discardPile = [];
    s.log = [];
    return s;
  }

  function hand(ids) {
    S().hand = ids.map((id) => mkCard(id));
  }

  function asCard(id) {
    return S().hand.filter((c) => c.def.id === id)[0];
  }

  function play(id) {
    const c = asCard(id);
    if (!c) throw new Error('手牌里没有 ' + id);
    Combat.playCard(c.uid);
  }

  const enemyHp = () => S().enemy.hp;
  const playerHp = () => S().player.hp;

  // ==========================================================
  console.log('\n[1] 卡池结构：50 张 = 10 基础 + DL1–DL10 各 3 张 + 群体系 3（DL2/5/8）+ 大威力 3（DL7/9/10）+ 低层能力牌 1（DL2）+ 重防轴 2（DL2）+ 夯击（DL3）');
  // CARDS 里还挂着一张诅咒卡（事件塞给玩家的负担，M4 加的），它不属于卡池
  const ids = Object.keys(CARDS).filter((k) => CARDS[k].rarity !== 'curse');
  assert(ids.length === 50, '总数 50 张（实际 ' + ids.length + '）');

  let dlOk = true;
  const dlCount = {};
  ids.forEach((k) => {
    const d = CARDS[k].dl;
    dlCount[d] = (dlCount[d] || 0) + 1;
  });
  // 层内张数例外：DL2 = M32 震波 + M33b 配重校准 + M64 重防轴 2 张（7 张）；
  // DL3 = M65 夯击；DL5/8 = M32 群体系；DL7/9/10 = M33 大威力轴
  const layerWant = { 2: 7, 3: 4, 5: 4, 7: 4, 8: 4, 9: 4, 10: 4 };
  for (let i = 1; i <= 10; i++) {
    if (dlCount[i] !== (layerWant[i] || 3)) dlOk = false;
  }
  assert(dlCount[0] === 10, '基础池 10 张（实际 ' + dlCount[0] + '）');
  assert(dlOk, 'DL1–DL10 层内张数正确（DL2=7，DL3·5·7·8·9·10=4，其余 3；实际 ' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => dlCount[i]).join('/') + '）');

  const dupId = ids.filter((k, i) => ids.map((x) => CARDS[x].id).indexOf(CARDS[k].id) !== i);
  assert(dupId.length === 0, '卡牌 id 无重复');
  const names = ids.map((k) => CARDS[k].name);
  const dupName = names.filter((n, i) => names.indexOf(n) !== i);
  assert(dupName.length === 0, '卡名无重复');

  const badType = ids.filter(function (k) {
    return ['attack', 'skill', 'power'].indexOf(CARDS[k].type) < 0;
  });
  assert(badType.length === 0, '每张卡的类型合法（攻击 / 技能 / 能力）');

  const noUp = ids.filter((k) => !CARDS[k].upV);
  assert(noUp.length === 0, '每张卡都有升级数据');
  const upSame = ids.filter((k) => JSON.stringify(CARDS[k].v) === JSON.stringify(CARDS[k].upV));
  assert(upSame.length === 0, '升级后数值确实有变化');

  // 诅咒卡（M4）：不该出现在奖励池里，也不该能被升级
  const curse = Object.keys(CARDS).filter((k) => CARDS[k].rarity === 'curse');
  assert(rewardPool().every((k) => CARDS[k].rarity !== 'curse'), '奖励池不含诅咒卡');
  assert(rewardPool().every((k) => CARDS[k].rarity !== 'basic'), '奖励池不含基础卡');
  assert(curse.every((k) => CARDS[k].unplayable && !CARDS[k].upV), '诅咒卡不可打出、不可升级');

  // ==========================================================
  console.log('\n[2] 冒烟：50 张卡全部可打出，且不抛错');
  let throwErr = null;
  let smokeFail = 0;
  ids.forEach(function (k) {
    fresh(300, 5);
    const s = S();
    s.player.block = 12; // 让「消耗格挡」类卡有东西可用
    s.player.buffs.str = 2;
    s.player.buffs.dex = 1;
    // 垫两张牌：否则抽牌时抽牌堆为空，会把刚打出的那张从弃牌堆洗回来，
    // 于是它又回到手上（这是正确规则，不是 bug，但会干扰"已离开手牌"的判定）
    s.drawPile = [mkCard('brace'), mkCard('brace')];
    hand([k]);
    const uid = asCard(k).uid;
    const cost = CARDS[k].cost;

    try {
      Combat.playCard(uid);
    } catch (e) {
      throwErr = CARDS[k].name + '：' + e.message;
      smokeFail++;
      return;
    }

    // 只核对"打出的那一张"是否离开手牌 —— 抽牌类卡会补进新牌，不能要求手牌清空
    if (s.hand.filter((c) => c.uid === uid).length > 0) {
      smokeFail++;
      throwErr = CARDS[k].name + '：打出后仍在手牌里';
      return;
    }
    if (s.player.energy !== 99 - cost) {
      smokeFail++;
      throwErr = CARDS[k].name + '：能量扣减错误（' + s.player.energy + '，应为 ' + (99 - cost) + '）';
      return;
    }
    // 描述文字在基础数值和升级数值下都能生成
    const t1 = CARDS[k].text(CARDS[k].v);
    const t2 = CARDS[k].text(CARDS[k].upV);
    if (!t1 || !t2) {
      smokeFail++;
      throwErr = CARDS[k].name + '：描述文字生成失败';
    }
  });
  assert(smokeFail === 0, '50 张卡逐张打出无异常' + (throwErr ? ' — ' + throwErr : ''));

  console.log('\n[3] 能力牌打出后不进弃牌堆');
  fresh(300);
  hand(['derrick']);
  play('derrick');
  assert(S().discardPile.length === 0, '能力牌从本场战斗移除');
  assert(S().player.buffs.metallicize === 3, '金属化 3 生效');

  fresh(300);
  hand(['strike']);
  play('strike');
  assert(S().discardPile.length === 1, '普通牌正常进弃牌堆');

  // ==========================================================
  console.log('\n[4] 基础池');
  fresh(300);
  hand(['strike']);
  play('strike');
  assert(enemyHp() === 294, '打击 6 伤');

  fresh(300);
  hand(['defend']);
  play('defend');
  assert(S().player.block === 5, '防御 5 格挡');

  fresh(300);
  hand(['crowbar']);
  play('crowbar');
  assert(enemyHp() === 291, '撬棍无格挡 9 伤');

  fresh(300);
  hand(['defend', 'crowbar']);
  play('defend');
  play('crowbar');
  assert(enemyHp() === 287, '撬棍有格挡 13 伤');
  assert(S().player.block === 5, '撬棍不消耗格挡');

  fresh(300);
  hand(['iron_fist']);
  play('iron_fist');
  assert(enemyHp() === 287, '铁拳 13 伤');

  fresh(300);
  hand(['brace']);
  play('brace');
  assert(S().player.block === 3 && S().player.energy === 99, '支撑 0 费 3 格挡');

  fresh(300);
  hand(['pry']);
  S().drawPile = [mkCard('strike')];
  play('pry');
  assert(enemyHp() === 296, '撬动 4 伤');
  assert(S().hand.length === 1, '撬动抽 1 张');

  fresh(300);
  hand(['shove']);
  play('shove');
  assert(enemyHp() === 295 && S().enemy.buffs.weak === 1, '推压 5 伤 + 1 虚弱');

  fresh(300);
  hand(['hardhat']);
  play('hardhat');
  assert(S().player.block === 6, '安全帽基础 6 格挡');

  fresh(300);
  hand(['strike', 'hardhat']);
  play('strike');
  play('hardhat');
  assert(S().player.block === 9, '出过攻击牌后安全帽 6+3=9 格挡');

  fresh(300);
  hand(['shrapnel']);
  S().player.block = 10;
  play('shrapnel');
  assert(enemyHp() === 295, '碎石：格挡 10 → 5 伤');
  assert(S().player.block === 10, '碎石不消耗格挡');

  fresh(300);
  hand(['patch']);
  S().player.hp = 50;
  play('patch');
  assert(playerHp() === 56, '修补回复 6 生命');

  // ==========================================================
  console.log('\n[5] DL1');
  fresh(300);
  hand(['rivet_plate']);
  play('rivet_plate');
  assert(S().player.block === 8, '铆钉板 8 格挡');

  fresh(300);
  hand(['hydraulic']);
  S().player.block = 12;
  play('hydraulic');
  assert(enemyHp() === 282, '液压冲击：格挡 12 ×1.5 = 18 伤');
  assert(S().player.block === 0, '液压冲击消耗全部格挡');

  fresh(300);
  hand(['dismantle']);
  play('dismantle');
  assert(enemyHp() === 294 && S().player.block === 6, '拆解 6 伤 + 6 格挡');

  // ==========================================================
  console.log('\n[6] DL2');
  fresh(300);
  hand(['ballast']);
  S().player.block = 12;
  play('ballast');
  assert(S().player.buffs.str === 2, '负重前行：格挡 12 → +2 力量');

  fresh(300, 5);
  hand(['wall_pick']);
  play('wall_pick');
  assert(enemyHp() === 291, '井壁凿击：深度 5 → 4+5=9 伤');

  fresh(300);
  hand(['weld']);
  S().drawPile = [mkCard('strike')];
  play('weld');
  assert(S().player.block === 6 && S().hand.length === 1, '加固焊接 6 格挡 + 抽 1');

  // M64 重防轴：两张都挂 DL2，且带收尾面板公告标记
  assert(CARDS.hazard_work.dl === 2 && CARDS.load_bearing.dl === 2,
    '带伤作业 / 承重墙都挂 DL2（深度 2 才解锁）');
  assert(CARDS.hazard_work.announce === true && CARDS.load_bearing.announce === true,
    '两张都带 announce 标记（DL1 通关升 DL2 时收尾面板点名）');

  fresh(300);
  hand(['hazard_work']);
  play('hazard_work');
  assert(S().player.block === 15 && playerHp() === 72, '带伤作业：15 格挡 − 3 生命');

  fresh(300);
  hand(['hazard_work']);
  upgradeCard(asCard('hazard_work'));
  play('hazard_work');
  assert(S().player.block === 20 && playerHp() === 73, '带伤作业+：20 格挡，自伤收敛到 2');

  fresh(300);
  hand(['load_bearing']);
  play('load_bearing');
  assert(S().player.block === 30, '承重墙：2 费直接 30 格挡');

  fresh(300);
  hand(['load_bearing']);
  upgradeCard(asCard('load_bearing'));
  play('load_bearing');
  assert(S().player.block === 40, '承重墙+：40 格挡');

  // ==========================================================
  console.log('\n[7] DL3');
  fresh(300, 5);
  hand(['deep_work']);
  play('deep_work');
  assert(S().player.block === 10, '深井作业：深度 5 ×2 = 10 格挡');

  fresh(300);
  hand(['quake']);
  S().enemy.buffs.str = 4;
  play('quake');
  assert(enemyHp() === 286, '震地锤 14 伤');
  assert(S().enemy.buffs.str === 2, '震地锤使敌人 4 → 2 力量');

  fresh(300);
  hand(['plate_guard']);
  play('plate_guard');
  assert(S().player.buffs.dex === 1, '钢板护体给 1 敏捷');
  assert(S().player.block === 13, '钢板护体：12 + 敏捷 1 = 13 格挡');

  // M65 夯击：伤害 = 打出瞬间的格挡值（不消耗格挡）
  fresh(300);
  hand(['ram_hit']);
  S().player.block = 12;
  S().player.energy = 3;   // 验证基础 1 费
  play('ram_hit');
  assert(enemyHp() === 288, '夯击：格挡 12 → 12 伤（实际 ' + (300 - enemyHp()) + '）');
  assert(S().player.block === 12, '夯击不消耗格挡');
  assert(S().player.energy === 2, '夯击基础 1 费');

  fresh(300);
  hand(['ram_hit']);
  upgradeCard(asCard('ram_hit'));
  S().player.energy = 0;   // 0 费 = 没能量也能打
  S().player.block = 7;
  play('ram_hit');
  assert(enemyHp() === 293, '夯击+：伤害公式不变，格挡 7 → 7 伤');
  assert(S().player.energy === 0, '夯击+ 0 费（不扣能量）');

  // ==========================================================
  console.log('\n[8] DL4');
  fresh(300);
  hand(['chain_chisel']);
  play('chain_chisel');
  assert(enemyHp() === 285, '连环凿 5×3 = 15 伤');

  fresh(300);
  hand(['rust_grip']);
  play('rust_grip');
  assert(
    S().enemy.buffs.weak === 2 && S().enemy.buffs.vulnerable === 2,
    '锈蚀之握：敌人 2 虚弱 + 2 脆弱'
  );

  fresh(300);
  hand(['emergency']);
  play('emergency');
  assert(S().player.block === 10 && playerHp() === 72, '应急护盾 10 格挡 − 3 生命');

  // ==========================================================
  console.log('\n[9] DL5');
  fresh(300);
  hand(['pressure_valve']);
  S().player.block = 12;
  play('pressure_valve');
  assert(S().player.buffs.str === 2, '压力阀：格挡 12 → 每 5 点 1 力量 = +2');
  assert(S().player.block === 0, '压力阀消耗全部格挡');

  fresh(300);
  hand(['sledge_work']);
  S().enemy.buffs.str = 4;
  play('sledge_work');
  assert(enemyHp() === 290, '重锤作业 10 伤');
  assert(S().enemy.buffs.str === 1, '重锤作业使敌人 4 → 1 力量');

  fresh(300);
  hand(['derrick']);
  play('derrick');
  Combat.endTurn();
  assert(S().player.block === 3, '井架支撑：下回合开始获得 3 格挡');

  // ==========================================================
  console.log('\n[10] DL6');
  fresh(300);
  hand(['rockbreak']);
  S().enemy.block = 20;
  play('rockbreak');
  assert(enemyHp() === 284, '破岩 16 伤无视 20 点格挡');
  assert(S().enemy.block === 20, '破岩不消耗敌人格挡');

  fresh(300);
  hand(['temper']);
  play('temper');
  assert(S().player.block === 5 && S().enemy.buffs.poison === 3, '回火 5 格挡 + 3 中毒');

  fresh(300);
  hand(['pry_combo']);
  play('pry_combo');
  assert(enemyHp() === 293, '撬棒连击 7 伤（未击杀不抽牌）');
  assert(S().hand.length === 0, '未击杀时不抽牌');

  fresh(7);
  hand(['pry_combo']);
  S().drawPile = [mkCard('strike'), mkCard('strike'), mkCard('strike')];
  play('pry_combo');
  assert(S().phase === 'win', '撬棒连击击杀敌人');
  assert(S().hand.length === 2, '击杀后抽 2 张');

  // ==========================================================
  console.log('\n[11] DL7');
  fresh(300);
  hand(['steel_beam']);
  play('steel_beam');
  Combat.endTurn();
  assert(S().player.buffs.str === 1, '钢梁：回合开始 +1 力量');
  Combat.endTurn();
  assert(S().player.buffs.str === 2, '钢梁叠到第 2 回合 +2 力量');

  fresh(300);
  hand(['dual_crowbar']);
  play('dual_crowbar');
  assert(enemyHp() === 282, '双持撬棍 9×2 = 18 伤');

  fresh(300);
  hand(['riposte']);
  play('riposte');
  assert(S().player.block === 8 && S().player.buffs.thorns === 4, '反击姿态 8 格挡 + 4 荆棘');
  Combat.endTurn();
  assert(enemyHp() === 296, '荆棘：敌人咬人后自受 4 点反弹');

  // M73：荆棘反弹先吃攻击者格挡（不是真实伤害）
  fresh(300);
  hand(['strike']);
  S().player.block = 10;
  S().enemy.buffs.thorns = 4;
  play('strike');
  assert(enemyHp() === 294, '主伤照常结算（300 → 294）');
  assert(S().player.block === 6 && playerHp() === 75,
    'M73：荆棘反弹先吃格挡（10 → 6，HP 不动）');
  fresh(300);
  hand(['strike']);
  S().player.block = 2;
  S().enemy.buffs.thorns = 4;
  play('strike');
  assert(S().player.block === 0 && playerHp() === 73,
    'M73：格挡不够时扣完挡格再扣 HP（2 → 0，HP −2）');

  // ==========================================================
  console.log('\n[12] DL8');
  fresh(300, 5);
  hand(['seam_resonance']);
  play('seam_resonance');
  assert(enemyHp() === 285, '地脉共振：深度 5 ×3 = 15 伤');

  fresh(300);
  hand(['heavy_rig']);
  play('heavy_rig');
  assert(S().player.buffs.barricade === 1, '重装机甲给壁垒');
  S().player.block = 10;
  Combat.endTurn();
  assert(S().player.block === 5, '壁垒：10 格挡吸收 5 伤后剩余 5，未清零');

  fresh(300);
  hand(['strike']);
  play('strike');
  S().player.block = 10;
  Combat.endTurn();
  assert(S().player.block === 0, '无壁垒时格挡照常清零');

  fresh(300, 5);
  hand(['salvage']);
  S().player.hp = 50;
  play('salvage');
  assert(S().player.block === 8, '废铁回收：深度 5 + 3 = 8 格挡');
  assert(playerHp() === 53, '废铁回收回复 3 生命');

  // ==========================================================
  console.log('\n[13] DL9');
  fresh(300, 5);
  hand(['abyss_echo']);
  S().drawPile = [mkCard('strike')];
  play('abyss_echo');
  assert(enemyHp() === 280, '深渊回响：深度 5 ×4 = 20 伤');
  assert(S().hand.length === 1, '深渊回响抽 1 张');

  fresh(300);
  hand(['iron_will']);
  S().player.buffs.str = 2;
  play('iron_will');
  assert(S().player.block === 21, '钢铁意志：15 + 力量 2 ×3 = 21 格挡');

  fresh(300);
  hand(['brace', 'brace', 'wall_breaker']);
  play('brace');
  play('brace');
  play('wall_breaker');
  assert(S().player.block === 3 + 3 + 8 + 8, '破壁索：8 + 已出 2 张技能牌 ×4 = 16 格挡');

  // ==========================================================
  console.log('\n[14] DL10');
  fresh(300);
  hand(['strike', 'strike', 'bottom_hammer']);
  play('strike');
  play('strike');
  play('bottom_hammer');
  assert(enemyHp() === 300 - 12 - 38, '井底之锤：26 + 已出 2 张攻击牌 ×6 = 38 伤');

  fresh(300);
  hand(['immovable']);
  play('immovable');
  assert(S().player.buffs.barricade === 1, '不动如山给壁垒');
  assert(S().player.buffs.metallicize === 5, '不动如山给金属化 5');
  Combat.endTurn();
  assert(S().player.block === 5, '不动如山：回合开始 5 格挡且不清零');

  fresh(300, 5);
  hand(['final_bore']);
  S().enemy.block = 30;
  play('final_bore');
  assert(enemyHp() === 275, '终末钻探：深度 5 ×5 = 25 伤无视 30 格挡');
  assert(playerHp() === 65, '终末钻探失去 10 生命');

  // ==========================================================
  console.log('\n[15] 本回合出牌统计（不计自身）');
  fresh(300);
  hand(['strike', 'strike', 'hardhat', 'bottom_hammer']);
  play('strike');
  assert(S().turnPlays.attack === 1, '打出 1 张攻击牌后计数 1');
  play('hardhat');
  assert(S().turnPlays.attack === 1 && S().turnPlays.skill === 1, '技能牌单独计数');
  play('strike');
  assert(S().turnPlays.attack === 2, '攻击牌计数累计到 2');
  play('bottom_hammer');
  assert(S().turnPlays.attack === 3, '井底之锤自身也计入，但结算时用的是打出前的值');
  const before = enemyHp();
  assert(
    before === 300 - 6 - 6 - 38,
    '井底之锤吃到的是"打出前"的 2 张攻击牌加成（26 + 2×6 = 38）'
  );

  console.log('\n[16] 新回合重置出牌统计');
  fresh(300);
  hand(['strike']);
  play('strike');
  Combat.endTurn();
  assert(S().turnPlays.attack === 0, '新回合统计归零');

  // ==========================================================
  console.log('\n[17] 减益衰减与中毒结算');
  fresh(300);
  hand(['rust_grip']);
  play('rust_grip');
  assert(S().enemy.buffs.vulnerable === 2, '敌人 2 层脆弱');
  Combat.endTurn();
  assert(S().enemy.buffs.vulnerable === 1, '敌人回合结束后脆弱 2 → 1');

  fresh(300);
  hand(['temper']);
  play('temper');
  Combat.endTurn();
  assert(enemyHp() === 297, '中毒在敌人回合开始结算 3 伤');
  assert(S().enemy.buffs.poison === 2, '中毒层数 3 → 2');

  fresh(300);
  S().player.buffs.poison = 4;
  hand([]);
  Combat.endTurn();
  assert(playerHp() === 75 - 4 - 5, '玩家中毒扣 4，随后被咬 5');
  assert(S().player.buffs.poison === 3, '玩家中毒层数 4 → 3');

  console.log('\n[18] 中毒可致死');
  fresh(300);
  S().player.hp = 3;
  S().player.buffs.poison = 5;
  hand([]);
  Combat.endTurn();
  assert(S().phase === 'lose' && playerHp() === 0, '中毒超过剩余生命 → 失败');

  // ==========================================================
  console.log('\n[19] 升级系统');
  const c = mkCard('strike');
  assert(c.v.dmg === 6 && !c.upgraded, '打击初始 6 伤、未升级');
  assert(upgradeCard(c) === true, '升级成功');
  assert(c.v.dmg === 9 && c.upgraded, '升级后 9 伤');
  assert(upgradeCard(c) === false, '不能重复升级');
  assert(mkCard('strike').v.dmg === 6, '升级只影响这张卡，不影响模板');

  fresh(300);
  hand(['strike']);
  upgradeCard(asCard('strike'));
  play('strike');
  assert(enemyHp() === 291, '升级后的打击打出 9 伤');

  console.log('\n[20] 能量与抽牌原语');
  fresh(300);
  S().player.energy = 1;
  Combat.gainEnergy(2);
  assert(S().player.energy === 3, '获得能量 1 + 2 = 3');
  fresh(300);
  S().drawPile = [mkCard('strike'), mkCard('defend')];
  Combat.drawCards(2);
  assert(S().hand.length === 2, '抽 2 张牌');
  fresh(300);
  Combat.drawCards(3);
  assert(S().hand.length === 0, '两边都空时抽牌不报错、不产生手牌');

  console.log('\n[21] M32 群体系：掘者三张全体攻击');
  // 震波：全体伤害 + 白送格挡
  fresh(300);
  Combat.addEnemy('crawler', { hp: 50 });
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['shockwave']);
  const swBefore = S().enemies.map((e) => e.hp);
  play('shockwave');
  assert(S().enemies.every((e, i) => e.hp === swBefore[i] - 5), '「震波」对全部 3 个敌人各造成 5 点伤害');
  assert(S().player.block === 4, '「震波」获得 4 点格挡');

  // 连锁爆破：击倒抽牌
  fresh(300);
  Combat.addEnemy('crawler', { hp: 5 });
  hand(['chain_demolition']);
  S().drawPile = [mkCard('strike')];
  S().discardPile = [];
  play('chain_demolition');
  assert(S().enemies[1].hp <= 0, '5 血小怪被「连锁爆破」击倒');
  assert(S().hand.length === 1 && S().hand[0].def.id === 'strike',
    '击倒任一敌人 → 抽 1 张牌（抽到的正是垫的 strike）');

  // 连锁爆破：没杀不抽
  fresh(300);
  Combat.addEnemy('crawler', { hp: 60 });
  hand(['chain_demolition']);
  S().drawPile = [mkCard('strike')];
  S().discardPile = [];
  play('chain_demolition');
  assert(S().enemies[1].hp > 0 && S().hand.length === 0 && S().drawPile.length === 1,
    '没击倒任何敌人就不抽牌');

  // 定向爆破：全体无视格挡
  fresh(300);
  Combat.addEnemy('crawler', { hp: 50 });
  S().enemies[1].block = 30;
  hand(['demolition_charge']);
  const dcBefore = S().enemies.map((e) => e.hp);
  play('demolition_charge');
  assert(S().enemies[0].hp === dcBefore[0] - 10, '「定向爆破」主目标 10 点');
  assert(S().enemies[1].hp === dcBefore[1] - 10, '「定向爆破」副目标的 30 点格挡被无视');

  // M32 后置数值复核（2026-10-02）：群体卡在**双敌**时的等效收益不得超过
  // 同角色同费单体最强的 1.25 倍 —— 否则就是「一锤子拍满编」的超模牌。
  // 这条守卫正是审计发现（定向爆破原 12 伤 = 150%）的回归网：
  // 只测「打出去有伤害」抓不住数值失衡，必须有一条按语义算收益比的断言。
  const EQ2 = (c, n) => {
    const v = c.v || {};
    return ((v.dmg || 0) * (v.times || 1) + (v.burn || 0) + (v.poison || 0)) * n + (v.block || 0);
  };
  const isAll = (c) => /ctx\.enemies/.test(c.play.toString());
  const digAoe = Object.keys(CARDS).filter((k) =>
    CARDS[k].char === 'digger' && CARDS[k].type === 'attack' && isAll(CARDS[k]));
  assert(digAoe.length === 3, '掘者群体攻击卡 3 张（实际 ' + digAoe.length + '）');
  digAoe.forEach((k) => {
    const c = CARDS[k];
    const singles = Object.keys(CARDS).filter((s) =>
      CARDS[s].char === 'digger' && CARDS[s].type === 'attack' && CARDS[s].cost === c.cost &&
      !isAll(CARDS[s]) && (CARDS[s].v.dmg || 0) > 0);
    if (!singles.length) return;
    const best = singles.map((s) => EQ2(CARDS[s], 1)).reduce((a, b) => Math.max(a, b), 0);
    const ratio = EQ2(c, 2) / best;
    assert(ratio <= 1.25, '「' + c.name + '」双敌等效 ' + EQ2(c, 2) + ' 不超过同费单体最强 ' +
      best + ' 的 125%（实际 ' + (ratio * 100).toFixed(0) + '%）');
  });

  // ==========================================================
  console.log('\n[21b] M33 大威力轴：三张 2/3 费终结技');
  // 炸药包：卖血换威力
  fresh(300);
  hand(['blast_charge']);
  play('blast_charge');
  assert(enemyHp() === 278, '「炸药包」22 伤');
  assert(playerHp() === 71, '「炸药包」失去 4 点生命');

  // 凿岩机：三段重击
  fresh(300);
  hand(['jackhammer']);
  play('jackhammer');
  assert(enemyHp() === 270, '「凿岩机」10×3 = 30 伤');

  // 基岩锤：攻防一体
  fresh(300);
  hand(['bedrock_hammer']);
  play('bedrock_hammer');
  assert(enemyHp() === 276, '「基岩锤」24 伤');
  assert(S().player.block === 12, '「基岩锤」获得 12 点格挡');

  // M33 数值守卫（同 M32b 思路：按语义算收益比，同档不得互相压制）。
  // 三条都有「会红」的反例 —— 有人把数值抬过线，这里当场翻车。
  const dmgOf = (c) => (c.v.dmg || 0) * (c.v.times || 1);
  // ① 炸药包是「卖血换直伤」：上限 = 同费同档无代价最强（双持撬棍 18）×1.25
  //    （旧值回算：若抬到 26 伤，26 > 22.5 判红）
  assert(dmgOf(CARDS.blast_charge) <= dmgOf(CARDS.dual_crowbar) * 1.25,
    '「炸药包」' + dmgOf(CARDS.blast_charge) + ' 伤 ≤ 双持撬棍 18 的 125%（卖血换威力有上限）');
  // ② 凿岩机无铺垫 30 伤：不得超过井底之锤基础 26 的 1.25 倍（成长空间让给铺垫轴）
  assert(dmgOf(CARDS.jackhammer) <= dmgOf(CARDS.bottom_hammer) * 1.25,
    '「凿岩机」' + dmgOf(CARDS.jackhammer) + ' 伤 ≤ 井底之锤 26 的 125%（无铺垫多段不压制成长轴）');
  // ③ 基岩锤白送格挡：直伤必须不高于井底之锤，否则对纯终结技全面优于
  assert(dmgOf(CARDS.bedrock_hammer) <= dmgOf(CARDS.bottom_hammer),
    '「基岩锤」' + dmgOf(CARDS.bedrock_hammer) + ' 伤 ≤ 井底之锤 26（带格挡的卡直伤不得反超）');

  // ==========================================================
  console.log('\n[21c] M33b 补缺：掘者低层能力牌「配重校准」');
  // 问题：掘者最低的能力牌在 DL5，而掉落池下限是 max(2, DL) —— 玩家卡在
  // DL1–4 时池子里一张能力牌都没有（实测 0.0%，医师/引火者约 33%/38%）。
  fresh(300);
  hand(['counterweight']);
  play('counterweight');
  assert(S().player.buffs.dex === 2, '「配重校准」给玩家 2 点敏捷');
  assert(S().discardPile.length === 0, '能力牌打出后不进弃牌堆（本场战斗移除）');

  fresh(300);
  hand(['counterweight', 'defend']);
  play('counterweight');
  play('defend');
  assert(S().player.block === 5 + 2, '敏捷让「防御」5 → 7 格挡（每张格挡牌都多吃 2）');

  fresh(300);
  hand(['counterweight']);
  upgradeCard(asCard('counterweight'));
  play('counterweight');
  assert(S().player.buffs.dex === 3, '升级后「配重校准」给 3 点敏捷');

  // 这条是本次修复的回归网：掉落池下限是 2 ⇒ 停在 DL1 的玩家实际抽的是 dl≤2 的池。
  // 旧值回算：补这张卡之前，掘者 dl≤2 池里能力牌 0 张，这条直接判红。
  const lowPool = rewardPool('digger', 2);
  assert(lowPool.filter((k) => CARDS[k].type === 'power').length >= 1,
    '掘者低 DL 掉落池（dl≤2）能力牌 ≥1 张（实际 ' +
    lowPool.filter((k) => CARDS[k].type === 'power').length + ' 张，旧版为 0）');

  console.log('\n' + (fail === 0 ? '全部通过' : '存在失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败\n');
  if (fail > 0) throw new Error('M2 卡池测试未全部通过');
}

vm.runInContext('(' + suite.toString() + ')()', sandbox);
