// M6 验证：拾荒医师（样本）与引火者（余烬）两套资源系统。
// 只加载逻辑层，不加载 render.js。
//
// 分工：m2 只管掘者的 46 张卡（它按 char 过滤过），这里管另外两个角色
// + 资源系统本身 + §8.4 的差异化验收。
//
// 运行：node tests/m6-characters.test.js

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

  const S = () => Combat.state;
  const res = () => Combat.resource();

  // 干净的战斗状态。charId 决定玩家是谁、有没有资源。
  function fresh(charId, enemyHp) {
    Combat.start(20260923, { charId: charId });
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
    s.player.resource.value = 0;
    s.depth = 1;
    s.hand = [];
    s.drawPile = [];
    s.discardPile = [];
    s.log = [];
    return s;
  }

  function hand(ids) { S().hand = ids.map((id) => mkCard(id)); }
  function asCard(id) { return S().hand.filter((c) => c.def.id === id)[0]; }
  function play(id) {
    const c = asCard(id);
    if (!c) throw new Error('手牌里没有 ' + id);
    Combat.playCard(c.uid);
  }
  // 直接结算，绕过手牌 —— 用来单测卡的效果
  function cast(id) {
    const c = mkCard(id);
    c.def.play(Combat.ctx(), c);
    return c;
  }

  // ==========================================================
  console.log('\n[1] 角色与卡池结构');
  const charIds = Object.keys(CHARACTERS);
  assert(charIds.length === 3, '三个角色都定义了（实际 ' + charIds.length + '）');
  assert(CHAR_ORDER.length === 3 && CHAR_ORDER.every((c) => CHARACTERS[c]), '展示顺序里的 id 都存在');

  let starterErr = [];
  CHAR_ORDER.forEach(function (cid) {
    const ch = CHARACTERS[cid];
    if (ch.starterDeck.length !== 10) starterErr.push(cid + ':张数 ' + ch.starterDeck.length);
    ch.starterDeck.forEach(function (id) {
      if (!CARDS[id]) starterErr.push(cid + ':' + id + ' 不存在');
      else if (CARDS[id].char !== cid) starterErr.push(cid + ':' + id + ' 属于 ' + CARDS[id].char);
    });
  });
  assert(starterErr.length === 0, '每个角色起始卡组 10 张且都属于自己的卡池' +
    (starterErr.length ? ' —— ' + starterErr.join('，') : ''));

  const deckSets = CHAR_ORDER.map((c) => CHARACTERS[c].starterDeck.slice().sort().join(','));
  assert(new Set(deckSets).size === 3, '三个角色的起始卡组互不相同');

  // 每个角色的卡池规模（M17：三个角色都补齐到 40 张；M32 群体系各 +3）
  const expect = { digger: 51, medic: 43, keeper: 43 };
  let sizeErr = [];
  CHAR_ORDER.forEach(function (cid) {
    const all = Object.keys(CARDS).filter((k) => CARDS[k].char === cid);
    if (all.length !== expect[cid]) sizeErr.push(cid + ':' + all.length + '≠' + expect[cid]);
  });
  assert(sizeErr.length === 0, '各角色卡池规模正确（掘者 51 含 1 诅咒，M64 重防轴 +2 / M65 夯击 +1 / 医师 43 / 引火者 43）' +
    (sizeErr.length ? ' —— ' + sizeErr.join('，') : ''));

  // M17：两个角色的卡池补齐到与掘者同规格 —— 10 基础 + DL1–DL10 各 3 张
  // M32 群体系：医师 DL2/6/9、引火者 DL4/6/9 各 +1 张全体攻击
  const extraDl = { medic: [2, 6, 9], keeper: [4, 6, 9] };
  let shapeErr = [];
  ['medic', 'keeper'].forEach(function (cid) {
    const all = Object.keys(CARDS).filter((k) => CARDS[k].char === cid);
    const n = (r, dl) => all.filter((k) => CARDS[k].rarity === r && CARDS[k].dl === dl).length;
    if (n('basic', 0) !== 10) shapeErr.push(cid + ' 基础池 ' + n('basic', 0));
    for (let dl = 1; dl <= 10; dl++) {
      const want = extraDl[cid].indexOf(dl) >= 0 ? 4 : 3;
      if (all.filter((k) => CARDS[k].dl === dl).length !== want) {
        shapeErr.push(cid + ' DL' + dl + ' 不是 ' + want + ' 张');
      }
    }
  });
  assert(shapeErr.length === 0, '两套新卡池都是 10 基础 + DL1–DL10 各 3 张 + 群体系各层 +1' +
    (shapeErr.length ? ' —— ' + shapeErr.join('，') : ''));

  // M17 设计约定：dl3–6 为 uncommon、dl7–10 为 rare
  // （dl1/dl2 的原值不动 —— 医师 dl2 已是 uncommon，不为了整齐把它降回 common）
  let rarityErr = [];
  ['medic', 'keeper'].forEach(function (cid) {
    Object.keys(CARDS).filter((k) => CARDS[k].char === cid).forEach(function (k) {
      const d = CARDS[k];
      if (d.dl >= 3 && d.dl <= 6 && d.rarity !== 'uncommon') rarityErr.push(k + ' DL' + d.dl + '=' + d.rarity);
      if (d.dl >= 7 && d.rarity !== 'rare') rarityErr.push(k + ' DL' + d.dl + '=' + d.rarity);
    });
  });
  assert(rarityErr.length === 0, 'DL3–6 稀有度为 uncommon、DL7–10 为 rare' +
    (rarityErr.length ? ' —— ' + rarityErr.join('，') : ''));

  const allIds = Object.keys(CARDS);
  const names = allIds.map((k) => CARDS[k].name);
  assert(new Set(names).size === names.length, '全卡池卡名无重复（共 ' + names.length + ' 张）');
  assert(allIds.every((k) => CARDS[k].id === k), '每张卡的 id 与键名一致');

  const curseOf = (cid) => allIds.filter((k) => CARDS[k].char === cid && CARDS[k].rarity === 'curse');
  assert(curseOf('digger').length === 1, '诅咒卡仍挂在掘者名下（M4 的旧数据没被角色分组打乱）');

  // 奖励池按角色隔离
  let poolErr = [];
  CHAR_ORDER.forEach(function (cid) {
    const pool = rewardPool(cid);
    if (!pool.length) poolErr.push(cid + ' 奖励池为空');
    pool.forEach(function (k) {
      if (CARDS[k].char !== cid) poolErr.push(cid + ' 的池里混进了 ' + k);
      if (CARDS[k].rarity === 'basic' || CARDS[k].rarity === 'curse') poolErr.push(cid + ' 的池里有 ' + k);
    });
  });
  assert(poolErr.length === 0, '奖励池按角色隔离，且不含基础卡与诅咒卡' +
    (poolErr.length ? ' —— ' + poolErr.join('，') : ''));

  const poolSets = CHAR_ORDER.map((c) => rewardPool(c).slice().sort().join(','));
  assert(new Set(poolSets).size === 3, '三个角色的奖励池互不重叠（§8.4 第一条）');

  // M33b 回归网：低 DL 掉落池必须至少有一张能力牌。
  // 掉落池下限是 max(2, DL)，玩家卡在 DL1–4 时实际能抽到的就是 dl≤2 的卡 ——
  // 掘者此前最低的能力牌在 DL5，于是「玩几次都没能力牌出现」（实测 0.0%）。
  // 旧值回算：补「配重校准」之前，这条对掘者是红的。
  let powerErr = [];
  CHAR_ORDER.forEach(function (cid) {
    const n = rewardPool(cid, 2).filter((k) => CARDS[k].type === 'power').length;
    if (n < 1) powerErr.push(cid + ' ' + n + ' 张');
  });
  assert(powerErr.length === 0, '三个角色的低 DL 掉落池（dl≤2）都至少有 1 张能力牌' +
    (powerErr.length ? ' —— ' + powerErr.join('，') : ''));

  // 升级数据完整
  const newCards = allIds.filter((k) => CARDS[k].char === 'medic' || CARDS[k].char === 'keeper');
  const noUp = newCards.filter((k) => !CARDS[k].upV);
  const upSame = newCards.filter((k) => JSON.stringify(CARDS[k].v) === JSON.stringify(CARDS[k].upV));
  assert(noUp.length === 0, '新卡都有升级数据');
  assert(upSame.length === 0, '新卡升级后数值确实有变化');

  // ==========================================================
  // M17：DL3–DL10 的 53 张新卡逐张打出，不能抛错。
  // m2 的冒烟只管掘者（它不加载这两个角色文件），所以这里必须自己走一遍。
  // 前置条件全垫上：资源（够 need 门槛）、格挡、低血线、敌人身上有中毒可读。
  console.log('\n[1b] 冒烟：DL3–DL10 的 53 张新卡逐张打出');
  const dlCards = newCards.filter((k) => CARDS[k].dl >= 3);
  assert(dlCards.length === 53, 'DL3+ 新卡共 53 张（实际 ' + dlCards.length + '）');
  assert(dlCards.every((k) => CARDS[k].cost >= 0 && CARDS[k].cost <= 3),
    '新卡费用都在 0–3（设计上限）');

  let smokeErr = null;
  let smokeFail = 0;
  dlCards.forEach(function (k) {
    const cid = CARDS[k].char;
    fresh(cid, 300);
    const s = S();
    s.player.resource.value = cid === 'keeper' ? 6 : 5; // 够所有 need 门槛
    s.player.block = 12;
    s.player.hp = 40; // 低于 50% —— 触发「低血线」分支
    s.player.maxHp = 75;
    s.enemy.buffs.poison = 10; // 让「毒理学 / 毒力」有东西可读
    s.enemy.buffs.burn = 5;
    // 垫两张牌：抽牌堆为空时会把刚打出的牌洗回来，干扰"已离开手牌"的判定
    s.drawPile = [mkCard(CHARACTERS[cid].starterDeck[0]), mkCard(CHARACTERS[cid].starterDeck[1])];
    hand([k]);
    const uid = asCard(k).uid;
    const cost = CARDS[k].cost;

    try {
      Combat.playCard(uid);
    } catch (e) {
      smokeFail++; smokeErr = CARDS[k].name + '：' + e.message; return;
    }
    if (s.hand.filter((c) => c.uid === uid).length > 0) {
      smokeFail++; smokeErr = CARDS[k].name + '：打出后仍在手牌里'; return;
    }
    if (s.player.energy !== 99 - cost) {
      smokeFail++; smokeErr = CARDS[k].name + '：能量扣减错误（' + s.player.energy + '）'; return;
    }
    const t1 = CARDS[k].text(CARDS[k].v);
    const t2 = CARDS[k].text(CARDS[k].upV);
    if (!t1 || !t2) { smokeFail++; smokeErr = CARDS[k].name + '：描述文字生成失败'; }
  });
  assert(smokeFail === 0, '53 张新卡逐张打出无异常' + (smokeErr ? ' — ' + smokeErr : ''));

  // ==========================================================
  // 机制族抽样：48 张逐条写断言不现实，但每个**新机制族**至少一条数值断言
  // （冒烟只证明「不抛错」，证明不了「真的按卡面结算」）
  console.log('\n[1c] DL3–DL10 新机制的数值验证');

  // 资源缩放（余烬/样本直接进伤害公式）
  fresh('medic', 300); S().player.resource.value = 4; cast('triage');
  assert(S().enemy.hp === 300 - (5 + 4 * 2), '「分诊」伤害随样本缩放（5 + 4×2 = 13）');
  fresh('keeper', 300); S().player.resource.value = 3; cast('cinder');
  assert(S().enemy.hp === 300 - (5 + 3 * 3), '「烬火」伤害随余烬缩放（5 + 3×3 = 14）');
  fresh('medic', 300); S().player.resource.value = 3; cast('ash_cloak');
  assert(S().player.block === 4 + 3 * 2, '「灰烬斗篷」格挡随余烬缩放（4 + 3×2 = 10）');

  // 毒 / 燃烧转伤害
  fresh('medic', 300); S().enemy.buffs.poison = 12; cast('toxicology');
  assert(S().enemy.hp === 300 - (6 + Math.floor(12 / 5) * 2), '「毒理学」按毒层加成（12 毒 → +4 = 10）');

  // 倍率叠毒：addBuff 是累加，×2 = 再补一份当前层数
  fresh('medic', 300); S().player.resource.value = 2; S().enemy.buffs.poison = 7; cast('virulence');
  assert(S().enemy.buffs.poison === 14, '「毒力」把毒层翻倍（7 → 14）');
  assert(S().player.resource.value === 0, '「毒力」消耗掉全部样本');

  // 消耗全部资源爆发
  fresh('medic', 300); S().player.resource.value = 5; cast('culture_burst');
  assert(S().enemy.hp === 300 - 15, '「培养爆」消耗全部样本打「样本数×3」= 15');

  // 多段 + 每段夹 buff（attackTimes 做不到，走的是自写循环）
  fresh('medic', 300); cast('dissection');
  assert(S().enemy.hp === 300 - 8 * 2 && S().enemy.buffs.poison === 6, '「剖检」两段各 8 伤 + 3 毒');
  fresh('keeper', 300); cast('flame_whip');
  assert(S().enemy.hp === 300 - 4 * 2 && S().enemy.buffs.burn === 4, '「焰鞭」两段各 4 伤 + 2 燃烧');

  // 低血线分支（< 50% 走高值）
  fresh('keeper', 300); S().player.hp = 30; cast('desperation');
  assert(S().enemy.hp === 300 - 16, '「孤注」低血线时按高值结算（16）');
  fresh('keeper', 300); cast('desperation');
  assert(S().enemy.hp === 300 - 8, '「孤注」血量健康时按基础值（8）');

  // 群体：多敌人下逐个体生效
  fresh('keeper', 300); Combat.addEnemy('hound'); cast('ember_storm');
  assert(S().enemies.length === 2 && S().enemies.every((e) => e.buffs.burn === 5),
    '「余烬风暴」对所有敌人都上 5 层燃烧');

  // 卖血与余烬的先后：自伤走 loseHp，不触发 onDamaged —— 不该「卖血反而涨余烬」
  fresh('keeper', 300); S().player.resource.value = 3; cast('blood_forge');
  assert(S().player.hp === 75 - 6 && S().enemy.hp === 300 - 12 && S().player.resource.value === 0,
    '「血锻」先卖血再结算余烬（自伤不涨余烬，3 点 → 12 伤）');

  // 无视格挡
  fresh('medic', 300); S().enemy.block = 20; cast('final_diagnosis');
  assert(S().enemy.hp === 300 - 24 && S().enemy.block === 20, '「终末诊断」24 伤无视 20 点格挡（M31 平衡：原 30）');

  // 能力牌：回合钩子真的挂上了
  fresh('medic', 300); cast('metabolism');
  assert(S().player.buffs.resPerTurn === 2, '「代谢」挂上每回合 +2 样本');
  fresh('medic', 300); cast('immunity');
  assert(S().player.buffs.metallicize === 4 && S().player.buffs.resPerTurn === 1,
    '「免疫」同时挂上格挡与样本两条回合钩子');

  // 治疗 + 格挡的终局卡
  fresh('medic', 300); S().player.hp = 50; cast('panacea');
  assert(S().player.hp === 65 && S().player.block === 15, '「万灵药」回复 15 生命 + 15 格挡');

  // ==========================================================
  console.log('\n[2] 样本系统（拾荒医师）');
  let s = fresh('medic');
  assert(S().player.name === '拾荒医师', '开局玩家是拾荒医师');
  assert(res() === 0, '开局 0 样本');
  assert(S().player.resource.key === 'sample' && S().player.resource.max === 5, '样本规格：上限 5');

  s.player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(res() === 1, '回合开始 +1 样本');
  Combat.startPlayerTurn();
  assert(res() === 2, '第二个回合累积到 2');

  for (let i = 0; i < 20; i++) Combat.gainResource(1, true);
  assert(res() === 5, '样本不会超过上限 5（灌了 20 点后仍是 ' + res() + '）');
  assert(Combat.gainResource(1, true) === 0, '已满时再加返回 0（没有实际获得）');

  assert(Combat.spendResource(3) === true && res() === 2, '花 3 点样本成功');
  assert(Combat.spendResource(5) === false && res() === 2, '不够时拒绝，且一点不扣（这就是"半扣"要防的）');

  // 显微镜：能力牌加速资源
  fresh('medic');
  hand(['microscope']);
  play('microscope');
  assert((S().player.buffs.resPerTurn || 0) === 1, '「显微镜」挂上资源产量 +1');
  s = S();
  s.player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(res() === 2, '每回合变成 +2（角色基础 1 + 显微镜 1）');

  // ==========================================================
  console.log('\n[3] 余烬系统（引火者）');
  fresh('keeper');
  assert(S().player.name === '引火者', '开局玩家是引火者');
  assert(res() === 0, '开局 0 余烬');
  assert(S().player.resource.max === null, '余烬无上限（卖血的代价本身就是限制）');

  // 余烬的三个"算"与"不算" —— 这是最容易写错的一段
  Combat.dealDamage(S().enemy, S().player, 6);
  assert(res() === 1, '被敌人打掉血 → +1 余烬');

  fresh('keeper');
  S().player.block = 20;
  Combat.dealDamage(S().enemy, S().player, 6);
  assert(res() === 0, '被格挡完全挡光的攻击**不**算受到伤害（否则叠甲就能白刷资源）');

  fresh('keeper');
  Combat.loseHp(S().player, 8);
  assert(res() === 0, '自伤（loseHp）不累积余烬 —— 那条线由卡面显式给，避免双重计数');

  fresh('keeper');
  S().player.buffs.poison = 3;
  Combat.tickPoison(S().player);
  assert(res() === 0, '中毒不累积余烬（设计里只有"被击中"算）');

  fresh('keeper');
  for (let i = 0; i < 12; i++) Combat.dealDamage(S().enemy, S().player, 1);
  assert(res() === 12 && S().player.hp > 0, '余烬可以一直堆上去（12 次受击 = 12 点）');

  // 「不灭」的阈值
  fresh('keeper');
  hand(['undying']);
  play('undying');
  s = S();
  s.player.hp = 75;
  s.player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(res() === 0, '「不灭」血线高于 30% 时不触发');
  s.player.hp = 20; // 75 的 26.7%
  s.player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(res() === 2, '血量低于 30% 时每回合 +2 余烬');

  // ==========================================================
  console.log('\n[4] 拾荒医师卡逐张');
  fresh('medic');
  hand(['scalpel']);
  play('scalpel');
  assert(S().enemy.hp === 294, '「解剖刀」造成 6 点伤害');

  fresh('medic');
  hand(['tourniquet']);
  play('tourniquet');
  assert(S().player.block === 5, '「止血带」获得 5 点格挡');

  fresh('medic');
  hand(['sampling']);
  play('sampling');
  assert(res() === 1, '「采样」获得 1 点样本');

  fresh('medic');
  hand(['sampling']);
  play('sampling');
  assert(S().player.energy === 99, '「采样」是 0 费，不消耗能量');

  fresh('medic');
  hand(['disinfect']);
  play('disinfect');
  assert(S().player.block === 4 && res() === 1, '「消毒」同时给格挡与样本');

  fresh('medic');
  hand(['injection']);
  S().player.hp = 50;
  play('injection');
  assert(S().player.hp === 55 && res() === 1, '「血清注射」回血并给样本');

  fresh('medic');
  hand(['antibody']);
  play('antibody');
  assert(S().player.block === 4 && (S().enemy.buffs.weak || 0) === 2, '「抗体」给格挡并施加 2 层虚弱');

  fresh('medic');
  hand(['pathology']);
  S().drawPile = [mkCard('scalpel'), mkCard('scalpel'), mkCard('scalpel')];
  play('pathology');
  assert(S().hand.length === 2, '「病理分析」抽 2 张');

  // 活检：有样本 / 没样本两条分支
  fresh('medic');
  hand(['biopsy']);
  play('biopsy');
  assert(S().enemy.hp === 295 && res() === 0, '「活检」没样本时按低伤害结算');

  fresh('medic');
  S().player.resource.value = 2;
  hand(['biopsy']);
  play('biopsy');
  assert(S().enemy.hp === 290 && res() === 1, '「活检」有样本时消耗 1 点并打出高伤害');

  // 清创：中毒目标才回血
  fresh('medic');
  hand(['debride']);
  S().player.hp = 60;
  play('debride');
  assert(S().player.hp === 60, '「清创」目标没中毒时不回血');

  fresh('medic');
  hand(['debride']);
  S().enemy.buffs.poison = 3;
  S().player.hp = 60;
  play('debride');
  assert(S().player.hp === 63, '「清创」目标中毒时回复 3 点生命');

  // DL1
  fresh('medic');
  S().player.resource.value = 3;
  hand(['serum3', 'serum3']);
  play('serum3');
  assert(S().enemy.hp === 288 && res() === 1, "「血清三号」消耗 2 样本造成 12 点伤害（M82 F6 调整；300 − 12）");

  fresh('medic');
  hand(['serum3']);
  assert(Combat.canPlay(asCard('serum3')) === false, '样本不足时「血清三号」打不出去（灰掉而不是空打）');
  fresh('medic');
  S().player.resource.value = 2;
  hand(['serum3']);
  assert(Combat.canPlay(asCard('serum3')) === true, '样本够了就能打');

  fresh('medic');
  hand(['observation']);
  S().drawPile = [mkCard('scalpel'), mkCard('scalpel'), mkCard('scalpel')];
  play('observation');
  assert(S().hand.length === 1, '「临床观察」没样本时只抽 1 张');

  fresh('medic');
  S().player.resource.value = 1;
  hand(['observation']);
  S().drawPile = [mkCard('scalpel'), mkCard('scalpel'), mkCard('scalpel')];
  play('observation');
  assert(S().hand.length === 2 && res() === 0, '「临床观察」花 1 样本多抽 1 张');

  fresh('medic');
  S().player.resource.value = 3;
  hand(['petri']);
  play('petri');
  assert((S().enemy.buffs.poison || 0) === 8 && res() === 0, '「培养皿」消耗 3 样本施加 8 层中毒');

  // DL2
  fresh('medic');
  hand(['regen_tissue']);
  S().player.resource.value = 4;
  S().player.hp = 50;
  play('regen_tissue');
  assert(S().player.hp === 62, '「组织再生」每样本回 3 点（4 × 3 = 12）');

  fresh('medic');
  S().player.resource.value = 5;
  hand(['bloom']);
  play('bloom');
  assert((S().enemy.buffs.poison || 0) === 15 && res() === 0, '「菌群爆发」消耗全部 5 样本施加 15 层中毒');

  fresh('medic');
  hand(['bloom']);
  assert(Combat.canPlay(asCard('bloom')) === false, '没样本时「菌群爆发」打不出去');

  // 寄生：敌人吃中毒伤害时回血
  fresh('medic');
  hand(['parasite']);
  play('parasite');
  assert((S().player.buffs.parasite || 0) === 1, '「寄生」挂上能力');
  S().player.hp = 50;
  S().enemy.buffs.poison = 6;
  Combat.tickPoison(S().enemy);
  assert(S().player.hp === 56, '敌人受到 6 点中毒伤害，玩家回复 6 点生命');

  fresh('medic');
  hand(['parasite']);
  upgradeCard(asCard('parasite'));
  play('parasite');
  S().player.hp = 50;
  S().enemy.buffs.poison = 4;
  Combat.tickPoison(S().enemy);
  assert(S().player.hp === 58, '升级后额外回 4 点（4 点中毒伤害 + 4）');

  fresh('medic');
  hand(['parasite']);
  play('parasite');
  S().player.hp = 50;
  Combat.dealDamage(S().enemy, S().enemy, 5); // 敌人吃直接伤害
  assert(S().player.hp === 50, '「寄生」只认中毒伤害，直接伤害不回血');

  // ==========================================================
  console.log('\n[5] 引火者卡逐张');
  fresh('keeper');
  hand(['tongs']);
  play('tongs');
  assert(S().enemy.hp === 294, '「火钳」造成 6 点伤害');

  fresh('keeper');
  hand(['ash_guard']);
  play('ash_guard');
  assert(S().player.block === 5, '「灰盾」获得 5 点格挡');

  fresh('keeper');
  hand(['spark']);
  play('spark');
  assert(S().player.hp === 73 && res() === 2, '「擦火」失去 2 生命换 2 余烬');

  fresh('keeper');
  hand(['scorch']);
  play('scorch');
  assert(S().enemy.hp === 293, '「灼烧」高血量时按低伤害结算（7）');

  fresh('keeper');
  hand(['scorch']);
  S().player.hp = 30; // 75 的 40%
  play('scorch');
  assert(S().enemy.hp === 289, '「灼烧」血量低于 50% 时按高伤害结算（11）');

  fresh('keeper');
  hand(['kindle']);
  play('kindle');
  assert((S().enemy.buffs.burn || 0) === 3, '「引燃」施加 3 层燃烧');

  fresh('keeper');
  hand(['ember_gift']);
  S().drawPile = [mkCard('tongs')];
  play('ember_gift');
  assert(res() === 1 && S().hand.length === 1, '「火种」给 1 余烬并抽 1 张');

  fresh('keeper');
  hand(['blood_rite']);
  play('blood_rite');
  assert(S().player.hp === 72 && S().enemy.hp === 290, '「血祭」失去 3 生命造成 10 点伤害');

  fresh('keeper');
  hand(['smokescreen']);
  play('smokescreen');
  assert(S().player.block === 5, '「烟幕」获得 5 点格挡（M31 平衡：对齐同池灰盾，原 7）');

  fresh('keeper');
  hand(['firewood']);
  play('firewood');
  S().player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(res() === 1, '「薪柴」让每回合额外 +1 余烬');

  // 焚身 / 自焚：对全体
  fresh('keeper');
  Combat.addEnemy('crawler', { hp: 50 });
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['burn_self']);
  const before3 = S().enemies.map((e) => e.hp);
  play('burn_self');
  assert(S().enemies.every((e, i) => e.hp === before3[i] - 8), '「焚身」对全部 3 个敌人各造成 8 点伤害');
  assert(S().player.hp === 70, '「焚身」自己失去 5 点生命');

  // DL1
  fresh('keeper');
  hand(['offering']);
  play('offering');
  assert(S().player.hp === 70 && res() === 3 && S().enemy.hp === 290,
    '「献燔」失去 5 生命、得 3 余烬、造成 10 点伤害（是 +3 不是 +4）');

  fresh('keeper');
  S().player.resource.value = 2;
  hand(['ash_baptism']);
  play('ash_baptism');
  assert(S().player.block === 6 && res() === 0, '「灰烬洗礼」消耗 2 余烬获得 6 点格挡');

  fresh('keeper');
  hand(['ash_baptism']);
  assert(Combat.canPlay(asCard('ash_baptism')) === false, '余烬不足时「灰烬洗礼」打不出去');

  fresh('keeper');
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['immolation']);
  // 开场自带的那只怪是 300 血，不能拿新加那两只的 50 血去比 —— 用差值
  const beforeImmo = S().enemies.map((e) => e.hp);
  play('immolation');
  assert(S().enemies.every((e, i) => e.hp === beforeImmo[i] - 12), '「自焚」对全体各造成 12 点伤害');
  assert(S().player.hp === 67, '「自焚」自己失去 8 点生命');

  // DL2
  fresh('keeper');
  S().player.resource.value = 5;
  hand(['resonance']);
  play('resonance');
  assert((S().player.buffs.strTurn || 0) === 5, '「火种共鸣」把 5 点余烬转成本回合力量 +5');
  hand(['tongs']);
  play('tongs');
  assert(S().enemy.hp === 300 - 11, '本回合的攻击吃到了 +5（6 + 5 = 11）');
  S().player.buffs.strTurn && Combat.endTurn();
  assert(!S().player.buffs.strTurn, '回合结束后 strTurn 被清掉');

  fresh('keeper');
  hand(['resonance']);
  play('resonance');
  S().player.resource.value = 0;
  Combat.startPlayerTurn();
  assert(!S().player.buffs.strTurn, 'strTurn 不会跨回合残留（「本回合」是动真格的）');

  fresh('keeper');
  S().player.resource.value = 4;
  hand(['last_flame']);
  play('last_flame');
  assert(S().enemy.hp === 284 && res() === 0, '「最后一把火」消耗 4 余烬造成 16 点伤害');

  fresh('keeper', 30); // 30 血 < 10 余烬 × 4 = 40 伤害，够一击必杀
  S().player.resource.value = 10;
  hand(['last_flame']);
  S().player.hp = 40;
  play('last_flame');
  assert(S().enemy.hp <= 0 && S().player.hp === 50, '「最后一把火」击杀后回复 10 点生命');

  fresh('keeper', 300);
  S().player.resource.value = 3;
  hand(['last_flame']);
  S().player.hp = 40;
  play('last_flame');
  assert(S().player.hp === 40, '没击杀就不回血');

  fresh('keeper');
  hand(['last_flame']);
  assert(Combat.canPlay(asCard('last_flame')) === false, '没余烬时「最后一把火」打不出去');

  // ==========================================================
  console.log('\n[6] 燃烧（M6 补齐的引擎缺口）');
  fresh('keeper');
  hand(['kindle']);
  play('kindle');
  const burnBefore = S().enemy.hp;
  Combat.tickBurn(S().enemy);
  assert(S().enemy.hp === burnBefore - 3, '燃烧在回合开始扣 N 点');
  Combat.tickBurn(S().enemy);
  assert(S().enemy.hp === burnBefore - 6, '燃烧**不衰减** —— 第二次仍扣 3（这就是与中毒的区别，§7）');
  assert((S().enemy.buffs.burn || 0) === 3, '层数保持不变');

  fresh('keeper');
  S().player.buffs.burn = 4;
  S().player.hp = 75;
  Combat.startPlayerTurn();
  assert(S().player.hp === 71, '玩家身上的燃烧同样在回合开始结算');

  // ==========================================================
  console.log('\n[6b] M32 群体系：三角色各 3 张全体攻击');

  // ---- 医师 ----
  fresh('medic', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['multi_swab']);
  const msBefore = S().enemies.map((e) => e.hp);
  play('multi_swab');
  assert(S().enemies.every((e, i) => e.hp === msBefore[i] - 3), '「多点采样」对全部 3 个敌人各 3 点伤害');
  assert(S().enemies.every((e) => (e.buffs.poison || 0) === 1), '「多点采样」全体各 1 层中毒');

  fresh('medic', 300);
  S().player.resource.value = 3;
  hand(['aerosol_bloom']);
  const abBefore = S().enemy.hp;
  play('aerosol_bloom');
  assert(S().enemy.hp === abBefore - 6, '「气溶胶爆发」消耗 3 样本 ×2 = 6 点伤害');
  assert(res() === 0, '「气溶胶爆发」样本清空');

  fresh('medic', 300);
  hand(['aerosol_bloom']);
  assert(Combat.canPlay(asCard('aerosol_bloom')) === false, '没样本时「气溶胶爆发」打不出去');

  fresh('medic', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  S().enemies[1].block = 20;
  hand(['virulent_outbreak']);
  const voBefore = S().enemies.map((e) => e.hp);
  play('virulent_outbreak');
  // 走的是带格挡结算：副目标的 20 点格挡吸收这一击，血量不动、格挡剩 12
  assert(S().enemies[0].hp === voBefore[0] - 8, '「暴发性感染」无格挡目标扣 8 血');
  assert(S().enemies[1].hp === voBefore[1] && S().enemies[1].block === 12,
    '「暴发性感染」副目标被 20 点格挡吸收（血不动、格挡剩 12）');
  assert(S().enemies.every((e) => (e.buffs.poison || 0) === 4), '「暴发性感染」全体各 4 层中毒（格挡不挡中毒）');

  // ---- 引火者 ----
  fresh('keeper', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['tongue_of_fire']);
  const tfBefore = S().enemies.map((e) => e.hp);
  play('tongue_of_fire');
  assert(S().enemies.every((e, i) => e.hp === tfBefore[i] - 4), '「火舌」对全部 3 个敌人各 4 点伤害');
  assert(S().enemies.every((e) => (e.buffs.burn || 0) === 2), '「火舌」全体各 2 层燃烧');

  fresh('keeper', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['ash_storm']);
  const asBefore = S().enemies.map((e) => e.hp);
  S().player.hp = 70;
  play('ash_storm');
  assert(S().enemies.every((e, i) => e.hp === asBefore[i] - 11), '「灰烬风暴」全体各 11 点伤害');
  assert(S().player.hp === 65, '「灰烬风暴」自己失去 5 点生命');
  assert(res() === 2, '「灰烬风暴」获得 2 点余烬');

  fresh('keeper', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['ash_storm']);
  const asdBefore = S().enemies.map((e) => e.hp);
  S().player.hp = 3;
  play('ash_storm');
  assert(S().enemies.every((e, i) => e.hp === asdBefore[i]), '血不够卖（3 < 5）→ 人先倒下，伤害不再结算');

  fresh('keeper', 300);
  Combat.addEnemy('crawler', { hp: 50 });
  hand(['judgement_fire']);
  const jfBefore = S().enemies.map((e) => e.hp);
  play('judgement_fire');
  assert(S().enemies.every((e, i) => e.hp === jfBefore[i] - 12), '「天火」全体各 12 点伤害');
  assert(S().enemies.every((e) => (e.buffs.burn || 0) === 5), '「天火」全体各 5 层燃烧');

  // M32 后置数值复核（2026-10-02）：群体卡的**双敌等效收益**不得超过同角色同费单体最强的预算。
  // 预算：无代价 125%；带「失去生命」代价的放宽到 150%（卖血买强度是引火者的既有交换）。
  // 「消耗全部资源」型按满资源折算：医师样本上限 5；引火者余烬无上限，同样取 5 作中期典型值。
  // ⚠️ 基础伤害与「每资源加成」要**相加**（烬火 = 5 伤 + 余烬×3），只取 per 会低估基线。
  const EQ2 = (c, n) => {
    const v = c.v || {};
    const base = (v.dmg || 0) * (v.times || 1) + (v.per ? v.per * 5 : 0);
    return (base + (v.burn || 0) + (v.poison || 0)) * n + (v.block || 0);
  };
  const isAll = (c) => /ctx\.enemies/.test(c.play.toString());
  const expectAoe = { medic: 3, keeper: 7 }; // 医师 M32 才补上群体系；引火者原有 4 张（焚身/自焚/烈焰/焚世）+ M32 三张
  ['medic', 'keeper'].forEach(function (ch) {
    const aoes = Object.keys(CARDS).filter((k) =>
      CARDS[k].char === ch && CARDS[k].type === 'attack' && isAll(CARDS[k]));
    assert(aoes.length === expectAoe[ch], ch + ' 群体攻击卡 ' + expectAoe[ch] +
      ' 张（实际 ' + aoes.length + '）');
    aoes.forEach(function (k) {
      const c = CARDS[k];
      const singles = Object.keys(CARDS).filter((s) =>
        CARDS[s].char === ch && CARDS[s].type === 'attack' && CARDS[s].cost === c.cost &&
        !isAll(CARDS[s]) && ((CARDS[s].v.dmg || 0) > 0 || CARDS[s].v.per));
      if (!singles.length) return;
      const best = singles.map((s) => EQ2(CARDS[s], 1)).reduce((a, b) => Math.max(a, b), 0);
      const budget = (c.v.hp || c.v.selfHurt) ? 1.5 : 1.25;
      const ratio = EQ2(c, 2) / best;
      assert(ratio <= budget, '「' + c.name + '」双敌等效 ' + EQ2(c, 2) + ' 不超过同费单体最强 ' +
        best + ' 的 ' + (budget * 100) + '%（实际 ' + (ratio * 100).toFixed(0) + '%）');
    });
  });

  // ==========================================================
  console.log('\n[7] Run 层：角色决定卡组与奖励池');
  let r = Run.start('act1', 20260923, 'medic');
  assert(r.charId === 'medic', 'Run.state 记下了角色');
  assert(r.deck.length === 10, '起始卡组 10 张');
  assert(r.deck.every((c) => c.def.char === 'medic'), '医师的卡组全是医师的卡');
  assert(r.deck.some((c) => c.def.id === 'scalpel'), '医师卡组里有「解剖刀」');

  r = Run.start('act1', 20260923, 'keeper');
  assert(r.deck.every((c) => c.def.char === 'keeper'), '引火者的卡组全是引火者的卡');

  r = Run.start('act1', 20260923);
  assert(r.charId === 'digger', '不传角色 = 掘者（M3–M5 的老调用点靠这个不变）');
  assert(r.deck.every((c) => c.def.char === 'digger'), '掘者卡组仍然是掘者的卡');

  // 奖励池按角色抽，不会抽出别的角色的卡
  let crossErr = 0;
  CHAR_ORDER.forEach(function (cid) {
    Run.start('act1', 777, cid);
    for (let i = 0; i < 200; i++) {
      const id = Run.rollCardIds(1)[0];
      if (!id || CARDS[id].char !== cid) crossErr++;
    }
  });
  assert(crossErr === 0, '三个角色各抽 200 次奖励卡，没有一次抽到别的角色的卡');

  // ==========================================================
  console.log('\n[8] §8.4 差异化验收');
  // 资源系统互不复用
  assert(CHARACTERS.digger.resource === null, '掘者没有资源系统');
  assert(CHARACTERS.medic.resource.key !== CHARACTERS.keeper.resource.key, '医师与引火者的资源键不同');
  assert(CHARACTERS.medic.resource.name !== CHARACTERS.keeper.resource.name, '资源名也不同（样本 / 余烬）');

  // 每个角色至少 4 张"无法移植"的卡：用到该角色专属原语的卡
  function uniqueCards(cid, needles) {
    return Object.keys(CARDS).filter(function (k) {
      const d = CARDS[k];
      if (d.char !== cid) return false;
      const src = (d.play || '').toString() + (d.need || '').toString();
      return needles.some((n) => src.indexOf(n) >= 0);
    });
  }
  const medicOnly = uniqueCards('medic', ['gainResource', 'spendResource', 'resource()', 'parasite']);
  const keeperOnly = uniqueCards('keeper', ['gainResource', 'spendResource', 'resource()', 'undying', 'strTurn']);
  const diggerOnly = uniqueCards('digger', ['consumeBlock', 'player.block']);
  assert(medicOnly.length >= 4, '医师有 ' + medicOnly.length + ' 张卡用到样本原语（≥4）');
  assert(keeperOnly.length >= 4, '引火者有 ' + keeperOnly.length + ' 张卡用到余烬原语（≥4）');
  assert(diggerOnly.length >= 4, '掘者有 ' + diggerOnly.length + ' 张卡用到格挡转化原语（≥4）');

  // 卡面框色三者不同
  const colors = CHAR_ORDER.map((c) => CHARACTERS[c].frameColor);
  assert(new Set(colors).size === 3, '三个角色卡面框色互不相同');
  const styles = CHAR_ORDER.map((c) => CHARACTERS[c].style);
  assert(new Set(styles).size === 3, '三个角色命名/排版风格互不相同');

  // 出牌节奏不同：医师靠攒、引火者靠卖血
  fresh('medic');
  hand(['sampling', 'sampling', 'sampling']);
  play('sampling'); play('sampling'); play('sampling');
  assert(res() === 3 && S().player.hp === 75, '医师的节奏是攒资源，不掉血');
  fresh('keeper');
  hand(['spark', 'spark']);
  play('spark'); play('spark');
  assert(res() === 4 && S().player.hp === 71, '引火者的节奏是卖血换资源');

  // ==========================================================
  console.log('\n[9] 完整战斗：医师与引火者各打一场');
  function fullFight(charId) {
    const run = Run.start('act1', 4242, charId);
    const node = run.map.nodes[Object.keys(run.map.nodes).filter(function (id) {
      return run.map.nodes[id].type === 'monster';
    })[0]];
    node.enemyId = node.enemyId || 'crawler';

    Combat.start(Run.battleSeed(node.id), {
      charId: run.charId,
      hp: run.hp,
      maxHp: run.maxHp,
      depth: node.depth,
      deck: run.deck,
      relics: [],
      enemyId: node.enemyId,
    });

    let guard = 0;
    while (Combat.state.phase === 'player' && guard++ < 60) {
      // 能打就打，打不动就结束回合
      const h = Combat.state.hand.slice();
      for (let i = 0; i < h.length; i++) {
        if (Combat.canPlay(h[i])) Combat.playCard(h[i].uid);
        if (Combat.state.phase !== 'player') break;
      }
      if (Combat.state.phase === 'player') Combat.endTurn();
    }
    return Combat.state;
  }

  const medicEnd = fullFight('medic');
  assert(medicEnd.phase === 'win' || medicEnd.phase === 'lose',
    '医师能打完一整场（结局：' + medicEnd.phase + '，剩 ' + medicEnd.player.hp + ' 血）');
  assert(medicEnd.player.resource.value >= 0 && medicEnd.player.resource.value <= 5,
    '打完之后样本仍在 0–5 之间（上限没被绕过）');

  const keeperEnd = fullFight('keeper');
  assert(keeperEnd.phase === 'win' || keeperEnd.phase === 'lose',
    '引火者能打完一整场（结局：' + keeperEnd.phase + '，剩 ' + keeperEnd.player.hp + ' 血）');
  assert(keeperEnd.player.resource.value >= 0, '打完之后余烬数值正常');

  // 掘者也不该被这一轮改动打坏
  const diggerEnd = fullFight('digger');
  assert(diggerEnd.phase === 'win' || diggerEnd.phase === 'lose',
    '掘者仍能打完一整场（结局：' + diggerEnd.phase + '）');
  assert(diggerEnd.player.resource === null, '掘者始终没有资源对象');

  return { pass: pass, fail: fail };
}

const r = vm.runInContext('(' + suite.toString() + ')()', sandbox);
console.log('\n' + r.pass + ' 通过 / ' + r.fail + ' 失败');
