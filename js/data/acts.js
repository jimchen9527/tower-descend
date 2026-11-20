// 大关配置 —— 全部写死，随机只发生在排列顺序与路径分支上（设计文档 §4）
//
// M3 只启用 Act 1。Act 2「菌床层」/ Act 3「熔核层」的 Boss 名单与敌人池
// 属于 M5/M6 的内容，这里不预留空壳，等做到那一版再加。
// 生成逻辑按配置驱动（depth / bossDepths 都从这读），所以扩展只改数据、
// 不动逻辑 —— 但层数一变，Act 2 / Act 3 原稿的 15 / 17 层就得重定：
// Act 1 现在是 33 层，比它俩都长，照原稿填会出现「越玩越短」。

const NODE_TYPES = {
  entry:   { id: 'entry',   label: '入口',      icon: '入' },
  monster: { id: 'monster', label: '小怪',      icon: '怪' },
  elite:   { id: 'elite',   label: '中 Boss',   icon: '中' },
  boss:    { id: 'boss',    label: '大 Boss',   icon: '王' },
  event:   { id: 'event',   label: '随机事件',  icon: '事' },
  shop:    { id: 'shop',    label: '商店',      icon: '商' },
  rest:    { id: 'rest',    label: '休息点',    icon: '火' },
  chest:   { id: 'chest',   label: '宝箱',      icon: '箱' },
};

const ACTS = {
  act1: {
    id: 'act1',
    name: '废墟层',
    // 33 层 = 每段 11 层（入口 → Boss① → Boss② → Boss③），三段等长。
    // 2026-09-23 由 21 层改到 33：21 层时第一场 Boss 前只有 6 个节点的成长，
    // 而三场 Boss 血量是固定值（不叠深压）—— 成长不够，Boss 算不赢。
    depth: 33,
    bossDepths: [11, 22, 33], // §5.3 第 6 条：Boss 层路径全汇聚

    // §6：名单固定，顺序即难度升序 —— 深度越深，Boss 越强
    bosses: [
      { id: 'rust_crown',        name: '锈冠',       tier: 1 },
      { id: 'mycelium_mother',   name: '菌母',       tier: 2 },
      { id: 'headless_executor', name: '无首执械者', tier: 3 },
    ],

    // 节点类型权重（§5.3 第 5 条）。战斗类合计 60，保证地图不荒凉。
    weights: { monster: 52, event: 16, elite: 8, shop: 6, rest: 9, chest: 9 },

    // §5.3 第 8 条：这些层休息点权重 ×3（不强制，保留变化）
    // 取「Boss 层 −1」：D10 / D21 是 D11 / D22 两场 Boss 前的补给层。
    restBoostDepths: [10, 21],

    // M5 起敌人池完整。M50 起这两行是**全集**（= 各关段池子的并集），
    // M56 起全集再纳入 12 只进化体（evolvedFrom 系）：
    //   ① 老测试与老调用点按「抽到的 id 一定在这一行里」写断言，破坏它没有收益；
    //   ② 「这一关全部可能出现的敌人」本身也是个有意义的问题，留着比删掉好。
    // 写成字面量而不是引用 enemies.js 的常量 —— acts.js 在 index.html 里
    // 先于 enemies.js 求值，引用会拿到 undefined。
    enemyPool: ['rats', 'sentinel', 'spore_walker', 'crawler', 'scavenger_shade',
                'arc_welder', 'pile_driver', 'husk_lancer', 'cord_creeper',
                'rat_king', 'sentinel_breach', 'spore_gravid', 'crawler_molt', 'shade_gatherer',
                'rat_tide', 'sentinel_siege', 'spore_mother', 'crawler_maul', 'shade_patch',
                'welder_overload', 'piledriver_breach'],
    elitePool: ['warlord', 'hound', 'bonewright', 'centurion', 'stitch_tyrant'],

    // ==================== M50：分关段（§9.4）====================
    //
    // 「关」= 33 层里被 bossDepths 切出的三段（D1–11 / D12–22 / D23–33），
    // 不是新的大关 —— Act 2/3 是另一件事（要各自的层数、地图与美术）。
    // 每一段有自己的敌人池、编队规则与强化规则，于是「越往下走越不一样」
    // 不只是数值变大，而是**出现的对手换了一批**。
    //
    // 字段说明：
    //   counts       编队只数的权重表 [[只数, 权重], ...]，用于「普通敌人复数组合」
    //   hpShare      多敌时的血量分摊（只数 → 每只的 HP 倍率）。
    //                ⚠️ 必须分摊：池子的 HP 是按「单挑」标定的，
    //                两只锈蚀哨兵原血同场 = 双倍血，第三关三只就是三倍 ——
    //                那不是「更热闹」，是单纯的伤害检验。
    //   enemyPool    本关小怪池（M56 起直接挂进化体 id —— 谁进化成谁是设计定的）
    //   eliteAffixCount 中 Boss 恒挂的词缀数（M56b：词缀从普通敌人退役，
    //                   只属于中 Boss 的「精锐」特殊形态 —— 第一关起就有 1 个，
    //                   第三关加到 2 个）
    //                （M62b 起大 Boss 恒原版：强化版概率 / 词缀数 / 血量倍率
    //                  的 bossAffix 三件套整体退役，Boss 走正常难度曲线）
    segments: [
      {
        id: 1, name: '第一关 · 井口残骸', from: 1, to: 11,
        enemyPool: ['rats', 'sentinel', 'spore_walker', 'crawler', 'scavenger_shade'],
        elitePool: ['warlord', 'hound', 'bonewright'],
        counts: [[1, 70], [2, 30]],
        hpShare: { 2: 0.72, 3: 0.55 },
        eliteAffixCount: 1,
      },
      {
        id: 2, name: '第二关 · 锈蚀遗迹', from: 12, to: 22,
        // M56：第一关五怪在这里以**二阶进化体**登场（原五怪不再出现）——
        // 池子直接挂进化体 id，谁进化成谁是设计稿定死的，不靠随机。
        // 电弧焊工 / 桩击机本关原样示人，第三关才出进化体。
        enemyPool: ['rat_king', 'sentinel_breach', 'spore_gravid', 'crawler_molt', 'shade_gatherer',
                    'arc_welder', 'pile_driver'],
        elitePool: ['warlord', 'hound', 'bonewright', 'centurion'],
        // M56c 编队规则（用户定）：第二关复数普通敌人**最多 2 只**，
        // 第三关才放开到 3 只 —— 复数压力按关段逐级抬升。
        // 原 [3,15] 档撤掉，权重并回 2 只档（复数仍是第二关的常客）。
        counts: [[1, 45], [2, 55]],
        hpShare: { 2: 0.72, 3: 0.55 },
        eliteAffixCount: 1,
      },
      {
        id: 3, name: '第三关 · 菌丝研究所', from: 23, to: 33,
        // M56：一关五怪 → 三阶进化体；二关两怪 → 各自进化体；
        // 三关专属的菌壳矛兵 / 菌索爬行体原样。
        enemyPool: ['rat_tide', 'sentinel_siege', 'spore_mother', 'crawler_maul', 'shade_patch',
                    'welder_overload', 'piledriver_breach', 'husk_lancer', 'cord_creeper'],
        elitePool: ['warlord', 'hound', 'bonewright', 'centurion', 'stitch_tyrant'],
        counts: [[1, 25], [2, 45], [3, 30]],
        hpShare: { 2: 0.72, 3: 0.55 },
        eliteAffixCount: 2,
      },
    ],
  },
};

// 深度 → 所在关段。取不到 act（理论上不会）时退回第一段，不抛错 ——
// 抽怪链路上抛错会把整局打断，而这是一个「查表」而不是「校验」的场合。
function actSegment(actId, depth) {
  const act = ACTS[actId];
  if (!act || !act.segments) return null;
  const d = Math.max(1, depth || 1);
  for (let i = 0; i < act.segments.length; i++) {
    const s = act.segments[i];
    if (d >= s.from && d <= s.to) return s;
  }
  return act.segments[d < act.segments[0].from ? 0 : act.segments.length - 1];
}
