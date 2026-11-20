// 掘者卡池 —— 共 50 张：10 张基础池（dl:0）+ DL1–DL10 每级 3 张
// + M32 群体系 3 张（DL2/5/8 各 1 张全体攻击）
// + M33 大威力轴 3 张（DL7/9/10 各 1 张 2/3 费终结技）
// + M33b 低层能力牌 1 张（DL2，补「DL1–4 掉落池零能力牌」的缺口）
// + M64 重防轴 2 张（DL2「带伤作业」卖血换格挡 /「承重墙」纯格挡重量级，
//   两张都带 announce 标记：DL1 通关升 DL2 时收尾面板点名）。
// + M65「夯击」1 张（DL3，伤害=格挡值，升级 0 费 —— 引擎首个升级改费的卡）。
// 设计文档 §8.1：核心机制是「格挡与伤害的双向转化」，命名走直白工业词。
//
// 模板结构：
//   v       —— 基础数值（mkCard 会拷贝一份到实例上）
//   upV     —— 升级后的数值
//   text(v) —— 按当前数值生成描述文字
//   play(ctx, card) —— 结算；card.v 是本张卡的实际数值
//
// 约束：play 里只准用 ctx 暴露的原语，不许碰 DOM —— 这样测试能在 Node 里直接跑。

let _cardUid = 0;

// 卡牌实例：def 是模板，v 是本张卡的数值（升级后换成 upV），upgraded 是标记
function mkCard(id) {
  const def = CARDS[id];
  if (!def) throw new Error('未知卡牌：' + id);
  return {
    uid: ++_cardUid,
    def: def,
    v: Object.assign({}, def.v),
    upgraded: false,
  };
}

// 升级：数值换成 upV
function upgradeCard(card) {
  if (!card || card.upgraded || !card.def.upV) return false;
  card.upgraded = true;
  card.v = Object.assign({}, card.def.upV);
  return true;
}

// 实际费用：卡定义可以在 upV 里放 cost 表示「升级改变费用」（M65「夯击」1→0）。
// 没写就走 def.cost，所有存量卡行为不变。
function cardCost(card) {
  if (card.upgraded && card.def.upV && card.def.upV.cost != null) return card.def.upV.cost;
  return card.def.cost;
}

// 复制一份给单场战斗用 —— 战斗会洗牌 / 弃牌 / 消耗，
// 直接拿 Run 的卡组进场会把本局卡组搅乱（洗牌是原地操作）。
function cloneCard(card) {
  return {
    uid: ++_cardUid,
    def: card.def,
    v: Object.assign({}, card.v),
    upgraded: card.upgraded,
  };
}

const CARDS = {
  // ==================== 基础池 10 张（dl:0）====================
  // DL1 起就进掉落池。起始卡组从这里面取 10 张牌。

  strike: {
    id: 'strike', name: '打击', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'blunt',
    v: { dmg: 6 }, upV: { dmg: 9 },
    text: (v) => `造成 ${v.dmg} 点伤害。`,
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg); },
  },

  defend: {
    id: 'defend', name: '防御', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 5 }, upV: { block: 8 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  crowbar: {
    id: 'crowbar', name: '撬棍', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'metal',
    v: { dmg: 9, boost: 13 }, upV: { dmg: 12, boost: 17 },
    text: (v) => `造成 ${v.dmg} 点伤害。若本回合已获得格挡，改为 ${v.boost} 点。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, ctx.player.block > 0 ? c.v.boost : c.v.dmg);
    },
  },

  iron_fist: {
    id: 'iron_fist', name: '铁拳', cost: 2, type: 'attack', rarity: 'basic', dl: 0, impact: 'blunt',
    v: { dmg: 13 }, upV: { dmg: 17 },
    text: (v) => `造成 ${v.dmg} 点伤害。`,
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg); },
  },

  brace: {
    id: 'brace', name: '支撑', cost: 0, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 3 }, upV: { block: 5 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  pry: {
    id: 'pry', name: '撬动', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'metal',
    v: { dmg: 4, draw: 1 }, upV: { dmg: 6, draw: 1 },
    text: (v) => `造成 ${v.dmg} 点伤害，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.drawCards(c.v.draw);
    },
  },

  shove: {
    id: 'shove', name: '推压', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'blunt',
    v: { dmg: 5, weak: 1 }, upV: { dmg: 5, weak: 2 },
    text: (v) => `造成 ${v.dmg} 点伤害，施加 ${v.weak} 层虚弱。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.addBuff(ctx.enemy, 'weak', c.v.weak);
    },
  },

  hardhat: {
    id: 'hardhat', name: '安全帽', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 6, bonus: 3 }, upV: { block: 8, bonus: 4 },
    text: (v) => `获得 ${v.block} 点格挡。若本回合已打出攻击牌，再获得 ${v.bonus} 点。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      if (ctx.turnPlays.attack > 0) ctx.gainBlock(ctx.player, c.v.bonus);
    },
  },

  shrapnel: {
    id: 'shrapnel', name: '碎石', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'pick',
    v: { ratio: 0.5 }, upV: { ratio: 0.75 },
    text: (v) => `造成等同于你格挡值 ${Math.round(v.ratio * 100)}% 的伤害。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, Math.floor(ctx.player.block * c.v.ratio));
    },
  },

  patch: {
    id: 'patch', name: '修补', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { heal: 6 }, upV: { heal: 9 },
    text: (v) => `回复 ${v.heal} 点生命。`,
    play(ctx, c) { ctx.heal(ctx.player, c.v.heal); },
  },

  // ==================== 诅咒卡 ====================
  // 事件 / 敌人塞进卡组的负担。不属于 40 张卡池，不进掉落池（见 rewardPool）。
  //
  // unplayable —— canPlay 直接返回 false，牌永远打不出去
  // curseHpLoss —— 回合结束时，只要它还在手牌里就扣血（由 combat.endTurn 结算）

  cursed_lung: {
    id: 'cursed_lung', name: '疫尘入肺', cost: 0, type: 'status', rarity: 'curse', dl: 0,
    unplayable: true, curseHpLoss: 2,
    v: {}, upV: null,
    text: () => '无法打出。每回合结束时，失去 2 点生命。',
    play() {},
  },

  // ==================== DL1 ====================
  // 主题：把「格挡」这条线正式接进来

  rivet_plate: {
    id: 'rivet_plate', name: '铆钉板', cost: 1, type: 'skill', rarity: 'common', dl: 1,
    v: { block: 8 }, upV: { block: 11 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  hydraulic: {
    id: 'hydraulic', name: '液压冲击', cost: 2, type: 'attack', rarity: 'common', dl: 1, impact: 'hammer',
    v: { ratio: 1.5 }, upV: { ratio: 2 },
    text: (v) => `消耗全部格挡，造成「格挡值 ×${v.ratio}」点伤害。`,
    play(ctx, c) {
      const b = ctx.consumeBlock(ctx.player);
      if (b > 0) ctx.dealDamage(ctx.player, ctx.enemy, Math.floor(b * c.v.ratio));
    },
  },

  dismantle: {
    id: 'dismantle', name: '拆解', cost: 1, type: 'attack', rarity: 'common', dl: 1, impact: 'metal',
    v: { dmg: 6, block: 6 }, upV: { dmg: 8, block: 8 },
    text: (v) => `造成 ${v.dmg} 点伤害，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  // ==================== DL2 ====================
  // 主题：格挡 → 力量；深度开始产生影响

  ballast: {
    id: 'ballast', name: '负重前行', cost: 1, type: 'skill', rarity: 'common', dl: 2,
    v: { per: 5 }, upV: { per: 4 },
    text: (v) => `每有 ${v.per} 点格挡，获得 1 点力量。`,
    play(ctx, c) {
      const n = Math.floor(ctx.player.block / c.v.per);
      if (n > 0) ctx.addBuff(ctx.player, 'str', n);
    },
  },

  wall_pick: {
    id: 'wall_pick', name: '井壁凿击', cost: 1, type: 'attack', rarity: 'common', dl: 2, impact: 'pick',
    v: { dmg: 4, perDepth: 1 }, upV: { dmg: 7, perDepth: 1 },
    text: (v) => `造成 ${v.dmg} + 深度×${v.perDepth} 点伤害。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg + ctx.depth * c.v.perDepth);
    },
  },

  weld: {
    id: 'weld', name: '加固焊接', cost: 1, type: 'skill', rarity: 'common', dl: 2,
    v: { block: 6, draw: 1 }, upV: { block: 8, draw: 1 },
    text: (v) => `获得 ${v.block} 点格挡，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.drawCards(c.v.draw);
    },
  },

  // M32 群体系：掘者的第一张 AoE。伤害平庸但白送格挡 ——
  // 「格挡与伤害的双向转化」主题在群体版的落法。
  shockwave: {
    id: 'shockwave', name: '震波', cost: 1, type: 'attack', rarity: 'common', dl: 2, impact: 'blast',
    v: { dmg: 5, block: 4 }, upV: { dmg: 7, block: 6 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  // M33b 补缺：掘者此前最低的能力牌在 DL5（井架支撑），而掉落池下限是
  // `max(2, DL)` —— 玩家卡在 DL1–4 时（DL 只在通关整局时才 +1）池子里
  // 一张能力牌都没有（实测 0.0%，医师/引火者在 DL1 就有约 33%/38%）。
  // 补一张 DL2 能力牌填这个洞，机制与既有四张能力牌完全不重叠：
  //   井架支撑 = 每回合 +N 格挡 / 钢梁 = 每回合 +N 力量
  //   重装机甲 & 不动如山 = 壁垒（格挡不清零）
  // 这里是「敏捷」—— 每个格挡牌都多吃 +2，是「格挡规模化」的能力化。
  counterweight: {
    id: 'counterweight', name: '配重校准', cost: 1, type: 'power', rarity: 'uncommon', dl: 2,
    v: { dex: 2 }, upV: { dex: 3 },
    text: (v) => `能力：获得 ${v.dex} 点敏捷（每张格挡牌都多吃 ${v.dex} 点）。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'dex', c.v.dex); },
  },

  // ==================== DL3 ====================
  // 主题：格挡的规模化 / 压制敌人

  deep_work: {
    id: 'deep_work', name: '深井作业', cost: 3, type: 'skill', rarity: 'common', dl: 3,
    v: { perDepth: 2 }, upV: { perDepth: 3 },
    text: (v) => `获得「深度 ×${v.perDepth}」点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, ctx.depth * c.v.perDepth); },
  },

  quake: {
    id: 'quake', name: '震地锤', cost: 2, type: 'attack', rarity: 'common', dl: 3, impact: 'hammer',
    v: { dmg: 14, strDown: 2 }, upV: { dmg: 18, strDown: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，敌人失去 ${v.strDown} 点力量。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.addBuff(ctx.enemy, 'str', -c.v.strDown);
    },
  },

  plate_guard: {
    id: 'plate_guard', name: '钢板护体', cost: 2, type: 'skill', rarity: 'common', dl: 3,
    v: { block: 12, dex: 1 }, upV: { block: 15, dex: 1 },
    text: (v) => `获得 ${v.block} 点格挡和 ${v.dex} 点敏捷。`,
    play(ctx, c) {
      // 先加敏捷再加格挡，本张牌自己就吃到加成
      ctx.addBuff(ctx.player, 'dex', c.v.dex);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  // ==================== DL4 ====================
  // 主题：多段与减益

  chain_chisel: {
    id: 'chain_chisel', name: '连环凿', cost: 2, type: 'attack', rarity: 'uncommon', dl: 4, impact: 'pick',
    v: { dmg: 5, times: 3 }, upV: { dmg: 7, times: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次。`,
    play(ctx, c) { ctx.attackTimes(ctx.player, ctx.enemy, c.v.times, c.v.dmg); },
  },

  rust_grip: {
    id: 'rust_grip', name: '锈蚀之握', cost: 1, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { weak: 2, vuln: 2 }, upV: { weak: 3, vuln: 3 },
    text: (v) => `敌人获得 ${v.weak} 层虚弱和 ${v.vuln} 层脆弱。`,
    play(ctx, c) {
      ctx.addBuff(ctx.enemy, 'weak', c.v.weak);
      ctx.addBuff(ctx.enemy, 'vulnerable', c.v.vuln);
    },
  },

  emergency: {
    id: 'emergency', name: '应急护盾', cost: 1, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { block: 10, selfHurt: 3 }, upV: { block: 14, selfHurt: 3 },
    text: (v) => `获得 ${v.block} 点格挡，失去 ${v.selfHurt} 点生命。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.loseHp(ctx.player, c.v.selfHurt);
    },
  },

  // ==================== DL5 ====================
  // 主题：格挡的两种出口（转力量 / 转压制），能力牌登场

  pressure_valve: {
    id: 'pressure_valve', name: '压力阀', cost: 1, type: 'skill', rarity: 'uncommon', dl: 5,
    v: { per: 5 }, upV: { per: 4 },
    text: (v) => `消耗全部格挡，每 ${v.per} 点使获得 1 点力量。`,
    play(ctx, c) {
      const b = ctx.consumeBlock(ctx.player);
      const n = Math.floor(b / c.v.per);
      if (n > 0) ctx.addBuff(ctx.player, 'str', n);
    },
  },

  sledge_work: {
    id: 'sledge_work', name: '重锤作业', cost: 2, type: 'attack', rarity: 'uncommon', dl: 5, impact: 'hammer',
    v: { dmg: 10, strDown: 3 }, upV: { dmg: 13, strDown: 4 },
    text: (v) => `造成 ${v.dmg} 点伤害，敌人失去 ${v.strDown} 点力量。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.addBuff(ctx.enemy, 'str', -c.v.strDown);
    },
  },

  derrick: {
    id: 'derrick', name: '井架支撑', cost: 2, type: 'power', rarity: 'uncommon', dl: 5,
    v: { block: 3 }, upV: { block: 5 },
    text: (v) => `能力：每回合开始时，获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'metallicize', c.v.block); },
  },

  // M32 群体系：歼灭奖励 —— 清场型的节奏牌，杀得动就回牌
  chain_demolition: {
    id: 'chain_demolition', name: '连锁爆破', cost: 2, type: 'attack', rarity: 'uncommon', dl: 5, impact: 'blast',
    v: { dmg: 9 }, upV: { dmg: 12 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害。若击倒任一敌人，抽 1 张牌。`,
    play(ctx, c) {
      const before = ctx.enemies.filter(function (e) { return e.hp > 0; }).length;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
      const after = ctx.enemies.filter(function (e) { return e.hp > 0; }).length;
      if (after < before) ctx.drawCards(1);
    },
  },

  // ==================== DL6 ====================
  // 主题：破防 / 中毒 / 连击奖励

  rockbreak: {
    id: 'rockbreak', name: '破岩', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'hammer',
    v: { dmg: 16 }, upV: { dmg: 21 },
    text: (v) => `造成 ${v.dmg} 点伤害，无视格挡。`,
    play(ctx, c) { ctx.dealDamageRaw(ctx.player, ctx.enemy, c.v.dmg); },
  },

  temper: {
    id: 'temper', name: '回火', cost: 1, type: 'skill', rarity: 'uncommon', dl: 6,
    v: { block: 5, poison: 3 }, upV: { block: 7, poison: 4 },
    text: (v) => `获得 ${v.block} 点格挡，给予敌人 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.addBuff(ctx.enemy, 'poison', c.v.poison);
    },
  },

  pry_combo: {
    id: 'pry_combo', name: '撬棒连击', cost: 1, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'metal',
    v: { dmg: 7, draw: 2 }, upV: { dmg: 10, draw: 2 },
    text: (v) => `造成 ${v.dmg} 点伤害。若击杀，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      if (ctx.enemy.hp <= 0) ctx.drawCards(c.v.draw);
    },
  },

  // M64：破防 / 中毒之外给 DL2 补一条「卖血换大格挡」线。
  // 对标应急护盾（DL4，10/−3 → 14/−3）：同费多 5 格挡、升级还把自伤从 3 收到 2 ——
  // DL2 就解锁是用户点名的（M64 二次调整：原落位 DL6）。
  // announce：升到 DL2 的收尾面板要点名这张卡（App.showFinish 读这个标记）。
  hazard_work: {
    id: 'hazard_work', name: '带伤作业', cost: 1, type: 'skill', rarity: 'uncommon', dl: 2,
    announce: true,
    v: { block: 15, selfHurt: 3 }, upV: { block: 20, selfHurt: 2 },
    text: (v) => `获得 ${v.block} 点格挡，失去 ${v.selfHurt} 点生命。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.loseHp(ctx.player, c.v.selfHurt);
    },
  },

  // ==================== DL7 ====================
  // 主题：成长与反击

  steel_beam: {
    id: 'steel_beam', name: '钢梁', cost: 1, type: 'power', rarity: 'rare', dl: 7,
    v: { str: 1 }, upV: { str: 2 },
    text: (v) => `能力：每回合开始时，获得 ${v.str} 点力量。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'strPerTurn', c.v.str); },
  },

  dual_crowbar: {
    id: 'dual_crowbar', name: '双持撬棍', cost: 2, type: 'attack', rarity: 'rare', dl: 7, impact: 'metal',
    v: { dmg: 9, times: 2 }, upV: { dmg: 12, times: 2 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次。`,
    play(ctx, c) { ctx.attackTimes(ctx.player, ctx.enemy, c.v.times, c.v.dmg); },
  },

  riposte: {
    id: 'riposte', name: '反击姿态', cost: 1, type: 'skill', rarity: 'rare', dl: 7,
    v: { block: 8, thorns: 4 }, upV: { block: 11, thorns: 6 },
    text: (v) => `获得 ${v.block} 点格挡和 ${v.thorns} 点荆棘。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.addBuff(ctx.player, 'thorns', c.v.thorns);
    },
  },

  // M33 大威力轴：卖血换威力 —— 2 费最高直伤，代价是真掉血。
  // 同档对照：双持撬棍（同 DL 同费 18 伤无代价）—— 炸药包 22 = 122%，由 4 点生命买单。
  blast_charge: {
    id: 'blast_charge', name: '炸药包', cost: 2, type: 'attack', rarity: 'rare', dl: 7, impact: 'blast',
    v: { dmg: 22, selfHurt: 4 }, upV: { dmg: 28, selfHurt: 4 },
    text: (v) => `造成 ${v.dmg} 点伤害，失去 ${v.selfHurt} 点生命。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.loseHp(ctx.player, c.v.selfHurt);
    },
  },

  // ==================== DL8 ====================
  // 主题：深度的代价与回报

  seam_resonance: {
    id: 'seam_resonance', name: '地脉共振', cost: 1, type: 'attack', rarity: 'rare', dl: 8, impact: 'blast',
    v: { perDepth: 3 }, upV: { perDepth: 4 },
    text: (v) => `造成「深度 ×${v.perDepth}」点伤害。`,
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, ctx.depth * c.v.perDepth); },
  },

  heavy_rig: {
    id: 'heavy_rig', name: '重装机甲', cost: 3, type: 'power', rarity: 'rare', dl: 8,
    v: { keep: 1 }, upV: { keep: 1, block: 5 },
    text: (v) => (v.block
      ? `能力：格挡不再于回合末清零，并立即获得 ${v.block} 点格挡。`
      : '能力：格挡不再于回合末清零。'),
    play(ctx, c) {
      ctx.addBuff(ctx.player, 'barricade', 1);
      if (c.v.block) ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  // M64：纯格挡的重量级——不转力量、不抽牌、不破防，就是把墙砌厚。
  // 2 费 30 看着吓人，对照钢铁意志（DL9，2 费 15 + 力量×3）：力量 ≥5 就反超，
  // 而掘者的力量轴（负重前行 / 压力阀 / 钢梁）成型后远不止 5 —— 这张是前期的地板，不是上限。
  // DL2 解锁同样是用户点名的（M64 二次调整：原落位 DL8）；announce 供收尾面板公告。
  load_bearing: {
    id: 'load_bearing', name: '承重墙', cost: 2, type: 'skill', rarity: 'rare', dl: 2,
    announce: true,
    v: { block: 30 }, upV: { block: 40 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  // M65：格挡→伤害的单向转化，补上「双向转化」的另一半拼图。
  // 伤害读打出瞬间的格挡值（不消耗格挡），先防后攻收益最大；
  // 升级只把费用从 1 收到 0、伤害公式不动（upV.cost，引擎第一个「升级改费」的卡）。
  ram_hit: {
    id: 'ram_hit', name: '夯击', cost: 1, type: 'attack', rarity: 'uncommon', dl: 3, impact: 'blunt',
    v: {}, upV: { cost: 0 },
    text: (v) => (v.cost === 0
      ? '造成等同于格挡值的伤害。'
      : '造成等同于格挡值的伤害。升级后费用为 0。'),
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, ctx.player.block); },
  },

  salvage: {
    id: 'salvage', name: '废铁回收', cost: 1, type: 'skill', rarity: 'rare', dl: 8,
    v: { block: 3, heal: 3 }, upV: { block: 5, heal: 5 },
    text: (v) => `获得「深度 + ${v.block}」点格挡，回复 ${v.heal} 点生命。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, ctx.depth + c.v.block);
      ctx.heal(ctx.player, c.v.heal);
    },
  },

  // M32 群体系：掘者唯一的全场破防。对标破岩（2 费 16 无视格挡）的群体版。
  // 2026-10-02 数值复核：原 12 伤在双敌下是破岩（16）的 150%、且无代价 —— 超预算，
  // 落到 10。单敌 10/16 = 63%（AoE 折扣带 55–65% 内），双敌 20/18 = 111%（预算带内）。
  // 「无视格挡」是这张卡的特色，保留。
  demolition_charge: {
    id: 'demolition_charge', name: '定向爆破', cost: 2, type: 'attack', rarity: 'rare', dl: 8, impact: 'blast',
    v: { dmg: 10 }, upV: { dmg: 13 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，无视格挡。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamageRaw(ctx.player, e, c.v.dmg);
      });
    },
  },

  // ==================== DL9 ====================
  // 主题：深度专精

  abyss_echo: {
    id: 'abyss_echo', name: '深渊回响', cost: 2, type: 'attack', rarity: 'rare', dl: 9, impact: 'blast',
    v: { perDepth: 4, draw: 1 }, upV: { perDepth: 5, draw: 1 },
    text: (v) => `造成「深度 ×${v.perDepth}」点伤害，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, ctx.depth * c.v.perDepth);
      ctx.drawCards(c.v.draw);
    },
  },

  iron_will: {
    id: 'iron_will', name: '钢铁意志', cost: 2, type: 'skill', rarity: 'rare', dl: 9,
    v: { block: 15, perStr: 3 }, upV: { block: 18, perStr: 4 },
    text: (v) => `获得 ${v.block} 点格挡；每有 1 点力量，再获得 ${v.perStr} 点。`,
    play(ctx, c) {
      const str = ctx.player.buffs.str || 0;
      ctx.gainBlock(ctx.player, c.v.block + str * c.v.perStr);
    },
  },

  wall_breaker: {
    id: 'wall_breaker', name: '破壁索', cost: 2, type: 'skill', rarity: 'rare', dl: 9,
    v: { block: 8, perSkill: 4 }, upV: { block: 10, perSkill: 5 },
    text: (v) => `获得 ${v.block} 点格挡；本回合每打出过 1 张技能牌，再获得 ${v.perSkill} 点。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block + ctx.turnPlays.skill * c.v.perSkill);
    },
  },

  // M33 大威力轴：三段重击 —— 无铺垫的稳定大伤害，成长上限让给井底之锤的铺垫轴。
  jackhammer: {
    id: 'jackhammer', name: '凿岩机', cost: 3, type: 'attack', rarity: 'rare', dl: 9, impact: 'drill',
    v: { dmg: 10, times: 3 }, upV: { dmg: 12, times: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次。`,
    play(ctx, c) { ctx.attackTimes(ctx.player, ctx.enemy, c.v.times, c.v.dmg); },
  },

  // ==================== DL10 ====================
  // 主题：井底的三张终结技

  bottom_hammer: {
    id: 'bottom_hammer', name: '井底之锤', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'hammer',
    v: { dmg: 26, perAttack: 6 }, upV: { dmg: 32, perAttack: 8 },
    text: (v) => `造成 ${v.dmg} 点伤害；本回合每打出过 1 张攻击牌，再 +${v.perAttack} 点。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg + ctx.turnPlays.attack * c.v.perAttack);
    },
  },

  immovable: {
    id: 'immovable', name: '不动如山', cost: 2, type: 'power', rarity: 'rare', dl: 10,
    v: { block: 5 }, upV: { block: 7 },
    text: (v) => `能力：格挡不再于回合末清零，且每回合开始获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.addBuff(ctx.player, 'barricade', 1);
      ctx.addBuff(ctx.player, 'metallicize', c.v.block);
    },
  },

  final_bore: {
    id: 'final_bore', name: '终末钻探', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'drill',
    v: { perDepth: 5, selfHurt: 10 }, upV: { perDepth: 6, selfHurt: 8 },
    text: (v) => `造成「深度 ×${v.perDepth}」点伤害，无视格挡；失去 ${v.selfHurt} 点生命。`,
    play(ctx, c) {
      ctx.dealDamageRaw(ctx.player, ctx.enemy, ctx.depth * c.v.perDepth);
      ctx.loseHp(ctx.player, c.v.selfHurt);
    },
  },

  // M33 大威力轴：攻防一体的终结技 —— 直伤不得反超井底之锤（26），差额用格挡补。
  bedrock_hammer: {
    id: 'bedrock_hammer', name: '基岩锤', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'hammer',
    v: { dmg: 24, block: 12 }, upV: { dmg: 30, block: 16 },
    text: (v) => `造成 ${v.dmg} 点伤害，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },
};

// ==================== 角色分组 ====================
// 三个角色的卡都挂在同一个 CARDS 对象上，靠 char 字段区分 ——
// 引擎按 id 取卡，不需要知道角色。上面这一整块就是掘者的卡池。
Object.keys(CARDS).forEach(function (k) { CARDS[k].char = DEFAULT_CHAR; });

// 掘者的起始卡组 —— 真正的来源是 characters.js 的 starterDeck，
// 这里保留同名常量是因为 combat.js 在没传 deck 时的默认开局要用它。
const STARTER_DECK = CHARACTERS[DEFAULT_CHAR].starterDeck;

const CARD_TYPE_NAMES = {
  attack: '攻击',
  skill: '技能',
  power: '能力',
  status: '状态',
};

const RARITY_NAMES = {
  basic: '基础',
  common: '普通',
  uncommon: '罕见',
  rare: '稀有',
  curse: '诅咒',
};

// 按解锁等级分组：dl 0 = 基础池，1–10 = 该等级解锁的 3 张。
// charId 不传 = 掘者，理由见下面 rewardPool 的说明。
function cardsByDl(dl, charId) {
  const ch = charId || DEFAULT_CHAR;
  return Object.keys(CARDS).filter((k) => CARDS[k].dl === dl && CARDS[k].char === ch);
}

// 奖励 / 商店用的卡池：排除基础卡与诅咒卡。
//   basic —— 只在起始卡组里出现，反复给「打击」没有构筑意义
//   curse —— 是负担不是奖励，只能由事件塞进来
//
// ⚠️ 调用方**必须**传当前角色的 charId：不传会静默拿到掘者池，
// 切到医师之后奖品还是掘者的卡。给默认值是为了让 M2–M5 的老测试
// 与既有调用点一行不用改，不是为了省参数。
//
// maxDl（M7 接上等级系统）：只出「该角色 DL 已经解锁」的卡（`dl <= maxDl`）。
// **不传 = 不过滤**，老调用点行为完全不变 —— M2–M6 那些只加载部分文件的测试
// 不会因为多了这个参数而变红。
function rewardPool(charId, maxDl) {
  const ch = charId || DEFAULT_CHAR;
  return Object.keys(CARDS).filter(function (k) {
    const d = CARDS[k];
    if (d.char !== ch) return false;
    if (d.rarity === 'basic' || d.rarity === 'curse') return false;
    if (maxDl != null && (d.dl || 0) > maxDl) return false;
    return true;
  });
}
