// 敌人 —— Act 1「废墟层」完整池（设计文档 §9）。
//
// 数据格式：
//   kind             'normal' | 'elite' | 'boss'，决定奖励规则
//   hpMin / hpMax    基础 HP 区间；小怪与中 Boss 会再乘深压系数（§13）
//   gold             击杀金币区间
//   pattern          招式循环：pattern[patternIndex % length]
//   choose(ctx)      可选。动态选招，返回招式 key；返回 null 表示回退到 pattern
//   moves            招式表
//
// 招式字段：
//   kind             'attack' | 'buff' | 'debuff' | 'defend' | 'special'
//   value            意图上显示的数值（attack 会被 intentDamage 按 buff 修正）
//   label            非攻击招式的意图文案（attack 一般不用，由渲染层算实际伤害）
//   desc(unit)       可选。完全自定义意图文案，优先于 label
//   run(ctx)         结算
//
// 可选钩子：
//   onSpawn(ctx)     本场战斗开始时触发（双头犬的第二颗头）
//   beforeAct(ctx)   该敌人每次行动前触发（无首执械者的姿态切换）
//   onDeath(ctx)     该敌人死亡时触发（菌母的孢子自爆）
//
// 可选标记：
//   noDepthScale     不叠深压。大 Boss 用 —— 它的强度由 tier 承担（§6）
//   keepBlock        自身格挡不在回合开始清零（蚀骨工匠的骨甲）
//   minion           算作召唤物，可被菌母的「召唤上限」统计
//
// 单位上的自定义字段（在招式的 run 里读写，用 `|| 0` 兜底，不需要在 spawn 处初始化）：
//   charge           蚀骨工匠的「叠甲轮数」。甲会被玩家打掉，蓄力不会 ——
//                    骨刺的触发靠它兜底，否则玩家一破甲就永远看不到骨刺（M14）
//
// 关于意图里的「全体」：本作只有玩家一方有单位（§7 目标单选），
// 所以「全体」在实现上就是「玩家」。文案保留原文的压迫感。

const ENEMIES = {
  // ==================== 小怪池（§9.1）====================

  rats: {
    id: 'rats', name: '腐蚀鼠群', kind: 'normal',
    hpMin: 12, hpMax: 18, gold: [10, 20],
    pattern: ['bite', 'rally'],
    moves: {
      bite: {
        id: 'bite', name: '咬', kind: 'attack', value: 5, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 5); },
      },
      rally: {
        id: 'rally', name: '鼠群集结', kind: 'buff', value: 2, label: '强化 +2 力量',
        run(ctx) { ctx.addBuff(ctx.enemy, 'str', 2); },
      },
    },
  },

  sentinel: {
    id: 'sentinel', name: '锈蚀哨兵', kind: 'normal',
    hpMin: 26, hpMax: 34, gold: [15, 25],
    pattern: ['shield_bash', 'hammer'],
    moves: {
      shield_bash: {
        id: 'shield_bash', name: '盾击', kind: 'attack', value: 6, impact: 'metal',
        desc: () => '攻击 6 · 自获 4 格挡',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 6);
          ctx.gainBlock(ctx.enemy, 4);
        },
      },
      hammer: {
        id: 'hammer', name: '重锤', kind: 'attack', value: 11, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 11); },
      },
    },
  },

  spore_walker: {
    id: 'spore_walker', name: '孢囊行者', kind: 'normal', minion: true,
    hpMin: 20, hpMax: 26, gold: [12, 22],
    pattern: ['spores', 'bite'],
    moves: {
      spores: {
        id: 'spores', name: '孢子', kind: 'debuff', value: 3,
        label: '施加 3 层中毒',
        run(ctx) { ctx.addBuff(ctx.player, 'poison', 3); },
      },
      bite: {
        id: 'bite', name: '撕咬', kind: 'attack', value: 7, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 7); },
      },
    },
  },

  crawler: {
    id: 'crawler', name: '井壁爬虫', kind: 'normal',
    hpMin: 16, hpMax: 22, gold: [12, 20],
    pattern: ['gnaw', 'hide'],
    moves: {
      gnaw: {
        id: 'gnaw', name: '撕咬', kind: 'attack', value: 4, impact: 'claw',
        desc: () => '攻击 4 × 2',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 4); },
      },
      hide: {
        id: 'hide', name: '遁入墙缝', kind: 'defend', value: 6, label: '获得 6 格挡',
        run(ctx) { ctx.gainBlock(ctx.enemy, 6); },
      },
    },
  },

  // 模仿你的上一张牌。为了让玩家能预判，模仿规则写死：
  // 上一张是攻击牌 → 造成「5 + 费用×3」伤害；否则缩起来加 8 格挡。
  scavenger_shade: {
    id: 'scavenger_shade', name: '拾荒者残影', kind: 'normal',
    // hover：悬浮单位，M26 待机走「上下浮动 + 地面影」而不是接地呼吸。
    // 没有标记的一律按接地处理 —— 脚踩地上的单位浮动会「飘」，脚底必须钉死。
    hover: true,
    hpMin: 18, hpMax: 24, gold: [15, 25],
    pattern: ['mimic'],
    moves: {
      mimic: {
        id: 'mimic', name: '模仿', kind: 'special', impact: 'blade',
        desc(unit) {
          const last = Combat.state.lastPlayed;
          if (!last || last.type !== 'attack') return '模仿 · 你上一张不是攻击牌';
          return '模仿 · 攻击 ' + (5 + last.cost * 3);
        },
        run(ctx) {
          const last = ctx.lastPlayed;
          if (!last || last.type !== 'attack') {
            ctx.log('残影抓了个空。');
            ctx.gainBlock(ctx.enemy, 8);
            return;
          }
          ctx.dealDamage(ctx.enemy, ctx.player, 5 + last.cost * 3);
        },
      },
    },
  },

  // ---- M50 新增：第二关（D12–22）普通怪 · 锈蚀遗迹机械系 ----

  // 电弧焊工：先上燃烧再攻击的「持续伤害」型。燃烧不衰减（combat.js tickBurn），
  // 所以它的威胁是滚雪球式的 —— 拖得越久越贵，玩家得抢在弧光叠厚之前解决。
  arc_welder: {
    id: 'arc_welder', name: '电弧焊工', kind: 'normal',
    hpMin: 24, hpMax: 30, gold: [16, 26],
    pattern: ['arc', 'weld'],
    moves: {
      arc: {
        id: 'arc', name: '电弧', kind: 'attack', value: 5, impact: 'blast',
        desc: () => '攻击 5 · 施加 2 层燃烧',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 5);
          ctx.addBuff(ctx.player, 'burn', 2);
        },
      },
      weld: {
        id: 'weld', name: '焊接加固', kind: 'buff', value: 2,
        desc: () => '自获 7 格挡 · 强化 +2 力量',
        run(ctx) {
          ctx.gainBlock(ctx.enemy, 7);
          ctx.addBuff(ctx.enemy, 'str', 2);
        },
      },
    },
  },

  // 桩击机：只会砸的纯压力型，但「过载」用自伤换力量 —— 拖着打它会越来越痛，
  // 速杀它的收益也最高。血量比同级怪高一截，是这一关的「墙」。
  pile_driver: {
    id: 'pile_driver', name: '桩击机', kind: 'normal',
    hpMin: 32, hpMax: 40, gold: [18, 28],
    pattern: ['ram', 'overload'],
    moves: {
      ram: {
        id: 'ram', name: '桩击', kind: 'attack', value: 11, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 11); },
      },
      overload: {
        id: 'overload', name: '过载', kind: 'buff', value: 3, label: '强化 +3 力量 · 自伤 4',
        run(ctx) {
          ctx.addBuff(ctx.enemy, 'str', 3);
          ctx.loseHp(ctx.enemy, 4);
          ctx.log('它把限压阀拧过了红区。');
        },
      },
    },
  },

  // ---- M50 新增：第三关（D23–33）专属普通怪 · 菌丝研究所系 ----

  // 菌壳矛兵：高单发 + 自我加甲 —— 硬碰硬换血很亏，得靠削甲或无视格挡的手段。
  husk_lancer: {
    id: 'husk_lancer', name: '菌壳矛兵', kind: 'normal',
    hpMin: 28, hpMax: 36, gold: [20, 30],
    pattern: ['pierce', 'harden'],
    moves: {
      pierce: {
        id: 'pierce', name: '穿刺', kind: 'attack', value: 13, impact: 'pick',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 13); },
      },
      harden: {
        id: 'harden', name: '结壳', kind: 'defend', value: 10, label: '获得 10 格挡',
        run(ctx) { ctx.gainBlock(ctx.enemy, 10); },
      },
    },
  },

  // 菌索爬行体：低血、上毒快 —— 单只不吓人，三只编队时中毒量叠得很快，
  // 是「复数组合」里最需要先处理的那一类。
  cord_creeper: {
    id: 'cord_creeper', name: '菌索爬行体', kind: 'normal', minion: true,
    hpMin: 20, hpMax: 26, gold: [14, 22],
    pattern: ['lash', 'infest'],
    moves: {
      lash: {
        id: 'lash', name: '菌索抽打', kind: 'attack', value: 8, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 8); },
      },
      infest: {
        id: 'infest', name: '侵染', kind: 'debuff', value: 4,
        label: '施加 4 层中毒',
        run(ctx) { ctx.addBuff(ctx.player, 'poison', 4); },
      },
    },
  },

  // ---- M56 新增：进化体（第 2/3 关）----
  //
  // 与 M50「壮大版」（同形象 + 数值词缀）的区别：进化体是**完全设计的敌人** ——
  // 更大的体型（art.css 的 .art-id-* 档位）、更强的形象与招式，与一阶敌人
  // 保持「延续、进化」：每只保留原型的 1 个标志性旧招 + 形象特征。
  // 字段 evolvedFrom / evolvedStage 供测试与图鉴用，逻辑层不读。
  // 数值锚点：二阶 ≈ 原 grown 槽位（HP ×1.9 上下）；三阶 ≈ ×2.4（第三关略强）。

  // 二阶（第二关 D12–22 · 锈蚀遗迹）

  // 锈牙鼠王（← 腐蚀鼠群）：领头巨鼠背上钉着锈铁片。保留旧招「咬」的骨架。
  rat_king: {
    id: 'rat_king', name: '锈牙鼠王', kind: 'normal',
    evolvedFrom: 'rats', evolvedStage: 2,
    hpMin: 34, hpMax: 42, gold: [25, 40],
    pattern: ['heavy_bite', 'swarm_bite', 'rally_up'],
    moves: {
      heavy_bite: {
        id: 'heavy_bite', name: '重咬', kind: 'attack', value: 8, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 8); },
      },
      swarm_bite: {
        id: 'swarm_bite', name: '鼠潮啃噬', kind: 'attack', value: 5, impact: 'claw',
        desc: () => '连续 2 次攻击 5 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 5); },
      },
      rally_up: {
        id: 'rally_up', name: '振群', kind: 'buff', value: 2, label: '强化 +2 力量',
        run(ctx) { ctx.addBuff(ctx.enemy, 'str', 2); },
      },
    },
  },

  // 哨兵·破城型（← 锈蚀哨兵）：盾面加了撞角。「列阵」是百夫长（中 Boss）的前摇教学。
  sentinel_breach: {
    id: 'sentinel_breach', name: '哨兵·破城型', kind: 'normal',
    evolvedFrom: 'sentinel', evolvedStage: 2,
    hpMin: 52, hpMax: 64, gold: [28, 42],
    pattern: ['breach_bash', 'siege_hammer', 'phalanx'],
    moves: {
      breach_bash: {
        id: 'breach_bash', name: '盾击·破城', kind: 'attack', value: 8, impact: 'metal',
        desc: () => '攻击 8 · 自获 6 格挡',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 8);
          ctx.gainBlock(ctx.enemy, 6);
        },
      },
      siege_hammer: {
        id: 'siege_hammer', name: '压制锤', kind: 'attack', value: 15, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 15); },
      },
      phalanx: {
        id: 'phalanx', name: '列阵', kind: 'defend', value: 8,
        desc: () => '获得 8 格挡 · 荆棘 +1',
        run(ctx) {
          ctx.gainBlock(ctx.enemy, 8);
          ctx.addBuff(ctx.enemy, 'thorns', 1);
          ctx.log('盾面的撞角立了起来。');
        },
      },
    },
  },

  // 孢囊行者·孕体（← 孢囊行者）：背囊胀大近一倍。「胀裂」是豁出去的一击 —— 伤己换毒。
  spore_gravid: {
    id: 'spore_gravid', name: '孢囊行者·孕体', kind: 'normal',
    evolvedFrom: 'spore_walker', evolvedStage: 2,
    hpMin: 40, hpMax: 48, gold: [22, 34],
    pattern: ['dense_spores', 'gravid_bite', 'burst_sac'],
    moves: {
      dense_spores: {
        id: 'dense_spores', name: '浓孢子', kind: 'debuff', value: 5,
        label: '施加 5 层中毒',
        run(ctx) { ctx.addBuff(ctx.player, 'poison', 5); },
      },
      gravid_bite: {
        id: 'gravid_bite', name: '撕咬', kind: 'attack', value: 9, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 9); },
      },
      burst_sac: {
        id: 'burst_sac', name: '胀裂', kind: 'special', value: 6, impact: 'blast',
        desc: () => '攻击 6 · 中毒 2 · 自失 3 血',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 6);
          ctx.addBuff(ctx.player, 'poison', 2);
          ctx.loseHp(ctx.enemy, 3);
          ctx.log('一颗孢囊胀裂了 —— 毒液溅了它自己一身。');
        },
      },
    },
  },

  // 蜕壳武者（← 井壁爬虫）：旧壳当盾背上驮着。保留旧招「撕咬」的多段骨架。
  crawler_molt: {
    id: 'crawler_molt', name: '蜕壳武者', kind: 'normal',
    evolvedFrom: 'crawler', evolvedStage: 2,
    hpMin: 36, hpMax: 44, gold: [24, 36],
    pattern: ['molt_gnaw', 'shed', 'dash'],
    moves: {
      molt_gnaw: {
        id: 'molt_gnaw', name: '撕咬', kind: 'attack', value: 6, impact: 'claw',
        desc: () => '连续 2 次攻击 6 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 6); },
      },
      shed: {
        id: 'shed', name: '蜕壳', kind: 'defend', value: 10, label: '获得 10 格挡',
        run(ctx) { ctx.gainBlock(ctx.enemy, 10); },
      },
      dash: {
        id: 'dash', name: '疾走突刺', kind: 'attack', value: 12, impact: 'pick',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 12); },
      },
    },
  },

  // 残影·聚尸者（← 拾荒者残影）：拖着一串捡来的破烂。模仿公式升级（5+费用×4）。
  shade_gatherer: {
    id: 'shade_gatherer', name: '残影·聚尸者', kind: 'normal', hover: true,
    evolvedFrom: 'scavenger_shade', evolvedStage: 2,
    hpMin: 38, hpMax: 46, gold: [28, 42],
    pattern: ['mimic_up', 'tangle', 'scavenge'],
    moves: {
      mimic_up: {
        id: 'mimic_up', name: '模仿', kind: 'special', impact: 'blade',
        desc(unit) {
          const last = Combat.state.lastPlayed;
          if (!last || last.type !== 'attack') return '模仿 · 你上一张不是攻击牌';
          return '模仿 · 攻击 ' + (5 + last.cost * 4);
        },
        run(ctx) {
          const last = ctx.lastPlayed;
          if (!last || last.type !== 'attack') {
            ctx.log('聚尸者抓了个空。');
            ctx.gainBlock(ctx.enemy, 10);
            return;
          }
          ctx.dealDamage(ctx.enemy, ctx.player, 5 + last.cost * 4);
        },
      },
      tangle: {
        id: 'tangle', name: '缠扰', kind: 'attack', value: 7, impact: 'blade',
        desc: () => '攻击 7 · 虚弱 1',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 7);
          ctx.addBuff(ctx.player, 'weak', 1);
        },
      },
      scavenge: {
        id: 'scavenge', name: '拾荒', kind: 'buff', value: 2,
        desc: () => '强化 +2 力量 · 回复 6',
        run(ctx) {
          ctx.addBuff(ctx.enemy, 'str', 2);
          ctx.heal(ctx.enemy, 6);
          ctx.log('它把捡来的破烂拼回了自己身上。');
        },
      },
    },
  },

  // 三阶（第三关 D23–33 · 菌丝研究所）

  // 鼠潮母兽（← 锈牙鼠王）：几十只鼠缠成一股浊流，菌丝从毛缝里长出来。
  rat_tide: {
    id: 'rat_tide', name: '鼠潮母兽', kind: 'normal',
    evolvedFrom: 'rat_king', evolvedStage: 3,
    hpMin: 58, hpMax: 70, gold: [40, 60],
    pattern: ['tide_gnaw', 'bile', 'nurture'],
    moves: {
      tide_gnaw: {
        id: 'tide_gnaw', name: '啃噬', kind: 'attack', value: 7, impact: 'claw',
        desc: () => '连续 2 次攻击 7 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 7); },
      },
      bile: {
        id: 'bile', name: '腐蚀唾液', kind: 'debuff', value: 4, impact: 'claw',
        desc: () => '攻击 6 · 中毒 4',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 6);
          ctx.addBuff(ctx.player, 'poison', 4);
        },
      },
      nurture: {
        id: 'nurture', name: '哺育', kind: 'buff', value: 2,
        desc: () => '回复 8 · 强化 +2 力量',
        run(ctx) {
          ctx.heal(ctx.enemy, 8);
          ctx.addBuff(ctx.enemy, 'str', 2);
          ctx.log('浊流翻涌，新的鼠填了进来。');
        },
      },
    },
  },

  // 哨兵·攻城型（← 哨兵·破城型）：肩上加曲射炮，盾面换成菌壳补丁 —— 机械被菌丝接管。
  sentinel_siege: {
    id: 'sentinel_siege', name: '哨兵·攻城型', kind: 'normal',
    evolvedFrom: 'sentinel_breach', evolvedStage: 3,
    hpMin: 84, hpMax: 100, gold: [45, 65],
    pattern: ['siege_ram', 'lob', 'fortress'],
    moves: {
      siege_ram: {
        id: 'siege_ram', name: '攻城锤', kind: 'attack', value: 18, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 18); },
      },
      lob: {
        id: 'lob', name: '曲射', kind: 'attack', value: 9, impact: 'blast',
        desc: () => '攻击 9 · 施加 2 层燃烧',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 9);
          ctx.addBuff(ctx.player, 'burn', 2);
        },
      },
      fortress: {
        id: 'fortress', name: '堡垒', kind: 'defend', value: 12,
        desc: () => '获得 12 格挡 · 荆棘 +1',
        run(ctx) {
          ctx.gainBlock(ctx.enemy, 12);
          ctx.addBuff(ctx.enemy, 'thorns', 1);
          ctx.log('菌壳盾面上，反刺一根根立了起来。');
        },
      },
    },
  },

  // 孢囊母株（← 孢囊行者·孕体）：扎在菌毯上的小塔，背上三颗成熟孢囊。
  // 死亡自爆（onDeath 8 点）= 菌母自爆机制的前置教学。
  spore_mother: {
    id: 'spore_mother', name: '孢囊母株', kind: 'normal',
    evolvedFrom: 'spore_gravid', evolvedStage: 3,
    hpMin: 62, hpMax: 74, gold: [36, 52],
    pattern: ['tendril', 'spray', 'ripen'],
    onDeath(ctx) {
      ctx.log('母株的孢囊同时炸开！');
      ctx.loseHp(ctx.player, 8);
    },
    moves: {
      tendril: {
        id: 'tendril', name: '触鞭', kind: 'attack', value: 6, impact: 'claw',
        desc: () => '连续 2 次攻击 6 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 6); },
      },
      spray: {
        id: 'spray', name: '孢浆喷洒', kind: 'debuff', value: 6,
        label: '施加 6 层中毒',
        run(ctx) { ctx.addBuff(ctx.player, 'poison', 6); },
      },
      ripen: {
        id: 'ripen', name: '催熟', kind: 'defend', value: 8,
        desc: () => '获得 8 格挡 · 死亡时爆开（8 点）',
        run(ctx) { ctx.gainBlock(ctx.enemy, 8); },
      },
    },
  },

  // 井壁巨螯（← 蜕壳武者）：四足双巨螯，旧壳嵌进背甲，螯上带菌斑。
  crawler_maul: {
    id: 'crawler_maul', name: '井壁巨螯', kind: 'normal',
    evolvedFrom: 'crawler_molt', evolvedStage: 3,
    hpMin: 66, hpMax: 80, gold: [40, 58],
    pattern: ['clip', 'rock_shell', 'ambush'],
    moves: {
      clip: {
        id: 'clip', name: '双螯剪', kind: 'attack', value: 8, impact: 'claw',
        desc: () => '连续 2 次攻击 8 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 8); },
      },
      rock_shell: {
        id: 'rock_shell', name: '岩壳', kind: 'defend', value: 12, label: '获得 12 格挡',
        run(ctx) { ctx.gainBlock(ctx.enemy, 12); },
      },
      ambush: {
        id: 'ambush', name: '伏击', kind: 'attack', value: 15, impact: 'pick',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 15); },
      },
    },
  },

  // 百衲怨影（← 残影·聚尸者）：三层影子叠成，每层一只伸出的手。模仿公式再升（6+费用×4）。
  shade_patch: {
    id: 'shade_patch', name: '百衲怨影', kind: 'normal', hover: true,
    evolvedFrom: 'shade_gatherer', evolvedStage: 3,
    hpMin: 60, hpMax: 72, gold: [45, 65],
    pattern: ['mimic_max', 'wail', 'bind'],
    moves: {
      mimic_max: {
        id: 'mimic_max', name: '模仿', kind: 'special', impact: 'blade',
        desc(unit) {
          const last = Combat.state.lastPlayed;
          if (!last || last.type !== 'attack') return '模仿 · 你上一张不是攻击牌';
          return '模仿 · 攻击 ' + (6 + last.cost * 4);
        },
        run(ctx) {
          const last = ctx.lastPlayed;
          if (!last || last.type !== 'attack') {
            ctx.log('怨影们抓了个空。');
            ctx.gainBlock(ctx.enemy, 12);
            return;
          }
          ctx.dealDamage(ctx.enemy, ctx.player, 6 + last.cost * 4);
        },
      },
      wail: {
        id: 'wail', name: '怨叠', kind: 'attack', value: 8, impact: 'blade',
        desc: () => '连续 2 次攻击 8 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 8); },
      },
      bind: {
        id: 'bind', name: '影缚', kind: 'debuff', value: 5, impact: 'blade',
        desc: () => '攻击 5 · 脆弱 2',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 5);
          ctx.addBuff(ctx.player, 'vulnerable', 2);
        },
      },
    },
  },

  // 过载工头（← 电弧焊工，第二关新怪的进化体）：双臂弧光鞭，工牌还挂在脖子上。
  welder_overload: {
    id: 'welder_overload', name: '过载工头', kind: 'normal',
    evolvedFrom: 'arc_welder', evolvedStage: 3,
    hpMin: 56, hpMax: 68, gold: [40, 58],
    pattern: ['arc_whip', 'steam', 'overclock'],
    moves: {
      arc_whip: {
        id: 'arc_whip', name: '弧光鞭', kind: 'attack', value: 7, impact: 'blast',
        desc: () => '攻击 7 · 施加 3 层燃烧',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 7);
          ctx.addBuff(ctx.player, 'burn', 3);
        },
      },
      steam: {
        id: 'steam', name: '过热蒸汽', kind: 'attack', value: 12, impact: 'blast',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 12); },
      },
      overclock: {
        id: 'overclock', name: '超频', kind: 'buff', value: 3, label: '强化 +3 力量 · 自伤 4',
        run(ctx) {
          ctx.addBuff(ctx.enemy, 'str', 3);
          ctx.loseHp(ctx.enemy, 4);
          ctx.log('它把限压阀彻底拆了。');
        },
      },
    },
  },

  // 破桩者（← 桩击机，第二关新怪的进化体）：桩头包着菌壳加固层，液压管爆开露出内焰。
  piledriver_breach: {
    id: 'piledriver_breach', name: '破桩者', kind: 'normal',
    evolvedFrom: 'pile_driver', evolvedStage: 3,
    hpMin: 78, hpMax: 92, gold: [45, 65],
    pattern: ['pile_break', 'ground_pile', 'overload2'],
    moves: {
      pile_break: {
        id: 'pile_break', name: '破桩', kind: 'attack', value: 16, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 16); },
      },
      ground_pile: {
        id: 'ground_pile', name: '地桩阵', kind: 'attack', value: 10, impact: 'hammer',
        desc: () => '攻击 10 · 自获 8 格挡',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 10);
          ctx.gainBlock(ctx.enemy, 8);
        },
      },
      overload2: {
        id: 'overload2', name: '过载', kind: 'buff', value: 4, label: '强化 +4 力量 · 自伤 6',
        run(ctx) {
          ctx.addBuff(ctx.enemy, 'str', 4);
          ctx.loseHp(ctx.enemy, 6);
          ctx.log('内焰从爆开的液压管里喷了出来。');
        },
      },
    },
  },

  // ==================== 中 Boss 池（§9.2，必掉遗物）====================

  warlord: {
    id: 'warlord', name: '铁颚督军', kind: 'elite',
    hpMin: 90, hpMax: 110, gold: [60, 90],
    pattern: ['cleave', 'cleave', 'war_cry'],
    moves: {
      cleave: {
        id: 'cleave', name: '横扫', kind: 'attack', value: 12, impact: 'metal',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 12); },
      },
      war_cry: {
        id: 'war_cry', name: '战吼', kind: 'buff', value: 3, label: '强化 +3 力量',
        run(ctx) {
          ctx.enemies.forEach(function (e) {
            if (e.hp > 0) ctx.addBuff(e, 'str', 3);
          });
          ctx.log('铁颚督军的战吼在竖井里撞出回声。');
        },
      },
    },
  },

  // 双头犬 = 两颗头各自独立行动（多敌人结构天然表达"两个行动回合"）。
  // 一头死后另一头狂暴 —— 由 onDeath 给存活的那颗 +5 力量。
  hound: {
    id: 'hound', name: '双头犬', kind: 'elite',
    hpMin: 40, hpMax: 50, gold: [60, 90],
    pattern: ['bite', 'bite', 'howl'],
    onSpawn(ctx) {
      const heads = ctx.enemies.filter(function (e) {
        return e.def.id === 'hound';
      }).length;
      if (heads >= 2) return;
      ctx.summon('hound');
      ctx.log('第二颗头从阴影里探出来。');
    },
    onDeath(ctx) {
      let enraged = false;
      ctx.enemies.forEach(function (e) {
        if (e.hp > 0 && e.def.id === 'hound') {
          ctx.addBuff(e, 'str', 5);
          enraged = true;
        }
      });
      if (enraged) ctx.log('另一颗头狂暴起来。');
    },
    moves: {
      bite: {
        id: 'bite', name: '撕咬', kind: 'attack', value: 9, impact: 'claw',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 9); },
      },
      howl: {
        id: 'howl', name: '低吼', kind: 'buff', value: 2, label: '强化 +2 力量',
        run(ctx) { ctx.addBuff(ctx.enemy, 'str', 2); },
      },
    },
  },

  // 蚀骨工匠：靠 keepBlock 让格挡跨回合累积成「骨甲」。
  // 常态「骨锤砸击 / 骨质增生」交替 —— 砸一回合、叠一回合，节奏看得见；
  // 甲厚到 16 就放出骨刺（伤害随甲放大，甲清零），血量四成以下改拆自己的骨头狂击。
  //
  // 数值节奏的教训（M14 改）：旧版 pattern 只有 ['calcify']、骨刺靠「甲 ≥16」触发，
  // 而玩家一回合打掉 8 点甲太容易 —— 甲永远到不了 16，骨刺一次都放不出来，
  // 实战体感就是「只会防御、不会攻击」。现在砸击是常态输出，叠甲是蓄力，
  // 玩家的取舍变成「打甲防爆发 vs 打血催进度」，而不是只能看着它反复叠甲。
  bonewright: {
    id: 'bonewright', name: '蚀骨工匠', kind: 'elite',
    hpMin: 95, hpMax: 115, gold: [60, 90],
    keepBlock: true,
    pattern: ['bone_slam', 'calcify'],
    choose(ctx) {
      const e = ctx.enemy;
      // 甲够厚，或骨甲已经叠满两轮 → 放出骨刺。
      // 后半句是 M14 的关键修正：玩家一回合能打掉 8 点甲，只看「当前甲」的话
      // 骨刺永远是死的（旧版实战 60 场里一次都没放出来过）。
      // 现在爆发必然发生，玩家能改变的只是它带着多少甲出手 ——
      // 甲 16 时 18 点，甲被打光时 10 点。打甲 = 减伤，不是免疫。
      if (e.block >= 16 || (e.charge || 0) >= 2) return 'bone_spike';
      // 残血 → 拆下自己的骨头当投掷物，与砸击交替（不占满回合，仍可应对）
      if (e.hp / e.maxHp <= 0.4) {
        return e.patternIndex % 2 === 0 ? 'bone_hail' : 'bone_slam';
      }
      return null; // 其余按 pattern：砸 / 叠 交替
    },
    moves: {
      bone_slam: {
        id: 'bone_slam', name: '骨锤砸击', kind: 'attack', value: 9, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 9); },
      },
      calcify: {
        id: 'calcify', name: '骨质增生', kind: 'defend', value: 8, impact: 'hammer',
        label: '骨甲 +8',
        // 甲封顶时不再空转（choose 会先转骨刺，这里是防呆）；文案跟着实际行为走
        desc: (unit) => (unit.block >= 24 ? '攻击 9 · 骨甲已满' : '骨甲 +8'),
        run(ctx) {
          // 蓄力层数：记的是「叠了几轮」，与甲有没有被玩家打掉无关
          ctx.enemy.charge = (ctx.enemy.charge || 0) + 1;
          // 上限 24 —— 不设上限的话玩家一旦破不了甲就被锁死
          if (ctx.enemy.block >= 24) {
            ctx.log('骨甲厚得无法再添 —— 它抡起骨锤砸了下来。');
            ctx.dealDamage(ctx.enemy, ctx.player, 9);
            return;
          }
          ctx.gainBlock(ctx.enemy, 8);
        },
      },
      bone_spike: {
        id: 'bone_spike', name: '骨刺', kind: 'attack', value: 10, impact: 'pick',
        desc: (unit) => '攻击 ' + (10 + Math.floor(unit.block / 2)) + '（随骨甲放大）',
        run(ctx) {
          const bonus = Math.floor(ctx.enemy.block / 2);
          ctx.dealDamage(ctx.enemy, ctx.player, 10 + bonus);
          ctx.log('骨刺把骨甲一起带了出去。');
          ctx.enemy.block = 0;
          ctx.enemy.charge = 0;
        },
      },
      bone_hail: {
        id: 'bone_hail', name: '碎骨狂击', kind: 'attack', value: 7, impact: 'pick',
        desc: () => '连续 2 次攻击 7 点',
        run(ctx) {
          ctx.attackTimes(ctx.enemy, ctx.player, 2, 7);
          ctx.log('它把自己身上的骨头一根根拆下来扔了出去。');
        },
      },
    },
  },

  // ---- M50 新增：第二关（D12–22）中 Boss · 锈蚀百夫长 ----
  //
  // 「方阵」型：叠甲的同时把荆棘往上堆 —— 玩家越是用多段攻击去磨它，
  // 自己掉得越快。它逼的不是数值，是打法：改用中毒 / 燃烧 / 破甲，
  // 或者先忍一两回合等它把甲站起来再一次性打穿（荆棘只反「被攻击」）。
  // 与蚀骨工匠的区别：工匠的甲是硬减伤（考「打得出多少伤害」），
  // 百夫长的甲是反伤（考「用什么打」）—— 同一主题的两个不同问法。
  centurion: {
    id: 'centurion', name: '锈蚀百夫长', kind: 'elite',
    hpMin: 100, hpMax: 118, gold: [60, 90],
    // 甲跨回合累积（同蚀骨工匠的 keepBlock）：站着不动的那一回合也不会白费
    keepBlock: true,
    pattern: ['javelin', 'shield_wall'],
    choose(ctx) {
      const e = ctx.enemy;
      // 荆棘叠到 4 或甲叠到 20 就停止加固，改投枪压血 —— 防呆，也防它无限苟住
      if ((e.buffs.thorns || 0) >= 4 || e.block >= 20) return 'javelin';
      return null;
    },
    moves: {
      javelin: {
        id: 'javelin', name: '掷枪', kind: 'attack', value: 13, impact: 'pick',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 13); },
      },
      shield_wall: {
        id: 'shield_wall', name: '立盾', kind: 'defend', value: 12,
        desc: (unit) => '自获 12 格挡 · 荆棘 +1（当前 ' +
          (unit.buffs.thorns || 0) + '）',
        run(ctx) {
          ctx.gainBlock(ctx.enemy, 12);
          ctx.addBuff(ctx.enemy, 'thorns', 1);
          ctx.log('盾阵合拢，反刺从甲缝里立起来。');
        },
      },
    },
  },

  // ---- M50 新增：第三关（D23–33）中 Boss · 缝合暴君 ----
  //
  // 「再生」型：一边撕裂一边把自己缝回去。玩家最容易被它骗掉 DPS ——
  // 打掉的 12 点下一回合就回来了。破法是打断节奏（虚弱 / 眩晕式压制）
  // 或一次性爆掉超过它单回合回复量的伤害。
  // 血量四成以下改「拆线」：自愈停掉，换成对自己也痛的爆发 —— 它开始不打算活了。
  stitch_tyrant: {
    id: 'stitch_tyrant', name: '缝合暴君', kind: 'elite',
    hpMin: 110, hpMax: 130, gold: [60, 90],
    pattern: ['rend', 'graft'],
    choose(ctx) {
      const e = ctx.enemy;
      if (e.hp / e.maxHp <= 0.4) return 'unstitch';
      // 满血时自愈没意义，直接撕裂 —— 否则它会在满血发呆两回合
      if (e.hp >= e.maxHp) return 'rend';
      return null;
    },
    moves: {
      rend: {
        id: 'rend', name: '撕裂', kind: 'attack', value: 9, impact: 'claw',
        desc: () => '连续 2 次攻击 9 点',
        run(ctx) { ctx.attackTimes(ctx.enemy, ctx.player, 2, 9); },
      },
      graft: {
        id: 'graft', name: '缝合', kind: 'buff', value: 12,
        desc: (unit) => '回复 ' + Math.min(12, unit.maxHp - unit.hp) + ' 点生命 · 强化 +2 力量',
        run(ctx) {
          ctx.heal(ctx.enemy, 12);
          ctx.addBuff(ctx.enemy, 'str', 2);
          ctx.log('它把裂开的自己重新拉拢、缝上。');
        },
      },
      unstitch: {
        id: 'unstitch', name: '拆线', kind: 'attack', value: 10, impact: 'blast',
        desc: () => '攻击 10 · 施加 4 层中毒 · 自伤 6',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 10);
          ctx.addBuff(ctx.player, 'poison', 4);
          ctx.loseHp(ctx.enemy, 6);
          ctx.log('它扯开自己的缝线，把腐液和碎骨一起甩了出来。');
        },
      },
    },
  },

  // ==================== 三大 Boss（§9.3，按难度升序）====================
  // 均标 noDepthScale：深度对它们的意义由 tier 表达（§6），
  // 再叠一次深压会让 D15 的终局 Boss 变成纯血包。

  // ① 锈冠 —— 防卫体指挥官，编号 S-001，还在等换班
  //    常态：腐蚀（你 −1 敏捷）/ 重砸 交替；血量过半后合并成「锈蚀重砸」
  rust_crown: {
    id: 'rust_crown', name: '锈冠', kind: 'boss', tier: 1,
    noDepthScale: true,
    lore: '「防卫体 S-001，值守中。」三百年来，它每天在日志里写同一句：无人接替。',
    hpMin: 220, hpMax: 220, gold: [120, 180],
    pattern: ['corrode', 'slam'],
    choose(ctx) {
      return ctx.enemy.hp / ctx.enemy.maxHp < 0.5 ? 'rust_slam' : null;
    },
    moves: {
      corrode: {
        id: 'corrode', name: '锈蚀蔓延', kind: 'debuff', value: 1,
        label: '你 −1 敏捷',
        run(ctx) {
          ctx.addBuff(ctx.player, 'dex', -1);
          ctx.log('锈屑顺着铠甲的缝往里钻。');
        },
      },
      slam: {
        id: 'slam', name: '重砸', kind: 'attack', value: 12, impact: 'hammer',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 12); },
      },
      rust_slam: {
        id: 'rust_slam', name: '锈蚀重砸', kind: 'attack', value: 10, impact: 'hammer',
        desc: () => '攻击 10 · 你 −1 敏捷',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 10);
          ctx.addBuff(ctx.player, 'dex', -1);
          ctx.log('它的动作反而快了 —— 锈蚀吃掉了自己的关节。');
        },
      },
    },
  },

  // ② 菌母 —— 生物研究所的清污系统，把污染当成了净化
  //    每 2 回合召唤 1 只孢囊行者（HP 30，最多 3 只）；
  //    本体死亡时存活的小怪自爆，每只对玩家造成 10 点伤害
  mycelium_mother: {
    id: 'mycelium_mother', name: '菌母', kind: 'boss', tier: 2,
    noDepthScale: true,
    lore: '生物研究所的清污系统。它本该把污染净化掉 —— 三百年里，它学会了把污染本身当成净化。',
    hpMin: 180, hpMax: 180, gold: [120, 180],
    pattern: ['seal', 'spore_burst'],
    spawnHp: 30,
    choose(ctx) {
      const e = ctx.enemy;
      const alive = ctx.enemies.filter(function (x) {
        return x.hp > 0 && x.def.minion;
      }).length;
      // P2 半血阶段「失控增殖」：不再隔回合播撒 —— 菌毯感知到宿主的败退，
      // 把最后的养分全部押在子代上。狂化只做一次宣告，之后每一回合
      // 只要有空位就召唤（血线压回去也换不回来，阶段单向）。
      if (e.hp / e.maxHp < 0.5 && alive < 3) {
        if (!e.enraged) {
          e.enraged = true;
          ctx.log('菌毯翻涌起来 —— 它开始把一切都变成孢子。');
        }
        return 'summon';
      }
      if (alive < 3 && e.patternIndex % 2 === 0) return 'summon';
      return null;
    },
    onDeath(ctx) {
      const alive = ctx.enemies.filter(function (x) { return x.hp > 0; });
      if (!alive.length) return;
      ctx.log('菌丝网塌缩，' + alive.length + ' 只孢囊行者同时炸开。');
      alive.forEach(function (x) { x.hp = 0; x.deadHandled = true; });
      ctx.loseHp(ctx.player, 10 * alive.length);
    },
    moves: {
      summon: {
        id: 'summon', name: '播散', kind: 'special',
        desc(unit) { return '召唤 1 只孢囊行者（HP ' + unit.def.spawnHp + '）'; },
        run(ctx) {
          const u = ctx.summon('spore_walker', ctx.enemy.def.spawnHp);
          ctx.log(u.name + '从菌毯里拱出来。');
        },
      },
      seal: {
        id: 'seal', name: '封壳', kind: 'defend', value: 10, label: '获得 10 格挡',
        run(ctx) { ctx.gainBlock(ctx.enemy, 10); },
      },
      spore_burst: {
        id: 'spore_burst', name: '孢子喷发', kind: 'attack', value: 8, impact: 'blast',
        desc: () => '攻击 8 · 施加 2 层中毒',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 8);
          ctx.addBuff(ctx.player, 'poison', 2);
        },
      },
    },
  },

  // ③ 无首执械者 —— 执行"阻止向下移动"命令最久的一台
  //    血量每掉 1/3 换一套姿态；换姿态的当回合 +8 格挡
  headless_executor: {
    id: 'headless_executor', name: '无首执械者', kind: 'boss', tier: 3,
    noDepthScale: true,
    lore: '执行「阻止一切向下移动的生物」最久的一台。它的头不见了，命令还在。',
    hpMin: 200, hpMax: 200, gold: [120, 180],
    pattern: ['cleave'],
    phaseMoves: ['cleave', 'riposte', 'rampage'],
    // 姿态一旦切了就固定停在那一套上。只靠 beforeAct 改 intent 是不够的 ——
    // 下一次 pickIntent 会按 pattern 又选回「斩击」，姿态等于没切。
    choose(ctx) {
      return ENEMIES.headless_executor.phaseMoves[ctx.enemy.phase - 1];
    },
    beforeAct(ctx) {
      const e = ctx.enemy;
      const pct = e.hp / e.maxHp;
      const ph = pct > 2 / 3 ? 1 : pct > 1 / 3 ? 2 : 3;
      if (ph === e.phase) return;

      e.phase = ph;
      ctx.gainBlock(e, 8);
      ctx.log('无首执械者卸下破损的组件，换上第 ' + ph + ' 套程序。');
      // 换姿态当回合就用新招 —— 玩家看到的意图会立刻变
      e.intent = e.def.moves[e.def.phaseMoves[ph - 1]];
    },
    moves: {
      cleave: {
        id: 'cleave', name: '斩击', kind: 'attack', value: 14, impact: 'blade',
        run(ctx) { ctx.dealDamage(ctx.enemy, ctx.player, 14); },
      },
      riposte: {
        id: 'riposte', name: '格挡反击', kind: 'attack', value: 6, impact: 'metal',
        desc: () => '攻击 6 · 自获 12 格挡',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 6);
          ctx.gainBlock(ctx.enemy, 12);
        },
      },
      rampage: {
        id: 'rampage', name: '狂暴', kind: 'attack', value: 14, impact: 'blade',
        desc: () => '攻击 14 · 自身 +2 力量',
        run(ctx) {
          ctx.dealDamage(ctx.enemy, ctx.player, 14);
          ctx.addBuff(ctx.enemy, 'str', 2);
        },
      },
    },
  },
};

// ==================== M50：强化层（变体 + 词缀）====================
//
// 设计取舍：**不新增敌人条目**，而是在同一份 def 上叠一层。理由有三：
//   ① 形象不必重画 —— 「壮大的腐蚀鼠群」就该长得像腐蚀鼠群，只是更凶；
//   ② 数值只有一处真源 —— 将来调鼠群，它的强化版跟着一起调，不会各调各的；
//   ③ 池子的组合数是乘出来的：5 只怪 × 变体 × 词缀，比硬写 20 条要小得多。
//
// 与「深压」和「lvlScale」的关系：那两条曲线管的是**这一局多难**（全局，
// 与抽到谁无关）；变体与词缀管的是**这一只多凶**（单个单位）。三者相乘。
// 词缀只动 HP 与伤害，不动招式表 —— 招式的语义（玩家怎么应对）必须保持稳定，
// 否则「看着是鼠群、打起来是别的怪」会让玩家的学习白费。

// 变体：分关出现的强化形态。
//   ⚠️ M56：'grown'（壮大版）已退役 —— 第 2/3 关的普通敌人改由**完全设计的
//   进化体**承担（见上面的 evolvedFrom 系列，池子挂接见 acts.js）。
//   老存档快照里可能还存着 variant:'grown'：mergeMods 对未知 variant 安全
//   跳过（v 为 undefined 时不加成），渲染层的类名 harmless，不会崩。
const VARIANTS = {
  // M62b：大 Boss 的「强化版」不再由编队生成（大 Boss 恒原版，走正常难度曲线）。
  // 定义保留：老存档快照里可能还存着 variant:'empowered'，mergeMods 与渲染层
  // 靠这份定义安全落位；变体机制本身继续由中 Boss 的 'elite' 形态使用。
  // 与旧 grown 分开：Boss 不适合「壮大」（它本来就大），
  // 它要的是「同一台机器、换了更强的程序」，所以前缀是「强化的」，
  // HP 倍率交给关段配置（bossHpMul），变体本身不加血，只加伤害与配色。
  empowered: {
    id: 'empowered', name: '强化', prefix: '强化的',
    hpMul: 1, dmgAdd: 2, tint: '#7A1F1F',
  },
  // 中 Boss 专属变体（M56b）：中 Boss **恒定**以此形态登场，不是概率事件。
  // 与大 Boss 的「强化」分开：那台是「换了程序的同一台机器」，
  // 这一档是「身经百战的老兵」—— 数值小幅上抬，配色走黄铜色系，
  // 与大 Boss 的深红区分。glyph 是徽记图标，渲染层拼在词缀徽章最前面。
  elite: {
    id: 'elite', name: '精锐', prefix: '精锐·', glyph: '★',
    hpMul: 1, dmgAdd: 1, tint: '#8A6A1F',
  },
};

// 词缀：战斗开始时随机挂在单位上的「特殊加持」。
//   hpMul       生命强化
//   dmgAdd      攻击力增强
//   startBlock  开局自带的格挡（跨回合型的敌人身上更狠，如百夫长）
//   startBuff   [键, 层数] 开局自带的状态
//
// 池子刻意压得很小：词缀的作用是「这一场要多想一下」，不是「换一个敌人」。
// 六个里挑，且每只最多 1 个（M62b 起中 Boss 最多 2 个）—— 多了就变成读不完的说明。
const AFFIXES = {
  hp_up: {
    id: 'hp_up', name: '生命强化', short: '厚血',
    hpMul: 1.35, tint: '#8C2F39',
  },
  atk_up: {
    id: 'atk_up', name: '暴戾', short: '暴戾',
    dmgAdd: 3, tint: '#B4451F',
  },
  armored: {
    id: 'armored', name: '铁甲', short: '铁甲',
    startBlock: 10, tint: '#4A5568',
  },
  thorned: {
    id: 'thorned', name: '荆棘', short: '荆棘',
    startBuff: ['thorns', 2], tint: '#6B7A3A',
  },
  regen: {
    id: 'regen', name: '再生', short: '再生',
    startBuff: ['regen', 2], tint: '#2F7A5A',
  },
  fierce: {
    id: 'fierce', name: '战意', short: '战意',
    startBuff: ['str', 2], tint: '#A33A3A',
  },

  // ---- Boss 专属形态词条（M80 / R5）：DL5+ 的大 Boss 随机带一枚 ----
  // bossOnly 标记让普通 / 中 Boss 的词缀池把它们滤掉（run.affixPool）。
  // 数值是精英级的加强版：高难复打时同一台机器有不一样的打开方式。
  overload: {
    id: 'overload', name: '过载', short: '过载', bossOnly: true,
    dmgAdd: 4, hpMul: 1.12, tint: '#B4451F',
  },
  bulwark: {
    id: 'bulwark', name: '磐垒', short: '磐垒', bossOnly: true,
    startBlock: 15, tint: '#4A5568',
  },
  spiked: {
    id: 'spiked', name: '棘铠', short: '棘铠', bossOnly: true,
    startBuff: ['thorns', 3], tint: '#6B7A3A',
  },
  undying: {
    id: 'undying', name: '不朽', short: '不朽', bossOnly: true,
    startBuff: ['regen', 3], tint: '#2F7A5A',
  },
  wrath: {
    id: 'wrath', name: '暴怒', short: '暴怒', bossOnly: true,
    startBuff: ['str', 3], tint: '#A33A3A',
  },
};

const AFFIX_IDS = Object.keys(AFFIXES);
const VARIANT_IDS = Object.keys(VARIANTS);

// 把「变体 + 词缀」折成一组合并后的修正值。spawnEnemy 用它的输出，
// 而不是自己去遍历两张表 —— 单点计算，重复挂同一个词缀也不会加两次。
function mergeMods(variantId, affixIds) {
  const out = { hpMul: 1, dmgAdd: 0, startBlock: 0, startBuffs: [], tint: null, prefix: '', names: [] };
  const v = variantId ? VARIANTS[variantId] : null;
  if (v) {
    out.hpMul *= (v.hpMul || 1);
    out.dmgAdd += (v.dmgAdd || 0);
    out.tint = v.tint || out.tint;
    out.prefix = v.prefix || '';
    out.names.push(v.name);
  }
  (affixIds || []).forEach(function (id) {
    const a = AFFIXES[id];
    if (!a) return;
    out.hpMul *= (a.hpMul || 1);
    out.dmgAdd += (a.dmgAdd || 0);
    out.startBlock += (a.startBlock || 0);
    if (a.startBuff) out.startBuffs.push(a.startBuff);
    if (!out.tint && a.tint) out.tint = a.tint;
    out.names.push(a.name);
  });
  return out;
}

const BUFF_NAMES = {
  str: '力量',
  dex: '敏捷',
  weak: '虚弱',
  vulnerable: '脆弱',
  poison: '中毒',
  burn: '燃烧',
  regen: '再生',
  thorns: '荆棘',
  // 以下三项由能力牌赋予，数值为"每回合触发量"
  metallicize: '金属化',
  barricade: '壁垒',
  strPerTurn: '力量成长',
  // M6：两套新资源系统的状态
  strTurn: '本回合力量', // 「火种共鸣」，回合开始清零
  resPerTurn: '资源产量', // 「显微镜」「薪柴」
  parasite: '寄生',       // 「寄生」，开关型
  parasiteBonus: '寄生强化',
  undying: '不灭',        // 「不灭」，值为低血线时每回合给的余烬
};

// 深压（§13）：敌人 HP = 基础 × (1 + (深度 − 1) × 0.05)
// 两处偏离原文，都在 §17 备案：
//   1. 用 (depth − 1)：D1 紧邻入口，不该吃额外加成；D33 = ×2.60
//   2. 大 Boss 不叠（noDepthScale）—— 它的强度刻度是 tier，不是深度
// 敌人伤害一律不随深度缩放，与 §17 第 7 条「伤害增速慢于 HP」同一取舍。
//
// lvlScale（M7）：DL 难度系数（§3.1，1 + 0.15 × (DL − 1)），与深压**相乘**。
// 两者是独立的两条曲线：深压管「这一局往下走多远」，lvlScale 管「这一级整体多难」。
// ⚠️ **大 Boss 吃 lvlScale，只豁免深压**（noDepthScale 只管 deep 那一段）——
// DL 是「整个下潜」的刻度，若大 Boss 免疫，DL1→DL10 的曲线会在三场 Boss 处断裂。
// 不传 = 1，M1–M6 的旧调用点与断言行为完全不变。
function depthScaleFor(def, depth, hpPctMod, lvlScale) {
  const deep = def && def.noDepthScale ? 1 : 1 + 0.05 * (depth - 1);
  const lvl = lvlScale == null ? 1 : lvlScale;
  return deep * lvl * (1 + (hpPctMod || 0) / 100);
}
