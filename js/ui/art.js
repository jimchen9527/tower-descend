// 图形库 —— 全部是「返回 SVG 字符串的纯函数」。零素材、零请求、随 CSS 颜色换色。
//
// 为什么内联 SVG 而不是 <img src="*.svg">：
//   1. file:// 下外链 SVG 的 <use href="...#id"> 会被 CORS 拦；内联没有这个问题
//   2. 内联才吃 currentColor —— 节点类型色（.mt-* 的 color）与角色主题色（--char）
//      直接作用到图形上，不用为每种配色各出一套图
//   3. 探针能查 DOM（querySelector('svg') 拿得到），外链图片查不到内容
//
// 颜色约定（重要）：
//   - 描边 / 主形体一律 currentColor —— 由调用处的 CSS color 决定
//   - 需要「挖空」的细节（眼睛、菌褶、兜帽内影）用 class="art-hole"，
//     填充色写在 css/art.css 里。**不能**用 fill="var(--panel)"：
//     SVG 的 presentation attribute 不接受 var()，只有 CSS 属性才认。
//
// 尺寸约定：节点图标 24×24，敌人与角色 64×64，意图图标 16×16。
// 实际显示多大由 CSS 控制（viewBox 保证缩放不糊）。
//
// 画法约定（v2，第一版返工后定的）：**特征必须在目标尺寸下读得出来**。
// 地图节点只有 22px、敌人面板 56~88px，所以：
//   - 单个特征不小于 4px（宝箱的锁第一版只有 2.4px，缩到 22px 就没了）
//   - 宁少勿碎：一只怪只给「一个形体 + 2~3 个特征」，细节多了糊成一团
//   - 靠轮廓区分，不靠内部纹理
// 返工记录：商店的「圆 + 竖线 + 圆点」被读成数字 8（改成上窄下宽的袋身）；
//   休息的「顶尖底圆」被读成水滴（补了内焰）；双头犬的粗脖子把两个头连成了一个。

const Art = {
  // 同一个图形会被反复请求（地图 120 个节点、每回合重绘手牌），
  // 拼字符串不贵但没必要重复拼 —— 缓存键就是「类别:参数」。
  _cache: {},

  // ============================================================
  // 位图立绘（v3：卡通 2D 全身，AI 生成 + rembg 抠图，preview-assets-v3/）
  // 战斗面板优先用位图；没有对应图的 id 返回 null，调用方退回下面的 SVG 剪影。
  // 路径是相对 index.html 的 —— file:// 直开也能加载（png 不受 CORS 限制）。
  // ============================================================
  BITMAP_BASE: 'preview-assets-v3/',
  BITMAP_CHARS: {
    digger: 'digger-cut.png',
    medic: 'medic-cut.png?v=M73c',
    keeper: 'keeper-cut.png?v=M73c',
  },
  BITMAP_ENEMIES: {
    rats: 'rats-cut.png',
    sentinel: 'sentinel-cut.png',
    spore_walker: 'spore_walker-cut.png',
    crawler: 'crawler-cut.png',
    scavenger_shade: 'shade-cut.png',
    warlord: 'warlord-cut.png',
    hound: 'hound-cut.png',
    bonewright: 'bonewright-cut.png',
    rust_crown: 'rust_crown-cut.png',
    mycelium_mother: 'mother-cut.png',
    headless_executor: 'executor-cut.png',
    arc_welder: 'arc_welder-cut.png',
    pile_driver: 'pile_driver-cut.png',
    husk_lancer: 'husk_lancer-cut.png',
    cord_creeper: 'cord_creeper-cut.png',
    centurion: 'centurion-cut.png',
    stitch_tyrant: 'stitch_tyrant-cut.png',
    // M56 进化体 12 张
    rat_king: 'rat_king-cut.png',
    sentinel_breach: 'sentinel_breach-cut.png',
    spore_gravid: 'spore_gravid-cut.png',
    crawler_molt: 'crawler_molt-cut.png',
    shade_gatherer: 'shade_gatherer-cut.png',
    rat_tide: 'rat_tide-cut.png',
    sentinel_siege: 'sentinel_siege-cut.png',
    spore_mother: 'spore_mother-cut.png',
    crawler_maul: 'crawler_maul-cut.png',
    shade_patch: 'shade_patch-cut.png',
    welder_overload: 'welder_overload-cut.png',
    piledriver_breach: 'piledriver_breach-cut.png',
  },

  charImg(id) {
    const f = this.BITMAP_CHARS[id];
    return f ? this.BITMAP_BASE + f : null;
  },

  enemyImg(id) {
    const f = this.BITMAP_ENEMIES[id];
    return f ? this.BITMAP_BASE + f : null;
  },

  // ============================================================
  // 战斗背景 + 节点场景图（v3 同批画风：2D 卡通、粗描边，preview-assets-bg/）
  // JPEG 无透明通道，只做背景层。深度带按 Act 1 的三段走（D1–11 / 12–22 / 23–33，
  // 与 bossDepths 对齐）：上层井口天光城邦残骸 → 中层冷色遗迹堆叠 → 下层菌丝研究所。
  // Act 2/3 加入后在这里换成按 act 查表的版本。
  // ============================================================
  BG_BASE: 'preview-assets-bg/',
  BATTLE_BGS: ['battle-band1.jpg', 'battle-band2.jpg', 'battle-band3.jpg'],
  SCENE_BGS: {
    event: 'scene-event.jpg',
    shop: 'scene-shop.jpg',
    rest: 'scene-rest.jpg',
    chest: 'scene-chest.jpg',
  },
  // M56d：每个随机事件一张专属场景横幅（preview-assets-bg/）——
  // 之前 8 个事件共用 scene-event.jpg，「渗水层」和「熔渣池」共用一张图
  // 总有一半对不上文案。键 = events.js 的事件 id；新增事件必须来这里登记，
  // 查不到的退回共用横幅（fallback，探针断言全覆盖）。
  EVENT_SCENES: {
    seepage: 'scene-event-seepage.jpg',
    duty_log: 'scene-event-duty_log.jpg',
    faceless_trader: 'scene-event-faceless_trader.jpg',
    collapse: 'scene-event-collapse.jpg',
    mycelium: 'scene-event-mycelium.jpg',
    carving: 'scene-event-carving.jpg',
    slag_pool: 'scene-event-slag_pool.jpg',
    silent_broadcast: 'scene-event-silent_broadcast.jpg',
  },

  // 深度 → 地形带（1 起）。边界值跟 Act 1 的 bossDepths 一致。
  terrainBand(depth) {
    const d = Math.max(1, depth || 1);
    return d <= 11 ? 1 : d <= 22 ? 2 : 3;
  },

  battleBgSrc(depth) {
    return this.BG_BASE + this.BATTLE_BGS[this.terrainBand(depth) - 1];
  },

  // 给 render.js 用：设到 #battle-bg 上的类名
  battleBgClass(depth) {
    return 'bg-band' + this.terrainBand(depth);
  },

  // 节点场景横幅。kind 不在表里（reward 等）返回 null，调用方跳过；
  // kind === 'boss' 用所在深度带的战斗背景 —— Boss 预告就该长在它的战场上。
  // kind === 'event' 时 eventId 命中 EVENT_SCENES 则用事件专属图（M56d），
  // 没带 eventId 或查不到 → 退回共用的 scene-event.jpg。
  sceneSrc(kind, depth, eventId) {
    if (kind === 'boss') return this.battleBgSrc(depth);
    if (kind === 'event' && eventId && this.EVENT_SCENES[eventId]) {
      return this.BG_BASE + this.EVENT_SCENES[eventId];
    }
    const f = this.SCENE_BGS[kind];
    return f ? this.BG_BASE + f : null;
  },

  // ============================================================
  // 卡面插画（B 方案：具象卡专属 + 泛化卡共用，preview-assets-cards/）
  // 58 张图覆盖全部 137 张卡 —— 泛化卡（打击 / 防御类、同主题卡）共用一张图。
  // 注册表本身就是清单：卡池加卡时必须来这里登记，cardImg 查不到返回 null，
  // 调用方退回「无画窗」版式（探针有全覆盖断言，漏登记会红）。
  // ============================================================
  CARDART_BASE: 'preview-assets-cards/',
  CARD_ART: {
    // ---- 掘者（35 图 / 51 卡，含 1 张诅咒卡）----
    strike: 'strike', defend: 'defend', cursed_lung: 'cursed_lung',
    crowbar: 'crowbar', pry: 'crowbar', pry_combo: 'crowbar', dual_crowbar: 'crowbar',
    iron_fist: 'iron_fist', shove: 'iron_fist',
    rivet_plate: 'rivet_plate', brace: 'rivet_plate', plate_guard: 'rivet_plate', immovable: 'rivet_plate',
    hardhat: 'hardhat',
    shrapnel: 'shrapnel', rockbreak: 'shrapnel',
    patch: 'patch',
    hydraulic: 'hydraulic', pressure_valve: 'hydraulic',
    dismantle: 'dismantle', salvage: 'dismantle',
    ballast: 'ballast',
    wall_pick: 'wall_pick', deep_work: 'wall_pick',
    weld: 'weld',
    quake: 'quake', sledge_work: 'quake',
    chain_chisel: 'chain_chisel', final_bore: 'chain_chisel',
    rust_grip: 'rust_grip',
    emergency: 'emergency',
    derrick: 'derrick', steel_beam: 'derrick',
    temper: 'temper',
    riposte: 'riposte', iron_will: 'riposte',
    seam_resonance: 'seam_resonance', abyss_echo: 'seam_resonance',
    wall_breaker: 'wall_breaker',
    heavy_rig: 'heavy_rig',
    bottom_hammer: 'bottom_hammer',
    // M32 群体系：三张全体攻击各配专属图
    shockwave: 'shockwave', chain_demolition: 'chain_demolition',
    demolition_charge: 'demolition_charge',
    // M33 大威力轴：三张 2/3 费终结技各配专属图
    blast_charge: 'blast_charge', jackhammer: 'jackhammer',
    bedrock_hammer: 'bedrock_hammer',
    // M33b 低层能力牌（补 DL1–4 掉落池零能力牌的缺口）
    counterweight: 'counterweight',
    // M64 重防轴：两张各配专属图（承重墙 = 砌厚的钢混结构 / 带伤作业 = 裂了还绑着绷带上岗的护板）
    load_bearing: 'load_bearing', hazard_work: 'hazard_work', ram_hit: 'ram_hit',
    // ---- 拾荒医师（9 图 / 40 卡）----
    // M17 补的 DL3–DL10 沿用同主题图：培养皿系（细菌/毒）、注射系（血清）、
    // 外科系（刀/缝合）、防护系（消毒）、研究系（显微镜）
    scalpel: 'scalpel', biopsy: 'scalpel', debride: 'scalpel',
    necropsy: 'scalpel', dissection: 'scalpel',
    tourniquet: 'tourniquet', suture: 'tourniquet',
    sampling: 'sampling', triage: 'sampling',
    injection: 'injection', serum3: 'injection', antibody: 'injection',
    anesthesia: 'injection', transfusion: 'injection', antibody_storm: 'injection',
    sedative: 'injection', serum_x: 'injection',
    microscope: 'microscope', pathology: 'microscope', observation: 'microscope',
    metabolism: 'microscope', final_diagnosis: 'microscope',
    disinfect: 'disinfect', immunity: 'disinfect', quarantine: 'disinfect', antiseptic: 'disinfect',
    petri: 'petri', bloom: 'petri',
    culture: 'petri', incubator: 'petri', toxicology: 'petri',
    culture_burst: 'petri', contagion: 'petri', pandemic: 'petri',
    parasite: 'parasite', virulence: 'parasite',
    regen_tissue: 'regen_tissue', palliative: 'regen_tissue',
    resuscitate: 'regen_tissue', panacea: 'regen_tissue',
    // M32 群体系：三张全体攻击各配专属图
    multi_swab: 'multi_swab', aerosol_bloom: 'aerosol_bloom',
    virulent_outbreak: 'virulent_outbreak',
    // ---- 引火者（8 图 / 40 卡）----
    // M17 补的 DL3–DL10 沿用同主题图：火星系（擦火）、护盾系（灰盾）、
    // 卖血系（血祭）、烈焰系（焚身）、柴薪系（薪柴）、共鸣系、终火系
    tongs: 'tongs', scorch: 'tongs', flame_whip: 'tongs', pyroclasm: 'tongs',
    ash_guard: 'ash_guard', smokescreen: 'ash_guard', ash_baptism: 'ash_guard',
    ash_cloak: 'ash_guard', ember_armor: 'ash_guard',
    spark: 'spark', kindle: 'spark', ember_gift: 'spark',
    cinder: 'spark', cauterize: 'spark', rekindle: 'spark',
    blood_rite: 'blood_rite', offering: 'blood_rite',
    desperation: 'blood_rite', blood_pact: 'blood_rite',
    blood_forge: 'blood_rite', sacrifice: 'blood_rite',
    firewood: 'firewood', forge: 'firewood', wildfire: 'firewood', eternal_flame: 'firewood',
    immolation: 'immolation', burn_self: 'immolation',
    pyre: 'immolation', inferno: 'immolation', immolate: 'immolation',
    conflagration: 'immolation', apocalypse_fire: 'immolation',
    resonance: 'resonance', ember_storm: 'resonance',
    last_flame: 'last_flame', undying: 'last_flame',
    ember_burst: 'last_flame', phoenix: 'last_flame',
    ashen_rebirth: 'last_flame', final_ember: 'last_flame',
    // M32 群体系：三张全体攻击各配专属图
    tongue_of_fire: 'tongue_of_fire', ash_storm: 'ash_storm',
    judgement_fire: 'judgement_fire',
  },

  cardImg(id) {
    const f = this.CARD_ART[id];
    return f ? this.CARDART_BASE + f + '.png' : null;
  },

  _memo(key, fn) {
    if (this._cache[key] === undefined) this._cache[key] = fn();
    return this._cache[key];
  },

  // 通用外壳。fill 默认 "none"（线描），需要实心的元素自己写 fill="currentColor"；
  // 传 fill 参数可整块翻转默认（M61 遗物卡通化：剪影为主、挖洞为辅）。
  _wrap(view, body, cls, width, fill) {
    return '<svg class="' + cls + '" viewBox="' + view + '" ' +
      'fill="' + (fill || 'none') + '" stroke="currentColor" stroke-width="' + width + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  },

  // ============================================================
  // 地图节点图标（8 种，24×24 线条风）
  // 保留 NODE_TYPES[type].icon 那个汉字作为无障碍兜底（title / aria），
  // 但画面上不再用汉字 —— 汉字只是「字」，图形才是一眼可辨的「型」。
  // ============================================================

  NODE_BODY: {
    // 入口：向下的箭头进入井口
    entry:
      '<path d="M12 3v13"/><path d="M6 10l6 6 6-6"/><path d="M4 21h16"/>',

    // 小怪：三道爪痕（加粗 —— 1.9px 的线缩到 22px 就淡得看不见）
    monster:
      '<path d="M6 3Q8.5 12 9.5 21" stroke-width="2.4"/>' +
      '<path d="M11 2Q13.5 12 14.5 21" stroke-width="2.4"/>' +
      '<path d="M16 3Q17.5 11 18.5 20" stroke-width="2.4"/>',

    // 中 Boss（第一关 / 默认）：带尖刺的头盔 —— 旧版唯一的中 Boss 图标，
    // 现在它代表「第一关的中 Boss」（铁颚督军 / 双头犬 / 蚀骨工匠都是人形或兽形军官）
    elite:
      '<path d="M5 16a7 7 0 0 1 14 0"/><path d="M5 16h14"/>' +
      '<path d="M12 9V4"/><path d="M7 11.5L4 8.5"/><path d="M17 11.5L20 8.5"/>' +
      '<path d="M9 13.5h6" stroke-width="1.6"/>',

    // 中 Boss（第二关）：双盾并立 —— 锈蚀百夫长的方阵。
    // 与「大 Boss 的王冠」和「第一关的头盔」都不撞形；两片盾叠出的宽轮廓
    // 在 22px 下比单片盾（那是意图 defend 的形）更容易读成「有组织的重甲」。
    elite2:
      '<path d="M8 3.5l4.2 1.6v5.2c0 2.5-2.1 4.2-4.2 5-2.1-.8-4.2-2.5-4.2-5V5.1z"/>' +
      '<path d="M15.8 3.5l4.2 1.6v5.2c0 2.5-2.1 4.2-4.2 5-2.1-.8-4.2-2.5-4.2-5V5.1z"/>' +
      '<path d="M5.5 20.5h13" stroke-width="2.2"/>',

    // 中 Boss（第三关）：菌盖冠 —— 缝合暴君的巢形。
    // 菌盖 + 短柄 + 两侧垂下的菌丝：与孢囊行者的「伞」不同，这里没有腿、
    // 底下是一条封口的横线（「坐镇」而不是「行走」）。
    elite3:
      '<path d="M3 12a9 9 0 0 1 18 0z"/>' +
      '<path d="M12 12V7" class="art-hole-line" stroke-width="1.8"/>' +
      '<path d="M9 12v4h6v-4" fill="none" stroke-width="2"/>' +
      '<path d="M4.5 14l-2.5 3.5M19.5 14l2.5 3.5" fill="none" stroke-width="1.8"/>' +
      '<path d="M6 20.5h12" stroke-width="2.2"/>',

    // 大 Boss：王冠（比汉字「王」更能表达"镇守一层"）
    boss:
      '<path d="M4 19V8l4.5 4L12 5l3.5 7L20 8v11z"/>' +
      '<circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/>',

    // 事件：问号
    event:
      '<path d="M9 9.5a3 3 0 1 1 3.5 2.97V15"/>' +
      '<circle cx="12.5" cy="19" r="1.3" fill="currentColor" stroke="none"/>',

    // 商店：金币（第三版 —— 前两版都画钱袋，22px 下分别读成「数字 8」与「挂锁」。
    // 圆 + 货币符号的辨识度远高于袋形，也不跟宝箱抢「箱子」这个形）
    shop:
      '<circle cx="12" cy="12" r="8"/>' +
      '<path d="M12 6.6v10.8" stroke-width="1.7"/>' +
      '<path d="M14.9 9.7c-.6-.9-1.7-1.5-2.9-1.5-1.7 0-2.9 1-2.9 2.2 0 2.9 6 1.5 6 4.4 0 1.2-1.2 2.2-3.1 2.2' +
      '-1.2 0-2.3-.6-2.9-1.5" stroke-width="1.7"/>',

    // 休息：篝火（第三版 —— 前两版自绘的火焰分别读成「水滴」与「桃」。
    // 改用公认的火焰轮廓：底宽、两侧内凹、顶部收成两处尖）
    rest:
      '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 ' +
      '.5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" ' +
      'fill="currentColor" fill-opacity=".14"/>',

    // 宝箱（第四版 —— 上一版加了左右包边，24px 下五条线太密，读成了「日历」。
    // 减法：去掉包边，把锁扣放大到 4.4px，「方箱 + 大锁」两个元素就够）
    chest:
      '<path d="M4 10.5h16V19H4z"/>' +
      '<path d="M4.4 10.5V9A2.5 2.5 0 0 1 6.9 6.5h10.2A2.5 2.5 0 0 1 19.6 9v1.5"/>' +
      '<path d="M4 13.8h16" stroke-width="1.5"/>' +
      '<rect x="9.8" y="11.4" width="4.4" height="5" rx=".8" fill="currentColor" stroke="none"/>',
  },

  // 地图节点图标。depth 可选（M50）—— 只有「中 Boss」会用到它：
  // 三关的中 Boss 不是同一批人，图标要能一眼看出这一关管事的是哪一类
  // （第一关人事军官 / 第二关方阵重甲 / 第三关菌巢）。
  // 段号直接复用 terrainBand：它的边界（11 / 22）与 bossDepths 本来就一致，
  // 再写一份阈值只会多一个会走样的真源。
  node(type, depth) {
    const band = type === 'elite' ? this.terrainBand(depth == null ? 1 : depth) : 0;
    const t = band > 1 ? 'elite' + band : type;
    return this._memo('n:' + t, () => {
      const body = this.NODE_BODY[t] || this.NODE_BODY[type] || this.NODE_BODY.monster;
      return this._wrap('0 0 24 24', body, 'art art-node', 1.9);
    });
  },

  // 已走过的节点：用勾替代图标。
  // 勾是「已完成」里最不需要学的一眼符号 —— 比「把图标调淡」明确得多。
  check() {
    return this._memo('check', () => {
      return this._wrap('0 0 24 24', '<path d="M5 12.5l4.6 4.6L19 7.4"/>',
        'art art-node art-check', 2.6);
    });
  },

  // 大 Boss 节点：王冠图标 + 右下角的难度角标。
  // 王冠替代了原来的「1 / 2 / 3」数字，但难度分层是玩法信息，不能丢 —— 所以补角标。
  bossBadge(tier) {
    return '<span class="art-boss-badge">' + this.node('boss') +
      '<b class="art-boss-tier">' + tier + '</b></span>';
  },

  // ============================================================
  // 敌人剪影（11 种，64×64）
  //
  // 手法统一：主形体用 currentColor 实心剪影，特征细节用 art-hole 挖空。
  // 敌人面板里它们只有 56~88px，画得再细也看不清 —— 辨识度靠轮廓。
  // ============================================================

  ENEMY_BODY: {
    // 腐蚀鼠群：一只主鼠 + 两只小鼠 + 三条长尾（「群」靠数量表达）
    rats:
      '<ellipse cx="26" cy="38" rx="15" ry="9.5"/>' +
      '<ellipse cx="41" cy="36" rx="6.5" ry="6"/>' +
      '<circle cx="39" cy="27" r="4.5"/><circle cx="46" cy="28" r="4"/>' +
      '<path d="M12 41q-8 1-9 8" fill="none" stroke-width="2.5"/>' +
      '<ellipse cx="48" cy="52" rx="8" ry="5"/>' +
      '<circle cx="46" cy="45" r="3.5"/>' +
      '<path d="M41 54q-6 1-7 5" fill="none" stroke-width="2"/>' +
      '<ellipse cx="18" cy="57" rx="6" ry="3.5"/>' +
      '<path d="M12 58q-5 1-5 4" fill="none" stroke-width="1.8"/>' +
      '<circle class="art-hole" cx="43.5" cy="35" r="1.7"/>',

    // 锈蚀哨兵：直立人形 + 大盾 + 长枪
    sentinel:
      '<circle cx="34" cy="15" r="6.5"/>' +
      '<path d="M34 21.5v3.5" fill="none" stroke-width="4"/>' +
      '<path d="M25 25h18l3 22H22z"/>' +
      '<path d="M21 27q13-7 26 0" fill="none" stroke-width="2.5"/>' +
      '<path d="M7 26h14v13c0 6-7 10-7 10s-7-4-7-10z"/>' +
      '<path d="M47 8v44" fill="none" stroke-width="2.5"/>' +
      '<path d="M47 6l-2.5 7h5z"/>' +
      '<path d="M27 47v10M41 47v10" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="34" cy="14.5" r="1.7"/>',

    // 孢囊行者：菌盖加厚 + 菌柄加粗（上一版菌柄只有 10px，整体读成了「伞」）
    spore_walker:
      '<path d="M11 30a21 16 0 0 1 42 0z"/>' +
      '<path d="M20 30v-8M28 30v-11M36 30v-11M44 30v-8" ' +
      'class="art-hole-line" fill="none" stroke-width="2.2"/>' +
      '<path d="M26 30h12v15H26z"/>' +
      '<path d="M28 45l-2 12M36 45l2 12" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="30" cy="38" r="1.8"/>' +
      '<circle class="art-hole" cx="34" cy="38" r="1.8"/>' +
      '<circle cx="9" cy="14" r="2.4"/><circle cx="55" cy="17" r="2.2"/>' +
      '<circle cx="17" cy="7" r="1.8"/>',

    // 井壁爬虫：五节递减的体节 + 成对短腿
    crawler:
      '<circle cx="14" cy="32" r="9"/><circle cx="25" cy="30" r="8"/>' +
      '<circle cx="35" cy="32" r="7"/><circle cx="44" cy="38" r="6"/>' +
      '<circle cx="51" cy="46" r="5"/>' +
      '<path d="M13 41l-4 9M21 37l-3 10M31 38v11M40 43l3 9M46 50l4 7" ' +
      'fill="none" stroke-width="2"/>' +
      '<circle class="art-hole" cx="12" cy="29" r="2"/>',

    // 拾荒者残影：钟形斗篷 + 兜帽内影 + 竖褶皱（上一版只有轮廓，太空）
    scavenger_shade:
      '<path d="M32 7c9 0 15 11 17 25 .8 6 1.4 12 1.4 20H13.6c0-8 .6-14 1.4-20C17 18 23 7 32 7z"/>' +
      '<path class="art-hole" d="M32 14c6.4 0 10.6 5.6 11.6 13H20.4c1-7.4 5.2-13 11.6-13z" stroke="none"/>' +
      '<circle cx="27.6" cy="21.5" r="2.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="36.4" cy="21.5" r="2.2" fill="currentColor" stroke="none"/>' +
      '<path d="M22 34v16M32 37v13M42 34v16" fill="none" stroke-width="1.6" stroke-opacity=".5"/>',

    // 铁颚督军（精英）：肩甲加大 + 铁颚加宽（「铁颚」是它的名字，得看得见）
    warlord:
      '<path d="M21 27h22l3 22H18z"/>' +
      '<ellipse cx="14" cy="30" rx="8" ry="6"/><ellipse cx="50" cy="30" rx="8" ry="6"/>' +
      '<circle cx="32" cy="16" r="8.5"/>' +
      '<path d="M32 24v3" fill="none" stroke-width="4.5"/>' +
      '<path d="M24 19h16v4l-3.2 3.6-3.2-3.6-3.2 3.6-3.2-3.6-3.2 3.6z"/>' +
      '<path d="M20 49v9M44 49v9" fill="none" stroke-width="3.5"/>' +
      '<circle class="art-hole" cx="29" cy="14" r="1.8"/>' +
      '<circle class="art-hole" cx="35" cy="14" r="1.8"/>',

    // 双头犬（精英）：两头拉开 + 各加一张嘴
    // （上一版脖子粗到 6px，把两个头和身体连成了一坨，看起来像单头兽）
    hound:
      '<ellipse cx="32" cy="42" rx="15" ry="9"/>' +
      '<path d="M18 34l-3-5M46 34l3-5" fill="none" stroke-width="7"/>' +
      '<ellipse cx="13" cy="24" rx="8.5" ry="7"/><ellipse cx="51" cy="24" rx="8.5" ry="7"/>' +
      '<path d="M9 17l-2.5-8 6.5 3.5z"/><path d="M55 17l2.5-8-6.5 3.5z"/>' +
      '<path d="M8 27h9M47 27h9" fill="none" stroke-width="1.6"/>' +
      '<path d="M50 37q7-1 6-9" fill="none" stroke-width="2.5"/>' +
      '<path d="M20 49v9M28 50v8M38 50v8M46 49v9" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="11" cy="23" r="1.8"/>' +
      '<circle class="art-hole" cx="53" cy="23" r="1.8"/>',

    // 蚀骨工匠（精英）：人形 + 高举的骨锤 + 身上的骨刺
    bonewright:
      '<path d="M23 26h18l3 22H20z"/>' +
      '<circle cx="32" cy="18" r="7"/>' +
      '<path d="M32 24.5v2" fill="none" stroke-width="4"/>' +
      '<path d="M24 33l-6-3M40 35l6-3" fill="none" stroke-width="2.5"/>' +
      '<path d="M47 34l-3-18" fill="none" stroke-width="3"/>' +
      '<ellipse cx="46" cy="11" rx="8" ry="5"/>' +
      '<path d="M42 11h8" class="art-hole-line" fill="none" stroke-width="1.6"/>' +
      '<path d="M25 48v8M39 48v8" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="29" cy="17" r="1.6"/>' +
      '<circle class="art-hole" cx="35" cy="17" r="1.6"/>',

    // 锈冠（大 Boss tier1）：铁面改实心 + 眼洞加大
    // （上一版整块都是轮廓线，冠和面糊在一起，看起来像帽子叠方框）
    rust_crown:
      '<path d="M7 33V13l8.5 7.5L32 5l16.5 15.5L57 13v20z"/>' +
      '<path d="M7 33h50" fill="none" stroke-width="2"/>' +
      '<path d="M18 33h28v11a14 14 0 0 1-28 0z" fill="currentColor" stroke="none"/>' +
      '<circle class="art-hole" cx="24" cy="40" r="4"/>' +
      '<circle class="art-hole" cx="40" cy="40" r="4"/>' +
      '<circle cx="24" cy="40" r="1.6" fill="currentColor" stroke="none"/>' +
      '<circle cx="40" cy="40" r="1.6" fill="currentColor" stroke="none"/>' +
      '<circle class="art-hole" cx="32" cy="18" r="3"/>' +
      '<path d="M19 57h26" fill="none" stroke-width="4"/>',

    // 菌母（大 Boss tier2）：超大菌盖 + 菌褶 + 环绕的孢子
    mycelium_mother:
      '<path d="M6 34a26 20 0 0 1 52 0z"/>' +
      '<path d="M16 34v-9M24 34v-13M32 34v-15M40 34v-13M48 34v-9" ' +
      'class="art-hole-line" fill="none" stroke-width="2"/>' +
      '<path d="M24 34h16v16H24z"/>' +
      '<path d="M28 50l-6 7M36 50l6 7M32 50v7" fill="none" stroke-width="2.5"/>' +
      '<circle class="art-hole" cx="28" cy="41" r="1.8"/>' +
      '<circle class="art-hole" cx="36" cy="41" r="1.8"/>' +
      '<circle cx="8" cy="18" r="2.6"/><circle cx="56" cy="16" r="2.2"/>' +
      '<circle cx="14" cy="46" r="2"/><circle cx="50" cy="44" r="2.4"/>' +
      '<circle cx="32" cy="7" r="2"/>',

    // 无首执械者（大 Boss tier3）：躯干加宽压矮 + 刃做实心
    // （第四版：腿从刃的两端收进躯干内侧 —— 之前腿长在最外侧，整体读成了「带腿的长凳」）
    headless_executor:
      '<path d="M15 26h34l3 20H12z"/>' +
      '<ellipse class="art-hole" cx="32" cy="26" rx="9.5" ry="4" stroke="none"/>' +
      '<ellipse cx="12" cy="30" rx="8.5" ry="6.5"/><ellipse cx="52" cy="30" rx="8.5" ry="6.5"/>' +
      '<path d="M18 37l-3 9M46 37l3 9" fill="none" stroke-width="5.5"/>' +
      '<rect x="9" y="44" width="46" height="5" rx="2" fill="currentColor" stroke="none"/>' +
      '<path d="M9 46.5h46" class="art-hole-line" fill="none" stroke-width="1.2"/>' +
      '<path d="M26 49v10M38 49v10" fill="none" stroke-width="3.5"/>' +
      '<circle class="art-hole" cx="32" cy="36" r="3.2"/>',
    // ---- M50 新增：第二关普通怪（锈蚀遗迹机械系）----

    // 电弧焊工：人形 + 高举的焊枪 + 枪口蹦出的电弧（一道折线，不是三根短线 ——
    // 22~64px 下「折线」比「放射线」更像电）
    arc_welder:
      '<circle cx="32" cy="17" r="7"/>' +
      '<path d="M32 24v3" fill="none" stroke-width="4"/>' +
      '<path d="M23 27h18l3 21H20z"/>' +
      '<path d="M41 31l9-11" fill="none" stroke-width="3.5"/>' +
      '<path d="M50 20l3-6" fill="none" stroke-width="3"/>' +
      '<path d="M53 13l4-3-3-2 4-4" fill="none" stroke-width="2"/>' +
      '<path d="M23 31l-5 9" fill="none" stroke-width="3"/>' +
      '<path d="M25 48v9M39 48v9" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="29" cy="16" r="1.7"/>' +
      '<circle class="art-hole" cx="35" cy="16" r="1.7"/>',

    // 桩击机：顶部大锤 + 立柱机身 + 履带底座。
    // 特征只给两处（锤 / 履带）—— 它和锈蚀哨兵都是「直立机器」，
    // 靠「有没有盾」和「脚下是腿还是履带」区分。
    pile_driver:
      '<ellipse cx="32" cy="8" rx="8" ry="4.5"/>' +
      '<path d="M32 12v7" fill="none" stroke-width="5"/>' +
      '<path d="M17 19h30" fill="none" stroke-width="4"/>' +
      '<rect x="22" y="21" width="20" height="26" rx="3"/>' +
      '<path d="M13 47h38v9H13z"/>' +
      '<path d="M19 51.5h26" class="art-hole-line" fill="none" stroke-width="1.8"/>' +
      '<circle class="art-hole" cx="27" cy="30" r="2.2"/>' +
      '<circle class="art-hole" cx="37" cy="30" r="2.2"/>' +
      '<path d="M32 35v6" class="art-hole-line" fill="none" stroke-width="1.8"/>',

    // ---- M50 新增：第三关专属普通怪（菌丝研究所系）----

    // 菌壳矛兵：宽肩甲 + 斜举短矛（不是哨兵那种竖持长枪）+ 没有盾。
    // 「斜举」是它和锈蚀哨兵唯一的强区分点，所以矛一定要斜、且不落地。
    husk_lancer:
      '<path d="M20 29h24l2 20H18z"/>' +
      '<ellipse cx="32" cy="26" rx="15" ry="6"/>' +
      '<circle cx="32" cy="15" r="6"/>' +
      '<path d="M32 21v6" fill="none" stroke-width="3.5"/>' +
      '<path d="M44 31l11-18" fill="none" stroke-width="2.6"/>' +
      '<path d="M56 11l1-8-6.5 4z"/>' +
      '<path d="M20 49v8M44 49v8" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="29" cy="14" r="1.6"/>' +
      '<circle class="art-hole" cx="35" cy="14" r="1.6"/>',

    // 菌索爬行体：一团缠绕的索 + 两只眼 + 三根须足 + 两粒孢子。
    // 与井壁爬虫的分界：爬虫是「分节的柱体」，这里是「打结的一团」。
    cord_creeper:
      '<circle cx="20" cy="36" r="9"/>' +
      '<circle cx="33" cy="32" r="10"/>' +
      '<circle cx="46" cy="37" r="8"/>' +
      '<path d="M10 44q11 7 22 1t20-2" fill="none" stroke-width="3"/>' +
      '<path d="M8 28q7-8 16-5" fill="none" stroke-width="2.4"/>' +
      '<path d="M24 43l-3 11M34 41v12M45 44l3 10" fill="none" stroke-width="2"/>' +
      '<circle class="art-hole" cx="17" cy="33" r="2"/>' +
      '<circle class="art-hole" cx="31" cy="29" r="2"/>' +
      '<circle cx="53" cy="19" r="2.4"/>' +
      '<circle cx="14" cy="13" r="1.8"/>',

    // ---- M50 新增：中 Boss ----

    // 锈蚀百夫长（第二关）：正面鸢形大盾 + 羽冠 + 短剑。
    // 盾内部**只留一条盾脊** —— 第一版画了十字分格，122px 下读成了「窗户」；
    // 一整块实心 + 中缝 + 旁边露出半个人，才是「扛着塔盾的方阵兵」。
    centurion:
      '<path d="M6 13h20v24l-10 6-10-6z"/>' +
      '<path d="M16 13v28" class="art-hole-line" fill="none" stroke-width="1.8"/>' +
      '<circle cx="42" cy="14" r="7"/>' +
      '<path d="M34 9h16v4l-3.2 3.6-3.2-3.6-3.2 3.6-3.2-3.6z"/>' +
      '<path d="M36 21h14l2 24H34z"/>' +
      '<path d="M49 26l9-6" fill="none" stroke-width="3"/>' +
      '<path d="M57 21l4-6" fill="none" stroke-width="2.4"/>' +
      '<path d="M38 45v11M48 45v11" fill="none" stroke-width="3"/>' +
      '<circle class="art-hole" cx="39" cy="13" r="1.7"/>' +
      '<circle class="art-hole" cx="45" cy="13" r="1.7"/>',

    // 缝合暴君（第三关）：不对称的巨躯 —— 右臂粗、左臂细，头是缝上去的一块。
    // 「缝合」的两个识别点：颈部一道虚线缝口 + 两根跨缝的缝合钉；
    // 再加胸口一道十字缝。**不对称就是它的辨识点**（其他中 Boss 都左右对称）。
    stitch_tyrant:
      '<path d="M14 26h30l4 24H10z"/>' +
      '<path d="M23 13h18l-1.5 10h-15z"/>' +
      '<path d="M22 24h22" class="art-hole-line" fill="none" stroke-width="2" ' +
      'stroke-dasharray="3 3"/>' +
      '<path d="M27 20.5v7M35 20.5v7" class="art-hole-line" fill="none" stroke-width="1.6"/>' +
      '<path d="M21 33l10 9M31 33l-10 9" class="art-hole-line" fill="none" stroke-width="1.6"/>' +
      '<path d="M44 28l12 7-4 10" fill="none" stroke-width="6"/>' +
      '<path d="M14 30l-8 10" fill="none" stroke-width="4"/>' +
      '<path d="M20 50v8M36 50v8" fill="none" stroke-width="3.5"/>' +
      '<circle class="art-hole" cx="28.5" cy="18" r="2"/>' +
      '<circle class="art-hole" cx="36.5" cy="18" r="2"/>',

    // ==================== M56 进化体（12 只）====================
    // 与一阶剪影同一套语言：主形体 currentColor 实心 + art-hole 挖空，
    // 辨识点 = 一阶特征「放大 + 增生」，不是换形状。

    // 锈牙鼠王（← 鼠群）：一只大鼠占满画面 + 背上锈铁片（斜方块）
    rat_king:
      '<ellipse cx="27" cy="36" rx="19" ry="12"/>' +
      '<ellipse cx="47" cy="33" rx="8" ry="7.5"/>' +
      '<circle cx="45" cy="21" r="6"/>' +
      '<circle class="art-hole" cx="47.5" cy="20" r="1.8"/>' +
      '<path d="M14 44q-9 2-11 10" fill="none" stroke-width="3"/>' +
      '<path d="M20 26l6-5 5 5-5 4z" class="art-hole"/>' +
      '<path d="M28 50l-2 9M38 50l2 9M48 49l3 8" fill="none" stroke-width="3"/>',

    // 哨兵·破城型（← 哨兵）：塔盾 + 盾面撞角（三角挖空）
    sentinel_breach:
      '<path d="M16 52V22a16 16 0 0 1 32 0v30z"/>' +
      '<path d="M22 30l5 6 5-6" class="art-hole"/>' +
      '<circle class="art-hole" cx="38" cy="40" r="3.5"/>' +
      '<path d="M42 18l7-6M45 24l8-4" fill="none" stroke-width="3"/>' +
      '<path d="M20 52v6M44 52v6" fill="none" stroke-width="4"/>',

    // 孢囊行者·孕体（← 孢囊行者）：背囊胀大占半身 + 囊内透光斑
    spore_gravid:
      '<circle cx="34" cy="26" r="17"/>' +
      '<circle class="art-hole" cx="28" cy="20" r="4"/>' +
      '<circle class="art-hole" cx="40" cy="30" r="2.6"/>' +
      '<path d="M24 42h14v14H24z"/>' +
      '<path d="M27 56l-3 8M36 56l3 8" fill="none" stroke-width="3"/>' +
      '<circle cx="12" cy="12" r="2.4"/><circle cx="52" cy="14" r="2"/>',

    // 蜕壳武者（← 爬虫）：体节上驮旧壳（弧形挖空甲缝）
    crawler_molt:
      '<ellipse cx="30" cy="34" rx="21" ry="10"/>' +
      '<path d="M14 32a17 9 0 0 1 30 0" class="art-hole-line" fill="none" stroke-width="2"/>' +
      '<ellipse cx="49" cy="30" rx="6" ry="5.5"/>' +
      '<circle class="art-hole" cx="51" cy="28" r="1.6"/>' +
      '<path d="M16 43l-4 10M26 44l-1 10M36 44l2 10M44 42l5 9" fill="none" stroke-width="2.6"/>',

    // 残影·聚尸者（← 残影）：飘带身 + 拖着一串破烂（方块链条）
    shade_gatherer:
      '<path d="M30 8a14 14 0 0 1 14 14c0 8-4 10-4 18H20c0-8-4-10-4-18A14 14 0 0 1 30 8z"/>' +
      '<circle class="art-hole" cx="25" cy="18" r="2.2"/>' +
      '<circle class="art-hole" cx="35" cy="18" r="2.2"/>' +
      '<rect x="47" y="30" width="7" height="7" fill="none" stroke-width="2.4"/>' +
      '<rect x="53" y="40" width="5" height="5" fill="none" stroke-width="2"/>' +
      '<path d="M44 28l4 3M52 37l2 3" fill="none" stroke-width="1.8"/>' +
      '<path d="M22 40v12M38 40v12" fill="none" stroke-width="2.4"/>',

    // 鼠潮母兽（← 鼠王）：缠成浊流的鼠团 —— 三层椭圆叠涌 + 一只大头
    rat_tide:
      '<ellipse cx="28" cy="40" rx="22" ry="11"/>' +
      '<ellipse cx="36" cy="30" rx="16" ry="9"/>' +
      '<ellipse cx="44" cy="22" rx="9" ry="7"/>' +
      '<circle cx="47" cy="13" r="5"/>' +
      '<circle class="art-hole" cx="49" cy="12" r="1.6"/>' +
      '<circle class="art-hole" cx="44" cy="14" r="1.4"/>' +
      '<path d="M8 46q-6 4-7 10" fill="none" stroke-width="2.6"/>' +
      '<path d="M14 51l-3 7M26 52l-1 7M40 51l2 7" fill="none" stroke-width="2.6"/>',

    // 哨兵·攻城型（← 破城型）：肩上曲射炮（斜筒）+ 盾面菌壳斑
    sentinel_siege:
      '<path d="M15 52V20a17 17 0 0 1 34 0v32z"/>' +
      '<path d="M21 28l6 7 6-7" class="art-hole"/>' +
      '<circle class="art-hole" cx="37" cy="42" r="3"/>' +
      '<path d="M40 14l14-8v10l-12 5z"/>' +
      '<circle class="art-hole" cx="49" cy="9" r="1.8"/>' +
      '<path d="M27 20a10 6 0 0 1 12 0" class="art-hole-line" fill="none" stroke-width="1.8"/>' +
      '<path d="M19 52v6M45 52v6" fill="none" stroke-width="4"/>',

    // 孢囊母株（← 孕体）：塔状定生 + 三颗成熟孢囊
    spore_mother:
      '<path d="M22 56l3-22h14l3 22z"/>' +
      '<circle cx="20" cy="24" r="8"/><circle cx="34" cy="16" r="10"/><circle cx="46" cy="26" r="7"/>' +
      '<circle class="art-hole" cx="34" cy="14" r="2.6"/>' +
      '<circle class="art-hole" cx="19" cy="23" r="1.8"/>' +
      '<circle class="art-hole" cx="46" cy="25" r="1.6"/>' +
      '<path d="M26 56v-8M38 56v-8" class="art-hole-line" fill="none" stroke-width="1.8"/>',

    // 井壁巨螯（← 蜕壳武者）：双巨螯 + 嵌甲背壳
    crawler_maul:
      '<ellipse cx="28" cy="38" rx="18" ry="11"/>' +
      '<path d="M12 34a16 10 0 0 1 26 0" class="art-hole-line" fill="none" stroke-width="2"/>' +
      '<path d="M44 34l10-8 6 5-9 9z"/>' +
      '<path d="M44 40l11 5-4 8-8-6z"/>' +
      '<circle class="art-hole" cx="53" cy="29" r="1.4"/>' +
      '<circle class="art-hole" cx="52" cy="47" r="1.4"/>' +
      '<path d="M16 48l-3 9M26 49l0 9M36 48l3 9" fill="none" stroke-width="2.6"/>',

    // 百衲怨影（← 聚尸者）：三层影叠成 + 每层一只伸手
    shade_patch:
      '<path d="M30 4a13 13 0 0 1 13 13c0 7-3 9-3 15H20c0-6-3-8-3-15A13 13 0 0 1 30 4z"/>' +
      '<circle class="art-hole" cx="26" cy="13" r="2"/>' +
      '<circle class="art-hole" cx="34" cy="13" r="2"/>' +
      '<path d="M17 32h-9M43 32h9" fill="none" stroke-width="4"/>' +
      '<path d="M17 40h-12M43 40h12" fill="none" stroke-width="3.4"/>' +
      '<path d="M20 32c0 8-2 10-2 16h24c0-6-2-8-2-16" fill="none" stroke-width="2.4"/>',

    // 过载工头（← 电弧焊工）：双臂弧光鞭 + 胸口喷汽（白洞）
    welder_overload:
      '<path d="M18 52V24a14 14 0 0 1 28 0v28z"/>' +
      '<circle cx="32" cy="18" r="9"/>' +
      '<circle class="art-hole" cx="29" cy="17" r="1.8"/>' +
      '<circle class="art-hole" cx="35" cy="17" r="1.8"/>' +
      '<path d="M18 30l-12 6 3 6 10-4" fill="none" stroke-width="3.4"/>' +
      '<path d="M46 30l12 8-3 6-10-5" fill="none" stroke-width="3.4"/>' +
      '<circle class="art-hole" cx="32" cy="34" r="3"/>' +
      '<path d="M24 52v7M40 52v7" fill="none" stroke-width="3.4"/>',

    // 破桩者（← 桩击机）：粗桩臂 + 桩头菌壳包层（弧纹）
    piledriver_breach:
      '<path d="M20 50V22a12 12 0 0 1 24 0v28z"/>' +
      '<circle cx="32" cy="16" r="8"/>' +
      '<circle class="art-hole" cx="29" cy="15" r="1.7"/>' +
      '<circle class="art-hole" cx="35" cy="15" r="1.7"/>' +
      '<path d="M46 26h10v14H46z"/>' +
      '<path d="M48 29a6 4 0 0 1 6 0" class="art-hole-line" fill="none" stroke-width="1.6"/>' +
      '<path d="M48 36h6" class="art-hole-line" fill="none" stroke-width="1.6"/>' +
      '<path d="M24 50v8M38 50v8" fill="none" stroke-width="4"/>',
  },

  enemy(id) {
    return this._memo('e:' + id, () => {
      const body = this.ENEMY_BODY[id] || this.ENEMY_BODY.rats;
      return this._wrap('0 0 64 64', body, 'art art-enemy', 1.5);
    });
  },

  // ============================================================
  // 角色半身像（3 种，64×64）—— 战斗面板的玩家区用
  // 三人共用「肩 + 头」的基础形，靠帽子 / 口罩 / 提灯区分 ——
  // 它们只有 56px，靠小道具区分比靠脸可靠。
  // ============================================================

  CHAR_BODY: {
    // 掘者：矿工帽 + 头灯
    digger:
      '<path d="M10 58v-6c0-6 8-10 22-10s22 4 22 10v6z"/>' +
      '<ellipse cx="32" cy="38" rx="9" ry="8.5"/>' +
      '<path d="M16 28a16 16 0 0 1 32 0z"/>' +
      '<path d="M12 28h40" fill="none" stroke-width="2.5"/>' +
      '<circle class="art-hole" cx="32" cy="19" r="4"/>' +
      '<circle cx="32" cy="19" r="1.6" fill="currentColor" stroke="none"/>' +
      '<circle class="art-hole" cx="28" cy="37" r="1.5"/>' +
      '<circle class="art-hole" cx="36" cy="37" r="1.5"/>',

    // 拾荒医师：兜帽 + 口罩 + 肩上的药箱
    medic:
      '<path d="M10 58v-6c0-6 8-10 22-10s22 4 22 10v6z"/>' +
      '<ellipse cx="32" cy="36" rx="9" ry="8.5"/>' +
      '<path d="M32 12c10 0 16 10 16 20H16c0-10 6-20 16-20z"/>' +
      '<path d="M23 38h18v5a9 9 0 0 1-18 0z"/>' +
      '<path d="M50 44h10v14H50z"/>' +
      '<path d="M55 47v8M51 51h8" class="art-hole-line" fill="none" stroke-width="2"/>' +
      '<circle class="art-hole" cx="28" cy="32" r="1.5"/>' +
      '<circle class="art-hole" cx="36" cy="32" r="1.5"/>',

    // 引火者：尖兜帽 + 手提的燃灯
    keeper:
      '<path d="M10 58v-6c0-6 8-10 22-10s22 4 22 10v6z"/>' +
      '<ellipse cx="32" cy="36" rx="9" ry="8.5"/>' +
      '<path d="M32 10c11 0 16 11 16 22H16c0-11 5-22 16-22z"/>' +
      '<path class="art-hole" d="M32 15c6 0 9 6 9 12H23c0-6 3-12 9-12z" stroke="none"/>' +
      '<circle cx="30" cy="22" r="1.8" fill="currentColor" stroke="none"/>' +
      '<circle cx="35" cy="22" r="1.8" fill="currentColor" stroke="none"/>' +
      '<path d="M50 38v6" fill="none" stroke-width="2"/>' +
      '<circle cx="50" cy="50" r="7"/>' +
      '<path d="M50 45c1.8 2.6 2.6 3.5 2.6 4.9a2.6 2.6 0 0 1-5.2 0c0-1.4.8-2.3 2.6-4.9z" ' +
      'fill="currentColor" stroke="none"/>',
  },

  char(id) {
    return this._memo('c:' + id, () => {
      const body = this.CHAR_BODY[id] || this.CHAR_BODY.digger;
      return this._wrap('0 0 64 64', body, 'art art-char', 1.5);
    });
  },

  // ============================================================
  // 意图图标（16×16）—— 战斗面板里加在「意图 ·」文字前面的图形
  // 文字前缀仍然保留（探针与无障碍都依赖它），图标只是加在它前面。
  // ============================================================

  INTENT_BODY: {
    // 攻击：斜置的剑
    attack:
      '<path d="M14.2 2.2L5.8 10.6" stroke-width="2.2"/>' +
      '<path d="M4.2 9l3.2 3.2" stroke-width="2"/>' +
      '<path d="M5.6 11.4l-2.6 2.6 2.6 2.2 2.4-2.4z" fill="currentColor" stroke="none"/>',
    // 增益：向上箭头
    buff:
      '<path d="M8 15V4.5" stroke-width="2.1"/>' +
      '<path d="M3.6 8.9L8 4.5l4.4 4.4" stroke-width="2.1"/>',
    // 防御：盾
    defend:
      '<path d="M8 2l6 2.4v5.4c0 3.8-3.4 6.6-6 7.6-2.6-1-6-3.8-6-7.6V4.4z"/>',
    // 减益：向下箭头
    debuff:
      '<path d="M8 2v10.5" stroke-width="2.1"/>' +
      '<path d="M3.6 8.1L8 12.5l4.4-4.4" stroke-width="2.1"/>',
    // 特殊：四角星
    special:
      '<path d="M8 1.5l1.8 4.7 4.7 1.8-4.7 1.8L8 14.5l-1.8-4.7L1.5 8l4.7-1.8z"/>',
  },

  intent(kind) {
    const k = this.INTENT_BODY[kind] ? kind : 'special';
    return this._memo('i:' + k, () => {
      return this._wrap('0 0 16 16', this.INTENT_BODY[k], 'art art-intent', 1.5);
    });
  },

  // ------------------------------------------------------------
  // 状态图标（M20，16×16）—— 战斗面板状态胶囊从「文字」精简为「图标 + 数字角标」，
  // 全名进 title（悬停可见），战斗日志里仍是全名（combat.js 的 log 不动）。
  // kind 分色：buff 绿 / debuff 红 / neutral 灰（抽牌堆等信息片）。
  // 未知 key 兜底成四角星，不会产出空图。
  // ------------------------------------------------------------
  BUFF_ICON: {
    // —— 格挡（盾，与意图 defend 同形）——
    block:
      '<path d="M8 2l6 2.4v5.4c0 3.8-3.4 6.6-6 7.6-2.6-1-6-3.8-6-7.6V4.4z"/>',
    // —— 增益（绿）——
    str: // 力量：上箭头
      '<path d="M8 14V4" stroke-width="2.1"/>' +
      '<path d="M3.8 8.2L8 4l4.2 4.2" stroke-width="2.1"/>',
    dex: // 敏捷：右上滑箭
      '<path d="M3 13L12.5 3.5" stroke-width="2"/>' +
      '<path d="M7 3.5h5.5V9" stroke-width="2"/>',
    regen: // 再生：心形
      '<path d="M8 13.5C4 10.5 2.5 8.3 2.5 6.3 2.5 4.5 3.9 3 5.7 3 6.8 3 7.6 3.5 8 4.3 8.4 3.5 9.2 3 10.3 3c1.8 0 3.2 1.5 3.2 3.3 0 2-1.5 4.2-5.5 7.2z" fill="currentColor" stroke="none"/>',
    thorns: // 荆棘：刺球
      '<circle cx="8" cy="8" r="3.6"/>' +
      '<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.3 1.3M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.3" stroke-width="1.4"/>',
    metallicize: // 金属化：六边形
      '<path d="M8 1.8l5.2 3v6.4l-5.2 3-5.2-3V4.8z" stroke-width="1.8"/>',
    barricade: // 壁垒：砖墙
      '<rect x="2" y="3.5" width="12" height="9" rx="1"/>' +
      '<path d="M2 8h12M6.5 3.5v4.5M9.5 8v4.5" stroke-width="1.4"/>',
    strPerTurn: // 力量成长：上箭头 + 底线
      '<path d="M8 12V3.5" stroke-width="2"/>' +
      '<path d="M4.4 6.9L8 3.3l3.6 3.6" stroke-width="2"/>' +
      '<path d="M3 14.2h10" stroke-width="1.6"/>',
    strTurn: // 本回合力量：闪电
      '<path d="M9 1.8L4 9h3.4L7 14.2 12 7H8.6z" fill="currentColor" stroke="none"/>',
    resPerTurn: // 资源产量：圆圈加号
      '<circle cx="8" cy="8" r="5.8"/>' +
      '<path d="M8 5.4v5.2M5.4 8h5.2" stroke-width="1.8"/>',
    parasiteBonus: // 寄生强化：小虫 + 点
      '<ellipse cx="8" cy="9.5" rx="3.4" ry="4"/>' +
      '<path d="M6 5.2L4.6 3M10 5.2L11.4 3" stroke-width="1.4"/>' +
      '<circle cx="12.4" cy="12.4" r="1.6" fill="currentColor" stroke="none"/>',
    undying: // 不灭：医疗十字
      '<path d="M6 2.5h4V6h3.5v4H10v3.5H6V10H2.5V6H6z" fill="currentColor" stroke="none"/>',
    // —— 减益（红）——
    weak: // 虚弱：向下箭头
      '<path d="M8 2v10.5" stroke-width="2.1"/>' +
      '<path d="M3.6 8.1L8 12.5l4.4-4.4" stroke-width="2.1"/>',
    vulnerable: // 脆弱：靶心
      '<circle cx="8" cy="8" r="5.8"/>' +
      '<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
    poison: // 中毒：水滴
      '<path d="M8 1.8C8 1.8 3.6 7.6 3.6 10.6a4.4 4.4 0 008.8 0C12.4 7.6 8 1.8 8 1.8z"/>',
    burn: // 燃烧：火焰
      '<path d="M8 1.6c.8 2.8-3.2 3.8-3.2 6.9a3.6 3.6 0 007.2 0c0-1.6-1-2.6-1.6-3.7-.7 1-1.9 1.2-2.4-3.2z"/>',
    parasite: // 寄生：小虫
      '<ellipse cx="8" cy="9.5" rx="3.4" ry="4"/>' +
      '<path d="M6 5.2L4.6 3M10 5.2L11.4 3" stroke-width="1.4"/>',
    // —— 中性（灰，牌堆信息）——
    draw: // 抽牌堆：两张叠牌
      '<rect x="2" y="3" width="7.5" height="10" rx="1.2"/>' +
      '<path d="M11 4.6l2 .6-2.6 8.4-2-.6"/>',
    discard: // 弃牌堆：翻开的单牌
      '<rect x="3.5" y="2.5" width="9" height="11" rx="1.2"/>' +
      '<path d="M3.5 5.5h9" stroke-width="1.3"/>',
    exhaust: // 消化堆：禁止符
      '<circle cx="8" cy="8" r="5.8"/>' +
      '<path d="M4.2 4.2l7.6 7.6" stroke-width="1.8"/>',
  },

  // 状态键 → 图标。未知 key 兜底四角星（与意图的兜底同一枚）。
  buffIcon(key) {
    const body = this.BUFF_ICON[key] || this.INTENT_BODY.special;
    return this._memo('b:' + key, () => {
      return this._wrap('0 0 16 16', body, 'art art-buff', 1.5);
    });
  },

  // ============================================================
  // 遗物图标（M58 引入 / M61 卡通化重绘）—— 24×24 物品剪影。
  // 与卡牌刻意区分：卡是「位图 + 矩形框的纸牌」，遗物是「自由轮廓的物件」。
  // 卡通语言与敌人立绘统一：实心胖剪影（linejoin round 兜圆角）+
  // art-hole 白色挖洞（表盘/眼睛/裂纹/高光），20px 托盘缩小后靠剪影认物。
  // 颜色走 currentColor：托盘 / 面板用稀有度色上色，同一份 SVG 两处通用。
  // 键 = RELICS 的 id；新增遗物必须来这里登记，查不到兜底一枚圆牌。
  // ============================================================
  RELIC_BODY: {
    // 锈蚀罗盘：提环 + 圆胖表体 + 白表盘 + 菱形指针 + 高光
    alloy_compass:
      '<path d="M9.8 4.4a2.4 2.4 0 0 1 4.4 0" fill="none"/>' +
      '<circle cx="12" cy="13.2" r="8"/>' +
      '<circle cx="12" cy="13.2" r="5.1" class="art-hole" stroke="none"/>' +
      '<path d="M12 10l1.3 3.2-1.3 3.2-1.3-3.2z" fill="currentColor" stroke="none"/>' +
      '<circle cx="9.3" cy="10.8" r=".9" class="art-hole" stroke="none"/>',

    // 井壁吊坠：挂绳 + 圆胖水滴坠 + 白孔 + 白弧光
    shaft_pendant:
      '<path d="M4.6 3.2c2.5 2.5 4.9 3.7 7.4 4.5" fill="none"/>' +
      '<path d="M19.4 3.2c-2.5 2.5-4.9 3.7-7.4 4.5" fill="none"/>' +
      '<circle cx="12" cy="8.6" r="1.6"/>' +
      '<path d="M12 7.8c3.6 0 6.3 2.7 6.3 6.3 0 4.1-2.7 6.9-6.3 6.9s-6.3-2.8-6.3-6.9c0-3.6 2.7-6.3 6.3-6.3z"/>' +
      '<circle cx="12" cy="10.8" r="1.1" class="art-hole" stroke="none"/>' +
      '<path d="M9.2 14.6c.5 2 1.4 3.1 2.8 3.5" class="art-hole-line" fill="none"/>',

    // 井壁碎片：圆胖岩块 + 白裂纹 + 白凹坑
    shaft_shard:
      '<path d="M6.9 4.6c3-1.5 7.3-1.3 10 .5 2.4 1.6 3.2 5.3 2 8.5-1 2.8-3.3 5.7-6.5 6.1-3.4.4-6.5-2-7.5-5.3-1-3.6-.4-8.2 2-9.8z"/>' +
      '<path d="M10.6 7l1.2 3.3-2 2.5 1.6 3.5" class="art-hole-line" fill="none"/>' +
      '<circle cx="8.5" cy="9.6" r="1" class="art-hole" stroke="none"/>',

    // 苔藓护符：圆胖圆盘 + 头顶三坨苔藓 + 白高光
    moss_charm:
      '<circle cx="12" cy="15" r="7"/>' +
      '<circle cx="12" cy="9.2" r="4.4"/>' +
      '<circle cx="9.2" cy="7.6" r="1.9"/>' +
      '<circle cx="14.6" cy="7.2" r="1.6"/>' +
      '<circle cx="12" cy="5.9" r="1.5"/>' +
      '<circle cx="9.7" cy="13.6" r="1.2" class="art-hole" stroke="none"/>' +
      '<circle cx="14.2" cy="16.8" r="1" class="art-hole" stroke="none"/>',

    // 断绳：两截粗绳 + 绳头圆结 + 炸毛
    rope_scrap:
      '<path d="M3.5 6c3.2 2.6 6 3.6 8.6 3.9" fill="none" stroke-width="3"/>' +
      '<path d="M11.9 14.1c2.6.3 5.4 1.3 8.6 3.9" fill="none" stroke-width="3"/>' +
      '<circle cx="12.4" cy="10" r="1.5"/>' +
      '<circle cx="11.6" cy="14" r="1.5"/>' +
      '<path d="M13.6 8.1l1.6-1.4M13 6.7l1-1.6M10.4 15.9l-1.7 1.2M11 17.3l-.9 1.6" fill="none" stroke-width="1.3"/>',

    // 火种读数仪：提梁 + 圆胖灯体 + 白玻璃窗 + 火苗
    ember_reader:
      '<path d="M9.6 4.2a2.6 2.6 0 0 1 4.8 0" fill="none"/>' +
      '<path d="M8.6 6.6h6.8l1.4 12.6H7.2z"/>' +
      '<path d="M10.1 9.4h3.8l.7 7.4H9.4z" class="art-hole" stroke="none"/>' +
      '<path d="M12 11.4c1 1.1 1.5 2 1.5 2.8a1.5 1.5 0 1 1-3 0c0-.8.5-1.7 1.5-2.8z" fill="currentColor" stroke="none"/>' +
      '<path d="M6.6 21h10.8" fill="none" stroke-width="1.8"/>',

    // 黄铜齿轮：胖轮体 + 8 根圆头短齿 + 白轴孔 + 高光
    brass_gear:
      '<circle cx="12" cy="12" r="6.8"/>' +
      '<path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2M5.4 5.4l2.3 2.3M16.3 16.3l2.3 2.3M18.6 5.4l-2.3 2.3M7.7 16.3l-2.3 2.3" stroke-width="3" fill="none"/>' +
      '<circle cx="12" cy="12" r="2.6" class="art-hole" stroke="none"/>' +
      '<circle cx="9.8" cy="9.4" r="1" class="art-hole" stroke="none"/>',

    // 火漆印：圆胖蜡滴 + 白星压纹
    wax_seal:
      '<path d="M12 3.4c4.4 0 7.8 3 7.8 6.8 0 2.4-1.2 4-2 5.6-.8 1.7-2.8 2.7-5.8 2.7s-5-1-5.8-2.7c-.8-1.6-2-3.2-2-5.6 0-3.8 3.4-6.8 7.8-6.8z"/>' +
      '<path d="M12 8.2l1.1 2.3 2.5.4-1.8 1.7.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.7 2.5-.4z" class="art-hole" stroke="none"/>',

    // 老油灯：火苗 + 圆胖灯碗 + 白高光 + 底座
    old_lamp:
      '<path d="M12 3.4c1.5 1.9 2.2 3.2 2.2 4.4a2.2 2.2 0 1 1-4.4 0c0-1.2.7-2.5 2.2-4.4z" fill="currentColor" stroke="none"/>' +
      '<path d="M6.4 15c0-2.8 2.5-4.8 5.6-4.8s5.6 2 5.6 4.8c0 1.3-.7 2.1-1.7 2.1H8.1c-1 0-1.7-.8-1.7-2.1z"/>' +
      '<path d="M6.6 20.6h10.8" fill="none" stroke-width="2"/>' +
      '<circle cx="9.7" cy="13.6" r="1" class="art-hole" stroke="none"/>',

    // 粉笔标记：圆胖粉笔 + 彩色弧形记号 + 粉尘点
    chalk_mark:
      '<rect x="3" y="14.4" width="10.6" height="4.8" rx="2.4" transform="rotate(-38 8.3 16.8)"/>' +
      '<path d="M13.8 10.2c2-1.8 4.6-2.2 6.9-1.2" fill="none" stroke-dasharray="2.6 2.2"/>' +
      '<circle cx="20.4" cy="12.6" r=".8" fill="currentColor" stroke="none"/>' +
      '<circle cx="17.8" cy="14.2" r=".6" fill="currentColor" stroke="none"/>',

    // 皮质绑带：斜置胖带条 + 白扣 + 铜针
    leather_strap:
      '<rect x="8.7" y="2.4" width="6.6" height="19.2" rx="3.3" transform="rotate(45 12 12)"/>' +
      '<rect x="9.7" y="9.7" width="4.6" height="4.6" rx="1.3" transform="rotate(45 12 12)" class="art-hole" stroke="none"/>' +
      '<rect x="11.3" y="11.3" width="1.4" height="1.4" transform="rotate(45 12 12)" fill="currentColor" stroke="none"/>',

    // 鼠獠牙：圆胖弯牙 + 白弧光 + 高光
    rat_fang:
      '<path d="M7.4 3c4.5 1.8 7.4 5.7 8.6 11 .5 2.2.5 4.6 0 7.1-1.8-2.7-4.2-4.5-7.3-5.9-3.3-1.5-4.5-6.7-1.3-12.2z"/>' +
      '<path d="M9.9 6.4c2 1.7 3.4 3.9 4.2 6.7" class="art-hole-line" fill="none" stroke-width="1.4"/>' +
      '<circle cx="8.9" cy="5.4" r=".9" class="art-hole" stroke="none"/>',

    // 矿工手套：圆胖连指手套 + 袖口 + 白缝线
    miners_gloves:
      '<path d="M6.2 9.4a2 2 0 0 1 4 0v2a2.4 2.4 0 0 1 4.8.4v2.8c0 3.8-2.5 6.2-6.1 6.2-3.4 0-6.3-2.5-6.3-6.3v-1.7a1.9 1.9 0 0 1 3.6-.5z"/>' +
      '<rect x="4.6" y="18.4" width="10.8" height="3.6" rx="1.8"/>' +
      '<path d="M9.2 13.8v3.2" class="art-hole-line" fill="none" stroke-width="1.3"/>',

    // 烟灰符：挂绳 + 圆胖木牌 + 白烟纹 + 白烟点
    soot_charm:
      '<path d="M12 2.4v2.8" fill="none"/>' +
      '<rect x="7.2" y="5.2" width="9.6" height="14.6" rx="3.2"/>' +
      '<path d="M12 8.8c1 .9 1 1.8 0 2.7-1 .9-1 1.8 0 2.7" class="art-hole-line" fill="none" stroke-width="1.5"/>' +
      '<circle cx="12" cy="16.6" r="1" class="art-hole" stroke="none"/>',

    // 草药袋：伸出的叶 + 圆胖束口袋 + 白扎绳 + 白弧光
    herb_pouch:
      '<path d="M10.7 6.2c-.6-2 .1-3.7 1.8-4.9 1 1.6 1.1 3.3.4 4.9" fill="none" stroke-width="1.6"/>' +
      '<path d="M13.5 6.4c1.4-.9 3.1-.9 4.8 0-1.2 1.5-2.8 2.1-4.6 1.9" fill="none" stroke-width="1.6"/>' +
      '<path d="M12 8.6c4.7 0 7.8 2.9 7.8 6.7 0 3.9-3.3 6.1-7.8 6.1s-7.8-2.2-7.8-6.1c0-3.8 3.1-6.7 7.8-6.7z"/>' +
      '<path d="M7.8 8.2h8.4" fill="none" stroke-width="2"/>' +
      '<path d="M7.9 10.9c-1.1 1.1-1.7 2.5-1.7 4" class="art-hole-line" fill="none" stroke-width="1.4"/>',

    // 旧披肩：胖三角披挂 + 白褶线 + 流苏
    warm_shawl:
      '<path d="M5.6 4.2c4.3 2.2 8.5 2.2 12.8 0l-1.6 13.1c-3.2 1.8-6.4 1.8-9.6 0z"/>' +
      '<path d="M9.6 6.4l2 10M14.4 6.4l-2 10" class="art-hole-line" fill="none" stroke-width="1.3"/>' +
      '<path d="M8.6 18.4v1.8M12 19.4v1.8M15.4 18.4v1.8" fill="none" stroke-width="1.6"/>',

    // 账目残页：胖纸页 + 白折角 + 白账目行 + 白对勾
    ledger_page:
      '<path d="M6 3.2h8.4l4.6 4.8v12a.9.9 0 0 1-.9.9H6.9a.9.9 0 0 1-.9-.9z"/>' +
      '<path d="M14.4 3.6v4.2h4.3z" class="art-hole" stroke="none"/>' +
      '<path d="M9 12.4h6.4M9 15.4h6.4M9 18.2h3.6" class="art-hole-line" fill="none" stroke-width="1.4"/>' +
      '<path d="M9.3 8.6l1.1 1.1 1.9-2.1" class="art-hole-line" fill="none" stroke-width="1.4"/>',

    // 铁肺：双叶胖风箱 + 白缝 + 白高光 + 底座
    iron_lung:
      '<path d="M11.2 6.6C9.4 4.4 6.7 4 4.1 5.2c-.6 4.3.7 7.9 3.7 10.1 1.3 1 2.5 1.4 3.4 1.3z"/>' +
      '<path d="M12.8 6.6c1.8-2.2 4.5-2.6 7.1-1.4.6 4.3-.7 7.9-3.7 10.1-1.3 1-2.5 1.4-3.4 1.3z"/>' +
      '<path d="M9.4 21h5.2" fill="none" stroke-width="2"/>' +
      '<circle cx="7.4" cy="8.6" r="1" class="art-hole" stroke="none"/>' +
      '<circle cx="16.6" cy="8.6" r="1" class="art-hole" stroke="none"/>',

    // 宽背带：胖腰带 + 大白扣 + 铜针 + 白扣眼
    wide_belt:
      '<rect x="2.6" y="9.4" width="18.8" height="5.8" rx="2.9"/>' +
      '<rect x="8.8" y="7.4" width="6.4" height="9.8" rx="2" class="art-hole" stroke="none"/>' +
      '<rect x="10.7" y="9.2" width="2.6" height="6.2" rx="1.3" fill="currentColor" stroke="none"/>' +
      '<circle cx="5.5" cy="12.3" r=".9" class="art-hole" stroke="none"/>' +
      '<circle cx="18.5" cy="12.3" r=".9" class="art-hole" stroke="none"/>',

    // 血契：胖卷轴 + 白字行 + 底部火漆滴 + 白缎带纹
    blood_pact:
      '<path d="M5.2 5.4c2.3-1.6 4.5-1.6 6.8 0 2.3-1.6 4.5-1.6 6.8 0v11.8c-2.3-1.6-4.5-1.6-6.8 0-2.3-1.6-4.5-1.6-6.8 0z"/>' +
      '<path d="M7.6 8.8h3.2M13.2 8.8h3.2M7.6 11.8h2.4M14 11.8h2.4" class="art-hole-line" fill="none" stroke-width="1.3"/>' +
      '<circle cx="12" cy="19.4" r="2.7"/>' +
      '<path d="M10.8 19l1.2 1.2 1.4-1.6" class="art-hole-line" fill="none" stroke-width="1.2"/>',

    // 金秤：立柱 + 横梁 + 双胖秤盘 + 顶珠
    gold_scale:
      '<circle cx="12" cy="3.6" r="1.3" fill="currentColor" stroke="none"/>' +
      '<path d="M12 4.6v12.8" fill="none" stroke-width="2"/>' +
      '<path d="M3.8 6.4h16.4" fill="none" stroke-width="2"/>' +
      '<path d="M4.6 7l-2.2 4.6a2.9 2.9 0 0 0 5.5 0z"/>' +
      '<path d="M19.4 7l-2.2 4.6a2.9 2.9 0 0 0 5.5 0z"/>' +
      '<path d="M9.8 20.9c0-2.4 1-3.9 2.2-4.4 1.2.5 2.2 2 2.2 4.4z"/>' +
      '<path d="M7.4 20.9h9.2" fill="none" stroke-width="2"/>',

    // 守护神像：圆胖石像 + 白眼睛 + 白笑纹 + 底座
    guardian_idol:
      '<path d="M6.4 20.6v-1.3c0-1.2.8-2.2 1.9-2.4a6.9 6.9 0 1 1 7.4 0c1.1.2 1.9 1.2 1.9 2.4v1.3z"/>' +
      '<circle cx="9.6" cy="10.6" r="1.3" class="art-hole" stroke="none"/>' +
      '<circle cx="14.4" cy="10.6" r="1.3" class="art-hole" stroke="none"/>' +
      '<path d="M10.2 14.2c1.2.9 2.4.9 3.6 0" class="art-hole-line" fill="none" stroke-width="1.5"/>' +
      '<path d="M5.4 20.6h13.2" fill="none" stroke-width="2"/>',

    // 余烬之心：胖心形 + 白裂纹 + 白高光
    ember_heart:
      '<path d="M12 20.6C6.4 16.6 3.4 13.2 3.4 9.6a4.7 4.7 0 0 1 8.6-2.6 4.7 4.7 0 0 1 8.6 2.6c0 3.6-3 7-8.6 11z"/>' +
      '<path d="M9 9.4l2.2 2.6-1.6 2.2 2.6 2.4" class="art-hole-line" fill="none" stroke-width="1.5"/>' +
      '<circle cx="7.6" cy="8.6" r="1" class="art-hole" stroke="none"/>',

    // 深井提灯：提环 + 圆胖灯体 + 白玻璃罩 + 内焰 + 底座
    deep_lantern:
      '<path d="M9.4 5.6a2.6 2.6 0 0 1 5.2 0" fill="none"/>' +
      '<path d="M8 5.6h8l-1.2 12.6H9.2z"/>' +
      '<path d="M10 8.4h4l-.5 7.8h-3z" class="art-hole" stroke="none"/>' +
      '<path d="M12 10.4c.9 1 1.4 1.9 1.4 2.6a1.4 1.4 0 1 1-2.8 0c0-.7.5-1.6 1.4-2.6z" fill="currentColor" stroke="none"/>' +
      '<path d="M7.4 20.6h9.2" fill="none" stroke-width="2"/>',

    // 兜底：圆胖圆牌 + 白环
    _fallback:
      '<circle cx="12" cy="12" r="7.8"/>' +
      '<circle cx="12" cy="12" r="4.2" class="art-hole" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  },

  // ============================================================
  // M63 遗物位图（末世卡通立体版）：面板大图用位图，托盘 20px 仍走
  // 上面的 SVG 剪影 —— 立体图缩到 20px 会糊成一坨，剪影小尺寸反而清楚。
  // 与 CARD_ART 同套路：显式注册表即清单，没登记的 id 走 relic() 兜底。
  // ============================================================
  RELICART_BASE: 'preview-assets-relics/',
  RELIC_IMG: {
    // ---- 普通 ----
    shaft_pendant: 1, shaft_shard: 1, brass_gear: 1, wax_seal: 1,
    old_lamp: 1, chalk_mark: 1, leather_strap: 1, rat_fang: 1,
    // ---- 罕见 ----
    alloy_compass: 1, moss_charm: 1, miners_gloves: 1, soot_charm: 1,
    herb_pouch: 1, warm_shawl: 1, ledger_page: 1, iron_lung: 1,
    // ---- 稀有 ----
    guardian_idol: 1, ember_heart: 1, gold_scale: 1, wide_belt: 1,
    blood_pact: 1, deep_lantern: 1,
    // ---- 未实装机制（ready:false，不进掉落池；图先备好，实装即用）----
    rope_scrap: 1, ember_reader: 1,
  },

  // 遗物图标。托盘（顶栏 20px）与面板（44px）共用同一份 SVG —— 缩放靠 viewBox。
  // M61 卡通化：外壳默认 fill=currentColor（实心剪影为主），白色细节靠
  // art-hole / art-hole-line 自带 fill/stroke 覆盖，线描元素显式 fill="none"。
  // M63 起：托盘仍走本方法；面板展示改走 relicArt()（位图优先）。
  relic(id) {
    return this._memo('r:' + id, () => {
      const body = this.RELIC_BODY[id] || this.RELIC_BODY._fallback;
      return this._wrap('0 0 24 24', body, 'art art-relic', 1.7, 'currentColor');
    });
  },

  // 位图路径。没登记返回 null —— 调用方（relicArt）退回 SVG。
  relicImg(id) {
    return this.RELIC_IMG[id] ? this.RELICART_BASE + id + '.png' : null;
  },

  // 面板展示（商店货架 / 宝箱 / 奖励）：位图优先，无位图兜底 SVG。
  relicArt(id) {
    const img = this.relicImg(id);
    return img
      ? '<img class="relic-img" src="' + img + '" alt="" draggable="false">'
      : this.relic(id);
  },

};
