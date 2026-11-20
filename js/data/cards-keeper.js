// 引火者卡池 —— 43 张：10 张专属基础池（dl:0）+ DL1–DL10 各 3 张
// + M32 群体系 3 张（DL4/6/9 各 1 张全体攻击）。
//
// 设计文档 §8.3：独有资源「余烬」（受到伤害时累积，不衰减），
// 命名走仪式祷告词，卡面燃橙。核心机制是**自伤爆发**：卖血换资源，血线越低越猛。
//
// ⚠️ 余烬的两条来源要分清，否则会双重计数：
//   1. 被敌人击中 → 引擎按资源规格自动 +1（onDamaged）
//   2. 自己卖血   → 卡面显式写死（「献燔」给 3 点）
// 自伤走的是 loseHp，**不触发** onDamaged。所以「献燔」是「失去 5 血 + 得 3 余烬」，
// 不是「得 4 余烬」。
//
// M6 先做到 DL2（16 张），M17 补齐 DL3–DL10（24 张）。DL3–DL4 扩展自伤换算
// （余烬护体 / 燃鞭），DL5–DL6 走持续燃烧与透支（绝望 / 重燃），
// DL7–DL10 是稀有终局（不死鸟、献祭、终焉之火）。

const KEEPER_CARDS = {
  // ==================== 基础池 10 张（dl:0）====================

  tongs: {
    name: '火钳', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'metal',
    v: { dmg: 6 }, upV: { dmg: 9 },
    text: (v) => `造成 ${v.dmg} 点伤害。`,
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg); },
  },

  ash_guard: {
    name: '灰盾', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 5 }, upV: { block: 8 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  // 起始卡组里的那张「撬棍位」：0 费卖 2 血换 2 余烬
  spark: {
    name: '擦火', cost: 0, type: 'skill', rarity: 'basic', dl: 0,
    v: { hp: 2, res: 2 }, upV: { hp: 2, res: 3 },
    text: (v) => `失去 ${v.hp} 点生命，获得 ${v.res} 点余烬。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      ctx.gainResource(c.v.res);
    },
  },

  scorch: {
    name: '灼烧', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'flame',
    v: { dmg: 7, boost: 11 }, upV: { dmg: 9, boost: 14 },
    text: (v) => `造成 ${v.dmg} 点伤害；若你的生命低于 50%，改为 ${v.boost} 点。`,
    play(ctx, c) {
      const low = ctx.player.hp / ctx.player.maxHp < 0.5;
      ctx.dealDamage(ctx.player, ctx.enemy, low ? c.v.boost : c.v.dmg);
    },
  },

  kindle: {
    name: '引燃', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { burn: 3 }, upV: { burn: 5 },
    text: (v) => `施加 ${v.burn} 层燃烧。`,
    play(ctx, c) { ctx.addBuff(ctx.enemy, 'burn', c.v.burn); },
  },

  ember_gift: {
    name: '火种', cost: 0, type: 'skill', rarity: 'basic', dl: 0,
    v: { res: 1, draw: 1 }, upV: { res: 2, draw: 1 },
    text: (v) => `获得 ${v.res} 点余烬，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.gainResource(c.v.res);
      ctx.drawCards(c.v.draw);
    },
  },

  blood_rite: {
    name: '血祭', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'flame',
    v: { hp: 3, dmg: 10 }, upV: { hp: 3, dmg: 13 },
    text: (v) => `失去 ${v.hp} 点生命，造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
    },
  },

  smokescreen: {
    name: '烟幕', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    // M31 平衡：原 1 费 7 格挡，而同池的「灰盾」也是 1 费却只有 5 ——
    // 同样是基础池、同样没有任何代价，没理由多出 40%。
    // 对齐到 5/8（与灰盾同数值、同升级曲线）。
    v: { block: 5 }, upV: { block: 8 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  firewood: {
    name: '薪柴', cost: 1, type: 'power', rarity: 'basic', dl: 0,
    v: { n: 1 }, upV: { n: 2 },
    text: (v) => `每回合开始额外获得 ${v.n} 点余烬。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'resPerTurn', c.v.n); },
  },

  burn_self: {
    name: '焚身', cost: 2, type: 'attack', rarity: 'basic', dl: 0, impact: 'flame',
    v: { hp: 5, dmg: 8 }, upV: { hp: 5, dmg: 11 },
    text: (v) => `失去 ${v.hp} 点生命：对所有敌人造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      // 把自己卖死了就别再打伤害了 —— 结算已经没有意义
      if (ctx.player.hp <= 0) return;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
    },
  },

  // ==================== DL1（common）====================
  // 主题：自伤与余烬的兑换率开始变好

  offering: {
    name: '献燔', cost: 1, type: 'attack', rarity: 'common', dl: 1, impact: 'flame',
    v: { hp: 5, res: 3, dmg: 10 }, upV: { hp: 5, res: 3, dmg: 14 },
    text: (v) => `失去 ${v.hp} 点生命，获得 ${v.res} 点余烬，造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      ctx.gainResource(c.v.res);
      if (ctx.player.hp <= 0) return;
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
    },
  },

  ash_baptism: {
    name: '灰烬洗礼', cost: 0, type: 'skill', rarity: 'common', dl: 1,
    v: { block: 6, res: 2 }, upV: { block: 9, res: 2 },
    text: (v) => `消耗 ${v.res} 点余烬：获得 ${v.block} 点格挡。`,
    need: (c, ctx) => ctx.resource() >= c.v.res,
    play(ctx, c) {
      ctx.spendResource(c.v.res);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  immolation: {
    name: '自焚', cost: 2, type: 'attack', rarity: 'common', dl: 1, impact: 'flame',
    v: { hp: 8, dmg: 12 }, upV: { hp: 8, dmg: 16 },
    text: (v) => `失去 ${v.hp} 点生命：对所有敌人造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
    },
  },

  // ==================== DL2（uncommon）====================
  // 主题：余烬从「够不够花」变成「能换来什么」

  resonance: {
    name: '火种共鸣', cost: 2, type: 'skill', rarity: 'uncommon', dl: 2,
    v: { per: 1 }, upV: { per: 2 },
    text: (v) => `本回合每点余烬使你的攻击额外造成 ${v.per} 点伤害。`,
    play(ctx, c) {
      const n = ctx.resource();
      // 记成本回合力量（strTurn）：回合开始清零，所以只影响本回合
      if (n > 0) ctx.addBuff(ctx.player, 'strTurn', n * c.v.per);
    },
  },

  last_flame: {
    name: '最后一把火', cost: 3, type: 'attack', rarity: 'uncommon', dl: 2, impact: 'flame',
    v: { per: 4, heal: 10 }, upV: { per: 5, heal: 15 },
    text: (v) => `消耗全部余烬：造成「余烬数 ×${v.per}」点伤害。若击杀，回复 ${v.heal} 点生命。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      const target = ctx.enemy;
      ctx.dealDamage(ctx.player, target, n * c.v.per);
      // dealDamage 是同步的，打完就能直接判死 —— 不需要额外的击杀钩子
      if (target.hp <= 0) ctx.heal(ctx.player, c.v.heal);
    },
  },

  undying: {
    name: '不灭', cost: 2, type: 'power', rarity: 'uncommon', dl: 2,
    v: { n: 2 }, upV: { n: 3 },
    text: (v) => `生命低于 30% 时，每回合开始获得 ${v.n} 点余烬。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'undying', c.v.n); },
  },

  // ==================== DL3（uncommon）====================
  // 主题：兑换率 —— 余烬从「顺手攒的」变成「主动算的」

  cinder: {
    name: '烬火', cost: 1, type: 'attack', rarity: 'uncommon', dl: 3, impact: 'flame',
    v: { dmg: 5, per: 3 }, upV: { dmg: 6, per: 4 },
    text: (v) => `造成 ${v.dmg} 点伤害；每有 1 点余烬，额外造成 ${v.per} 点（不消耗）。`,
    play(ctx, c) {
      // 与医师「分诊」同构，但走的是余烬 —— 僧多粥少时这牌就是残血翻盘器
      const n = ctx.resource();
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg + n * c.v.per);
    },
  },

  ash_cloak: {
    name: '灰烬斗篷', cost: 1, type: 'skill', rarity: 'uncommon', dl: 3,
    v: { block: 4, per: 2 }, upV: { block: 5, per: 3 },
    text: (v) => `获得 ${v.block} 点格挡；每有 1 点余烬，再获得 ${v.per} 点。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block + ctx.resource() * c.v.per);
    },
  },

  pyre: {
    name: '火葬', cost: 2, type: 'skill', rarity: 'uncommon', dl: 3, impact: 'flame', // M82（F7）：零直伤，attack→skill 归类
    v: { hp: 6, burn: 4 }, upV: { hp: 6, burn: 6 },
    text: (v) => `失去 ${v.hp} 点生命：施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.addBuff(ctx.enemy, 'burn', c.v.burn);
    },
  },

  // ==================== DL4（uncommon）====================
  // 主题：燃烧流成型 —— 燃烧不衰减，叠上去就是「加速击杀」

  flame_whip: {
    name: '焰鞭', cost: 1, type: 'attack', rarity: 'uncommon', dl: 4, impact: 'flame',
    v: { dmg: 4, times: 2, burn: 2 }, upV: { dmg: 6, times: 2, burn: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次；每次施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      // 与医师「剖检」同理：attackTimes 只打伤害，夹不了 buff，自己走循环
      for (let i = 0; i < c.v.times; i++) {
        if (ctx.enemy.hp <= 0) break;
        ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
        ctx.addBuff(ctx.enemy, 'burn', c.v.burn);
      }
    },
  },

  cauterize: {
    name: '灼烙', cost: 1, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { burn: 3, block: 6 }, upV: { burn: 4, block: 9 },
    text: (v) => `施加 ${v.burn} 层燃烧，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.addBuff(ctx.enemy, 'burn', c.v.burn);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  ember_armor: {
    name: '烬甲', cost: 2, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { block: 14, res: 1 }, upV: { block: 18, res: 1 },
    text: (v) => `获得 ${v.block} 点格挡和 ${v.res} 点余烬。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.gainResource(c.v.res);
    },
  },

  // M32 群体系：火苗舔过一排 —— 伤害不高但群体挂燃烧，
  // 燃烧是引火者 AoE 的第二落点（直伤线已有焚身/自焚/烈焰三张）。
  // 2026-10-02 数值复核：原 5 伤时双敌等效 (5+2)×2 = 14，对 1 费单体基准（血祭 10）是 140%。
  // 落到 4：双敌 (4+2)×2 = 12 = 120%，回到预算带内。
  tongue_of_fire: {
    name: '火舌', cost: 1, type: 'attack', rarity: 'uncommon', dl: 4, impact: 'flame',
    v: { dmg: 4, burn: 2 }, upV: { dmg: 6, burn: 3 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，各施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) {
          ctx.dealDamage(ctx.player, e, c.v.dmg);
          ctx.addBuff(e, 'burn', c.v.burn);
        }
      });
    },
  },

  // ==================== DL5（uncommon）====================
  // 主题：低血线 —— 血越少越强的那条线正式立起来

  desperation: {
    name: '孤注', cost: 1, type: 'attack', rarity: 'uncommon', dl: 5, impact: 'flame',
    v: { dmg: 8, boost: 16 }, upV: { dmg: 10, boost: 20 },
    text: (v) => `造成 ${v.dmg} 点伤害；若你的生命低于 50%，改为 ${v.boost} 点。`,
    play(ctx, c) {
      const low = ctx.player.hp / ctx.player.maxHp < 0.5;
      ctx.dealDamage(ctx.player, ctx.enemy, low ? c.v.boost : c.v.dmg);
    },
  },

  blood_pact: {
    name: '血契', cost: 1, type: 'skill', rarity: 'uncommon', dl: 5,
    v: { hp: 4, str: 2 }, upV: { hp: 4, str: 3 },
    text: (v) => `失去 ${v.hp} 点生命，获得 ${v.str} 点力量。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.addBuff(ctx.player, 'str', c.v.str);
    },
  },

  rekindle: {
    name: '复燃', cost: 2, type: 'skill', rarity: 'uncommon', dl: 5,
    v: { heal: 6, res: 2 }, upV: { heal: 9, res: 3 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.res} 点余烬。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainResource(c.v.res);
    },
  },

  // ==================== DL6（uncommon）====================
  // 主题：余烬爆发雏形 —— 攒下的余烬一次兑现

  ember_burst: {
    name: '余烬爆发', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'flame',
    v: { per: 3 }, upV: { per: 4 },
    text: (v) => `消耗全部余烬：造成「余烬数 ×${v.per}」点伤害。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.dealDamage(ctx.player, ctx.enemy, n * c.v.per);
    },
  },

  inferno: {
    name: '烈焰', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'flame',
    v: { hp: 6, dmg: 10 }, upV: { hp: 6, dmg: 14 },
    text: (v) => `失去 ${v.hp} 点生命：对所有敌人造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
    },
  },

  forge: {
    name: '锻炉', cost: 1, type: 'power', rarity: 'uncommon', dl: 6,
    v: { hp: 2, n: 2 }, upV: { hp: 2, n: 3 },
    text: (v) => `失去 ${v.hp} 点生命：每回合开始额外获得 ${v.n} 点余烬。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.addBuff(ctx.player, 'resPerTurn', c.v.n);
    },
  },

  // M32 群体系：卖血换全场直伤，附送余烬 —— 对标烈焰（失 6 → 全体 10），
  // 血价便宜一档、伤害高一档，多给的 2 余烬是对「下一张 ×余烬」卡的预支
  ash_storm: {
    name: '灰烬风暴', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'flame',
    v: { hp: 5, dmg: 11, res: 2 }, upV: { hp: 5, dmg: 15, res: 3 },
    text: (v) => `失去 ${v.hp} 点生命：对所有敌人造成 ${v.dmg} 点伤害，获得 ${v.res} 点余烬。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
      ctx.gainResource(c.v.res);
    },
  },

  // ==================== DL7（rare）====================
  // 主题：稀有档 —— 燃烧与卖血两条线各自质变

  immolate: {
    name: '燔祭', cost: 2, type: 'attack', rarity: 'rare', dl: 7, impact: 'flame',
    v: { hp: 8, dmg: 14, burn: 4 }, upV: { hp: 8, dmg: 18, burn: 6 },
    text: (v) => `失去 ${v.hp} 点生命：造成 ${v.dmg} 点伤害，并施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.addBuff(ctx.enemy, 'burn', c.v.burn);
    },
  },

  phoenix: {
    name: '不死鸟', cost: 2, type: 'skill', rarity: 'rare', dl: 7,
    v: { heal: 8, res: 3 }, upV: { heal: 12, res: 4 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.res} 点余烬。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainResource(c.v.res);
    },
  },

  pyroclasm: {
    name: '火碎雨', cost: 2, type: 'attack', rarity: 'rare', dl: 7, impact: 'flame',
    v: { dmg: 6, times: 3 }, upV: { dmg: 8, times: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次。`,
    play(ctx, c) { ctx.attackTimes(ctx.player, ctx.enemy, c.v.times, c.v.dmg); },
  },

  // ==================== DL8（rare）====================
  // 主题：规模效应

  blood_forge: {
    name: '血锻', cost: 2, type: 'attack', rarity: 'rare', dl: 8, impact: 'metal',
    v: { hp: 6, per: 4 }, upV: { hp: 6, per: 5 },
    text: (v) => `失去 ${v.hp} 点生命：消耗全部余烬，造成「余烬数 ×${v.per}」点伤害。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      // 先卖血再算余烬：自伤走 loseHp，不触发 onDamaged，所以不会「卖血反而涨余烬」
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.dealDamage(ctx.player, ctx.enemy, n * c.v.per);
    },
  },

  ember_storm: {
    name: '余烬风暴', cost: 2, type: 'skill', rarity: 'rare', dl: 8,
    v: { burn: 5 }, upV: { burn: 7 },
    text: (v) => `对所有敌人施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.addBuff(e, 'burn', c.v.burn);
      });
    },
  },

  sacrifice: {
    name: '献祭', cost: 2, type: 'skill', rarity: 'rare', dl: 8,
    v: { hp: 10, str: 3 }, upV: { hp: 10, str: 4 },
    text: (v) => `失去 ${v.hp} 点生命，获得 ${v.str} 点力量。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.addBuff(ctx.player, 'str', c.v.str);
    },
  },

  // ==================== DL9（rare）====================
  // 主题：极端手段

  conflagration: {
    name: '焚世', cost: 3, type: 'attack', rarity: 'rare', dl: 9, impact: 'flame',
    // 2026-10-02 数值复核：原 12 伤被「自焚」（common/DL1，2 费，同样 −8 HP 同样全体 12）
    // 无条件压制 —— 一张 DL9 稀有牌多花 1 费却零收益。提到 14 后：
    // 焚世＝卖 8 血换稳定 14；天火（同费无代价）＝12 伤 + 5 燃烧。两张各有取舍。
    v: { hp: 8, dmg: 14 }, upV: { hp: 8, dmg: 19 },
    text: (v) => `失去 ${v.hp} 点生命：对所有敌人造成 ${v.dmg} 点伤害。`,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, c.v.dmg);
      });
    },
  },

  ashen_rebirth: {
    name: '灰烬重生', cost: 2, type: 'skill', rarity: 'rare', dl: 9,
    v: { heal: 12, block: 12 }, upV: { heal: 16, block: 16 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  wildfire: {
    name: '野火', cost: 2, type: 'power', rarity: 'rare', dl: 9,
    v: { n: 2 }, upV: { n: 3 },
    text: (v) => `能力：每回合开始额外获得 ${v.n} 点余烬。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'resPerTurn', c.v.n); },
  },

  // M32 群体系：全场天罚 —— 对标燎原（3 费单体 24+6 燃烧）的群体版，
  // 一人 12 伤 + 5 燃烧，满编时总伤害赶得上单体，代价是没有斩杀线的单点爆发。
  // 2026-10-02 数值复核：原 16 伤 + 5 燃烧 + 零代价，在全部维度压制同费同档的「焚世」
  // （同 rare/DL9，焚世还要卖 8 血）—— 抽到焚世等于抽到废牌。落到 12，
  // 双敌 (12+5)×2 = 34 对燎原 30 = 113%，回到预算带内。
  judgement_fire: {
    name: '天火', cost: 3, type: 'attack', rarity: 'rare', dl: 9, impact: 'flame',
    v: { dmg: 12, burn: 5 }, upV: { dmg: 17, burn: 7 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，各施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) {
          ctx.dealDamage(ctx.player, e, c.v.dmg);
          ctx.addBuff(e, 'burn', c.v.burn);
        }
      });
    },
  },

  // ==================== DL10（rare）====================
  // 主题：终局 —— 卖血、余烬、燃烧三条线的合流

  final_ember: {
    name: '终烬', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'flame',
    v: { hp: 12, per: 6 }, upV: { hp: 12, per: 8 },
    text: (v) => `失去 ${v.hp} 点生命：消耗全部余烬，造成「余烬数 ×${v.per}」点伤害。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      ctx.loseHp(ctx.player, c.v.hp);
      if (ctx.player.hp <= 0) return;
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.dealDamage(ctx.player, ctx.enemy, n * c.v.per);
    },
  },

  eternal_flame: {
    name: '永燃', cost: 3, type: 'power', rarity: 'rare', dl: 10,
    v: { n: 3 }, upV: { n: 4 },
    text: (v) => `能力：每回合开始额外获得 ${v.n} 点余烬。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'resPerTurn', c.v.n); },
  },

  apocalypse_fire: {
    name: '燎原', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'flame',
    v: { dmg: 24, burn: 6 }, upV: { dmg: 30, burn: 9 },
    text: (v) => `造成 ${v.dmg} 点伤害，并施加 ${v.burn} 层燃烧。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      ctx.addBuff(ctx.enemy, 'burn', c.v.burn);
    },
  },
};

// 打角色标并并入总卡池（冲突检测的理由同 cards-medic.js）
Object.keys(KEEPER_CARDS).forEach(function (k) {
  if (CARDS[k]) throw new Error('卡牌 id 冲突：' + k + '（引火者）');
  KEEPER_CARDS[k].id = k;
  KEEPER_CARDS[k].char = 'keeper';
  CARDS[k] = KEEPER_CARDS[k];
});
