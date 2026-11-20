// M50 验证：分关敌人池、复数编队、强化壮大版、随机词缀。
// 只加载逻辑层，不加载任何 render-*.js —— 编队与强化是纯数值/机制。
//
// 这一层验的是「规则」而不是「画面」：
//   · 第一关必须还是旧版那 5 只普通怪（无变体、无词缀、Boss 不强化）
//   · 第二关起出现新敌人与壮大版，第三关出现专属普通怪
//   · 每关都可能出现复数组合，且多敌时血量要分摊
//   · 词缀（生命强化 / 暴戾 / 铁甲 / 荆棘 …）在意图与实际结算里都真的生效
//   · M62/M62b：Boss 层恒单只且恒原版（僚机与强化版均已退役）
// 形象与徽章由 art.js / render.js 负责，另由 ui-probe-art.js 验证。
//
// 运行：node tests/m8-encounters.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

// suite 会被序列化后丢进沙箱执行，所以常量必须挂在 sandbox 上，不能用文件作用域的 const。
const sandbox = { console: console, SEEDS: 120 };
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

  // 开一场战斗。玩家血量给足，避免测试中途被打死干扰断言。
  function fight(opts) {
    return Combat.start(opts.seed === undefined ? 1 : opts.seed, {
      enemies: opts.enemies,
      depth: opts.depth === undefined ? 1 : opts.depth,
      hp: opts.hp === undefined ? 300 : opts.hp,
      maxHp: opts.maxHp === undefined ? 300 : opts.maxHp,
    });
  }

  const S = () => Combat.state;
  const E0 = () => Combat.state.enemies[0];

  // 遍历 SEEDS 张图，把每个战斗节点的编队交给回调统计。
  // 走 run.js 的真函数（不是另写一份抽样），所以测的是产品代码本身。
  function scan(fn) {
    for (let s = 1; s <= SEEDS; s++) {
      Run.start('act1', s * 1013 + 17);
      Run.state.map.layers.forEach(function (layer) {
        layer.forEach(function (n) {
          if (n.type !== 'monster' && n.type !== 'elite' && n.type !== 'boss') return;
          fn(n, Run.rollEncounter(n));
        });
      });
    }
  }

  // ==========================================================
  console.log('\n[1] 关段切分：33 层按 bossDepths 切三段');
  const act = ACTS.act1;
  assert(act.segments.length === 3, '大关配了 3 个关段');
  assert(actSegment('act1', 1).id === 1 && actSegment('act1', 11).id === 1,
    'D1–11 是第一关');
  assert(actSegment('act1', 12).id === 2 && actSegment('act1', 22).id === 2,
    'D12–22 是第二关（边界与 bossDepths 对齐）');
  assert(actSegment('act1', 23).id === 3 && actSegment('act1', 33).id === 3,
    'D23–33 是第三关');
  assert(actSegment('act1', 999).id === 3, '超出末层取最后一段（不抛错）');
  assert(actSegment('nope', 5) === null, '不认识的大关返回 null（不抛错）');

  const seg1 = act.segments[0], seg2 = act.segments[1], seg3 = act.segments[2];
  const OLD = ['rats', 'sentinel', 'spore_walker', 'crawler', 'scavenger_shade'];
  assert(seg1.enemyPool.length === 5 && OLD.every((id) => seg1.enemyPool.indexOf(id) >= 0),
    '第一关池子 = 旧版那 5 只，一只不多一只不少');
  assert(seg2.enemyPool.length === 7, '第二关池子 = 二阶进化 5 只 + 本关新 2 只');
  assert(seg3.enemyPool.length === 9, '第三关池子 = 三阶进化 5 只 + 二关进化 2 只 + 三关专属 2 只');
  assert(seg2.elitePool.length === 4 && seg3.elitePool.length === 5,
    '中 Boss 池逐关扩大（各自关段专属中 Boss 逐个加入）');
  assert(seg1.affixChance === undefined && seg2.affixChance === undefined &&
      seg3.affixChance === undefined,
    'affixChance 已从所有关段移除（M56b：普通敌人不挂词缀）');
  assert(seg1.eliteAffixCount === 1 && seg2.eliteAffixCount === 1 && seg3.eliteAffixCount === 2,
    '中 Boss 恒挂词缀数：一、二关 1 个，第三关 2 个（第三关略强）');
  // M62b：大 Boss 强化版退役 —— bossAffix 三件套已从所有关段移除
  assert(seg1.bossAffix === undefined && seg2.bossAffix === undefined &&
      seg3.bossAffix === undefined && seg1.bossHpMul === undefined &&
      seg2.bossHpMul === undefined && seg3.bossHpMul === undefined,
    'bossAffix / bossHpMul 已从所有关段移除（M62b：大 Boss 恒原版）');
  // M56：壮大版退役 —— 任何关段都不再有 grown 字段与随机变体
  assert(seg1.grownPool === undefined && seg2.grownPool === undefined && seg3.grownPool === undefined,
    'grownPool 已从所有关段移除（M56 退役）');

  // ==========================================================
  console.log('\n[2] 编队：每关都可能出现复数组合，且多敌必须分摊血量');
  const seen = {};   // 段 → { count:{只数:次数}, ids:{}, variant:0, affix:0, total:0,
                     //   eliteTotal/eliteVar/eliteAffix/eliteAffix2: 中 Boss 特殊形态统计 }
  for (let i = 1; i <= 3; i++) {
    seen[i] = { count: {}, ids: {}, variant: 0, affix: 0, total: 0, multi: 0,
      eliteTotal: 0, eliteVar: 0, eliteAffix: 0, eliteAffix2: 0 };
  }
  let eliteMulti = 0;

  scan(function (n, enc) {
    n.encounter = enc;   // M67：与 enterNode 同款写回 —— 词缀去重的判定读它
    const seg = actSegment('act1', n.depth);
    const st = seen[seg.id];
    if (n.type === 'monster') {
      const k = enc.enemyIds.length;
      st.count[k] = (st.count[k] || 0) + 1;
      st.total++;
      if (k > 1) st.multi++;
      for (let i = 0; i < k; i++) {
        st.ids[enc.enemyIds[i]] = (st.ids[enc.enemyIds[i]] || 0) + 1;
        if (enc.enemyVariant[i]) st.variant++;
        if (enc.enemyAffixes[i] && enc.enemyAffixes[i].length) st.affix++;
      }
    }
    if (n.type === 'elite') {
      st.eliteTotal++;
      if (enc.enemyVariant[0] === 'elite') st.eliteVar++;
      const af = enc.enemyAffixes[0] || [];
      if (af.length >= 1) st.eliteAffix++;
      if (af.length >= 2) st.eliteAffix2++;
    }
    if (n.type === 'elite' && enc.enemyIds.length !== 1) eliteMulti++;
  });

  assert(seen[1].multi > 0, '第一关也出现过复数组合（' + seen[1].multi + ' 次 / 共 ' +
    seen[1].total + ' 场）');
  assert(seen[2].multi > 0 && seen[3].multi > 0, '第二、三关都有复数组合');
  // M56c 编队规则（用户定）：第二关复数最多 2 只，第三关才放开到 3 只
  assert(!seen[2].count[3],
    '第二关从未出现 3 只编队（复数上限 2，实测 3 只档 0 次 / ' + seen[2].total + ' 场）');
  assert(seen[2].count[2] > 0, '第二关仍有双敌编队（上限收紧不等于取消复数）');
  assert(seen[3].count[3] > 0,
    '第三关真的放出了 3 只编队（实测 ' + seen[3].count[3] + ' 次 / ' + seen[3].total + ' 场）');
  assert(seen[1].count[3] === undefined || seen[1].count[3] === 0,
    '第一关也从未出现 3 只编队（第一关上限同样是 2）');
  assert(eliteMulti === 0, '中 Boss 恒单只（复数组合是普通敌人的玩法）');

  assert(Object.keys(seen[1].ids).length === 5 &&
    Object.keys(seen[1].ids).every((id) => OLD.indexOf(id) >= 0),
    '第一关真的只会遇到旧版那 5 只（实测 ' + Object.keys(seen[1].ids).length + ' 种）');
  assert(seen[1].variant === 0 && seen[1].affix === 0,
    '第一关一场都没出变体 / 词缀（严格保持旧版）');

  assert((seen[2].ids.arc_welder || 0) > 0 && (seen[2].ids.pile_driver || 0) > 0,
    '第二关遇到了本关新敌人（电弧焊工 / 桩击机）');
  assert((seen[3].ids.husk_lancer || 0) > 0 && (seen[3].ids.cord_creeper || 0) > 0,
    '第三关遇到了只在第三关出现的普通敌人（菌壳矛兵 / 菌索爬行体）');
  // M56：二、三关池子全部是进化体 —— 实测出现的每一种都得是设计稿里的那只
  const SEG2_EVOLVED = ['rat_king', 'sentinel_breach', 'spore_gravid', 'crawler_molt', 'shade_gatherer'];
  const SEG3_EVOLVED = ['rat_tide', 'sentinel_siege', 'spore_mother', 'crawler_maul', 'shade_patch',
    'welder_overload', 'piledriver_breach'];
  Object.keys(seen[2].ids).forEach(function (id) {
    assert(SEG2_EVOLVED.indexOf(id) >= 0 || id === 'arc_welder' || id === 'pile_driver',
      '第二关只出二阶进化体 / 本关新怪（' + id + ' 越界）');
  });
  Object.keys(seen[3].ids).forEach(function (id) {
    assert(SEG3_EVOLVED.indexOf(id) >= 0 || id === 'husk_lancer' || id === 'cord_creeper',
      '第三关只出三阶进化体 / 三关专属（' + id + ' 越界）');
  });
  assert(SEG2_EVOLVED.filter(function (id) { return seen[2].ids[id]; }).length >= 3,
    '二阶进化体在第二关实际成群出现（实测 ' +
    SEG2_EVOLVED.filter(function (id) { return seen[2].ids[id]; }).length + ' / 5 种）');
  assert(SEG3_EVOLVED.filter(function (id) { return seen[3].ids[id]; }).length >= 4,
    '三阶进化体在第三关实际成群出现（实测 ' +
    SEG3_EVOLVED.filter(function (id) { return seen[3].ids[id]; }).length + ' / 7 种）');
  assert(seen[1].variant === 0 && seen[2].variant === 0 && seen[3].variant === 0,
    '普通敌人不再有随机变体（壮大版已退役，empowered 也不再由编队生成）');
  assert(seen[1].affix === 0 && seen[2].affix === 0 && seen[3].affix === 0,
    '普通敌人任何关段都不挂词缀（M56b：buff 特殊形态只属于中 Boss）');
  const eliteTotal = seen[1].eliteTotal + seen[2].eliteTotal + seen[3].eliteTotal;
  assert(eliteTotal > 0, '扫描里真的出现了中 Boss 节点（不是空集假通过）');
  assert((seen[1].eliteVar + seen[2].eliteVar + seen[3].eliteVar) === eliteTotal,
    '中 Boss 恒为「精锐」形态（基础身份不变，' + eliteTotal + ' 场全是）');
  // M67：词缀 buff 不再是中 Boss 标配 —— 每个小关只有本段第一只带词缀
  assert(seen[1].eliteAffix > 0 && seen[2].eliteAffix > 0 && seen[3].eliteAffix > 0,
    '每个小关都有带词缀的中 Boss（有中 Boss 节点的图就会出）');
  assert(seen[1].eliteAffix <= seen[1].eliteTotal && seen[2].eliteAffix <= seen[2].eliteTotal &&
      seen[3].eliteAffix <= seen[3].eliteTotal,
    '带词缀的中 Boss 不超过中 Boss 总数（大部分中 Boss 是原版）');
  assert(seen[1].eliteAffix2 === 0 && seen[2].eliteAffix2 === 0 &&
      seen[3].eliteAffix2 === seen[3].eliteAffix,
    '第三关那只是 2 词缀，一、二关 1 个（第三关略强）');

  // M67 逐图核对：同一段同一张图最多 1 只带词缀的中 Boss；每段每图都出；
  // 词缀数量跟关段配置走；本段其余中 Boss 恒原版。
  let violMulti = 0, violMissing = 0, violCount = 0;
  for (let s = 1; s <= SEEDS; s++) {
    Run.start('act1', s * 1013 + 17);
    const buffedIn = {};
    Run.state.map.layers.forEach(function (layer) {
      layer.forEach(function (n) {
        if (n.type !== 'elite') return;
        const seg = actSegment('act1', n.depth);
        n.encounter = Run.rollEncounter(n);   // 与 enterNode 同款：写回节点
        const af = n.encounter.enemyAffixes[0] || [];
        const segId = seg ? seg.id : 0;
        if (af.length > 0) {
          if (buffedIn[segId]) violMulti++;
          buffedIn[segId] = true;
          if (seg && seg.eliteAffixCount && af.length !== seg.eliteAffixCount) violCount++;
        }
        // 无词缀的原版中 Boss（af.length === 0）在 M67 里是合法常态，不计数
      });
    });
    [1, 2, 3].forEach(function (i) { if (!buffedIn[i]) violMissing++; });
  }
  assert(violMulti === 0, '逐图核对：同一小关同一张图最多 1 只带词缀的中 Boss');
  assert(violCount === 0, '词缀数量跟关段配置走（一、二关 1 个，第三关 2 个）');
  // 关段没有中 Boss 节点的图合法（地图生成不保证每段都有中 Boss）—— 只报数不断言
  console.log('  [info] 中 Boss 节点缺席的图×段：' + violMissing + '（不违反规则）');

  // 分摊：单只满血、两只 ×0.72、三只 ×0.55
  const share1 = [], share2 = [], share3 = [];
  scan(function (n, enc) {
    if (n.type !== 'monster') return;
    const a = enc.enemyHpMul;
    if (a.length === 1) share1.push(a[0]);
    if (a.length === 2) share2.push(a[0] + '/' + a[1]);
    if (a.length === 3) share3.push(a[0]);
  });
  assert(share1.every((v) => v === 1), '单只敌人的血量倍率恒为 1（' + share1.length + ' 个样本）');
  assert(share2.length > 0 && share2.every((v) => v === '0.72/0.72'),
    '两只编队每只分摊到 0.72 倍血（' + share2.length + ' 个样本）');
  assert(share3.length > 0 && share3.every((v) => v === 0.55),
    '三只编队每只分摊到 0.55 倍血（' + share3.length + ' 个样本）');

  // ==========================================================
  console.log('\n[3] 进化体（M56）：完全设计的更强敌人，取代「壮大版」');
  function hpRange(enemies) {
    const out = [];
    for (let i = 1; i <= 200; i++) {
      fight({ seed: i, enemies: enemies, depth: 1 });
      out.push(E0().maxHp);
    }
    return { min: Math.min.apply(null, out), max: Math.max.apply(null, out) };
  }
  const plainRats = hpRange([{ id: 'rats' }]);
  const kingRats = hpRange([{ id: 'rat_king' }]);
  const tideRats = hpRange([{ id: 'rat_tide' }]);
  assert(plainRats.min === 12 && plainRats.max === 18, '腐蚀鼠群（一阶）12–18 不变');
  assert(kingRats.min === 34 && kingRats.max === 42,
    '锈牙鼠王（二阶）34–42（实测 ' + kingRats.min + '–' + kingRats.max + '）');
  assert(tideRats.min === 58 && tideRats.max === 70,
    '鼠潮母兽（三阶）58–70（实测 ' + tideRats.min + '–' + tideRats.max + '）');
  assert(E0().name === '鼠潮母兽' && E0().def.evolvedFrom === 'rat_king' && E0().def.evolvedStage === 3,
    '进化体带 evolvedFrom / evolvedStage 血统字段');
  // 12 只进化体全部存在且血统链完整
  const LINEAGE = {
    rats: ['rat_king', 'rat_tide'],
    sentinel: ['sentinel_breach', 'sentinel_siege'],
    spore_walker: ['spore_gravid', 'spore_mother'],
    crawler: ['crawler_molt', 'crawler_maul'],
    scavenger_shade: ['shade_gatherer', 'shade_patch'],
    arc_welder: ['welder_overload'],
    pile_driver: ['piledriver_breach'],
  };
  Object.keys(LINEAGE).forEach(function (base) {
    LINEAGE[base].forEach(function (evo, idx) {
      const def = ENEMIES[evo];
      assert(def && def.evolvedFrom === (idx === 0 ? base : LINEAGE[base][idx - 1]) &&
        def.evolvedStage === (base === 'arc_welder' || base === 'pile_driver' ? 3 : idx + 2) &&
        def.kind === 'normal' && def.hpMin > 0,
        '进化链 ' + base + ' → ' + evo + ' 存在且血统正确');
    });
  });
  // 旧存档兼容：快照里的 variant:'grown' 现在安全落地为无加成
  fight({ seed: 7, enemies: [{ id: 'rats', variant: 'grown' }] });
  assert(E0().name === '腐蚀鼠群' && !E0().dmgAdd,
    '旧存档的 variant:grown 退役后安全落地（无加成、无崩溃、名字不变）');

  // ==========================================================
  console.log('\n[4] 词缀：每一项都在意图与结算里真的生效');
  fight({ seed: 7, enemies: [{ id: 'rats' }] });
  const baseIntent = Combat.intentDamage(E0());
  assert(baseIntent === 5, '裸鼠群咬人意图 5');

  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['atk_up'] }] });
  assert(Combat.intentDamage(E0()) === 8, '「暴戾」让意图从 5 变成 8（预告不撒谎）');
  Combat.endTurn();
  assert(S().player.hp === 300 - 8, '「暴戾」在实战里也真的打进 8 点');

  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['hp_up'] }] });
  assert(E0().maxHp >= 16 && E0().maxHp <= 24,
    '「生命强化」把鼠群顶到 16–24（12×1.35 / 18×1.35，实测 ' + E0().maxHp + '）');

  fight({ seed: 7, enemies: [{ id: 'sentinel', affixes: ['armored'] }] });
  assert(E0().block === 10, '「铁甲」开局自带 10 格挡');

  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['thorned'] }] });
  assert(E0().buffs.thorns === 2, '「荆棘」开局自带 2 层反伤');

  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['fierce'] }] });
  assert(E0().buffs.str === 2 && Combat.intentDamage(E0()) === 7,
    '「战意」开局 +2 力量，意图跟着涨到 7');

  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['regen'] }] });
  assert(E0().buffs.regen === 2, '「再生」开局自带 2 层');

  // 变体 + 词缀叠加：变体轴已退役，只剩词缀
  fight({ seed: 7, enemies: [{ id: 'rats', affixes: ['hp_up', 'atk_up'] }] });
  const both = E0();
  assert(both.dmgAdd === 3, '只有词缀时加伤 = 3（变体轴已退役）');
  assert(both.maxHp >= 16 && both.maxHp <= 24,
    'HP 倍率 1.35（实测 ' + both.maxHp + '）');
  assert(both.affixNames.length === 2, '标记列表里有 2 项（2 个词缀）');
  assert(both.name === '腐蚀鼠群', '同名同词缀的编号从 1 起算，不带 #2');

  // ==========================================================
  console.log('\n[5] 复数编队进场：独立行动、独立编号、目标可切');
  fight({ seed: 9, enemies: [{ id: 'rats' }, { id: 'crawler' }] });
  assert(S().enemies.length === 2, '两只敌人同场');
  assert(S().enemies[0].name === '腐蚀鼠群' && S().enemies[1].name === '井壁爬虫',
    '各是各的名字');
  fight({ seed: 9, enemies: [{ id: 'rats' }, { id: 'rats' }] });
  assert(S().enemies[0].name === '腐蚀鼠群' && S().enemies[1].name === '腐蚀鼠群 #2',
    '同种叠加才编号');
  fight({ seed: 9, enemies: [{ id: 'rats' }, { id: 'rat_king' }] });
  assert(S().enemies[0].name === '腐蚀鼠群' && S().enemies[1].name === '锈牙鼠王',
    '一阶与二阶同场时是两个独立敌人（各自名字、不共用编号）');
  assert(Combat.intentDamage(S().enemies[0]) === 5 &&
    Combat.intentDamage(S().enemies[1]) === 8,
    '两只各算各的意图（5 / 8）');

  // ==========================================================
  console.log('\n[6] Boss 恒单只且恒原版（M62 / M62b）');
  let bossTotal = 0, bossBoosted = 0, bossMulti = 0, bossDressed = 0;
  let seg1BossTotal = 0, seg1Boosted = 0;
  scan(function (n, enc) {
    if (n.type !== 'boss') return;
    const seg = actSegment('act1', n.depth);
    bossTotal++;
    if (enc.bossBoosted) bossBoosted++;
    if (enc.enemyIds.length !== 1) bossMulti++;
    if (enc.enemyVariant[0] || (enc.enemyAffixes[0] && enc.enemyAffixes[0].length) ||
      enc.enemyHpMul[0] !== 1) bossDressed++;
    if (seg.id === 1) {
      seg1BossTotal++;
      if (enc.bossBoosted) seg1Boosted++;
    }
  });
  // seg1BossTotal > 0 同时锚住 bossTotal > 0 —— 否则「bossMulti === 0」
  // 在一场 Boss 都没扫到时也会真空成立（全称断言的空集陷阱）。
  assert(seg1BossTotal > 0 && seg1Boosted === 0,
    '第一关的 Boss 永远是原版（' + seg1BossTotal + ' 场）');
  assert(bossBoosted === 0 && bossDressed === 0,
    '大 Boss 恒原版：无变体、无词缀、血量倍率 1（M62b 退役强化版，' +
    bossTotal + ' 场全查）');
  assert(bossMulti === 0,
    'Boss 层恒单只：大 Boss 从不带僚机 / 复数（' + bossTotal + ' 场全查）');

  // 血量倍率机制：大 Boss 不吃深压，血量 = 基础 × hpMul（× DL 系数）
  fight({ seed: 3, depth: 22, enemies: [{ id: 'rust_crown', hpMul: 0.32 }] });
  assert(E0().maxHp === Math.round(220 * 0.32),
    'hpMul 0.32 的锈冠 220 × 0.32 = ' + E0().maxHp + ' 血（倍率生效，不是原血）');
  // 变体机制回归（直接传参 —— 编队自 M62b 起不再生成 empowered，
  // 但强化层管线仍被中 Boss 的 'elite' 形态使用，这里守住它的数值语义）。
  fight({ seed: 3, depth: 33, enemies: [{ id: 'rust_crown', hpMul: 1.25, variant: 'empowered' }] });
  assert(E0().maxHp === Math.round(220 * 1.25) && E0().name === '强化的锈冠',
    '变体机制：empowered 锈冠 275 血、名字带「强化的」（' + E0().name + '）');
  // 锈冠的开场意图是「锈蚀蔓延」（debuff，没有伤害数字），
  // 所以这里显式换成重砸来验加伤 —— 与 m5 验督军斩击的写法一致。
  E0().intent = ENEMIES.rust_crown.moves.slam;
  assert(Combat.intentDamage(E0()) === 14,
    '变体机制：重砸的意图 = 12 + 变体加伤 2（' + Combat.intentDamage(E0()) + '）');

  // ==========================================================
  console.log('\n[7] 老节点 / 老存档的兼容');
  const legacy = { type: 'monster', enemyId: 'rats', depth: 4 };
  const lc = Run.encounterOf(legacy);
  assert(lc.enemyIds.length === 1 && lc.enemyIds[0] === 'rats',
    'M50 之前的节点（没有 encounter 字段）退化成单只编队');

  Run.start('act1', 4242);
  let walked = 0;
  for (let i = 0; i < 200 && walked < 3; i++) {
    const edges = Run.current().edges;
    if (!edges.length) break;
    Run.moveTo(edges[0]);
    const n = Run.current();
    if (n.type === 'monster' || n.type === 'elite') {
      assert(!!n.encounter && n.enemyId === n.encounter.enemyIds[0],
        'D' + n.depth + ' 进入时定下编队，enemyId 仍是编队第一只');
      walked++;
    }
  }
  assert(walked === 3, '真的走到了 3 个战斗节点（不是空转）');

  // 重进同一节点：编队不变
  Run.start('act1', 4242);
  let checked = 0;
  for (let i = 0; i < 200 && !checked; i++) {
    const edges = Run.current().edges;
    if (!edges.length) break;
    const back = Run.current().id;
    Run.moveTo(edges[0]);
    const cand = Run.current();
    if (cand.type !== 'monster') continue;
    const snapshot = JSON.stringify(cand.encounter);
    Run.state.currentId = back;
    Run.moveTo(cand.id);
    assert(JSON.stringify(cand.encounter) === snapshot,
      '重进同一节点，编队一只不差（不重抽）');
    checked = 1;
  }
  assert(checked === 1, '找到了一个可以复现的战斗节点');

  // 存档往返：encounter 跟着 map 一起走
  Run.start('act1', 777);
  let target = null;
  for (let i = 0; i < 200 && !target; i++) {
    const edges = Run.current().edges;
    if (!edges.length) break;
    Run.moveTo(edges[0]);
    if (Run.current().type === 'monster') target = Run.current();
  }
  const snap = Run.toSnapshot();
  const before = JSON.stringify(snap.map.nodes[target.id].encounter);
  assert(Run.fromSnapshot(snap), '存档能读回来');
  assert(JSON.stringify(Run.state.map.nodes[target.id].encounter) === before,
    '编队随节点一起进存档（读档后重打还是那几只）');

  // ==========================================================
  console.log('\n' + (fail === 0 ? 'M8 全部通过' : 'M8 存在失败项') +
    '：' + pass + ' 通过 / ' + fail + ' 失败\n');
  return fail;
}

const failed = vm.runInContext(
  '(' + suite.toString() + ')()', sandbox, { filename: 'm8-suite.js' }
);
process.exit(failed === 0 ? 0 : 1);
