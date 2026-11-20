// 遗物 —— 设计文档 §12。M58 P1 扩容：4 → 22 件可掉落。
//
// 效果键名由 combat.js / run.js 直接读取，不做通用事件总线。
// 现有 10 个键（改这里之前先确认引擎真的读了它）：
//   combat：battleStartDraw / firstTurnEnergy / calmTurnHeal / startBlock / handSize
//   run：  descendMaxHp / winGold / winHeal / shopDiscount(0~0.5) / gainMaxHp(获得时一次性)
// ready:false 的遗物**不进任何掉落池** —— 玩家拿到一个不生效的遗物，比拿不到更糟。

const RELICS = {
  // ==================== 普通 ====================

  shaft_pendant: {
    id: 'shaft_pendant',
    name: '井壁吊坠',
    rarity: 'common',
    text: '每场战斗第 1 回合额外获得 1 点能量。',
    effect: { firstTurnEnergy: 1 },
    ready: true,
  },

  shaft_shard: {
    id: 'shaft_shard',
    name: '井壁碎片',
    rarity: 'common',
    text: '每深入 1 层，最大生命 +1。',
    effect: { descendMaxHp: 1 },
    ready: true,
  },

  brass_gear: {
    id: 'brass_gear',
    name: '黄铜齿轮',
    rarity: 'common',
    text: '每场战斗开始时，获得 4 点格挡。',
    effect: { startBlock: 4 },
    ready: true,
  },

  wax_seal: {
    id: 'wax_seal',
    name: '火漆印',
    rarity: 'common',
    text: '每场战斗胜利后，回复 3 点生命。',
    effect: { winHeal: 3 },
    ready: true,
  },

  old_lamp: {
    id: 'old_lamp',
    name: '老油灯',
    rarity: 'common',
    text: '每场战斗胜利后，额外获得 6 金币。',
    effect: { winGold: 6 },
    ready: true,
  },

  chalk_mark: {
    id: 'chalk_mark',
    name: '粉笔标记',
    rarity: 'common',
    text: '商店里所有物品的价格 −15%。',
    effect: { shopDiscount: 0.15 },
    ready: true,
  },

  leather_strap: {
    id: 'leather_strap',
    name: '皮质绑带',
    rarity: 'common',
    text: '获得时，最大生命 +8。',
    effect: { gainMaxHp: 8 },
    ready: true,
  },

  rat_fang: {
    id: 'rat_fang',
    name: '鼠獠牙',
    rarity: 'common',
    text: '每场战斗开始时，抽 1 张额外的牌。',
    effect: { battleStartDraw: 1 },
    ready: true,
  },

  // ==================== 罕见 ====================

  alloy_compass: {
    id: 'alloy_compass',
    name: '锈蚀罗盘',
    rarity: 'uncommon',
    text: '每场战斗开始时，抽 1 张额外的牌。',
    effect: { battleStartDraw: 1 },
    ready: true,
  },

  moss_charm: {
    id: 'moss_charm',
    name: '苔藓护符',
    rarity: 'uncommon',
    text: '回合结束时若本回合未受伤，回复 2 点生命。',
    effect: { calmTurnHeal: 2 },
    ready: true,
  },

  miners_gloves: {
    id: 'miners_gloves',
    name: '矿工手套',
    rarity: 'uncommon',
    text: '每场战斗开始时，获得 7 点格挡。',
    effect: { startBlock: 7 },
    ready: true,
  },

  soot_charm: {
    id: 'soot_charm',
    name: '烟灰符',
    rarity: 'uncommon',
    text: '每场战斗胜利后，额外获得 12 金币。',
    effect: { winGold: 12 },
    ready: true,
  },

  herb_pouch: {
    id: 'herb_pouch',
    name: '草药袋',
    rarity: 'uncommon',
    text: '每场战斗胜利后，回复 6 点生命。',
    effect: { winHeal: 6 },
    ready: true,
  },

  warm_shawl: {
    id: 'warm_shawl',
    name: '旧披肩',
    rarity: 'uncommon',
    text: '回合结束时若本回合未受伤，回复 4 点生命。',
    effect: { calmTurnHeal: 4 },
    ready: true,
  },

  ledger_page: {
    id: 'ledger_page',
    name: '账目残页',
    rarity: 'uncommon',
    text: '商店里所有物品的价格 −30%。',
    effect: { shopDiscount: 0.3 },
    ready: true,
  },

  iron_lung: {
    id: 'iron_lung',
    name: '铁肺',
    rarity: 'uncommon',
    text: '获得时，最大生命 +16。',
    effect: { gainMaxHp: 16 },
    ready: true,
  },

  // ==================== 稀有 ====================

  guardian_idol: {
    id: 'guardian_idol',
    name: '守护神像',
    rarity: 'rare',
    text: '每场战斗开始时，获得 15 点格挡。',
    effect: { startBlock: 15 },
    ready: true,
  },

  ember_heart: {
    id: 'ember_heart',
    name: '余烬之心',
    rarity: 'rare',
    text: '每场战斗胜利后，回复 10 点生命。',
    effect: { winHeal: 10 },
    ready: true,
  },

  gold_scale: {
    id: 'gold_scale',
    name: '金秤',
    rarity: 'rare',
    text: '每场战斗胜利后，额外获得 25 金币。',
    effect: { winGold: 25 },
    ready: true,
  },

  wide_belt: {
    id: 'wide_belt',
    name: '宽背带',
    rarity: 'rare',
    text: '手牌上限 +1（每回合多抽 1 张）。',
    effect: { handSize: 1 },
    ready: true,
  },

  blood_pact: {
    id: 'blood_pact',
    name: '血契',
    rarity: 'rare',
    text: '获得时，最大生命 +25。',
    effect: { gainMaxHp: 25 },
    ready: true,
  },

  deep_lantern: {
    id: 'deep_lantern',
    name: '深井提灯',
    rarity: 'rare',
    text: '每场战斗第 1 回合额外获得 2 点能量。',
    effect: { firstTurnEnergy: 2 },
    ready: true,
  },

  // ---- 以下两个依赖未实装机制，暂不进掉落池 ----

  rope_scrap: {
    id: 'rope_scrap',
    name: '断绳',
    rarity: 'rare',
    text: '攀绳次数 +1（每局共 2 次）。',
    effect: { backrope: 1 },
    // M78：攀绳（§13）已实装，解禁进掉落池
    ready: true,
  },

  ember_reader: {
    id: 'ember_reader',
    name: '火种读数仪',
    rarity: 'rare',
    text: '每场 Boss 战开始前，显示该 Boss 的下一个行动 3 回合。',
    effect: { bossIntentPreview: 3 },
    // M78：开局意图推演（Combat.forecastBoss）已实装，解禁进掉落池
    ready: true,
  },
};

// 可掉落池：只有 ready 的遗物
function relicPool() {
  return Object.keys(RELICS).filter(function (k) {
    return RELICS[k].ready;
  });
}

// 把一组遗物的某个 effect 累加。
// 同种遗物不会重复获得，但不同遗物以后可能映射到同一个 effect 键。
function relicEffect(relicIds, key) {
  let sum = 0;
  (relicIds || []).forEach(function (id) {
    const r = RELICS[id];
    if (r && r.effect && r.effect[key]) sum += r.effect[key];
  });
  return sum;
}
