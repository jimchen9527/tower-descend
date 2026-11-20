// 战斗状态机 —— 纯逻辑，不碰 DOM。
// 设计文档 §7：能量 3 / 每回合抽 5 / 格挡回合末清空 / 敌人意图预告
//
// M2 扩展：新原语（heal / loseHp / dealDamageRaw / consumeBlock / drawCards /
// gainEnergy / attackTimes）、减益衰减、中毒结算、能力牌回合钩子、荆棘反弹、
// 本回合出牌统计、深度。
//
// M5 扩展：单敌人 → 多敌人。state.enemies 是单位数组，state.targetIdx 是玩家
// 选中的目标。**state.enemy 保留为只读 getter**（返回当前有效目标），
// 这样 M1–M4 的渲染与测试一行不用改。
//
// M6 扩展：角色资源。state.player.resource 是一个可选字段，规格来自
// characters.js —— 引擎不知道「样本」「余烬」是什么，只按规格执行
// （每回合 +N / 被击中 +N / 上限 N）。另补了燃烧结算与 strTurn（本回合力量）。

// 敌人单位工厂。hpScale 是深压系数（§13），由 start 算好传进来；
// summon 出来的召唤物传固定 hp，不叠深压。
//
// M50 扩展：opts.variant（变体 id，如 'empowered'）与 opts.affixes（词缀 id 数组）
// 是**同一份 def 上的强化层**，不改 def 本身。修正值由 enemies.js 的 mergeMods
// 折算，这里只负责落到单位上：
//   · hpMul     → 乘进 HP（固定 HP 的召唤物也乘，语义一致）
//   · dmgAdd    → 记在 unit.dmgAdd，rawDamage / intentDamage 各读一次
//   · startBlock / startBuffs → 开局直接写进 block / buffs（不进战斗日志，
//     否则开局的每一条记录都会先刷两行「获得 10 点格挡」）
// 老调用点不传这两个字段 → mods 全为中性值 → 行为与 M49 完全一致。
function spawnEnemy(defId, opts) {
  const def = ENEMIES[defId];
  if (!def) throw new Error('未知敌人：' + defId);
  opts = opts || {};
  // mergeMods 是数据层的纯函数。逻辑测试沙箱里一定加载了 enemies.js（ENEMIES 就在
  // 那里），所以这里不需要 typeof 兜底 —— 真拿不到的话上一行已经抛了。
  const mods = mergeMods(opts.variant, opts.affixes);
  const base = opts.hp != null
    ? opts.hp
    : RNG.int(def.hpMin, def.hpMax) * (opts.hpScale || 1);
  const hp = Math.max(1, Math.round(base * mods.hpMul));

  const unit = {
    def: def,
    name: (mods.prefix || '') + def.name,
    hp: hp,
    maxHp: hp,
    block: 0,
    buffs: {},
    patternIndex: 0,
    intent: null,
    phase: 1,          // 姿态，目前只有无首执械者用
    deadHandled: false, // onDeath 只触发一次

    // ---- M50：强化层在单位上的落点 ----
    variant: opts.variant || null,
    affixes: (opts.affixes || []).slice(),
    dmgAdd: mods.dmgAdd,
    tint: mods.tint,
    affixNames: mods.names.slice(),
  };

  if (mods.startBlock > 0) unit.block += mods.startBlock;
  mods.startBuffs.forEach(function (b) {
    unit.buffs[b[0]] = (unit.buffs[b[0]] || 0) + b[1];
  });

  return unit;
}

const Combat = {
  state: null,

  // 本场战斗的动作日志（M24）：每命中一次推一条 { src, dst }。
  // 只给表现层看 —— 渲染层读完即清（takeActs），逻辑测试不依赖它。
  //
  // 为什么这件事必须由引擎做：受击方可以靠「前后血量 diff」推出来（谁掉血了），
  // 但**出手方推不出来**。伤害的来源有玩家的牌、敌人的意图、荆棘反弹、中毒，
  // 纯渲染层只能猜「点了手牌 = 玩家攻击」，而技能牌、AOE、反伤都会让它说谎。
  // 这里记的是纯数据（单位引用），不碰 DOM，逻辑层依然无头可测。
  acts: [],

  // 取走日志并清空。渲染层每帧调一次。
  takeActs() {
    const a = this.acts;
    this.acts = [];
    return a;
  },

  // ---------- 生命周期 ----------

  // opts 可选：{ hp, maxHp, depth, locTag, deck, relics, enemyId, enemyHpPct, dlScale }
  // 地图接入后由 Run 传入所在层数、跨节点保留的血量、本局卡组与遗物；
  // 不传就是 M1 的默认开局（起始卡组 + 无遗物 + 一层深度 + 腐蚀鼠群）。
  start(seed, opts) {
    RNG.init(seed);
    opts = opts || {};
    this.acts = []; // 上一场没消费完的动作日志不能漏进新的一场

    const depth = opts.depth == null ? 1 : opts.depth;
    // DL 难度系数（§3.1）：1 + 0.15 × (DL − 1)。不传 = 1 → 老调用点行为完全不变。
    const lvlScale = opts.dlScale == null ? 1 : opts.dlScale;
    const enemyId = opts.enemyId || 'rats';
    const startHp = opts.hp == null ? 75 : opts.hp;
    // 不传角色 = 掘者：M1–M5 的老测试与调用点都是这么起局的
    const char = characterOf(opts.charId);
    const resSpec = char.resource;

    this.state = {
      seed: RNG.seed,
      turn: 1,
      depth: depth,
      dlScale: lvlScale, // 敌人 HP 与伤害都乘它（大 Boss 也乘，只豁免深压）
      locTag: opts.locTag || '废墟层 · 小怪',
      phase: 'player', // player | enemy | win | lose
      // 本回合已打出的牌型统计（不含当前这张）
      turnPlays: { attack: 0, skill: 0, power: 0 },
      player: {
        name: char.name,
        role: char.role,
        charId: char.id,
        hp: startHp,
        maxHp: opts.maxHp == null ? 75 : opts.maxHp,
        block: 0,
        energy: 3,
        maxEnergy: 3,
        buffs: {},
        // 角色独有资源（§8）：掘者没有，医师是「样本」，引火者是「余烬」。
        // 引擎只按规格执行，不认识这些名字 —— 加第四个角色不用改引擎。
        resource: resSpec ? {
          key: resSpec.key,
          name: resSpec.name,
          value: resSpec.start || 0,
          max: resSpec.max,
        } : null,
      },
      enemies: [],
      targetIdx: 0,
      lastPlayed: null, // 上一张打出的牌 def —— 「拾荒者残影」的模仿对象
      hand: [],
      drawPile: [],
      discardPile: [],
      // 消化牌堆（M11）：能力牌打出去就到这儿，本场不再回来。
      // 与弃牌堆的关键区别：drawTo 洗回抽牌堆时只洗弃牌堆，消化堆永远不洗回。
      exhaustPile: [],
      log: [],

      // 本场带进来的遗物，以及它们派生出的效果值（§12）。
      // 只读一次、存成具体数字，卡牌与回合逻辑就不用反复查遗物表。
      relics: opts.relics ? opts.relics.slice() : [],
      // §11（M78）：药水。**传引用**（Run.state.potions 原数组）——
      // 喝掉即从本局移除、跨战斗保留，不需要战后回写。
      potions: opts.potions || [],
      bonus: {
        battleStartDraw: relicEffect(opts.relics, 'battleStartDraw'),
        firstTurnEnergy: relicEffect(opts.relics, 'firstTurnEnergy'),
        calmTurnHeal: relicEffect(opts.relics, 'calmTurnHeal'),
        startBlock: relicEffect(opts.relics, 'startBlock'),
        handSize: relicEffect(opts.relics, 'handSize'),
      },
    };

    // 兼容视图：M1–M4 的渲染与测试都按「state.enemy 是场上那只怪」写的。
    // 只读，别赋值 —— 没有 setter。
    Object.defineProperty(this.state, 'enemy', {
      get: function () { return Combat.targetUnit(); },
      configurable: true,
    });

    // M50：编队。opts.enemies = [{ id, variant, affixes, hpMul, hp }, …]，
    // 不传就退回老的「单只 opts.enemyId」路径 —— M1–M49 的全部调用点与断言不变。
    // 顺序即进场顺序：大 Boss（或主敌）排在 index 0，M23 的「先上场 = 老大」与
    // 前后排排序都依赖它。
    //   hpMul  这一只的血量倍率（run.js 折出来的：多敌分摊 × 强化倍率）。
    //          池子的 HP 是按单挑标定的，两只同场不平摊就是双倍血。
    const lineup = (opts.enemies && opts.enemies.length)
      ? opts.enemies.slice()
      : [{ id: enemyId }];
    const main = lineup.map((e) => this.addEnemy(e.id, {
      hp: e.hp,
      variant: e.variant,
      affixes: e.affixes,
      hpScale: depthScaleFor(ENEMIES[e.id], depth, opts.enemyHpPct, lvlScale) * (e.hpMul || 1),
    }));

    // 开局召唤（双头犬的第二颗头）。放在这里而不是 addEnemy 里，
    // 否则 onSpawn 自己调 summon 会递归。
    this.state.enemies.slice().forEach(function (e) {
      if (e.def.onSpawn) e.def.onSpawn(Combat.ctx(e));
    });

    // 卡组是 Run 的，战斗只拿副本 —— 战斗会原地洗牌、弃牌、消耗
    const deck = opts.deck && opts.deck.length
      ? opts.deck.map(cloneCard)
      : char.starterDeck.map(mkCard);
    this.state.drawPile = RNG.shuffle(deck);

    // 开场白按**编队**列名（M50）。只数 main —— 双头犬的第二颗头是 onSpawn
    // 召唤来的，写进开场白会变成「前方是双头犬、双头犬。」
    this.log('前方是' + main.map((u) => u.name).join('、') + '。');
    this.state.enemies.forEach((e) => this.pickIntent(e));
    this.startPlayerTurn();
    return this.state;
  },

  startPlayerTurn() {
    const s = this.state;
    s.phase = 'player';
    s.turnPlays = { attack: 0, skill: 0, power: 0 };

    // 回合开始先结算中毒（无视格挡）
    this.tickPoison(s.player);
    if (s.player.hp <= 0) {
      s.phase = 'lose';
      this.log(s.player.name + ' 因中毒倒下。');
      return;
    }

    // 格挡清空；有「壁垒」则保留
    if (!s.player.buffs.barricade) s.player.block = 0;

    // 能力牌钩子
    const met = s.player.buffs.metallicize || 0;
    if (met > 0) this.gainBlock(s.player, met);

    const regen = s.player.buffs.regen || 0;
    if (regen > 0) this.heal(s.player, regen);

    const strPerTurn = s.player.buffs.strPerTurn || 0;
    if (strPerTurn > 0) this.addBuff(s.player, 'str', strPerTurn);

    // 「火种共鸣」给的 strTurn 只活一个回合 —— 在这里清掉上一回合留下的
    if (s.player.buffs.strTurn) delete s.player.buffs.strTurn;

    // 角色资源的每回合累积（§8.2 样本：每回合开始 +1，上限 5）。
    // 静默累加，不进战斗记录 —— 否则每回合都刷一行"获得 1 点样本"。
    this.gainResourcePerTurn();

    // 引火者的「不灭」：血线低于 30% 时额外给余烬
    const undying = s.player.buffs.undying || 0;
    if (undying > 0 && s.player.hp / s.player.maxHp < 0.3) {
      this.gainResource(undying, true);
    }

    // 燃烧结算（§7：回合开始扣 N，层数不衰减）
    this.tickBurn(s.player);
    if (s.player.hp <= 0) {
      s.phase = 'lose';
      this.log(s.player.name + ' 被烧尽了。');
      return;
    }

    // 「井壁吊坠」：只有第 1 回合额外给能量
    s.player.energy = s.player.maxEnergy +
      (s.turn === 1 ? s.bonus.firstTurnEnergy : 0);

    // 「黄铜齿轮」一家（startBlock）：战斗开始时（= 第 1 回合）给先手格挡。
    // 必须放在上面 block=0 清空之后 —— 否则会被本回合的清空直接吃掉。
    if (s.turn === 1 && s.bonus.startBlock > 0) {
      this.gainBlock(s.player, s.bonus.startBlock);
    }

    // 「苔藓护符」的判定基准：记下玩家回合开始时的血量，回合末只要没比它低就算没被消耗。
    // 为什么要基准而不打标记：敌人的伤害发生在敌人回合，若在 dealDamage 里打标记，
    // 那标记会一直挂着，这条遗物永远不触发。
    // 放在中毒结算之后 —— 上回合中的毒不该算作本回合被打扰。
    s.player.turnStartHp = s.player.hp;

    this.log('—— 第 ' + s.turn + ' 回合 ——');
    // 手牌上限：基础 5 +「宽背带」（handSize）；战斗开始时（= 第 1 回合）
    // 再叠「锈蚀罗盘 / 鼠獠牙」（battleStartDraw）的额外抽牌
    this.drawTo(5 + s.bonus.handSize +
      (s.turn === 1 ? s.bonus.battleStartDraw : 0));
  },

  endTurn() {
    const s = this.state;
    if (s.phase !== 'player') return;

    // 诅咒牌：只要还捏在手里，回合末就扣血（在弃牌之前结算）
    s.hand.forEach((c) => {
      if (c.def.curseHpLoss) this.loseHp(s.player, c.def.curseHpLoss);
    });
    if (this.checkEnd()) return;

    // 回合末弃掉整手
    if (s.hand.length) {
      s.discardPile.push.apply(s.discardPile, s.hand);
      s.hand = [];
    }

    this.decayDebuffs(s.player);

    // 「苔藓护符」：这一回合血量没掉过就回血（中毒 / 诅咒 / 自伤都会算作被消耗）
    if (s.player.hp >= s.player.turnStartHp && s.bonus.calmTurnHeal > 0) {
      this.heal(s.player, s.bonus.calmTurnHeal);
    }

    s.phase = 'enemy';
    this.enemyTurn();
    if (this.checkEnd()) return;

    s.turn++;
    this.startPlayerTurn();
  },

  // ---------- 出牌 ----------

  canPlay(card) {
    const s = this.state;
    if (s.phase !== 'player') return false;
    if (card.def.unplayable) return false; // 诅咒牌（§10 渗水层给的「疫尘入肺」）
    if (cardCost(card) > s.player.energy) return false;
    // 卡自带的额外门槛（M6）：比如「血清三号」要有 2 点样本才能打。
    // 放在这里而不是 play 里，是为了让 UI 能把它标成灰色不可点 ——
    // 只在 play 里拦的话，玩家会白花 1 点能量打出一张空牌。
    if (card.def.need && !card.def.need(card, this.ctx())) return false;
    return true;
  },

  playCard(uid) {
    const s = this.state;
    const idx = s.hand.findIndex(function (c) {
      return c.uid === uid;
    });
    if (idx < 0) return;

    const card = s.hand[idx];
    if (!this.canPlay(card)) return;

    s.player.energy -= cardCost(card);
    s.hand.splice(idx, 1);

    // 能力牌本场只能打出一次：进消化牌堆，洗牌永远洗不回来
    if (card.def.type === 'power') {
      s.exhaustPile.push(card);
      this.log('打出能力「' + card.def.name + '」，进入消化牌堆。');
    } else {
      s.discardPile.push(card);
      this.log('打出「' + card.def.name + '」。');
    }

    // 打击材质：本张卡的 impact 记进上下文，play 里的 dealDamage 会把它带进动作日志。
    // 注意顺序：play 里读到的 turnPlays 不含本张
    this._impact = card.def.impact || null;
    // 打击画像（M40）：连同「这张卡是什么」一起记进上下文 —— core 只做透传，
    // 不认识音频。SfxProfile 是 js/data 里的纯函数层；逻辑测试沙箱里可能没有它，
    // 所以判一下 typeof（没有就退化成「只有材质」，不是错误）。
    this._sfx = (typeof SfxProfile !== 'undefined' && SfxProfile) ? SfxProfile.of(card.def) : null;
    // M76 图鉴：打出过才点亮（运行时探测，与 run.js dlOf 同一套理由 ——
    // M1 的战斗测试没加载 progress.js）。只改内存，随下一个存档点落盘。
    if (typeof Progress !== 'undefined' && Progress.recordCard) {
      try { Progress.recordCard(card.def.id); } catch (e) { /* 记录失败不碰战斗 */ }
    }
    card.def.play(this.ctx(), card);
    s.turnPlays[card.def.type] = (s.turnPlays[card.def.type] || 0) + 1;
    s.lastPlayed = card.def; // 「拾荒者残影」要模仿这个

    this.checkEnd();
  },

  // ---------- 药水（M78 · §11）----------

  // 战斗中随时可喝：不耗能量、不占出牌次数；仅玩家回合（结算中喝了会乱序）。
  // potions 是 Run.state.potions 的引用 —— 喝掉即从本局消失，跨战斗自动保留。
  // 返回喝掉的药水 id；不可用返回 null。
  usePotion(idx) {
    const s = this.state;
    if (s.phase !== 'player') return null;
    const list = s.potions || [];
    if (idx < 0 || idx >= list.length) return null;
    const def = POTIONS[list[idx]];
    if (!def) return null;
    const id = list.splice(idx, 1)[0];
    // 目标类药水打当前选中目标（单敌时即唯一敌人；目标已死自动顺延）
    def.use(this.ctx());
    this.log('喝下「' + def.name + '」。');
    this.checkEnd();
    return id;
  },

  // ---------- 目标 ----------

  aliveEnemies() {
    return this.state.enemies.filter(function (e) { return e.hp > 0; });
  },

  // 玩家选中的目标；它死了就自动落到第一个还活着的敌人身上。
  // 攻击牌里写的都是 ctx.enemy，靠这一层保证「打死了会接着打下一个」。
  targetUnit() {
    const s = this.state;
    const t = s.enemies[s.targetIdx];
    if (t && t.hp > 0) return t;
    const alive = this.aliveEnemies();
    return alive[0] || s.enemies[0] || null;
  },

  setTarget(idx) {
    const s = this.state;
    const e = s.enemies[idx];
    if (!e || e.hp <= 0) return false;
    s.targetIdx = idx;
    return true;
  },

  // 加一个敌人。同名重复时加 #N 后缀 —— 日志和 UI 里要能分清是哪一只。
  // M50：编号按「同一个 def + 同一个变体」数，而不是只按 def ——
  // 场上同时有「腐蚀鼠群」和「壮大的腐蚀鼠群」时，后者的编号要从 1 起算，
  // 否则会出现「壮大的腐蚀鼠群 #2」却没有 #1 的怪事。
  addEnemy(defId, opts) {
    const unit = spawnEnemy(defId, opts);
    const s = this.state;
    const v = (opts && opts.variant) || null;
    const same = s.enemies.filter(function (e) {
      return e.def.id === defId && (e.variant || null) === v;
    }).length;
    if (same > 0) unit.name = unit.name + ' #' + (same + 1);
    s.enemies.push(unit);
    return unit;
  },

  // ---------- 意图 ----------

  // Boss 开战意图推演（M78 · 「火种读数仪」解禁）：不依赖战斗实例，
  // 从「满血、姿态 1、patternIndex 0」的开战姿态推演接下来 n 个行动。
  // 三个 Boss 的 choose 都只读态势（血线 / 小怪数 / 姿态），推演与真实开局
  // 一致；战局推进后自然偏离 —— 文案上按「以当前态势推演」交付。
  // 返回招式定义数组（可能少于 n：推演中断时不编造）。
  forecastBoss(defId, n) {
    const def = (typeof ENEMIES !== 'undefined' && ENEMIES[defId]) || null;
    if (!def || def.kind !== 'boss' || !n) return [];
    const sim = { hp: 9999, maxHp: 9999, patternIndex: 0, phase: 1, enraged: false, buffs: {}, def: def };
    // 只读沙箱 ctx：choose 万一调了原语也不能真打出去
    const ctx = {
      player: { hp: 9999, maxHp: 9999, block: 0, buffs: {} },
      enemy: sim, self: sim,
      enemies: [sim],
      turn: 1, depth: 1,
      log: function () {},
      addBuff: function () {}, dealDamage: function () {}, heal: function () {},
      loseHp: function () {}, gainBlock: function () {},
      summon: function () { return { name: '…' }; },
    };
    const out = [];
    for (let i = 0; i < n; i++) {
      let key = null;
      if (def.choose) {
        try { key = def.choose(ctx) || null; } catch (e) { key = null; }
      }
      if (!key) key = def.pattern[sim.patternIndex % def.pattern.length];
      sim.patternIndex++;
      const mv = def.moves[key];
      if (!mv) break;
      out.push(mv);
    }
    return out;
  },

  pickIntent(unit) {
    const def = unit.def;
    let key = def.choose ? def.choose(this.ctx(unit)) : null;
    if (!key) key = def.pattern[unit.patternIndex % def.pattern.length];
    unit.patternIndex++;
    unit.intent = def.moves[key] || null;
    return unit.intent;
  },

  // 意图上显示的是"实际会打出多少"，而不是原始值。
  // M89：直接复用 rawDamage —— 显示与结算必须同源。此前这里自己算了一遍，
  // 漏了 dlScale（DL5 显示 12 实际 19、DL10 显示 12 实际 28），也漏了 strTurn。
  intentDamage(unit) {
    const s = this.state;
    const u = unit || this.targetUnit();
    const mv = u && u.intent;
    if (!mv || mv.kind !== 'attack') return null;
    return this.rawDamage(u, s.player, mv.value);
  },

  // ---------- 结算原语 ----------

  dealDamage(attacker, target, base) {
    // 打击材质（M36）：玩家出牌 / 敌人行动前已把「当前招式的材质」记进 _impact，
    // 这里一并带进动作日志，渲染层按它选音效。兜底：玩家 blunt / 敌人 claw。
    // M40 起再带 sfx（卡片特质画像）与 dmg（打出的力道）—— 都是**加法字段**，
    // 既有消费方读到的东西一个没改。
    // 注意 dmg 记的是 rawDamage 之后、减格挡**之前**的值：被墙挡下的重击依然是重击，
    // 音频的「力度」该反映打出的力道，不是净掉血量。
    const act = { src: attacker, dst: target,
      impact: this._impact || (this.state.enemies.indexOf(attacker) >= 0 ? 'claw' : 'blunt'),
      sfx: this._sfx || null };
    this.acts.push(act);
    const dmg = this.rawDamage(attacker, target, base);
    const absorbed = Math.min(target.block, dmg);
    target.block -= absorbed;
    const dealt = dmg - absorbed;
    act.dmg = dmg;

    target.hp = Math.max(0, target.hp - dealt);
    const suffix = absorbed > 0 ? '（格挡吸收 ' + absorbed + '）' : '';
    this.log(this.unitName(target) + ' 受到 ' + dealt + ' 点伤害' + suffix + '。');
    // 引火者的余烬：被真的打掉血才累积（§8.3）
    if (dealt > 0) this.onHit(target);

    // 荆棘反弹：被攻击时反伤攻击者（M73：先吃攻击者的格挡，见 applyThorns）
    this.applyThorns(target, attacker);
  },

  // 无视格挡的伤害（破岩 / 终末钻探）
  dealDamageRaw(attacker, target, base) {
    const act = { src: attacker, dst: target,
      impact: this._impact || (this.state.enemies.indexOf(attacker) >= 0 ? 'claw' : 'blunt'),
      sfx: this._sfx || null };
    this.acts.push(act);
    const dmg = this.rawDamage(attacker, target, base);
    act.dmg = dmg;
    target.hp = Math.max(0, target.hp - dmg);
    this.log(this.unitName(target) + ' 受到 ' + dmg + ' 点伤害（无视格挡）。');
    if (dmg > 0) this.onHit(target);

    // 主击可以穿格挡，反弹这一段不跟着穿（M73）
    this.applyThorns(target, attacker);
  },

  // 荆棘反弹（M73 用户定的规则）：反伤**不是真实伤害** —— 先吃攻击者的
  // 格挡，挡格扣完才扣 HP。dealDamage / dealDamageRaw 两个入口共用。
  applyThorns(target, attacker) {
    const thorns = target.buffs.thorns || 0;
    if (!(thorns > 0) || attacker === target) return;
    const absorbed = Math.min(attacker.block, thorns);
    attacker.block -= absorbed;
    const dealt = thorns - absorbed;
    attacker.hp = Math.max(0, attacker.hp - dealt);
    const suffix = absorbed > 0 ? '（格挡吸收 ' + absorbed + '）' : '';
    this.log(this.unitName(attacker) + ' 被荆棘反弹 ' + thorns + ' 点伤害' + suffix + '。');
  },

  // 连击：重复 times 次。中途目标死亡或攻击者倒下就中断
  attackTimes(attacker, target, times, base) {
    for (let i = 0; i < times; i++) {
      if (target.hp <= 0 || attacker.hp <= 0) break;
      this.dealDamage(attacker, target, base);
    }
  },

  // 基础伤害经过力量 / 虚弱 / 脆弱修正后的数值
  rawDamage(attacker, target, base) {
    // strTurn（「火种共鸣」）与 str 一样是加算，区别只在回合开始会清零
    // M50：dmgAdd（壮大 / 暴戾词缀）也在这里加 —— 它代表体格而不是气势，
    // 所以乘在力量**之前**（与 str 同为加法，顺序上不影响结果，
    // 但写在前面读起来更清楚：先「这只怪本身有多重」，再「它今天多有劲」）。
    let dmg = base + (attacker.dmgAdd || 0) +
      (attacker.buffs.str || 0) + (attacker.buffs.strTurn || 0);
    // DL 难度系数只作用于**敌人打出**的伤害（§3.1）。玩家卡牌走的是同一个出口，
    // 所以必须按 attacker 判断，不能在这里统乘 —— 否则玩家的牌也一起变强。
    // 乘在力量之后、虚弱/脆弱之前：「敌人这一击的整体威力 × DL」。
    if (this.state.enemies.indexOf(attacker) >= 0) {
      dmg = Math.round(dmg * (this.state.dlScale || 1));
    }
    if (attacker.buffs.weak) dmg = Math.floor(dmg * 0.75);
    if (target.buffs.vulnerable) dmg = Math.floor(dmg * 1.5);
    return Math.max(0, dmg);
  },

  gainBlock(target, amount) {
    const gained = Math.max(0, amount + (target.buffs.dex || 0));
    target.block += gained;
    this.log(this.unitName(target) + ' 获得 ' + gained + ' 点格挡。');
  },

  heal(unit, amount) {
    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    const gained = unit.hp - before;
    if (gained > 0) this.log(this.unitName(unit) + ' 回复 ' + gained + ' 点生命。');
  },

  // 失去生命：无视格挡、不触发荆棘
  loseHp(unit, amount) {
    unit.hp = Math.max(0, unit.hp - amount);
    this.log(this.unitName(unit) + ' 失去 ' + amount + ' 点生命。');
  },

  // 消耗全部格挡并返回消耗量
  consumeBlock(unit) {
    const b = unit.block;
    unit.block = 0;
    if (b > 0) this.log(this.unitName(unit) + ' 消耗了 ' + b + ' 点格挡。');
    return b;
  },

  // 允许负值 —— 「锈蚀」（我方 −1 敏捷）与「撬动」（降敌方力量）都靠它。
  // 这里曾经有个 Math.max(0, ...) 把结果夹在 0 以上：玩家敏捷本来是 0 时
  // 锈冠的锈蚀完全无效，D5 那只 Boss 的核心机制直接失效。
  addBuff(target, key, n) {
    if (!n) return;
    const cur = target.buffs[key] || 0;
    const next = cur + n;
    const delta = next - cur;
    if (next === 0) delete target.buffs[key];
    else target.buffs[key] = next;
    if (delta === 0) return;

    this.log(
      this.unitName(target) +
        (delta > 0 ? ' 获得 ' : ' 失去 ') +
        Math.abs(delta) +
        ' 层' +
        (BUFF_NAMES[key] || key) +
        '。'
    );
  },

  drawCards(n) {
    this.drawTo(this.state.hand.length + n);
  },

  gainEnergy(n) {
    this.state.player.energy += n;
    this.log('获得 ' + n + ' 点能量。');
  },

  // ---------- 角色资源（M6，§8）----------
  // 引擎只认「角色有一个可选资源 + 一份规格」，不认样本 / 余烬这些名字。
  // 加第四个角色只要在 characters.js 写一份 resource 规格，这里一行不用改。

  // 当前资源值。掘者没有资源，一律返回 0 ——
  // 卡里的 ctx.resource() 因此不用先判空。
  resource(unit) {
    const r = (unit || this.state.player).resource;
    return r ? r.value : 0;
  },

  // 加资源。silent 给回合自动累积那类不值得进战斗记录的场合用。
  gainResource(n, silent) {
    const p = this.state.player;
    if (!p.resource || n <= 0) return 0;
    const before = p.resource.value;
    const raw = before + n;
    p.resource.value = p.resource.max == null ? raw : Math.min(p.resource.max, raw);
    const gained = p.resource.value - before;
    // 已经满了就不再刷日志 —— 否则"样本已满"会每回合写一行
    if (gained > 0 && !silent) {
      this.log('获得 ' + gained + ' 点' + p.resource.name + '。');
    }
    return gained;
  },

  // 花资源。**不够就一点不花、返回 false** —— 不能花掉一半，
  // 否则「消耗 3 点样本」会让只有 1 点的玩家白亏 1 点。
  spendResource(n) {
    const p = this.state.player;
    if (!p.resource || n <= 0) return false;
    if (p.resource.value < n) return false;
    p.resource.value -= n;
    this.log('消耗 ' + n + ' 点' + p.resource.name + '。');
    return true;
  },

  // 回合开始的自动累积 = 角色规格的 perTurn + 能力牌给的 resPerTurn
  gainResourcePerTurn() {
    const p = this.state.player;
    if (!p.resource) return;
    const spec = characterOf(p.charId).resource;
    const per = (spec ? spec.perTurn : 0) + (p.buffs.resPerTurn || 0);
    if (per > 0) this.gainResource(per, true);
  },

  // 被击中时累积（§8.3 余烬）。只在真的掉血时触发 ——
  // 被格挡挡光的攻击不算「受到伤害」，否则引火者可以全程叠甲白刷余烬，
  // 那就退化成跟掘者一样的叠甲流派，"越危险越强"的设计意图就没了。
  // 自伤走的是 loseHp，不经过这里 —— 那条线由卡面显式给资源，不会双重计数。
  onHit(target) {
    const p = this.state.player;
    if (target !== p || !p.resource) return;
    const spec = characterOf(p.charId).resource;
    if (spec && spec.onDamaged > 0) this.gainResource(spec.onDamaged, true);
  },

  // ---------- 内部 ----------

  // 中毒：回合开始扣血，层数 −1
  tickPoison(unit) {
    const p = unit.buffs.poison || 0;
    if (p <= 0) return;
    unit.hp = Math.max(0, unit.hp - p);
    this.log(this.unitName(unit) + ' 受到 ' + p + ' 点中毒伤害。');
    if (p - 1 > 0) unit.buffs.poison = p - 1;
    else delete unit.buffs.poison;

    // 「寄生」：敌人每次吃中毒伤害，玩家回等量血（升级后额外再加）。
    // 只认中毒 —— 燃烧与直接伤害都不触发，卡面写的是"受到中毒伤害"。
    const holder = this.state.player;
    if (unit !== holder && (holder.buffs.parasite || 0) > 0) {
      this.heal(holder, p + (holder.buffs.parasiteBonus || 0));
    }
  },

  // 燃烧：回合开始扣血，**层数不衰减** —— 这是它与中毒的唯一区别（§7）。
  // 持续到战斗结束，所以对敌人是"加速击杀"，对自己是真正的惩罚。
  tickBurn(unit) {
    const b = unit.buffs.burn || 0;
    if (b <= 0) return;
    unit.hp = Math.max(0, unit.hp - b);
    this.log(this.unitName(unit) + ' 受到 ' + b + ' 点燃烧伤害。');
  },

  // 虚弱 / 脆弱在回合结束时衰减 1 层
  decayDebuffs(unit) {
    ['weak', 'vulnerable'].forEach(function (k) {
      const v = unit.buffs[k] || 0;
      if (v <= 0) return;
      if (v - 1 > 0) unit.buffs[k] = v - 1;
      else delete unit.buffs[k];
    });
  },

  // 敌人回合：所有存活单位依次行动。多敌人是 M5 加的 —— 双头犬的两颗头
  // 就是靠这个拿到"两个独立行动回合"，「战吼」这类群体 buff 也才有意义。
  enemyTurn() {
    const s = this.state;
    const actors = this.aliveEnemies();

    for (let i = 0; i < actors.length; i++) {
      const u = actors[i];
      // 前面的单位可能已经把玩家打死，或者这个单位自己中了毒/被反伤
      if (u.hp <= 0 || s.player.hp <= 0) continue;

      this.tickPoison(u);
      this.tickBurn(u);
      if (u.hp <= 0) continue; // 毒死 / 烧死就不行动

      // 蚀骨工匠的骨甲要跨回合累积，所以它不清格挡
      if (!u.def.keepBlock) u.block = 0;

      const ctx = this.ctx(u);

      // 行动前钩子：无首执械者的姿态切换在这里做 —— 它要影响本回合的行动，
      // 放在行动后（pickIntent）就晚了一回合
      if (u.def.beforeAct) u.def.beforeAct(ctx);

      const move = u.intent;
      if (move && u.hp > 0) {
        // 打击材质：本招式的 impact（敌人招式没标就默认 claw）
        this._impact = (move.impact) || (u.def && u.def.impact) || 'claw';
        // 敌人招式没有卡面 ⇒ 画像置空。**必须显式清掉**，否则玩家上一张卡的特质
        // 会漏到敌人的这一击上（「卖血」层出现在怪物爪击里，是纯粹的谎报）。
        this._sfx = null;
        this.log(u.name + ' 使用「' + move.name + '」。');
        move.run(ctx);
      }

      if (u.hp > 0) {
        this.decayDebuffs(u);
        this.pickIntent(u);
      }
    }
  },

  // 死亡触发。由 checkEnd 统一调用，用 deadHandled 保证每个单位只触发一次。
  resolveDeaths() {
    const s = this.state;
    s.enemies.forEach(function (e) {
      if (e.hp > 0 || e.deadHandled) return;
      e.deadHandled = true;
      e.intent = null;
      Combat.log(e.name + ' 被击败。');
      if (e.def.onDeath) e.def.onDeath(Combat.ctx(e));
    });
  },

  drawTo(n) {
    const s = this.state;
    let reshuffled = false;

    while (s.hand.length < n) {
      if (s.drawPile.length === 0) {
        if (s.discardPile.length === 0) break; // 两边都空，抽不动了
        s.drawPile = RNG.shuffle(s.discardPile);
        s.discardPile = [];
        reshuffled = true;
      }
      s.hand.push(s.drawPile.pop());
    }

    if (reshuffled) this.log('弃牌堆洗回抽牌堆。');
  },

  checkEnd() {
    const s = this.state;
    this.resolveDeaths();

    // 只在 phase 真的变化时写日志 —— checkEnd 会被反复调用
    // （每次出牌、每次 endTurn、每次敌人行动后），不做这个判断日志会重复刷屏
    if (s.player.hp <= 0) {
      if (s.phase !== 'lose') {
        s.phase = 'lose';
        this.log(s.player.name + ' 倒下了。');
      }
      return true;
    }
    if (this.aliveEnemies().length === 0) {
      if (s.phase !== 'win') {
        s.phase = 'win';
        this.log('深度 D' + s.depth + ' 的威胁被清除。');
      }
      return true;
    }
    return false;
  },

  // actor 不传 = 玩家出牌，enemy 指向玩家选中的目标；
  // 传了 = 某个敌人在行动，enemy 指向它自己（招式脚本里 ctx.enemy 都是"我"）
  ctx(actor) {
    const s = this.state;
    const self = this;
    const cur = actor || this.targetUnit();
    return {
      player: s.player,
      enemy: cur,
      self: cur,
      enemies: s.enemies,
      depth: s.depth,
      turn: s.turn,
      turnPlays: s.turnPlays,
      lastPlayed: s.lastPlayed,
      dealDamage: function (a, t, n) {
        self.dealDamage(a, t, n);
      },
      dealDamageRaw: function (a, t, n) {
        self.dealDamageRaw(a, t, n);
      },
      attackTimes: function (a, t, times, n) {
        self.attackTimes(a, t, times, n);
      },
      gainBlock: function (t, n) {
        self.gainBlock(t, n);
      },
      heal: function (t, n) {
        self.heal(t, n);
      },
      loseHp: function (t, n) {
        self.loseHp(t, n);
      },
      consumeBlock: function (t) {
        return self.consumeBlock(t);
      },
      addBuff: function (t, k, n) {
        self.addBuff(t, k, n);
      },
      drawCards: function (n) {
        self.drawCards(n);
      },
      gainEnergy: function (n) {
        self.gainEnergy(n);
      },
      // 角色资源（M6）。spendResource 返回布尔：花不起就是 false，
      // 卡里靠它决定"可选消耗"要不要生效（见「活检」「临床观察」）。
      resource: function () {
        return self.resource();
      },
      gainResource: function (n) {
        return self.gainResource(n);
      },
      spendResource: function (n) {
        return self.spendResource(n);
      },
      // 召唤。传 hp 就是固定血量（菌母的孢囊行者固定 30，不叠深压）
      summon: function (defId, hp) {
        const u = self.addEnemy(defId, { hp: hp });
        self.pickIntent(u);
        return u;
      },
      log: function (m) {
        self.log(m);
      },
    };
  },

  unitName(unit) {
    return unit.name || '某个单位';
  },

  log(msg) {
    this.state.log.push(msg);
  },
};
