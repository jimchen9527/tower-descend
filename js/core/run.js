// 本局进度 —— 地图 + 当前位置 + 跨节点保留的玩家状态（血量 / 金币 / 卡组 / 遗物 / 临时修正）。
//
// 纯逻辑，不碰 DOM，也**不引用 Combat**：血量与卡组由调用方传进战斗、打完读回来。
// 这样 Run 能独立无头测试，战斗结算是单向的（UI 读 Combat 再喂给 Run）。
//
// 随机数：本局自己维护一套确定性随机（rand / int / chance / pick / pickMany），
// 状态只有 rngCount 一个整数 —— M7 存档时存它就能复现整局。
// 为什么不复用 RNG 单例：战斗 start 时会 RNG.init(战斗种子)，两条线会互相踩。

const START_HP = 75; // §14 数值基线
const START_GOLD = 99;

// 奖励池抽卡的稀有度权重。梯度对齐 §11 的定价：普通 45–60 / 罕见 75–95 / 稀有 120–150
const RARITY_WEIGHT = { common: 60, uncommon: 30, rare: 10 };

// 商店定价（§11 价格基线）
const CARD_PRICE = { common: [45, 60], uncommon: [75, 95], rare: [120, 150] };
const RELIC_PRICE = [140, 200];
const REMOVE_BASE = 75;
const REMOVE_STEP = 25; // 每删一次 +25

// §3.1 第 2 条（M31）：「零代价安全项」的判据 —— 削选项时**优先**削这种垫底项。
// 判据看文案（作者给这类选项的 hint 高度一致），不依赖新增数据字段，
// 这样老事件不用逐个改；将来若加新事件，写「无事发生」即自动纳入。
function isFreeSafe(opt) {
  if (!opt || !opt.hint) return false;
  return /无事发生|离开|不管|什么都不留|不要了|无视|绕开/.test(opt.hint);
}

// ==================== 每日挑战（M60）====================
//
// 一天一副「考卷」：日期字符串 → 确定性的种子与修饰词。全世界同一天拿到的
// 是同一张卷子，纯单机也能有「今天大家都打这局」的比较语境。
//
// 修饰词全部走**已有管线**，不为它开新机关：
//   enemyHpPct → 事件临时修正的同一条 modSum 管线（until 给 999 = 全局）
//   gold/rest  → 结算点的两个乘数挂点（rollBattleReward / restHealAmount）
//   hp/goldNum → 开局数值直改
//   preUpg     → 开局随机升级 N 张（复用 upgradeCardRandom）
// 新增一个修饰词 = 表里加一行，引擎零改动。
const DAILY_MODS = {
  thick_spawn: {
    id: 'thick_spawn', name: '浓密孢雾', desc: '所有敌人生命 +15%',
    enemyHpPct: 15,
  },
  light_purse: {
    id: 'light_purse', name: '轻装钱袋', desc: '起始金币只有 40',
    goldNum: 40,
  },
  glass_bones: {
    id: 'glass_bones', name: '玻璃骨骼', desc: '起始与最大生命 60',
    hp: 60,
  },
  gold_vein: {
    id: 'gold_vein', name: '富金矿脉', desc: '战斗金币 +50%',
    goldMul: 1.5,
  },
  warm_ash: {
    id: 'warm_ash', name: '温热灰烬', desc: '休息点回血 +50%',
    restMul: 1.5,
  },
  veteran_eye: {
    id: 'veteran_eye', name: '老手眼力', desc: '开局随机升级 2 张卡',
    preUpg: 2,
  },
};
const DAILY_MOD_IDS = Object.keys(DAILY_MODS);

// 日期串（'YYYY-MM-DD'）→ 本日种子与修饰。确定性 hash：同一天永远同值，
// 不同天互不相关（两个不同盐位的多轮乘搅散）。
function dailyFor(dateKey) {
  let h = 0;
  const salt = 'td-daily';
  for (let i = 0; i < dateKey.length + salt.length; i++) {
    const c = (i < dateKey.length ? dateKey.charCodeAt(i) : salt.charCodeAt(i - dateKey.length));
    h = ((h * 131) + c) >>> 0;
    h = ((h * 17) ^ (h >>> 13)) >>> 0;
  }
  return {
    date: dateKey,
    seed: h >>> 0,
    modKey: DAILY_MOD_IDS[h % DAILY_MOD_IDS.length],
    dl: 3, // 每日挑战固定 DL3：人人同难度的前提，也与角色刻痕无关
  };
}

// 修饰的数值乘数（结算点读；没有每日修饰或该词没这字段 = 1）
function dailyMulOf(state, key) {
  if (!state || !state.daily) return 1;
  const m = DAILY_MODS[state.daily.modKey];
  return (m && m[key]) || 1;
}

const Run = {
  state: null,
  // ---------- 等级（可选依赖）----------
  // §3.1 的四条每级特殊调整（M31）要读当前 DL，但 **Run 不硬依赖 Progress**：
  // M3–M6 的测试按需加载文件（FILES 清单里没有 progress.js），
  // 顶层直接引用 Progress 会让那些测试当场 ReferenceError。
  // 而且「纯逻辑层各自独立可测」是本项目的架构铁律 —— 这里改成运行时探测：
  // 拿不到进度就当 DL1（= 不启用任何特殊调整），测试与老调用点零改动。
  dlOf(charId) {
    if (typeof Progress === 'undefined' || !Progress || !Progress.dl) return 1;
    try {
      return Progress.dl(charId);
    } catch (e) {
      return 1;
    }
  },

  // 本局生效的 DL（M55）：开局时选定并冻进 state.dl —— 可以低于角色当前刻痕
  // （主菜单自选难度），也可以没有（老快照 / 老调用点）→ 退回角色刻痕，
  // 行为与 M55 之前完全一致。战斗 dlScale、事件调整、休息回血、掉落池上限
  // 都读它，不再各查各的 Progress。
  curDl() {
    const s = this.state;
    if (s && s.dl >= 1) return s.dl;
    return this.dlOf(s ? s.charId : DEFAULT_CHAR);
  },

  // ---------- 生命周期 ----------

  // charId 不传 = 掘者：M3–M5 的老测试与调用点都是两个参数。
  // dlWanted（M55）：主菜单允许在 1–10 内自选本局难度刻痕（UI 侧已限制
  // ≤ 角色当前 DL）；不传或非法 = 沿用角色当前刻痕，老调用点零改动。
  start(actId, seed, charId, dlWanted, daily) {
    const char = characterOf(charId);
    let dl = this.dlOf(char.id);
    if (dlWanted >= 1 && dlWanted <= 10) dl = Math.min(dlWanted | 0, 10);
    // §3.1 每级特殊调整（M31 补齐第 4 条）：DL10「开局带 1 张诅咒」。
    // 诅咒卡是负担不是资源（cards.js 的 curse 注释），开局就压在牌库里，
    // 逼 DL10 的玩家每一局都先处理这张牌。
    const CURSE_AT_DL = 10;
    const map = MapGen.generate(actId, seed, dl);
    const deckCards = char.starterDeck.slice();
    if (dl >= CURSE_AT_DL) deckCards.push('cursed_lung');
    const s = {
      actId: map.actId,
      seed: map.seed,
      charId: char.id,
      dl: dl,       // 本局冻结的难度刻痕（M55），读它走 curDl()
      map: map,
      currentId: map.entryId,
      visited: {},
      cleared: {}, // nodeId -> 'entry' | 'win' | 'done' | 'skip' | 'lose'

      hp: START_HP,
      maxHp: START_HP,
      gold: START_GOLD,
      deck: deckCards.map(mkCard),
      relics: [],
      mods: [],       // 事件给的临时修正，按层数过期
      eventsUsed: {}, // §10：同一局内事件不重复
      removedCount: 0,
      potions: [],    // §11（M78）：药水 3 槽，跨战斗保留
      prevId: null,   // §13（M78）：上一脚踏过的节点 —— 攀绳的落点
      ropeUsed: 0,    // §13（M78）：本局已攀绳次数

      shop: null, // 进入商店时生成一次，离开即清空
      battles: 0,
      rngCount: 0,
      finished: false,
    };
    s.visited[map.entryId] = true;
    s.cleared[map.entryId] = 'entry';
    this.state = s;
    // 每日挑战（M60）：修饰随快照存档，续档后照常生效。
    // seed 由调用方传 dailyFor(dateKey).seed —— 同一天全世界的卷子相同。
    // ⚠️ 必须在 this.state = s 之后：addMod 内部走 this.current().depth。
    if (daily && DAILY_MODS[daily.modKey]) {
      s.daily = { date: daily.date, modKey: daily.modKey };
      const m = DAILY_MODS[daily.modKey];
      if (m.goldNum != null) s.gold = m.goldNum;
      if (m.hp != null) { s.maxHp = m.hp; s.hp = m.hp; }
      if (m.enemyHpPct) this.addMod('enemyHpPct', m.enemyHpPct, 999);
      if (m.preUpg) {
        for (let i = 0; i < m.preUpg; i++) this.upgradeCardRandom();
      }
    }
    return s;
  },

  node(id) { return this.state.map.nodes[id]; },
  current() { return this.node(this.state.currentId); },

  // ---------- 本局随机 ----------
  // 每次调用重新派生一个 mulberry32 并取第一个值：状态只有 rngCount，
  // 无需序列化闭包，M7 存档只存这一个整数。

  rand() {
    const s = this.state;
    s.rngCount = (s.rngCount + 1) >>> 0;
    return mulberry32((s.seed * 2654435761 + s.rngCount * 40503 + 12345) >>> 0)();
  },

  int(min, max) { return min + Math.floor(this.rand() * (max - min + 1)); },

  chance(p) { return this.rand() < p; },

  pick(arr) {
    return arr && arr.length ? arr[Math.floor(this.rand() * arr.length)] : null;
  },

  // 不重复抽 n 个（返回新数组，不改原数组）
  pickMany(arr, n) {
    const pool = arr.slice();
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    }
    return out;
  },

  // 掉落池的 DL 上限（§3.2：卡上的 dl = 从第几级起**进掉落池**）。
  // 只有两条出口用它 —— 战斗奖励、商店货架。
  //
  // 事件里的固定选卡**不接它**：§10 的事件文案承诺了「3 张稀有卡」，而稀有卡
  // 全是 dl7–10，一过滤 DL1–DL6 就抽到 0 张 —— 玩家先扣 60 金 / 12 血，再拿到
  // 一个空候选列表。事件是「明确的报价」，不是掉落池（§17 第 25 条）。
  //
  // Progress 没加载时返回 null = 不过滤，M2–M6 那些不加载 progress.js 的测试不变。
  //
  // 掉落池下限（M16 修复「每场掉落固定三张」）：§3.1 里 DL1 只解锁 3 张卡，
  // 而战斗奖励 / 商店货架每次都抽 3 张 —— 池子只有 3 张时，抽 3 张就永远
  // 是固定那三张（新玩家第一个可玩档就是 DL1，等于全程无随机掉落）。
  // 修法：把掉落池的 DL 下限抬到 2 —— DL1 时也解锁 DL2 的卡，池子 3 → 6 张，
  // 抽 3 张立刻有随机组合。DL2 起行为与原来完全一致（dl≤DL 照旧）。
  dlCap() {
    if (!(typeof Progress !== 'undefined' && Progress.data)) return null;
    return Math.max(2, this.curDl());
  },

  // 按稀有度权重抽 n 张不重复的卡 id；给 rarity 就只从该稀有度里抽。
  // maxDl 不传 = 不过滤（事件选卡与老调用点都走这条）。
  rollCardIds(n, rarity, maxDl) {
    // 必须带上当前角色 —— 漏了会静默拿到掘者池，切到医师后奖品还是掘者的卡。
    let pool = rewardPool(this.state.charId, maxDl).filter(function (k) {
      return !rarity || CARDS[k].rarity === rarity;
    });
    // M64：announce 卡走「升档解锁」—— 掉落池下限（DL1 借用 DL2 的卡）对它们
    // **不生效**，深度不到就绝不进池，否则收尾面板的「新卡入池」公告就成了假话。
    // 只挂在传了 maxDl 的掉落路径上（战斗奖励 / 商店货架）；事件选卡（不传
    // maxDl）不受此限 —— §17 第 25 条的「事件是明确的报价」口径不动。
    if (maxDl != null) {
      const dlNow = this.curDl();
      pool = pool.filter(function (k) {
        return !(CARDS[k].announce && (CARDS[k].dl || 0) > dlNow);
      });
    }
    const out = [];
    while (out.length < n && pool.length) {
      const weights = pool.map(function (k) {
        return RARITY_WEIGHT[CARDS[k].rarity] || 1;
      });
      let total = 0;
      weights.forEach(function (w) { total += w; });

      let r = this.rand() * total;
      let idx = weights.length - 1;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) { idx = i; break; }
      }
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  },

  // 抽 1 张（事件「值班日志」用）
  pickOneCard(rarity) {
    const r = this.rollCardIds(1, rarity);
    return r.length ? r[0] : null;
  },

  // ---------- 资源 ----------

  heal(n) {
    const s = this.state;
    s.hp = Math.min(s.maxHp, s.hp + n);
    return s.hp;
  },

  // 事件造成的生命流失。保底留 1 点 —— 事件不该直接决定一局的生死
  loseHp(n) {
    const s = this.state;
    s.hp = Math.max(1, s.hp - n);
    return s.hp;
  },

  raiseMaxHp(n) {
    const s = this.state;
    s.maxHp += n;
    s.hp += n;
  },

  lowerMaxHp(n) {
    const s = this.state;
    s.maxHp = Math.max(1, s.maxHp - n);
    if (s.hp > s.maxHp) s.hp = s.maxHp;
  },

  addGold(n) {
    this.state.gold += n;
    return this.state.gold;
  },

  spendGold(n) {
    if (this.state.gold < n) return false;
    this.state.gold -= n;
    return true;
  },

  // ---------- 卡组 ----------

  deckSize() { return this.state.deck.length; },

  addCard(id) {
    const c = mkCard(id);
    this.state.deck.push(c);
    return c;
  },

  removeCard(uid) {
    const deck = this.state.deck;
    const i = deck.findIndex(function (c) { return c.uid === uid; });
    return i < 0 ? null : deck.splice(i, 1)[0];
  },

  upgradeCardById(uid) {
    const c = this.state.deck.find(function (x) { return x.uid === uid; });
    return c ? upgradeCard(c) : false;
  },

  removeCardRandom() {
    if (!this.state.deck.length) return null;
    return this.removeCard(this.pick(this.state.deck).uid);
  },

  upgradeCardRandom() {
    const c = this.pick(this.upgradableCards());
    if (!c) return null;
    upgradeCard(c);
    return c;
  },

  upgradableCards() {
    return this.state.deck.filter(function (c) {
      return c.def.upV && !c.upgraded;
    });
  },

  // ---------- 遗物 ----------

  hasRelic(id) { return this.state.relics.indexOf(id) >= 0; },

  addRelic(id) {
    if (!RELICS[id] || this.hasRelic(id)) return false;
    this.state.relics.push(id);
    // M76 图鉴：拾取即计入（运行时探测，理由同 dlOf —— 老测试没加载 progress.js，
    // 直接引用会当场 ReferenceError）。只改内存，随下一个存档点落盘。
    if (typeof Progress !== 'undefined' && Progress.recordRelic) {
      try { Progress.recordRelic(id); } catch (e) { /* 记录失败不碰游戏链路 */ }
    }
    // 「皮质绑带」一家（gainMaxHp）：获得时一次性结算（raiseMaxHp 会连带回血）
    const g = RELICS[id].effect && RELICS[id].effect.gainMaxHp;
    if (g) this.raiseMaxHp(g);
    return true;
  },

  // 随机给一个还没拿到的遗物；全都有了返回 null
  grantRandomRelic() {
    const pool = relicPool().filter((id) => !this.hasRelic(id));
    const id = this.pick(pool);
    if (!id) return null;
    this.addRelic(id);
    return id;
  },

  // M68：大 Boss 战利品 —— 稀有卡三选一。
  // M68b（用户拍板）：**按 DL 解锁档限制**，不能靠 Boss 提前解锁高档稀有卡。
  // 抽取顺序 rare → uncommon → common，全部吃 dlCap；档位太浅凑不满三张时
  // 逐级兜底，保证永远是三选一（而不是一两张或空）。
  // ⚠️ 之前试过 maxDl=10 全档（保证「稀有」），被否 —— DL 锁是全游戏的
  //    成长节奏阀，Boss 只在「已解锁的池子里」给最好的那档。
  rollBossCardChoices(n) {
    const cap = this.dlCap();
    const out = this.rollCardIds(n, 'rare', cap);
    const topUp = (rarity) => {
      if (out.length >= n) return;
      this.rollCardIds(n * 2, rarity, cap).forEach((id) => {
        if (out.length < n && out.indexOf(id) < 0) out.push(id);
      });
    };
    topUp('uncommon');
    topUp('common');
    return out;
  },

  // M68：大 Boss 战利品 —— 稀有遗物三选一。
  // 优先指定稀有度；不够三件就用任意未拥有的补齐（不重复、不含已拥有）。
  // 全收集 → 返回空数组，上层折算金币（与宝箱 / 精英同一套兜底语言）。
  rollRelicChoices(n, rarity) {
    const owned = this.state.relics;
    const unowned = () => relicPool().filter((id) => owned.indexOf(id) < 0);
    const out = [];
    const take = (list) => {
      list = list.filter((id) => out.indexOf(id) < 0);
      while (out.length < n && list.length) {
        out.push(list.splice(this.int(0, list.length - 1), 1)[0]);
      }
    };
    take(unowned().filter((id) => (RELICS[id].rarity || 'common') === rarity));
    take(unowned());
    return out;
  },

  relicEffect(key) { return relicEffect(this.state.relics, key); },

  // ---------- 临时修正（事件给的，按层数过期）----------

  addMod(key, value, layers) {
    this.state.mods.push({
      key: key,
      value: value,
      until: this.current().depth + layers,
    });
  },

  // 只累加还没过期的
  modSum(key) {
    const d = this.current().depth;
    return this.state.mods
      .filter(function (m) { return m.key === key && m.until >= d; })
      .reduce(function (a, m) { return a + m.value; }, 0);
  },

  // ---------- 移动与结算 ----------

  // 只能走当前节点的出边；已结束的一局不能再动
  canMoveTo(id) {
    if (!this.state || this.state.finished) return false;
    return this.current().edges.indexOf(id) >= 0;
  },

  moveTo(id) {
    if (!this.canMoveTo(id)) return null;
    const s = this.state;
    s.prevId = s.currentId; // §13（M78）：记下从哪来 —— 攀绳要退回这里
    s.currentId = id;
    s.visited[id] = true;
    const n = this.node(id);

    // 「井壁碎片」：每深入 1 层，最大生命 +1
    const gain = this.relicEffect('descendMaxHp');
    if (gain) this.raiseMaxHp(gain);

    // 战斗节点在「进入时」定对手，存在节点上：重打同一节点还是同一只怪，
    // 而且它会随节点一起进存档（M7）。不存的话每次 startBattle 都要重抽，
    // 调试用的「重打」会换一只怪。
    // M50：定的是**整支编队**（encounter），enemyId 保留为主敌 ——
    // 奖励、地点标签、老存档的判空都以它为锚，一个字段没白加。
    if (!n.enemyId && (n.type === 'monster' || n.type === 'elite' || n.type === 'boss')) {
      n.encounter = this.rollEncounter(n);
      n.enemyId = n.encounter.enemyIds[0];
    }

    return { id: id, type: n.type, depth: n.depth, enemyId: n.enemyId || null };
  },

  // 本场打谁：Boss 层用地图写死的名单（§6），其余从**本关段**的池子里抽一只。
  // M50 起它只回答「编队里的第一只（主敌）是谁」，完整编队见 rollEncounter。
  // 保留这个函数：① m5 的老断言直接调它（40 张图 × 全部节点）；
  // ② 「这一层的主敌是谁」仍然是个有意义的问题（奖励金币、地点标签都用它）。
  rollEnemyId(node) {
    if (node.type === 'boss') return node.bossId;
    const act = ACTS[this.state.actId];
    const seg = actSegment(this.state.actId, node.depth);
    const pool = node.type === 'elite'
      ? (seg ? seg.elitePool : act.elitePool)
      : (seg ? seg.enemyPool : act.enemyPool);
    return this.pick(pool) || 'rats';
  },

  // 按权重抽一个「只数」：counts = [[只数, 权重], …]（acts.js 的 segments 给）。
  // 与 rollCardIds 里的权重抽法同一套写法 —— 只抽一次，够用就不抽象。
  weightedCount(counts) {
    let total = 0;
    counts.forEach(function (c) { total += c[1]; });
    let r = this.rand() * total;
    for (let i = 0; i < counts.length; i++) {
      r -= counts[i][1];
      if (r < 0) return counts[i][0];
    }
    return counts[counts.length - 1][0];
  },

  // 词缀池（M50）。与上面的 dlOf 同一套理由：M3–M6 的测试按需加载文件，
  // FILES 清单里没有 enemies.js（它们只测地图 / 流程，不碰战斗数据），
  // 顶层直接引用 AFFIX_IDS 会让那些测试当场 ReferenceError。
  // 拿不到就当「没有词缀池」—— 编队照常生成，只是不带加持，不是错误。
  // M80：bossOnly 的形态词条不进普通 / 中 Boss 的池子。
  affixPool() {
    if (typeof AFFIXES !== 'undefined' && AFFIXES) {
      return Object.keys(AFFIXES).filter(function (k) { return !AFFIXES[k].bossOnly; });
    }
    return (typeof AFFIX_IDS !== 'undefined' && AFFIX_IDS) ? AFFIX_IDS : [];
  },

  // M80 / R5：Boss 专属词条池（DL5+ 的大 Boss 从这里抽）
  bossAffixPool() {
    if (typeof AFFIXES !== 'undefined' && AFFIXES) {
      return Object.keys(AFFIXES).filter(function (k) { return AFFIXES[k].bossOnly; });
    }
    return [];
  },

  pickAffixes(n) {
    const pool = this.affixPool();
    return pool.length ? this.pickMany(pool, n) : [];
  },

  // M50：一场战斗的完整编队。只在地图节点「进入时」算一次、写在节点上 ——
  // 节点随存档一起走，所以重进同一节点看到的是同一批敌人（§17 第 26 条的延伸）。
  //
  // 写回的字段（索引与 enemyIds 对齐）：
  //   enemyHpMul  这一只的血量倍率 = 多敌分摊（Boss 恒 1）
  //   enemyVariant 变体 id（'elite' 只属于中 Boss；
  //                普通敌人永远 null —— M56b 起 buff 特殊形态是中 Boss 的专属）
  //   enemyAffixes 词缀 id 数组（普通敌人永远空；中 Boss 恒挂 eliteAffixCount 个）
  //
  // M62：Boss 层恒单只 —— 用户定的规则，大 Boss 不再带僚机，
  // 复数编队只发生在普通小怪层。
  // M62b：大 Boss 恒原版 —— 强化版（变体 + 词缀 + 血量倍率）整体退役，
  // Boss 难度走正常曲线，只靠关段本身的基础数值成长。
  // 规则全部读 acts.js 的 segments —— 这里不写死任何一个数字或名单，
  // 将来加 Act 2 只要补一段 segments。
  rollEncounter(node) {
    const act = ACTS[this.state.actId];
    const seg = actSegment(this.state.actId, node.depth) || act.segments[0];
    const enc = { enemyIds: [], enemyHpMul: [], enemyVariant: [], enemyAffixes: [] };

    // ---------- 大 Boss 层 ----------
    if (node.type === 'boss') {
      enc.enemyIds.push(node.bossId);
      enc.enemyVariant.push(null);
      // M80 / R5：DL5+ 的 Boss 带一枚形态词条 —— 同一台机器在高难复打时
      // 有不同的打开方式（词条随编队写回节点，重打同节点词条不变）
      let bossAf = [];
      if (this.curDl() >= 5) {
        const pool = this.bossAffixPool();
        if (pool.length) bossAf = [this.pick(pool)];
      }
      enc.enemyAffixes.push(bossAf);
      enc.enemyHpMul.push(1);
      return enc;
    }

    // ---------- 小怪 / 中 Boss ----------
    // 中 Boss 恒单只：用户要的「复数组合」说的是普通敌人；
    // 两只中 Boss 同场在 D22 就是 500+ 血的墙，没有打法上的新意，只有血量的堆积。
    if (node.type === 'elite') {
      const eliteId = this.pick(seg.elitePool) || 'warlord';
      enc.enemyIds.push(eliteId);
      enc.enemyHpMul.push(1);
      // M67：词缀 buff 不再是中 Boss 的标配 —— **每个小关（关段）只有本段
      // 第一只中 Boss 带词缀**（红气场圈换词缀色 + 词缀牌 = 它与原版中 Boss
      // 的区分图标）；本段后续的中 Boss 恒原版（仍是精锐形态，无词缀）。
      // 判定读地图上已写回编队的节点：随存档一起走、不用另立旗子；
      // 进入守卫（!n.enemyId）保证同一节点不会重抽，「第一只」不会被冲掉。
      // 精锐变体本身不变 —— 那是中 Boss 的基础身份（M56b），不是 buff。
      const alreadyBuffed = (this.state.map ? this.state.map.layers : []).some(
        (layer) => layer.some((n) => {
          if (n === node || n.type !== 'elite') return false;
          // ⚠️ 编队写回在 n.encounter（enterNode 同款），不在 n.enemyAffixes
          const af = n.encounter && n.encounter.enemyAffixes && n.encounter.enemyAffixes[0];
          if (!af || !af.length) return false;   // 本段已写回的中 Boss 里没有带词缀的
          const s2 = actSegment(this.state.actId, n.depth);
          return !!s2 && !!seg && s2.id === seg.id;
        })
      );
      enc.enemyVariant.push('elite');
      enc.enemyAffixes.push(alreadyBuffed ? [] : this.pickAffixes(seg.eliteAffixCount || 1));
      return enc;
    }
    const pool = seg.enemyPool;
    const want = this.weightedCount(seg.counts);
    // pickMany 不重复 —— 组合是「不同种类凑一场」，不是「同一种来三份」。
    // 重复同类只会让名字后缀变多，打法上与一只没差别。
    const ids = this.pickMany(pool, want);
    const n = ids.length;
    // 多敌分摊：池子的 HP 按单挑标定，两只同场就是双倍血 —— 必须摊回去。
    const share = seg.hpShare[n] || 1;

    ids.forEach((id) => {
      enc.enemyIds.push(id);
      enc.enemyHpMul.push(share);
      // M56：进化体在 acts.js 的段池子里直接挂 id，「谁进化成谁是设计定的」，
      // 不再有「壮大版」随机变体 —— 变体轴永远 null。
      // M56b：词缀也从普通敌人退役 —— 普通场不加料，按正常数值成长。
      enc.enemyVariant.push(null);
      enc.enemyAffixes.push([]);
    });
    return enc;
  },

  // 节点的编队。老存档（M50 之前）的节点上没有 encounter 字段 ——
  // 就地退化成一个「单只、无变体」的编队，而不是让 UI 拿着 undefined 崩掉。
  encounterOf(node) {
    if (node && node.encounter) return node.encounter;
    const id = (node && node.enemyId) || 'rats';
    return { enemyIds: [id], enemyHpMul: [1], enemyVariant: [null], enemyAffixes: [[]] };
  },

  // 同局同节点可复现的战斗种子（战斗自己会再 RNG.init 一次）
  battleSeed(id) {
    const n = this.node(id);
    return (this.state.seed * 31 + n.depth * 1009 + n.lane * 97 + 7) >>> 0;
  },

  // result: 'win' | 'done' | 'skip' | 'lose'；hp 只有战斗结算才传
  settle(result, hp) {
    const s = this.state;
    const n = this.current();
    s.cleared[n.id] = result;
    s.shop = null;

    // 血量先写回 —— 失败时也必须写。否则 run.hp 停在战前的值，
    // 上层用「hp > 0」区分通关与失败就会判反（M3 的 showMap 正是这么判的）。
    if (typeof hp === 'number') s.hp = hp;

    if (result === 'lose') { s.finished = true; return; }
    if (result === 'win') s.battles++;
    if (n.depth === s.map.depth) s.finished = true; // 走到末层 = 本大关结束
    // 每日挑战（M60）：走到末层且赢了末战 = 今日通关。Progress 是可选依赖
    //（与 dlOf 同一套运行时探测），记录失败不能影响本局收尾。
    if (s.finished && s.daily && typeof Progress !== 'undefined' &&
        Progress.recordDailyWin) {
      try { Progress.recordDailyWin(s.daily.date); } catch (e) { /* 存储满/坏：忽略 */ }
    }
  },

  hpPct() {
    return Math.max(0, (this.state.hp / this.state.maxHp) * 100);
  },

  // ---------- 事件 ----------

  // 抽一个本局还没出现过的事件；池子耗尽就允许重复（§10 同局不重复）
  // §3.1 第 2 条（M31）：DL7 起「事件惩罚选项占比提升」。
  //
  // ⚠️ 最初实现成「把代价型选项排到最前」，实测对**全部 8 个事件都是恒等操作**
  //    —— 作者的叙事习惯就是把代价型写在第 0 位（先给最刺激的那条），
  //    所以排序等于没做，DL7 的事件跟 DL1 一模一样。见 tests/m7 的自曝断言。
  //
  // 现实现：DL7 起从**含代价型选项**的事件里削掉 1 条非代价型选项：
  //    ① 优先削零代价安全项（「无事发生 / 离开 / 不管」）—— 最干净，玩家只剩两种代价可选；
  //    ② 没有零代价项时，削**收益最低**的那条非代价型选项（如 duty_log 的 +8 生命、
  //       mycelium 的 +70 金币）—— 否则这两条事件在 DL7 下毫无变化，等级白升。
  //    不含代价型选项的事件（carving 这种纯安全事件）**不动手**：
  //    削它不叫「惩罚占比提升」，只是平白削弱。保底至少留 2 条。
  rollEvent() {
    const all = Object.keys(EVENTS);
    const fresh = all.filter((id) => !this.state.eventsUsed[id]);
    const id = this.pick(fresh.length ? fresh : all);
    this.state.eventsUsed[id] = true;
    const ev = EVENTS[id];
    if (this.curDl() < 7) return ev;

    // 代价型排到最前（作者的排法多半已经如此，此步是稳妥的归一化）
    let opts = ev.options.filter(function (o) { return o.risky; })
      .concat(ev.options.filter(function (o) { return !o.risky; }));

    // 只对「含代价型选项」的事件动手；削完至少留 2 条
    if (opts.length > 2 && ev.options.some(function (o) { return o.risky; })) {
      let cutAt = -1;
      // ① 零代价安全项：从后往前找，优先削垫底的「无事发生」类
      for (let i = opts.length - 1; i >= 0; i--) {
        if (!opts[i].risky && isFreeSafe(opts[i])) { cutAt = i; break; }
      }
      // ② 退而求其次：最靠后的非代价型选项（作者把收益最低的垫在最后）
      if (cutAt < 0) {
        for (let i = opts.length - 1; i >= 1; i--) {
          if (!opts[i].risky) { cutAt = i; break; }
        }
      }
      if (cutAt > 0) opts = opts.slice(0, cutAt).concat(opts.slice(cutAt + 1));
    }
    return Object.assign({}, ev, { options: opts });
  },

  // 事件脚本唯一能改本局状态的通道 —— 和战斗的 ctx() 一个思路。
  // 刻意放在 core 而不是 UI：事件逻辑必须能在 Node 里无 DOM 跑测试，
  // 也要防止脚本随手调 Run.start() 把整局重开。
  eventCtx() {
    const self = this;
    return {
      heal: (n) => self.heal(n),
      loseHp: (n) => self.loseHp(n),
      lowerMaxHp: (n) => self.lowerMaxHp(n),
      raiseMaxHp: (n) => self.raiseMaxHp(n), // M79：事件链「替它值一班」要用
      depth: () => self.current().depth,     // M79：叙事文案里报深度用（只读）
      addGold: (n) => self.addGold(n),
      spendGold: (n) => self.spendGold(n),
      addCard: (id) => self.addCard(id),
      addRelic: (id) => self.addRelic(id),
      removeCardRandom: () => self.removeCardRandom(),
      upgradeCardRandom: () => self.upgradeCardRandom(),
      upgradableCount: () => self.upgradableCards().length,
      deckSize: () => self.deckSize(),
      pickOneCard: (rarity) => self.pickOneCard(rarity),
      chance: (p) => self.chance(p),
      addMod: (k, v, layers) => self.addMod(k, v, layers),
    };
  },

  // ---------- 商店 ----------

  cardPrice(cardId) {
    const range = CARD_PRICE[CARDS[cardId].rarity] || CARD_PRICE.common;
    return this.int(range[0], range[1]);
  },

  removePrice() {
    return REMOVE_BASE + REMOVE_STEP * this.state.removedCount;
  },

  // ---------- 药水（M78 · §11）----------

  POTION_MAX: 3,

  // 返回 true = 装进去了；槽满或未知 id = false（上层给金币折算或不给）
  addPotion(id) {
    // 运行时探测（与 SfxProfile 同款理由）：M1–M8 的逻辑测试沙箱只装 core，
    // 没有数据层也要能跑商店与宝箱
    if (typeof POTIONS === 'undefined' || !POTIONS[id]) return false;
    const p = this.state.potions || (this.state.potions = []);
    if (p.length >= this.POTION_MAX) return false;
    p.push(id); // 同名药水允许共存（两瓶止血敷料是合法的）
    // 药水图鉴（M85 / G1）：获得即点亮 —— 与遗物同口径
    if (typeof Progress !== 'undefined' && Progress.recordPotion) {
      try { Progress.recordPotion(id); } catch (e) { /* 记录失败不碰游戏链路 */ }
    }
    return true;
  },

  // 战斗中喝掉 / 其他消耗。返回被喝掉的药水 id，索引非法返回 null
  removePotion(idx) {
    const p = this.state.potions || [];
    if (idx < 0 || idx >= p.length) return null;
    return p.splice(idx, 1)[0];
  },

  potionSpace() {
    return this.POTION_MAX - ((this.state.potions || []).length);
  },

  // ---------- 攀绳（M78 · §13）----------

  // 剩余次数：基础 1 次，「断绳」遗物 +1（§12）
  ropeLeft() {
    return (1 + this.relicEffect('backrope')) - (this.state.ropeUsed || 0);
  },

  canClimb() {
    const s = this.state;
    if (!s || s.finished) return false;
    if (this.ropeLeft() <= 0 || !s.prevId) return false;
    // Boss 闸门两侧不许攀：闸门后的层段是 DL 推进的奖励，
    // 攀回去再重打一次 Boss 等于刷刻痕 —— 直接封死
    const cur = this.node(s.currentId);
    const prev = this.node(s.prevId);
    if (cur && cur.type === 'boss') return false;
    if (prev && prev.type === 'boss') return false;
    return true;
  },

  // 退回上一层：当前节点作废（可重新选择分支），代价最大生命 −10
  climbUp() {
    if (!this.canClimb()) return false;
    const s = this.state;
    delete s.visited[s.currentId];
    delete s.cleared[s.currentId];
    // 节点上进入时抽的编队保留 —— 重走同一节点还是同一只怪（与「重打」同约定）
    s.currentId = s.prevId;
    s.prevId = null; // 攀回的节点没有「上一层」—— 不允许连环攀
    s.ropeUsed = (s.ropeUsed || 0) + 1;
    // 攀绳成就数据源（M85 / G3）
    if (typeof Progress !== 'undefined' && Progress.recordClimb) {
      try { Progress.recordClimb(); } catch (e) { /* 记录失败不碰游戏链路 */ }
    }
    this.lowerMaxHp(10); // §13 代价：最大生命 −10，当前生命跟着收
    return true;
  },

  // 进入商店时调一次，生成后存在 state.shop 里 —— 每次点击都重绘，
  // 货品不能重绘一次就重抽一次
  rollShop() {
    const owned = this.state.relics;
    // 「粉笔标记」一家（shopDiscount）：进店时一次性折算进货价。
    // 只折「物品」（卡 + 遗物），删牌是服务不折；两件折扣遗物叠带上限 50%。
    const discount = Math.min(0.5, this.relicEffect('shopDiscount'));
    const priced = (n) => Math.max(1, Math.round(n * (1 - discount)));
    const shop = {
      cards: this.rollCardIds(3, null, this.dlCap()).map((id) => ({
        id: id, price: priced(this.cardPrice(id)), sold: false,
      })),
      relics: this.pickMany(
        relicPool().filter((id) => owned.indexOf(id) < 0), 2
      ).map((id) => ({
        id: id, price: priced(this.int(RELIC_PRICE[0], RELIC_PRICE[1])), sold: false,
      })),
      // §11（M78）：货架常备 1 瓶药水 —— 药水算「物品」，吃 shopDiscount 折扣。
      // 数据层缺失（老测试沙箱）时退化为空货架
      potions: (typeof potionPool === 'function'
        ? this.pickMany(potionPool(), 1) : []).map((id) => ({
        id: id, price: priced(POTIONS[id].price), sold: false,
      })),
      removePrice: this.removePrice(),
      removeUsed: false,
    };
    this.state.shop = shop;
    return shop;
  },

  // ---------- 战斗奖励与宝箱 ----------

  // 击杀金币直接入账，返回 3 张候选卡等玩家挑。
  // 中 Boss 额外必掉 1 件遗物（§9.2）—— 遗物拿满时 relicId 为 null，
  // 那种情况折成金币补偿，不能让「必掉」变成「什么都不掉」。
  rollBattleReward(node) {
    const def = ENEMIES[node && node.enemyId] || ENEMIES.rats;
    const g = def.gold || [10, 20];
    // 「老油灯」一家（winGold）：胜利加钱，并进击杀金币一起入账与展示
    // M60：每日修饰「富金矿脉」在这一个出口乘 —— 只乘战斗金币，
    // 事件的固定赏金不掺（那是剧本数值，不该被今天的词改写）。
    let gold = Math.round((this.int(g[0], g[1]) + this.relicEffect('winGold')) *
      dailyMulOf(this.state, 'goldMul'));
    this.addGold(gold);
    // 「火漆印」一家（winHeal）：胜利回血
    const wh = this.relicEffect('winHeal');
    if (wh) this.heal(wh);

    const out = { gold: gold, cards: this.rollCardIds(3, null, this.dlCap()), relicId: null, bonusGold: 0 };
    if (def.kind === 'elite') {
      out.relicId = this.grantRandomRelic();
      if (!out.relicId) {
        out.bonusGold = 120;
        this.addGold(out.bonusGold);
      }
    }
    // M68：大 Boss 战利品 —— 稀有卡三选一 + 稀有遗物三选一（面板分两段领）。
    // 普通怪物 / 中 Boss 的发奖逻辑不变；金币照发。
    if (node && node.type === 'boss') {
      out.boss = true;
      out.cards = this.rollBossCardChoices(3);
      out.relicChoices = this.rollRelicChoices(3, 'rare');
      if (!out.relicChoices.length) {   // 遗物全收集 → 折算金币
        out.bonusGold = 150;
        this.addGold(out.bonusGold);
      }
    }
    return out;
  },

  // §5.2：宝箱给免费遗物；遗物全拿到了就换成药水/金币（§11 M78：25% 先掉药水）
  openChest() {
    // 药水未满才掉 —— 满槽时掉药水等于没收，直接跳过这档（数据层缺失也跳过）
    if (this.potionSpace() > 0 && typeof potionPool === 'function' && this.chance(0.25)) {
      const pid = this.pick(potionPool());
      this.addPotion(pid);
      return { kind: 'potion', potionId: pid };
    }
    const id = this.grantRandomRelic();
    if (id) return { kind: 'relic', relicId: id };
    this.addGold(150);
    return { kind: 'gold', gold: 150 };
  },

  // §5.2：休息点回血 30%
  // §3.1 第 3 条（M31 补齐）：DL9 起回血 −25%（30% → 22.5%，取整到 23%）。
  // 只削「休息点回血」，不吃 heal 药水 / 卡牌的回复 —— 那两处走 Combat.heal，
  // 不经过这里。休息点是 DL9 玩家最主要的续航来源，削它最见效果。
  restHealAmount() {
    const pct = this.curDl() >= 9 ? 0.23 : 0.3;
    // M60：每日修饰「温热灰烬」乘在这里 —— 只乘休息点，与 DL9 的削减相乘共存
    return Math.ceil(this.state.maxHp * pct * dailyMulOf(this.state, 'restMul'));
  },

  // ---------- 战报（M81 / R6）----------

  // 纯函数：把当前局折成一段可分享的纯文本战报。
  // UI 层（App.copyResult）负责剪贴板；这里负责内容，逻辑测试可无头验证。
  resultText() {
    const s = this.state;
    if (!s) return '';
    const won = s.hp > 0;
    const name = characterOf(s.charId).name;
    let daily = '';
    if (s.daily && DAILY_MODS[s.daily.modKey]) {
      daily = ' · 每日挑战 ' + s.daily.date + '「' + DAILY_MODS[s.daily.modKey].name + '」';
    }
    return [
      '《竖井》下潜战报',
      name + ' · DL' + (s.dl || 1) + ' · ' + s.map.actName + ' D' + s.map.depth +
        (won ? ' · 到底' : ' · 陨落') + daily,
      '战斗 ' + s.battles + ' 场 · 血 ' + Math.max(0, s.hp) + '/' + s.maxHp + ' · 金 ' + s.gold +
        ' · seed ' + s.seed,
      won ? '火种室是空的，但人到了。' : '井底的风一直往上吹 —— 下一次，更深一点。',
      'https://tower-descend-game-60674.app.workbuddy.host/',
    ].join('\n');
  },

  // ---------- 存档（M7）----------

  // 快照必须是**纯数据**：卡对象里的 `def` 是对 CARDS 的引用，而 `def.play` 是函数 ——
  // JSON.stringify 会把函数整个丢掉。直接存 deck 的话，读回来是一堆"有名字但打不出去"
  // 的牌。所以卡只存 {id, upgraded, v}，读档时用 mkCard 重建。
  //
  // map 整张存，不从 seed 重新生成：节点上挂着**进入时抽的** enemyId（§17 第 26 条），
  // 重新生成会把它丢掉，重打同一节点就换怪了。
  toSnapshot() {
    const s = this.state;
    if (!s) return null;
    return {
      actId: s.actId,
      seed: s.seed,
      charId: s.charId,
      dl: s.dl || 0, // 0 = 老结构没有该字段，读档时退回角色刻痕
      map: s.map,
      currentId: s.currentId,
      visited: s.visited,
      cleared: s.cleared,
      hp: s.hp,
      maxHp: s.maxHp,
      gold: s.gold,
      deck: s.deck.map(function (c) {
        return { id: c.def.id, upgraded: !!c.upgraded, v: Object.assign({}, c.v) };
      }),
      relics: s.relics.slice(),
      mods: s.mods.map(function (m) { return Object.assign({}, m); }),
      eventsUsed: Object.assign({}, s.eventsUsed),
      removedCount: s.removedCount,
      potions: (s.potions || []).slice(),
      prevId: s.prevId || null,
      ropeUsed: s.ropeUsed || 0,
      shop: s.shop,
      battles: s.battles,
      rngCount: s.rngCount,
      finished: s.finished,
    };
  },

  // 把快照装回 state。返回 true = 可用；缺关键字段 / 卡 id 已不存在 → false，
  // 上层当「没有存档」处理（宁可开新局，也不要装出一个半坏的状态）。
  fromSnapshot(snap) {
    if (!snap || !snap.map || !snap.currentId || !snap.charId) return false;
    if (!snap.map.nodes || !snap.map.nodes[snap.currentId]) return false;

    const deck = [];
    const saved = snap.deck || [];
    for (let i = 0; i < saved.length; i++) {
      let c;
      try {
        c = mkCard(saved[i].id); // 卡被改名 / 删掉 → 整档作废
      } catch (e) {
        return false;
      }
      if (saved[i].v) c.v = Object.assign({}, saved[i].v);
      c.upgraded = !!saved[i].upgraded;
      deck.push(c);
    }

    this.state = {
      actId: snap.actId,
      seed: snap.seed,
      charId: snap.charId,
      dl: snap.dl || 0,
      map: snap.map,
      currentId: snap.currentId,
      visited: snap.visited || {},
      cleared: snap.cleared || {},
      hp: snap.hp,
      maxHp: snap.maxHp,
      gold: snap.gold,
      deck: deck,
      relics: (snap.relics || []).slice(),
      mods: (snap.mods || []).map(function (m) { return Object.assign({}, m); }),
      eventsUsed: snap.eventsUsed || {},
      removedCount: snap.removedCount || 0,
      potions: (snap.potions || []).slice(), // M78：旧档没有药水，就地补空
      prevId: snap.prevId || null,
      ropeUsed: snap.ropeUsed || 0,
      shop: snap.shop || null,
      battles: snap.battles || 0,
      rngCount: snap.rngCount || 0,
      finished: !!snap.finished,
    };
    return true;
  },
};
