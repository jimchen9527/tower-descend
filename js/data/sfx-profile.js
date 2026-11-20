// ============================================================================
// sfx-profile.js —— 卡片 → 打击音效画像（M40）
//
// 为什么单独成一层：M36/M38 的打击音效只有**一个维度**（材质 impact），于是
//   · 「打击」（6 伤）和「铁拳」（13 伤）共用一个 blunt —— 轻重完全听不出来；
//   · 「连环凿」（5 伤 ×3）只响一声 —— 渲染层按出手者去重，连击被吃掉；
//   · 群体牌（天火）与单体牌同声 —— 打一只和打一片没有区别。
//
// 这一层是**纯函数**：输入卡面数据 / 真实伤害，输出「该怎么响」的画像。
// 不碰 DOM、不碰音频，所以能直接在 Node 里断言（见 tests/m1-combat.test.js [20]）。
//
// 三层结构（缺一层就会退回到「同一材质听起来一样」）：
//   ① 材质层 impact ——「打的是什么」：9 种材质来自卡面，保辨识度（M36 已定）
//   ② 力度层 weight ——「打多重」：由**实际打出的伤害**推 0..1，连续量；
//                      任何两张伤害不同的卡都不会听起来一样
//   ③ 语义层 traits ——「这张卡在做什么」：机制派生，叠加在材质层之上
//
// 一条铁律：**只认卡面写着的机制，不做语义猜测**。
// 「毒理学」这张卡不带 poison 字段（它是造成伤害的采样牌），那它听起来就该是
// blade（刃割）而不是毒素 —— 音频不替设计说谎，不然玩家会从声音里读出
// 一张卡根本没有的机制。
// ============================================================================
const SfxProfile = (function () {
  'use strict';

  // 力度映射区间：单次伤害 ≤6 → weight 0（最轻）；≥26 → weight 1（最重）。
  // 取 6/26 是因为卡池实测：基础牌 6 伤，最重的终结技 24~26 伤（见 m2 卡池审计）。
  var W_MIN = 6;
  var W_MAX = 26;

  // 中文名：试听台与诊断 HUD 用，代码里不出现散落的中文字面量
  var IMPACT_ZH = {
    blunt: '钝击', hammer: '重锤', metal: '金属', pick: '凿击',
    drill: '钻掘', blast: '爆破', blade: '刃割', flame: '灼烧', claw: '爪撕',
  };
  var TRAIT_ZH = {
    multi: '连击', bleed: '卖血', toxin: '生化', ember: '燃烧',
    guard: '攻防一体', swift: '轻快', wide: '横扫',
  };

  // 固定顺序：画像里的 traits 永远按这个次序排列，断言与诊断才可预期。
  // wide 只能由**运行时**给出（同帧打多目标），traitsOf 永远不会返回它。
  var TRAIT_ORDER = ['multi', 'bleed', 'toxin', 'ember', 'guard', 'swift', 'wide'];

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : 0; }

  // ---- ③ 语义层：从卡面字段推特质 ----
  // 每一条都对应一个「玩家能从卡面读出来的机制」。阈值只用于「够不够格加一层」，
  // 比如 1 点格挡不值得加金属余韵，6 点（攻防一体的量级）才加。
  function traitsOf(def) {
    var hit = {};
    if (def) {
      var v = def.v || {};
      if (num(v.times) >= 2) hit.multi = true;                      // 多段：连击
      if (num(v.selfHurt) > 0 || num(v.hp) > 0) hit.bleed = true;   // 代价：卖血 / 献祭
      if (num(v.poison) > 0) hit.toxin = true;                      // 生化：毒
      if (num(v.burn) > 0) hit.ember = true;                        // 火：燃烧
      if (num(v.block) >= 6) hit.guard = true;                      // 攻防一体
      if (num(v.draw) > 0 || num(def.cost) === 0) hit.swift = true; // 轻快：抽牌 / 0 费
    }
    return TRAIT_ORDER.filter(function (t) { return hit[t]; });
  }

  // ---- ② 力度层 ----
  // 真值优先：调用方拿到**实际打出的伤害**（act.dmg）就传进来，没拿到才估算。
  function weightOf(dmg) {
    var d = num(dmg);
    if (d <= 0) return 0;
    return clamp((d - W_MIN) / (W_MAX - W_MIN), 0, 1);
  }

  // 估算「单次伤害」—— 只给**拿不到真值**的场景用（试听台、卡池盘点）。
  // 明确是估算：比例型（碎石 = 格挡×0.5）按 20 点格挡折算，随深度型按 D30 折算。
  // 游戏里跑的是 act.dmg（真值），这张表不参与实战。
  function hitDamage(def) {
    var v = (def && def.v) || {};
    if (num(v.dmg) > 0) return num(v.dmg);
    if (num(v.per) > 0) return num(v.per) * Math.max(num(v.n), 1);
    if (num(v.mult) > 0) return 10 * num(v.mult);
    if (num(v.perDepth) > 0) return num(v.perDepth) * 30;
    if (num(v.ratio) > 0) return Math.round(20 * num(v.ratio));
    return 0;
  }

  // ---- 组装画像 ----
  // def: 卡片定义（可为 null —— 敌人招式没有卡面）；dmg: 实际伤害（可为 null → 走估算）
  function of(def, dmg) {
    var useEst = (dmg == null);
    var d = useEst ? hitDamage(def) : num(dmg);
    return {
      impact: (def && def.impact) || 'blunt',
      traits: traitsOf(def),
      dmg: d,
      weight: weightOf(d),
      estimated: useEst,   // true = dmg 是估算值，不是真值（诊断/试听台据此标注）
    };
  }

  // 合并运行时的「上下文体特质」（wide 等）——去重并保持固定顺序
  function merge(base, extra) {
    var list = (base || []).concat(extra || []);
    var hit = {};
    list.forEach(function (t) { if (TRAIT_ZH[t]) hit[t] = true; });
    return TRAIT_ORDER.filter(function (t) { return hit[t]; });
  }

  return {
    of: of,
    traitsOf: traitsOf,
    weightOf: weightOf,
    hitDamage: hitDamage,
    merge: merge,
    IMPACT_ZH: IMPACT_ZH,
    TRAIT_ZH: TRAIT_ZH,
    TRAIT_ORDER: TRAIT_ORDER,
    W_MIN: W_MIN,
    W_MAX: W_MAX,
  };
})();
