// 拾荒医师卡池 —— 43 张：10 张专属基础池（dl:0）+ DL1–DL10 各 3 张
// + M32 群体系 3 张（DL2/6/9 各 1 张全体攻击）。
//
// 设计文档 §8.2：独有资源「样本」（上限 5，每回合开始 +1），
// 命名走学术病历词，卡面病绿。核心机制是**资源累积**：前期弱，攒起来后翻盘。
//
// M6 先做到 DL2（16 张），M17 按 DL 层分批补齐 DL3–DL10（24 张），
// 达成 §3.2 的终态每角色 40 张。DL3–DL4 是基础池的机制延伸
// （样本转化 / 中毒流），DL5–DL6 转向续航与爆发（换血 / 尸检加成），
// DL7–DL10 是稀有终局（终末诊断、大流行、万灵药）。
//
// 引用的引擎原语：gainResource / spendResource / resource
// （combat.js 按角色资源规格提供，不认「样本」这个名字）

const MEDIC_CARDS = {
  // ==================== 基础池 10 张（dl:0）====================
  // 对标掘者的 strike / defend / crowbar，但机制全换成样本线。

  scalpel: {
    name: '解剖刀', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'blade',
    v: { dmg: 6 }, upV: { dmg: 9 },
    text: (v) => `造成 ${v.dmg} 点伤害。`,
    play(ctx, c) { ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg); },
  },

  tourniquet: {
    name: '止血带', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 5 }, upV: { block: 8 },
    text: (v) => `获得 ${v.block} 点格挡。`,
    play(ctx, c) { ctx.gainBlock(ctx.player, c.v.block); },
  },

  // 起始卡组里的那张「撬棍位」：0 费直接换资源
  sampling: {
    name: '采样', cost: 0, type: 'skill', rarity: 'basic', dl: 0,
    v: { res: 1 }, upV: { res: 2 },
    text: (v) => `获得 ${v.res} 点样本。`,
    play(ctx, c) { ctx.gainResource(c.v.res); },
  },

  biopsy: {
    name: '活检', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'blade',
    v: { dmg: 5, boost: 10, res: 1 }, upV: { dmg: 7, boost: 13, res: 1 },
    text: (v) => `造成 ${v.dmg} 点伤害；消耗 ${v.res} 点样本则改为 ${v.boost} 点。`,
    play(ctx, c) {
      // 可选消耗：没样本也能打，只是吃不到加成
      const spent = ctx.spendResource(c.v.res);
      ctx.dealDamage(ctx.player, ctx.enemy, spent ? c.v.boost : c.v.dmg);
    },
  },

  disinfect: {
    name: '消毒', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 4, res: 1 }, upV: { block: 7, res: 1 },
    text: (v) => `获得 ${v.block} 点格挡，获得 ${v.res} 点样本。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.gainResource(c.v.res);
    },
  },

  debride: {
    name: '清创', cost: 1, type: 'attack', rarity: 'basic', dl: 0, impact: 'blade',
    v: { dmg: 8, heal: 3 }, upV: { dmg: 11, heal: 4 },
    text: (v) => `造成 ${v.dmg} 点伤害；若目标已中毒，回复 ${v.heal} 点生命。`,
    play(ctx, c) {
      // 先看状态再打 —— 这一击自己把毒清掉了不该算数
      const poisoned = (ctx.enemy.buffs.poison || 0) > 0;
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      if (poisoned) ctx.heal(ctx.player, c.v.heal);
    },
  },

  injection: {
    name: '血清注射', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { heal: 5, res: 1 }, upV: { heal: 8, res: 1 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.res} 点样本。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainResource(c.v.res);
    },
  },

  microscope: {
    name: '显微镜', cost: 1, type: 'power', rarity: 'basic', dl: 0,
    v: { n: 1 }, upV: { n: 2 },
    text: (v) => `每回合开始额外获得 ${v.n} 点样本。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'resPerTurn', c.v.n); },
  },

  pathology: {
    name: '病理分析', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { draw: 2 }, upV: { draw: 3 },
    text: (v) => `抽 ${v.draw} 张牌。`,
    play(ctx, c) { ctx.drawCards(c.v.draw); },
  },

  antibody: {
    name: '抗体', cost: 1, type: 'skill', rarity: 'basic', dl: 0,
    v: { block: 4, weak: 2 }, upV: { block: 6, weak: 3 },
    text: (v) => `获得 ${v.block} 点格挡，施加 ${v.weak} 层虚弱。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.addBuff(ctx.enemy, 'weak', c.v.weak);
    },
  },

  // ==================== DL1（common）====================
  // 主题：把样本真正当资源花出去 —— 第一次出现「必须有样本才能打」的卡

  serum3: {
    name: '血清三号', cost: 1, type: 'attack', rarity: 'common', dl: 1, impact: 'blade',
    v: { dmg: 12, res: 2 }, upV: { dmg: 16, res: 2 }, // M82（F6）：14→12 / 19→16，让出全池每费最高
    text: (v) => `消耗 ${v.res} 点样本：造成 ${v.dmg} 点伤害。`,
    need: (c, ctx) => ctx.resource() >= c.v.res,
    play(ctx, c) {
      ctx.spendResource(c.v.res);
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
    },
  },

  observation: {
    name: '临床观察', cost: 0, type: 'skill', rarity: 'common', dl: 1,
    v: { draw: 1, extra: 1, res: 1 }, upV: { draw: 1, extra: 2, res: 1 },
    text: (v) => `抽 ${v.draw} 张牌；消耗 ${v.res} 点样本再抽 ${v.extra} 张。`,
    play(ctx, c) {
      ctx.drawCards(c.v.draw);
      if (ctx.spendResource(c.v.res)) ctx.drawCards(c.v.extra);
    },
  },

  petri: {
    name: '培养皿', cost: 2, type: 'skill', rarity: 'common', dl: 1,
    v: { poison: 8, res: 3 }, upV: { poison: 12, res: 3 },
    text: (v) => `消耗 ${v.res} 点样本：施加 ${v.poison} 层中毒。`,
    need: (c, ctx) => ctx.resource() >= c.v.res,
    play(ctx, c) {
      ctx.spendResource(c.v.res);
      ctx.addBuff(ctx.enemy, 'poison', c.v.poison);
    },
  },

  // ==================== DL2（uncommon）====================
  // 主题：样本开始产生被动收益

  parasite: {
    name: '寄生', cost: 2, type: 'power', rarity: 'uncommon', dl: 2,
    v: { bonus: 0 }, upV: { bonus: 4 },
    text: (v) => `敌方受到中毒伤害时，你回复等量生命${v.bonus ? `，再额外回复 ${v.bonus}` : ''}。`,
    play(ctx, c) {
      ctx.addBuff(ctx.player, 'parasite', 1);
      if (c.v.bonus) ctx.addBuff(ctx.player, 'parasiteBonus', c.v.bonus);
    },
  },

  regen_tissue: {
    name: '组织再生', cost: 1, type: 'skill', rarity: 'uncommon', dl: 2,
    v: { per: 3 }, upV: { per: 4 },
    text: (v) => `每有 1 点样本，回复 ${v.per} 点生命。`,
    play(ctx, c) {
      const n = ctx.resource();
      if (n > 0) ctx.heal(ctx.player, n * c.v.per);
    },
  },

  bloom: {
    name: '菌群爆发', cost: 3, type: 'skill', rarity: 'uncommon', dl: 2,
    v: { per: 3 }, upV: { per: 4 },
    text: (v) => `消耗全部样本：对所有敌人施加「样本数 ×${v.per}」层中毒。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      const poison = n * c.v.per;
      // 多敌人的「对全体」：遍历所有存活单位，不是只打当前目标
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.addBuff(e, 'poison', poison);
      });
    },
  },

  // M32 群体系：医师的第一张「直接打全体」——数值平平但带群体上毒，
  // 是「多点采样」的字面意思：每个病灶都抹一下。
  multi_swab: {
    name: '多点采样', cost: 1, type: 'attack', rarity: 'uncommon', dl: 2, impact: 'blade',
    v: { dmg: 3, poison: 1 }, upV: { dmg: 4, poison: 2 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，各施加 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) {
          ctx.dealDamage(ctx.player, e, c.v.dmg);
          ctx.addBuff(e, 'poison', c.v.poison);
        }
      });
    },
  },

  // ==================== DL3（uncommon）====================
  // 主题：样本的转化效率 —— 从「攒样本」进入「样本就是数值」

  culture: {
    name: '培养基', cost: 1, type: 'skill', rarity: 'uncommon', dl: 3,
    v: { block: 8, res: 2 }, upV: { block: 12, res: 2 },
    text: (v) => `消耗 ${v.res} 点样本：获得 ${v.block} 点格挡。`,
    need: (c, ctx) => ctx.resource() >= c.v.res,
    play(ctx, c) {
      ctx.spendResource(c.v.res);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  triage: {
    name: '分诊', cost: 1, type: 'attack', rarity: 'uncommon', dl: 3, impact: 'blade',
    v: { dmg: 5, per: 2 }, upV: { dmg: 6, per: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害；每有 1 点样本，额外造成 ${v.per} 点（不消耗）。`,
    play(ctx, c) {
      // 不消耗样本 —— 这是「样本越多越强」的直给型，鼓励继续攒
      const n = ctx.resource();
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg + n * c.v.per);
    },
  },

  anesthesia: {
    name: '麻醉', cost: 1, type: 'skill', rarity: 'uncommon', dl: 3,
    v: { weak: 2, poison: 3 }, upV: { weak: 3, poison: 4 },
    text: (v) => `施加 ${v.weak} 层虚弱和 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.addBuff(ctx.enemy, 'weak', c.v.weak);
      ctx.addBuff(ctx.enemy, 'poison', c.v.poison);
    },
  },

  // ==================== DL4（uncommon）====================
  // 主题：中毒流成型 —— 群体上毒与「毒转伤害」

  incubator: {
    name: '培养箱', cost: 2, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { poison: 3 }, upV: { poison: 4 },
    text: (v) => `对所有敌人施加 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.addBuff(e, 'poison', c.v.poison);
      });
    },
  },

  toxicology: {
    name: '毒理学', cost: 1, type: 'attack', rarity: 'uncommon', dl: 4, impact: 'blade',
    v: { dmg: 6, per: 2 }, upV: { dmg: 8, per: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害；目标每有 5 层中毒，额外造成 ${v.per} 点。`,
    play(ctx, c) {
      // 先读毒层再打 —— 这一击不改变毒层，两种顺序等价，但读在前更清楚
      const p = ctx.enemy.buffs.poison || 0;
      const bonus = Math.floor(p / 5) * c.v.per;
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg + bonus);
    },
  },

  suture: {
    name: '缝合', cost: 1, type: 'skill', rarity: 'uncommon', dl: 4,
    v: { block: 6, heal: 3 }, upV: { block: 9, heal: 5 },
    text: (v) => `获得 ${v.block} 点格挡，回复 ${v.heal} 点生命。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.heal(ctx.player, c.v.heal);
    },
  },

  // ==================== DL5（uncommon）====================
  // 主题：续航 —— 把样本线接回生命线

  transfusion: {
    name: '输血', cost: 2, type: 'skill', rarity: 'uncommon', dl: 5,
    v: { heal: 8, res: 2 }, upV: { heal: 12, res: 2 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.res} 点样本。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainResource(c.v.res);
    },
  },

  immunity: {
    name: '免疫', cost: 2, type: 'power', rarity: 'uncommon', dl: 5,
    v: { block: 4, res: 1 }, upV: { block: 6, res: 1 },
    text: (v) => `能力：每回合开始时，获得 ${v.block} 点格挡和 ${v.res} 点样本。`,
    play(ctx, c) {
      // 两件事都是「回合开始」钩子：格挡走 metallicize、样本走 resPerTurn
      ctx.addBuff(ctx.player, 'metallicize', c.v.block);
      ctx.addBuff(ctx.player, 'resPerTurn', c.v.res);
    },
  },

  quarantine: {
    name: '隔离', cost: 1, type: 'skill', rarity: 'uncommon', dl: 5,
    v: { block: 7, weak: 1 }, upV: { block: 10, weak: 2 },
    text: (v) => `获得 ${v.block} 点格挡，施加 ${v.weak} 层虚弱。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.addBuff(ctx.enemy, 'weak', c.v.weak);
    },
  },

  // ==================== DL6（uncommon）====================
  // 主题：样本爆发雏形 —— 把攒下来的样本一次兑现

  antibody_storm: {
    name: '抗体风暴', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'blade',
    v: { dmg: 4, times: 3 }, upV: { dmg: 6, times: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次。`,
    play(ctx, c) { ctx.attackTimes(ctx.player, ctx.enemy, c.v.times, c.v.dmg); },
  },

  culture_burst: {
    name: '培养爆', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'blast',
    v: { per: 3 }, upV: { per: 4 },
    text: (v) => `消耗全部样本：造成「样本数 ×${v.per}」点伤害。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.dealDamage(ctx.player, ctx.enemy, n * c.v.per);
    },
  },

  sedative: {
    name: '镇静剂', cost: 1, type: 'skill', rarity: 'uncommon', dl: 6,
    v: { block: 5, draw: 2 }, upV: { block: 7, draw: 2 },
    text: (v) => `获得 ${v.block} 点格挡，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.drawCards(c.v.draw);
    },
  },

  // M32 群体系：「菌群爆发」的伤害版镜像 —— 样本转化为全场直接伤害。
  // 2 费比爆发（3 费）便宜一档，毒是慢伤、这里是快伤，两条线各管一头。
  // 2026-10-02 数值复核：原 per 4 与同费同档的「培养爆」（单体 per 3）相比，
  // 群体版的每样本系数反而高 33% —— AoE 折扣反了。落到 per 2：
  // 满样本（上限 5）全体 10、双敌 20，对标同费同档的「焚身」（basic 2 费全体 8、代价 −5 HP）。
  aerosol_bloom: {
    name: '气溶胶爆发', cost: 2, type: 'attack', rarity: 'uncommon', dl: 6, impact: 'blast',
    v: { per: 2 }, upV: { per: 3 },
    text: (v) => `消耗全部样本：对所有敌人造成「样本数 ×${v.per}」点伤害。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.dealDamage(ctx.player, e, n * c.v.per);
      });
    },
  },

  // ==================== DL7（rare）====================
  // 主题：稀有档 —— 把前面三条线（样本 / 中毒 / 回复）推到质变

  antiseptic: {
    name: '防腐', cost: 1, type: 'skill', rarity: 'rare', dl: 7,
    v: { per: 5 }, upV: { per: 6 },
    text: (v) => `消耗全部样本：每点样本获得 ${v.per} 点格挡。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.gainBlock(ctx.player, n * c.v.per);
    },
  },

  necropsy: {
    name: '尸检', cost: 2, type: 'attack', rarity: 'rare', dl: 7, impact: 'blade',
    v: { dmg: 12, draw: 3 }, upV: { dmg: 16, draw: 3 },
    text: (v) => `造成 ${v.dmg} 点伤害。若击杀，抽 ${v.draw} 张牌。`,
    play(ctx, c) {
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
      if (ctx.enemy.hp <= 0) ctx.drawCards(c.v.draw);
    },
  },

  virulence: {
    name: '毒力', cost: 2, type: 'skill', rarity: 'rare', dl: 7,
    v: { mult: 2 }, upV: { mult: 3 },
    text: (v) => `消耗全部样本：目标的中毒层数 ×${v.mult}。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      ctx.spendResource(ctx.resource());
      // addBuff 是累加，所以「×2」= 再补一份当前层数，倍率改数值即可
      const cur = ctx.enemy.buffs.poison || 0;
      if (cur > 0) ctx.addBuff(ctx.enemy, 'poison', cur * (c.v.mult - 1));
    },
  },

  // ==================== DL8（rare）====================
  // 主题：样本的规模效应 —— 单卡数值跳一档

  serum_x: {
    name: '血清X', cost: 2, type: 'attack', rarity: 'rare', dl: 8, impact: 'blade',
    v: { dmg: 20, res: 4 }, upV: { dmg: 26, res: 4 },
    text: (v) => `消耗 ${v.res} 点样本：造成 ${v.dmg} 点伤害。`,
    need: (c, ctx) => ctx.resource() >= c.v.res,
    play(ctx, c) {
      ctx.spendResource(c.v.res);
      ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
    },
  },

  palliative: {
    name: '姑息', cost: 1, type: 'skill', rarity: 'rare', dl: 8,
    // M31 平衡：原 12 格挡 + 4 回血，是「缝合」（1 费 6 格挡 + 3 回血，
    // uncommon）的整整两倍 —— 同为 1 费，稀有度只该高一档不该翻倍。
    // 收到 8/5（升级 11/7）：仍明显强于缝合，但回到「稀有」的量级。
    v: { block: 8, heal: 5 }, upV: { block: 11, heal: 7 },
    text: (v) => `获得 ${v.block} 点格挡，回复 ${v.heal} 点生命。`,
    play(ctx, c) {
      ctx.gainBlock(ctx.player, c.v.block);
      ctx.heal(ctx.player, c.v.heal);
    },
  },

  metabolism: {
    name: '代谢', cost: 2, type: 'power', rarity: 'rare', dl: 8,
    v: { n: 2 }, upV: { n: 3 },
    text: (v) => `能力：每回合开始额外获得 ${v.n} 点样本。`,
    play(ctx, c) { ctx.addBuff(ctx.player, 'resPerTurn', c.v.n); },
  },

  // ==================== DL9（rare）====================
  // 主题：极端手段 —— 高费高收益

  contagion: {
    name: '传染', cost: 3, type: 'skill', rarity: 'rare', dl: 9,
    v: { poison: 6 }, upV: { poison: 9 },
    text: (v) => `对所有敌人施加 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.addBuff(e, 'poison', c.v.poison);
      });
    },
  },

  resuscitate: {
    name: '复苏', cost: 2, type: 'skill', rarity: 'rare', dl: 9,
    v: { heal: 8, res: 3 }, upV: { heal: 12, res: 4 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.res} 点样本。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainResource(c.v.res);
    },
  },

  dissection: {
    name: '剖检', cost: 2, type: 'attack', rarity: 'rare', dl: 9, impact: 'blade',
    v: { dmg: 8, times: 2, poison: 3 }, upV: { dmg: 11, times: 2, poison: 4 },
    text: (v) => `造成 ${v.dmg} 点伤害，重复 ${v.times} 次；每次施加 ${v.poison} 层中毒。`,
    play(ctx, c) {
      // 不用 attackTimes：那条路只打伤害，每段之间没法夹上毒。自己走循环。
      for (let i = 0; i < c.v.times; i++) {
        if (ctx.enemy.hp <= 0) break;
        ctx.dealDamage(ctx.player, ctx.enemy, c.v.dmg);
        ctx.addBuff(ctx.enemy, 'poison', c.v.poison);
      }
    },
  },

  // M32 群体系：群体速伤 + 群体上毒一卡两吃，DL9 的稀有档全体牌
  virulent_outbreak: {
    name: '暴发性感染', cost: 2, type: 'attack', rarity: 'rare', dl: 9, impact: 'blast',
    v: { dmg: 8, poison: 4 }, upV: { dmg: 11, poison: 6 },
    text: (v) => `对所有敌人造成 ${v.dmg} 点伤害，各施加 ${v.poison} 层中毒。`,
    play(ctx, c) {
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) {
          ctx.dealDamage(ctx.player, e, c.v.dmg);
          ctx.addBuff(e, 'poison', c.v.poison);
        }
      });
    },
  },

  // ==================== DL10（rare）====================
  // 主题：终局 —— 三条线的合流

  panacea: {
    name: '万灵药', cost: 3, type: 'skill', rarity: 'rare', dl: 10,
    v: { heal: 15, block: 15 }, upV: { heal: 20, block: 20 },
    text: (v) => `回复 ${v.heal} 点生命，获得 ${v.block} 点格挡。`,
    play(ctx, c) {
      ctx.heal(ctx.player, c.v.heal);
      ctx.gainBlock(ctx.player, c.v.block);
    },
  },

  pandemic: {
    name: '大流行', cost: 3, type: 'skill', rarity: 'rare', dl: 10,
    v: { per: 5 }, upV: { per: 7 },
    text: (v) => `消耗全部样本：对所有敌人施加「样本数 ×${v.per}」层中毒。`,
    need: (c, ctx) => ctx.resource() > 0,
    play(ctx, c) {
      const n = ctx.resource();
      ctx.spendResource(n);
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0) ctx.addBuff(e, 'poison', n * c.v.per);
      });
    },
  },

  final_diagnosis: {
    name: '终末诊断', cost: 3, type: 'attack', rarity: 'rare', dl: 10, impact: 'blade',
    // M31 平衡：原 30（每费 10）是全池最高的每费输出，且无视格挡 ——
    // 比它更贵的终末钻探（3 费）还得先失去 10 点生命。
    // 收到 24/32（每费 8，与掘者的「破岩」同档），仍比任何普通攻击高。
    v: { dmg: 24 }, upV: { dmg: 32 },
    text: (v) => `造成 ${v.dmg} 点伤害，无视格挡。`,
    play(ctx, c) { ctx.dealDamageRaw(ctx.player, ctx.enemy, c.v.dmg); },
  },
};

// 打角色标并并入总卡池。
// 这里显式查一遍 id 冲突而不是直接 Object.assign —— assign 会静默覆盖，
// 两个角色撞了同名 id 时要等到玩法出问题才发现。
// 卡上的 id 由 key 自动填，不手写：手写就有写错的可能。
Object.keys(MEDIC_CARDS).forEach(function (k) {
  if (CARDS[k]) throw new Error('卡牌 id 冲突：' + k + '（拾荒医师）');
  MEDIC_CARDS[k].id = k;
  MEDIC_CARDS[k].char = 'medic';
  CARDS[k] = MEDIC_CARDS[k];
});
