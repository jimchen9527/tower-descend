// 药水（M78 / R3a · §11 设计落地）
// —— 3 槽位、战斗中随时使用（不耗能量、不占出牌次数）、战斗结束不消失。
// 来源：商店（50–75 金）与宝箱（§11）。
//
// use(ctx)：与卡牌 play 同一套 ctx 原语（player/enemy/enemies/gainBlock/heal/
// drawCards/gainEnergy/addBuff/dealDamage…），引擎零特判。
// 敌方目标类药水打 ctx.enemy（玩家当前选中目标，单敌时即唯一敌人）。
const POTIONS = {
  poultice: {
    name: '止血敷料', icon: '🧪', price: 50,
    desc: '回复 18 点生命。',
    use(ctx) { ctx.heal(ctx.player, 18); },
  },
  quickplate: {
    name: '速凝护板', icon: '🛡️', price: 55,
    desc: '获得 14 点格挡。',
    use(ctx) { ctx.gainBlock(ctx.player, 14); },
  },
  cell: {
    name: '高能电池', icon: '🔋', price: 70,
    desc: '获得 2 点能量。',
    use(ctx) { ctx.gainEnergy(2); },
  },
  recall: {
    name: '记忆强化剂', icon: '📖', price: 55,
    desc: '抽 3 张牌。',
    use(ctx) { ctx.drawCards(3); },
  },
  stim: {
    name: '战斗兴奋剂', icon: '💉', price: 70,
    desc: '获得 2 点力量。',
    use(ctx) { ctx.addBuff(ctx.player, 'str', 2); },
  },
  firebomb: {
    name: '燃烧瓶', icon: '🔥', price: 60,
    desc: '对一名敌人造成 22 点伤害。',
    use(ctx) { ctx.dealDamageRaw(ctx.player, ctx.enemy, 22); },
  },
  toxin: {
    name: '蚀毒喷雾', icon: '☠️', price: 60,
    desc: '给一名敌人施加 5 层中毒。',
    use(ctx) { ctx.addBuff(ctx.enemy, 'poison', 5); },
  },
  flash: {
    name: '致盲粉尘', icon: '🌫️', price: 50,
    desc: '给一名敌人施加 2 层虚弱。',
    use(ctx) { ctx.addBuff(ctx.enemy, 'weak', 2); },
  },
  venomburst: {
    name: '腐蚀酸囊', icon: '🫧', price: 65,
    desc: '给一名敌人施加 3 层脆弱和 3 层中毒。',
    use(ctx) {
      ctx.addBuff(ctx.enemy, 'vulnerable', 3);
      ctx.addBuff(ctx.enemy, 'poison', 3);
    },
  },
};

// 商店货架的可抽池（全部平价药水；DL 不改变药水池 —— 药水是战术工具不是进度）
function potionPool() {
  return Object.keys(POTIONS);
}
