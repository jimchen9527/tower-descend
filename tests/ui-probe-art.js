// 图形层 UI 探针（M8）：验证 SVG 图形真的接进了地图与战斗，且反应链路通。
//
// v3 追加：战斗面板的单位形象升级为位图立绘（preview-assets-v3/，AI 生成 + 抠图），
// 战斗断言随之从「.unit-art svg」改为「.unit-art img」；地图节点仍是纯 SVG。
// SVG 剪影没有删 —— 它们是位图缺失时的兜底（unknownEnemyFallback 仍验证这条链路）。
//
// 为什么单独一层：其他探针查的是「类名 / 数据集 / 文字」这些语义钩子，
// 它们刻意不看画面 —— 所以「节点里到底有没有图形」没人管。
// 这一层就是补这个洞：图形在不在、映射对不对、颜色有没有跟着类型走。
//
// 三类断言：
//   1. 存在性 —— 节点/单位里真的有 svg，不是空的按钮
//   2. 映射正确性 —— 谁对应哪张图、尺寸分几档、颜色跟不跟类型走
//   3. 反馈链路 —— 打一张牌，敌人身上该出现飘字与抖动
//
// 运行：node tests/ui-probe-art.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-art.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  try {
    // M58b：动效规则已解包为常驻（不再包 no-preference 查询），无头里动画**真的在跑**了。
    // 几何量测（立绘基准 / gap / 血条位置）必须在基准态量 —— 注入 animation:none
    // 回到 M57 以前的测量条件。这不是「绕过开关证动画」：动画是否挂对规则由
    // 下面的 CSSOM 文本断言把关，这里只管把量测环境固定住。
    var animKill = document.createElement('style');
    animKill.textContent =
      '.battle-stage, .battle-stage *, .mnode.is-cur { animation: none !important; }';
    document.head.appendChild(animKill);

    // ==================== 1. 图形库自检 ====================
    // 每个图形都得产出真东西（不是空串、得含 <svg 标签）
    var nodeKinds = Object.keys(Art.NODE_BODY);
    var enemyKinds = Object.keys(Art.ENEMY_BODY);
    var charKinds = Object.keys(Art.CHAR_BODY);
    var intentKinds = Object.keys(Art.INTENT_BODY);
    log('nodeKindCount', nodeKinds.length);
    log('enemyKindCount', enemyKinds.length);
    log('charKindCount', charKinds.length);
    log('intentKindCount', intentKinds.length);
    log('allNodesRender', nodeKinds.every(function (k) {
      var s = Art.node(k); return s.indexOf('<svg') === 0 && s.length > 80; }));
    log('allEnemiesRender', enemyKinds.every(function (k) {
      var s = Art.enemy(k); return s.indexOf('<svg') === 0 && s.length > 80; }));
    log('allCharsRender', charKinds.every(function (k) {
      var s = Art.char(k); return s.indexOf('<svg') === 0 && s.length > 80; }));
    log('allIntentsRender', intentKinds.every(function (k) {
      var s = Art.intent(k); return s.indexOf('<svg') === 0 && s.length > 80; }));
    // 未知 key 必须有兜底，不能产出空图
    log('unknownNodeFallback', Art.node('__nope__') === Art.node('monster'));
    log('unknownEnemyFallback', Art.enemy('__nope__') === Art.enemy('rats'));
    log('unknownIntentFallback', Art.intent('__nope__') === Art.intent('special'));
    // 缓存：同一个图形只拼一次字符串
    log('cacheReuse', Art.node('shop') === Art.node('shop'));

    // ==================== 2. 地图 ====================
    Progress.reset();
    App.boot({ fresh: true });
    var s = Run.state, map = s.map;
    // 前 5 层走通，当前节点停在第 6 层
    map.layers.slice(0, 5).forEach(function (l) {
      l.forEach(function (n) { s.visited[n.id] = true; s.cleared[n.id] = true; });
    });
    var cur = map.layers[5][0];
    s.currentId = cur.id;
    App.showMap();

    log('mapNodeCount', qa('#map-nodes .mnode').length);
    log('mapNodesWithArt', qa('#map-nodes .mnode svg.art-node').length);
    log('mapIconsAreSvg', qa('#map-nodes .mnode svg').length === qa('#map-nodes .mnode').length);
    // 已走过的节点换成勾
    // 入口节点走过也不显示勾（它是起点，不是「清理过的房间」），所以比对时排除它
    log('mapDoneCount', qa('#map-nodes .is-done').length);
    log('mapCheckIconsMatchDone',
      qa('#map-nodes .mnode svg.art-check').length ===
      qa('#map-nodes .mnode:not(.mt-entry).is-done').length);
    // Boss 节点：王冠 + 难度角标
    log('mapBossCount', qa('#map-nodes .mt-boss').length);
    log('mapBossBadgeCount', qa('#map-nodes .mt-boss .art-boss-tier').length);
    log('mapBossTiers', qa('#map-nodes .mt-boss .art-boss-tier').map(function (b) {
      return b.textContent; }).sort().join(','));
    // M70：连线曲线化 —— 连线是 path、带贝塞尔控制点；已走路径有双层描边
    log('mapLineCount', qa('#map-svg path.edge').length > 0);
    log('mapEdgeCurved', [].slice.call(qa('#map-svg path.edge'))
      .every(function (p) { return (p.getAttribute('d') || '').indexOf(' C ') >= 0; }));
    // 汉字已从画面撤走，但 title / aria-label 还留着
    var firstNode = q('#map-nodes .mnode');
    log('mapNodePaintText', JSON.stringify(firstNode.textContent.trim()));
    log('mapNodeTitleKept', firstNode.title.length > 0);
    log('mapNodeAriaKept', (firstNode.getAttribute('aria-label') || '').length > 0);
    // 尺寸分档：普通 27px，Boss 31px（M87/V7 图标放大 +12.5%）
    var iconBox = q('#map-nodes .mnode:not(.mt-boss) svg.art-node').getBoundingClientRect();
    var bossIconBox = q('#map-nodes .mt-boss svg.art-node').getBoundingClientRect();
    log('mapIconSize', Math.round(iconBox.width) + 'x' + Math.round(iconBox.height));
    log('mapBossIconSize', Math.round(bossIconBox.width) + 'x' + Math.round(bossIconBox.height));
    // 图标颜色跟着节点类型走（currentColor 继承是否真的生效）
    var monStroke = getComputedStyle(q('#map-nodes .mt-monster svg.art-node')).stroke;
    var evStroke = getComputedStyle(q('#map-nodes .mt-event svg.art-node')).stroke;
    log('mapColorFollowsType', monStroke !== evStroke);
    log('mapMonsterStroke', monStroke);
    // M70：波浪层理由 render-map.js 逐层生成（每层一条 .stratum，33 层 = 33 条）
    log('mapStratumCount', qa('#map-svg .stratum').length);
    log('mapWalkGlow', qa('#map-svg .edge-walk-glow').length > 0);

    // ==================== 3. 战斗 ====================
    Combat.start(20260923, {
      charId: 'digger', hp: 70, maxHp: 75, depth: 3, locTag: '探针 · D3',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Render.resetFeedback(); // 探针直接开战，得自己替 App.startBattle 做这一步
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.draw();

    log('enemyUnitCount', qa('#enemy-panel .eunit').length);
    log('enemyHasArt', qa('#enemy-panel .eunit .unit-art img').length);
    // 位图覆盖（M51 修订）：六只新敌人的位图立绘到位后，17 只敌人 + 3 角色
    // 全员张张有位图。SVG 剪影仍保留为兜底（unknown id 的回落链路由
    // unknownEnemyFallback 断言单独验证）。
    log('bitmapCoversAll',
      ['rats', 'sentinel', 'spore_walker', 'crawler', 'scavenger_shade',
       'warlord', 'hound', 'bonewright', 'rust_crown', 'mycelium_mother',
       'headless_executor', 'arc_welder', 'pile_driver', 'husk_lancer',
       'cord_creeper', 'centurion', 'stitch_tyrant',
       // M56 进化体 12 只也全员张张有位图
       'rat_king', 'sentinel_breach', 'spore_gravid', 'crawler_molt', 'shade_gatherer',
       'rat_tide', 'sentinel_siege', 'spore_mother', 'crawler_maul', 'shade_patch',
       'welder_overload', 'piledriver_breach'].every(function (k) {
        return !!Art.enemyImg(k);
      }) &&
      charKinds.every(function (k) { return !!Art.charImg(k); }));
    // 形象要和 def.id 对得上：换一只怪，立绘也得换
    var ratsImg = q('#enemy-panel .eunit .unit-art img').getAttribute('src');
    Combat.start(20260923, {
      charId: 'digger', hp: 70, maxHp: 75, depth: 3, locTag: '探针 · D3',
      deck: Run.state.deck, enemyId: 'rust_crown'
    });
    Render.resetFeedback();
    Render.draw();
    var crownImg = q('#enemy-panel .eunit .unit-art img').getAttribute('src');
    log('enemyArtFollowsId', ratsImg !== crownImg);
    log('bossKindClass', qa('#enemy-panel .eunit .unit-art.art-kind-boss').length);
    // 玩家形象：位图立绘 + 路径指向对应角色
    log('playerHasArt', qa('#player-panel .unit-art-player img').length);
    log('playerImgSrc', q('#player-panel .unit-art-player img').getAttribute('src'));
    // 意图：图标在场，但「意图 · 」文字前缀一个字都不能少
    log('intentHasIcon', qa('#enemy-panel .intent svg.art-intent').length);
    log('intentTextKept', q('#enemy-panel .intent').textContent.indexOf('意图') === 0);
    // 卡面类型色：攻击与技能不该同色
    var atkCtype = q('#hand .card .ctype-attack');
    var skillCtype = q('#hand .card .ctype-skill');
    if (atkCtype && skillCtype) {
      log('cardTypeColorDiffers',
        getComputedStyle(atkCtype).color !== getComputedStyle(skillCtype).color);
    } else {
      log('cardTypeColorDiffers', 'skip（这副牌里没有同时出现攻击与技能）');
    }
    // 卡面画窗：手牌的卡要有画窗位图；注册表要覆盖卡池全部卡（B 方案 42 图 / 121 卡）
    log('cardArtInHand', qa('#hand .card .cart img').length);
    log('cardArtCoversAll',
      Object.keys(CARDS).every(function (k) { return !!Art.cardImg(k); }));
    // B 方案核心：泛化卡共用一张图（撬动 / 撬棒连击 / 双持撬棍都用撬棍的画）
    log('cardArtShared',
      Art.cardImg('pry') === Art.cardImg('crowbar') && Art.cardImg('pry') !== null);

    // ==================== 3.4b 卡面铭牌化（M27）====================
    // 手牌每张卡的边框色必须等于自身稀有度色（基础铁灰/普通绿/稀有蓝/传说金/诅咒紫）
    var RAR_HEX = { basic: '#7E7A6A', common: '#4E8A3A', uncommon: '#185FA5', rare: '#C9962B', curse: '#7A4A9E' };
    function rgbOf(hex) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgb(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
    }
    var rarOk = true, rarN = 0;
    qa('#hand .card').forEach(function (el) {
      var m = /rar-([a-z]+)/.exec(el.className);
      if (!m || !RAR_HEX[m[1]]) { rarOk = false; return; }
      rarN++;
      if (getComputedStyle(el).borderTopColor !== rgbOf(RAR_HEX[m[1]])) rarOk = false;
    });
    log('rarBorderOk', rarOk);
    log('rarBorderCounted', rarN > 0);
    // 铭牌工艺：--rar 颜色变量、四角铆钉与内刻线的规则都要在样式表里
    var cssText = '';
    try {
      for (var si = 0; si < document.styleSheets.length; si++) {
        var rs = document.styleSheets[si].cssRules;
        for (var ri = 0; ri < rs.length; ri++) cssText += rs[ri].cssText + '\\n';
      }
    } catch (e) { /* 个别样式表读不到就算了 */ }
    log('cssomRarVars', cssText.indexOf('--rar:') >= 0 && cssText.indexOf('.card.rar-rare') >= 0);
    log('cssomPlaqueLayers', cssText.indexOf('.card::before') >= 0 && cssText.indexOf('.card::after') >= 0);
    // 商店 / 奖励面板同款：NodePanel.cardHtml 输出必须带稀有度类
    log('cardHtmlRarClass', NodePanel.cardHtml('strike').indexOf('rar-basic') >= 0);
    // 选中发光（M27b）：hover / active 规则都要带稀有度色亮环
    log('cssomHoverGlow', cssText.indexOf('.card:hover') >= 0 && cssText.indexOf('0 0 0 3px') >= 0);
    log('cssomActiveGlow', cssText.indexOf('.card:active') >= 0 && cssText.indexOf('0 0 36px 13px') >= 0);

    // ==================== 3.5 地形背景（M12）====================
    // 深度带边界与 Act 1 bossDepths 对齐（11/12、22/23 分界）
    log('terrainBandBounds',
      Art.terrainBand(1) === 1 && Art.terrainBand(11) === 1 &&
      Art.terrainBand(12) === 2 && Art.terrainBand(22) === 2 &&
      Art.terrainBand(23) === 3 && Art.terrainBand(33) === 3);
    var bgEl = q('#battle-bg');
    log('battleBgShown', !!bgEl && !bgEl.hidden && bgEl.className.indexOf('bg-band1') >= 0);
    Combat.state.depth = 20; Render.draw();
    var band2 = q('#battle-bg').className.indexOf('bg-band2') >= 0;
    Combat.state.depth = 30; Render.draw();
    var band3 = q('#battle-bg').className.indexOf('bg-band3') >= 0;
    log('battleBgFollowsDepth', band2 && band3);
    // M19：三张背景图重生成为「地面占六成」的低地平线构图，
    // M15 的地面延伸带（::before）随之删除 —— 断言改为确认它真的不在了，
    // 且三个深度带的兜底色（位图加载前的 background-color）两两不同。
    var gbContent = getComputedStyle(q('#battle-bg'), '::before').content;
    log('groundBandRemoved', gbContent === 'none');
    // 上一段断言可能把深度留在了 30 —— 先回到 D3 再取 band1 的兜底色
    Combat.state.depth = 3; Render.draw();
    var gc1 = getComputedStyle(q('#battle-bg')).backgroundColor;
    Combat.state.depth = 20; Render.draw();
    var gc2 = getComputedStyle(q('#battle-bg')).backgroundColor;
    Combat.state.depth = 30; Render.draw();
    var gc3 = getComputedStyle(q('#battle-bg')).backgroundColor;
    log('groundFallbackFollowsBand', gc1 !== gc2 && gc2 !== gc3);
    // 节点场景横幅：休息点有图；reward 结算没有；Boss 预告用所在深度带的战斗背景
    NodePanel.showRest();
    log('restSceneShown', !!q('#placeholder .np-scene') &&
      q('#placeholder .np-scene').getAttribute('src').indexOf('scene-rest.jpg') > 0);
    NodePanel.hide();
    log('sceneSrcNullForReward', Art.sceneSrc('reward', 3) === null);
    log('bossSceneUsesBattleBg', (Art.sceneSrc('boss', 3) || '').indexOf('battle-band1.jpg') > 0);
    // 窄窗口不裁单位（M12b 回归）：舞台有 overflow:hidden、面板禁收缩，
    // 窗口一窄右侧敌人会被整体裁掉。探针自己跑在 800×600 视口 —— 正好卡住这条线：
    // 最右敌人的右缘必须落在舞台右缘之内。
    Combat.state.depth = 3;
    Combat.addEnemy('hound');
    Render.draw();
    var stR = q('.battle-stage').getBoundingClientRect().right;
    var eus = qa('#enemy-panel .eunit');
    var lastR = eus.length ? eus[eus.length - 1].getBoundingClientRect().right : 0;
    log('enemyNotClipped', lastR <= stR + 0.5);
    log('stageClipGap', Math.round(stR - lastR));

    // 满编 4 敌不越界（M21 回归）：菌母 + 3 只孢囊行者是全局最挤的编队 ——
    // 单个单位最宽的不是立绘（180）也不是名牌（150），而是**意图胶囊**
    // 「召唤 1 只孢囊行者（HP 30）」实测 232px，四个横排必超舞台。
    // 这条线以前没人守：2 敌的 enemyNotClipped 一直全绿，
    // 实战到第二层 Boss 才发现后排手下被裁出界。
    // 断言打「最右敌人右缘 ≤ 舞台右缘（扣除 padding）」，不写死宽度 ——
    // 以后调缩放档位不用改测试。
    Combat.start(20260924, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 22, locTag: '探针 · D22 菌母',
      deck: Run.state.deck, enemyId: 'mycelium_mother'
    });
    Render.resetFeedback();
    Render.draw();
    var soloW = q('#enemy-panel .eunit').getBoundingClientRect().width;
    Combat.addEnemy('spore_walker', 30);
    Combat.addEnemy('spore_walker', 30);
    Combat.addEnemy('spore_walker', 30);
    Render.draw();
    var st2 = q('.battle-stage');
    var st2R = st2.getBoundingClientRect().right -
      parseFloat(getComputedStyle(st2).paddingRight);
    var eus2 = qa('#enemy-panel .eunit');
    var lastR2 = eus2.length ? eus2[eus2.length - 1].getBoundingClientRect().right : 0;
    log('crowdUnits', eus2.length);
    log('crowdNotClipped', lastR2 <= st2R + 0.5);
    log('crowdClipGap', Math.round(st2R - lastR2));
    log('crowdShrinksUnit', eus2[0].getBoundingClientRect().width < soloW);
    // 死掉的手下（M58 P1 死亡表现）：刚死的 0.55s 过渡期里仍渲染（is-dying
    // 溶解退场），过渡结束才真正摘除 —— M21「尸体不占位」铁律的窗口期版本。
    Combat.state.enemies[1].hp = 0;
    Combat.state.enemies[2].hp = 0;
    Render.draw();
    var eus3 = qa('#enemy-panel .eunit');
    log('afterDeathUnits', eus3.length); // 死亡瞬间 = 2 活 + 2 具溶解中
    log('dyingPlaying', eus3.filter(function (n) { return (' ' + n.className + ' ').indexOf(' is-dying ') >= 0; }).length);
    // 快进：把过渡名单的时间戳拨到 0（等价于 0.55s 已过），下一次 draw 摘除
    (Render._dying || []).forEach(function (d) { d.t = 0; });
    Render.draw();
    var eus4 = qa('#enemy-panel .eunit');
    var lastR4 = eus4.length ? eus4[eus4.length - 1].getBoundingClientRect().right : 0;
    log('afterDeathUnits2', eus4.length);
    log('afterDeathNotClipped', lastR4 <= st2R + 0.5);
    log('afterDeathWidens', eus4[0].getBoundingClientRect().width > eus2[0].getBoundingClientRect().width);

    // ============ 3.6b 窄屏档的 gap 没被桌面档压掉（M44 回归）============
    // 这条守的是一个**静默失效**：媒体查询不提升 CSS 特异性，所以
    // style.css 的 .battle-stage[data-crowd="4"] { gap: 99px }（0,2,0）
    // 会压过 art.css 媒体查询里的 .battle-stage { gap: 8px }（0,1,0）——
    // 媒体查询里那条 8px 根本没生效。而手机档舞台是纵向两行，
    // gap 量的是**上下两行之间的留白**，99px 会让玩家和敌人隔出一整块空白。
    // 桌面档断言（gap 99）全绿也发现不了：两处 CSS 各自都对，只是接不上。
    // 所以这里换视口后重测，把「窄屏档生效值」也钉住。
    // 探针是复制页跑的，改不了真实视口 —— 用 CSSOM 读规则文本代替：
    // 找 art.css 的 640 媒体查询块，断言它里面有 data-crowd 的 gap 覆盖。
    // 探针跑在 --allow-file-access-from-files 下（见文件末尾的 EDGE 参数），
    // 所以 cssRules 读得到 —— 读不到时下面的 try 会静默吞掉、断言变成
    // 「0 条规则」，看起来像规则不存在，其实是读不到。两者要能区分开，
    // 所以先记下读到的样式表条数。
    var cssMedia = [], sheetsRead = 0;
    Array.prototype.forEach.call(document.styleSheets, function (ss) {
      var rules = null;
      try { rules = ss.cssRules; } catch (e) { return; }
      if (!rules) return;
      sheetsRead++;
      // 媒体查询块（r.cssRules 非空且有 .media）要递归进去，
      // 普通样式规则（cssText 里有花括号但 cssRules 为空）直接收文本。
      Array.prototype.forEach.call(rules, function (r) {
        if (r.media && r.cssRules) {
          Array.prototype.forEach.call(r.cssRules, function (x) {
            if (x.cssText) cssMedia.push(x.cssText);
          });
        } else if (r.cssText) {
          cssMedia.push(r.cssText);
        }
      });
    });
    log('cssSheetsReadable', sheetsRead);
    var crowdGapRule = cssMedia.filter(function (t) {
      return t.indexOf('data-crowd') >= 0 && t.indexOf('battle-stage') >= 0 && t.indexOf('gap') >= 0;
    });
    log('crowdGapRules', crowdGapRule.length);
    // 桌面 2 条（data-crowd="3"/"4"）+ ≤900 档 2 条 + ≤640 档 1 条（合并写法）= 5
    log('narrowGapOverridden', crowdGapRule.length >= 5);

    // ============ 3.7 单位信息与悬停浮层（M22 起，M25 扩展）============
    // M25：脚下只剩一根血条（名牌白框退役），名字 / 角色 / 资源 / 深度 /
    // 状态图标 / 牌堆全部搬进悬停浮层 —— 默认不可见，鼠标移到单位上才展开。
    // 浮层用 visibility 而不是「不渲染」—— 元素仍在 DOM 里，
    // ui-probe-boss 的 negStatHasMinus（读 textContent）这类旧断言不受影响。
    var moreP = q('#player-panel .stats-more');
    log('statsMoreExists', !!moreP);
    log('statsMoreHidden', moreP ? getComputedStyle(moreP).visibility === 'hidden' : false);
    log('statsMoreNotLaid', moreP ? getComputedStyle(moreP).position === 'absolute' : false);
    // 浮层里真的装着东西，不是空壳：牌堆三片 + 名字 + 资源 + 深度
    log('statsMoreHasPiles', moreP ? !!moreP.querySelector('.bicon-neutral') : false);
    log('moreHasName', moreP ? !!moreP.querySelector('.unit-name') : false);
    log('moreHasDepth', moreP ? !!moreP.querySelector('.stat-depth') : false);
    // 资源标签也要在浮层里，但这一局跑的是掘者 —— 掘者没有资源，
    // 所以这里断言「不该凭空多出一个空标签」；有资源的情形（样本 / 余烬）
    // 由 ui-probe-char 覆盖，它读的就是 .stat-res 的文本
    log('moreHasNoResForDigger', moreP ? !moreP.querySelector('.stat-res') : false);
    // 脚下只剩「立绘 + 血条」：单位的常驻子元素就这两层（浮层是绝对定位，
    // 虽然也在 children 里，但不占布局），白框不再生成
    var myUnit = q('#player-panel .unit');
    log('footOnlyArtAndHp', myUnit
      ? Array.prototype.every.call(myUnit.children, function (c) {
          return c.classList.contains('unit-art') ||
                 c.classList.contains('hprow') ||
                 c.classList.contains('stats-more');
        })
      : false);
    log('noUnitBody', !q('.unit-body'));
    // 敌人与玩家同构：脚下同样只有血条，名字在浮层里
    var eMore = q('#enemy-panel .eunit .stats-more');
    log('enemyMoreHasName', eMore ? !!eMore.querySelector('.unit-name') : false);

    // ============ 3.7b 点自己 → 钉住信息浮层（M64b）============
    // 点玩家单位：浮层常驻 + 指针放行（title 注释靠悬停触发，none 弹不出来）
    q('#player-panel .unit-art').click();
    var pinMore = q('#player-panel .stats-more');
    log('pinToggled', q('#player-panel .unit').classList.contains('is-pinned'));
    log('pinShown', pinMore ? getComputedStyle(pinMore).visibility === 'visible' : false);
    log('pinPointer', pinMore ? getComputedStyle(pinMore).pointerEvents === 'auto' : false);
    // 点其他内容（舞台空白处）→ 钉住解除，浮层回默认隐身
    q('.battle-stage').click();
    var pinUnit2 = q('#player-panel .unit');
    var pinMore2 = q('#player-panel .stats-more');
    log('pinCleared', !pinUnit2.classList.contains('is-pinned'));
    log('pinHiddenAgain', pinMore2 ? getComputedStyle(pinMore2).visibility === 'hidden' : false);

    // 能量条（M25）：从脚下的名牌搬到舞台左上角的 HUD 行。
    // 断言按语义写 —— 能量条在 HUD 里、是 HUD 的第一块、且不在单位里。
    var hud = q('#stage-hud');
    log('hudExists', !!hud);
    log('hudIsStageChild',
      !!(hud && hud.parentElement && hud.parentElement.classList.contains('battle-stage')));
    log('energyInHud', !!(hud && hud.querySelector('.energybar')));
    log('energyFirstInHud',
      !!(hud && hud.firstElementChild && hud.firstElementChild.classList.contains('energybar')));
    log('energyTextInHud',
      hud ? ((hud.querySelector('.stat-energy') || {}).textContent || 'MISSING') : 'MISSING');
    log('energyNotOnUnit', !q('#player-panel .unit .stat-energy'));
    if (hud) {
      var hr = hud.getBoundingClientRect();
      var stgBox = q('.battle-stage').getBoundingClientRect();
      log('hudAtStageTopLeft',
        Math.round(hr.left - stgBox.left) + ',' + Math.round(hr.top - stgBox.top));
    }

    // 站位（M22）：玩家与敌人同款竖排 —— 立绘是单位的一级子元素。
    // 旧版玩家是「立绘侧列 + 名牌在右」的横排，与敌人一横一竖不对称。
    var pUnit = q('#player-panel .unit');
    var pArt = q('#player-panel .unit-art');
    log('playerArtDirectChild', !!(pArt && pArt.parentElement === pUnit));
    var eUnit0 = q('#enemy-panel .eunit');
    var eArt0 = eUnit0 ? eUnit0.querySelector('.unit-art') : null;
    log('enemyArtDirectChild', !!(eArt0 && eArt0.parentElement === eUnit0));
    // 居中靠拢：玩家左留白与敌人右留白应当基本相等（容忍 14px 的取整与小数）
    var stg = q('.battle-stage');
    var stgR = stg.getBoundingClientRect();
    var padL = parseFloat(getComputedStyle(stg).paddingLeft);
    var padR = parseFloat(getComputedStyle(stg).paddingRight);
    var ppR = q('#player-panel').getBoundingClientRect();
    var epR = q('#enemy-panel').getBoundingClientRect();
    var gapL = ppR.left - (stgR.left + padL);
    var gapR = (stgR.right - padR) - epR.right;
    log('stageCentered', Math.abs(gapL - gapR) <= 14);
    log('stageGapPx', Math.round(epR.left - ppR.right) + 'px');

    // ==================== 3.8 前后排与站位（M23）====================
    // 多重敌人时小怪站前排（靠我方）、Boss / 精英退后排：
    // DOM 顺序按 rank 重排（引擎里 Boss 恒在 index 0，照原序排就挡在手下前面），
    // 后排整体抬高一段 —— 脚落在画面更高处 = 站得更远。
    // 此刻场上剩 2 个（菌母 + 1 只孢囊行者，前面把 #1 #2 打死了）。
    var rearU = qa('#enemy-panel .eunit[data-rank="back"]');
    var frontU = qa('#enemy-panel .eunit[data-rank="front"]');
    log('rearRankExists', rearU.length === 1);
    log('frontRankForMinions', frontU.length === 1);
    // 后排排在所有前排之后（DOM 顺序就是左右顺序）——
    // 「小怪在前面、Boss 在后面」这句规格的可断言形式
    log('rearSitsAfter', !!(rearU[0] && frontU[0]) &&
      (frontU[0].compareDocumentPosition(rearU[0]) & 4) > 0);
    log('rearUnitHigher', !!(rearU[0] && frontU[0]) &&
      rearU[0].getBoundingClientRect().top < frontU[0].getBoundingClientRect().top);
    log('unitsNotOverlap', !!(rearU[0] && frontU[0]) &&
      frontU[0].getBoundingClientRect().right <= rearU[0].getBoundingClientRect().left + 0.5);
    // 单敌（只剩菌母本体）不该有前后排 —— 一只怪没有「后面」可言
    Combat.start(20260924, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 22, locTag: '探针 · D22 菌母',
      deck: Run.state.deck, enemyId: 'mycelium_mother'
    });
    Render.resetFeedback();
    Render.draw();
    log('soloNoRear', qa('#enemy-panel .eunit[data-rank="back"]').length === 0);
    // 立绘基准（M23 从 175 降到 154）不该大到把舞台占满 ——
    // 用比例而不是绝对值：以后调基准，这条不用跟着改
    var soloArt = q('#enemy-panel .unit-bm');
    var stageH = q('.battle-stage').getBoundingClientRect().height;
    log('artFitsStage',
      Math.round(soloArt.getBoundingClientRect().height / stageH * 100) <= 45);

    // ==================== 4. 受击反馈 ====================
    // 回到小怪战，打一张攻击牌，看敌人身上有没有出现飘字与抖动
    Combat.start(20260923, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '探针 · D3',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Render.resetFeedback();
    document.getElementById('view-combat').hidden = false;
    Render.draw();
    // 第一帧先建立血量基线（feedback 靠前后对比，没有基线就不会动画）
    var enemy = Combat.state.enemies[0];
    var hpBefore = enemy.hp;
    // 把一张攻击牌直接塞进手里，避开抽牌随机性
    var atk = null;
    for (var i = 0; i < Run.state.deck.length; i++) {
      if (Run.state.deck[i].def.type === 'attack') { atk = Run.state.deck[i]; break; }
    }
    log('foundAttackCard', !!atk);
    if (atk) {
      Combat.state.player.energy = 9;
      Combat.state.hand.push(atk);
      Combat.playCard(atk.uid);
      Render.draw();
      log('enemyHpDropped', Combat.state.enemies[0].hp < hpBefore);
      log('dmgFloatCount', qa('#view-combat .dmg-float').length);
      log('dmgFloatIsNumber', /^−\\d+/.test((q('#view-combat .dmg-float') || {}).textContent || ''));
      log('enemyGotShake', qa('#enemy-panel .eunit.is-hit').length);
      log('playerNotShaken', qa('#player-panel .is-hit').length);
      // 飘字必须挂在 #view-combat 上（单位面板每帧重建，挂里面会被清掉）
      log('floatHostIsView', q('#view-combat > .dmg-float') !== null);
    }

    // ==================== 5. 打斗反馈（M24） ====================
    // 走真实的出牌与回合结算路径 ——「谁出手」由引擎的动作日志给出，渲染层只消费。
    // 断言分两层写，缺一不可：类挂对了元素（运行时）＋ 规则的方向写对了（CSSOM）。
    //
    // 方向为什么读 CSSOM 而不读 getComputedStyle：headless Edge 恒报
    // prefers-reduced-motion: reduce（--force-prefers-reduced-motion=0 /
    // --disable-features=PrefersReducedMotion / --headless=old 都试过，无效），
    // 动效规则在无头环境里根本不匹配，animationName 永远是 none。那是**测试
    // 环境的属性，不是产品的属性** —— 拿它当断言，等于在测浏览器的默认设置。
    var cssAll = '';
    for (var si = 0; si < document.styleSheets.length; si++) {
      var rs = document.styleSheets[si].cssRules;
      for (var ri = 0; ri < rs.length; ri++) cssAll += (rs[ri].cssText || '');
    }
    // M45 加一层：只要**顶层**规则（媒体查询整块跳过）。
    // 注意 CSSMediaRule.cssText 是含内部规则的完整序列化文本 —— 所以
    // cssAll 里「找得到某条规则」并不能说明它写在媒体查询外。凡是
    // 「必须写在查询外」的断言（动画开关、常显规则）都得用 cssTop 验，
    // 否则无头环境恒 reduce 时那条规则根本不匹配，断言却照样绿。
    var cssTop = '';
    for (var sj = 0; sj < document.styleSheets.length; sj++) {
      var rt = document.styleSheets[sj].cssRules;
      for (var rj = 0; rj < rt.length; rj++) {
        if (rt[rj].media) continue;
        cssTop += (rt[rj].cssText || '');
      }
    }

    Combat.start(20260924, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '探针 · M24',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Render.resetFeedback();
    Render.draw();
    var mc = null;
    for (var mi = 0; mi < Run.state.deck.length; mi++) {
      if (Run.state.deck[mi].def.type === 'attack') { mc = Run.state.deck[mi]; break; }
    }
    Combat.state.player.energy = 9;
    Combat.state.hand.push(mc);
    Combat.playCard(mc.uid);
    Render.draw();
    log('playerSwings', qa('#player-panel .is-attack').length);
    log('playerSwingDir', !/#player-panel\\s+\\.is-attack\\s*\\{[^}]*atk-lunge-r/.test(cssAll));
    log('enemyKnockedBack', qa('#enemy-panel .eunit.is-hit').length);
    log('playerStillOnOwnAttack', qa('#player-panel .is-hit').length);
    log('hitFlashOnArtLayer', /\\.unit\\.is-hit\\s+\\.unit-art\\s*\\{[^}]*hit-flash/.test(cssAll));

    // 敌方回合：所有存活敌人一起出手
    Combat.endTurn();
    Render.draw();
    log('enemySwings', qa('#enemy-panel .eunit.is-attack').length);
    log('enemySwingDir', /#enemy-panel\\s+\\.is-attack\\s*\\{[^}]*atk-lunge-l/.test(cssAll));
    log('playerKnockedBack', qa('#player-panel .is-hit').length);
    log('playerKnockDir', /#player-panel\\s+\\.is-hit\\s*\\{[^}]*hit-knock-l/.test(cssAll));
    log('enemyKnockDir', /#enemy-panel\\s+\\.is-hit\\s*\\{[^}]*hit-knock-r/.test(cssAll));

    // 格挡全吸收：血量一点没掉，但「被打中了」这件事仍然要有反应
    Combat.start(20260925, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '探针 · M24 格挡',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Render.resetFeedback();
    Combat.state.player.block = 99;
    var mHp = Combat.state.player.hp;
    Combat.dealDamage(Combat.state.enemies[0], Combat.state.player, 6);
    Render.draw();
    log('blockAbsorbedAll', Combat.state.player.hp === mHp);
    log('blockedStillReacts', qa('#player-panel .is-hit').length);
    log('blockedNoFakeZero', qa('#view-combat .dmg-float').length);

    // ============ 5.5 单位常驻只剩血条 + 中毒绿色预告段（M43 / M45） ============
    // M43 两件事：① 单位身上常驻的只剩血条一根 —— Boss 铭牌默认隐身
    // （visibility + opacity，占位不动，M21/M30 的逐像素宽度预算一格不减），
    // 鼠标移到敌人上才全亮；触屏无悬停，常驻。
    // M45 把**意图胶囊**从这条隐身路里摘出来了：M43 连它一起收进悬停之后，
    // 不拿鼠标一个个扫就完全不知道对面下一手要干什么（用户实测反馈
    // 「敌人的动作意图还是需要加上」）。现在意图默认淡淡常显（opacity .82），
    // 悬停推全亮，出手那一帧 JS 挂 .intent-reveal 自亮 + intent-pop 弹一下。
    // Boss 铭牌维持 M43 行为 —— 它是身份信息，不是待办动作。
    // ② 血条把「回合开始要扣、还没扣的血」（= 毒层数，无视格挡）铺成绿色：
    //   tickPoison 回合开始扣 p 点、层数 −1，所以预告段宽 = min(毒, 血)/maxHp，
    //   left = (血 − 预告)/maxHp；毒 ≥ 血时绿段从 0 铺满当前血（这口毒致命）。
    Combat.start(20261007, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '探针 · M43',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Render.resetFeedback();
    Render.draw();
    var en43 = Combat.state.enemies[0];
    var hp43 = en43.hp, max43 = en43.maxHp;
    var it43 = q('#enemy-panel .eunit[data-eidx="0"] .intent');
    // M45：意图默认常显（M43 那条 m43IntentHidden 期望 hidden，已被本里程碑推翻）。
    // 桌面档压到 .82 半亮 —— 看得见，又不跟立绘抢戏。
    log('m45IntentVisible', it43 ? getComputedStyle(it43).visibility === 'visible' : 'no-intent');
    log('m43IntentStillLaid', it43 ? getComputedStyle(it43).display !== 'none' : false);
    // 出手自亮：JS 给出手者的意图胶囊挂 .intent-reveal，1100ms 后摘除。
    // 无头环境动画名恒 none（见下方 M26 组），这里只验类名与规则文本两层。
    // ⚠️ 这里不断言 .82 这个具体值：无头 Edge 报 hover: none 还是 hover: hover
    // 取决于版本，触屏档是常驻全亮（opacity 1）。两条分支都是「看得见」，
    // 真正要守住的是「别又变回 M43 的 0」。.82 这个刻度由 CSSOM 文本断言把关。
    log('m45IntentDim', it43 ? (parseFloat(getComputedStyle(it43).opacity) >= 0.82) : 'no-intent');
    var en45 = q('#enemy-panel .eunit[data-eidx="0"]');
    if (en45) Render.revealIntent(en45);
    var rev45 = q('#enemy-panel .eunit[data-eidx="0"] .intent.intent-reveal');
    log('m45RevealClass', !!rev45);
    // ⚠️ 这两条读 cssTop（顶层规则），不读 cssAll —— 规则文本进了
    // CSSMediaRule.cssText，用 cssAll 找的话，就算它被误写进媒体查询里
    // 也照样命中，断言会静默失去意义。
    // ⚠️ 选择器后必须紧跟 \\s*\\{，不能写 [^{}]*\\{ ——
    //   .eunit .intent.intent-reveal 这个选择器在 art.css 里出现**两次**：
    //   第一次在 hover 规则（只有 opacity/visibility，没有 animation），
    //   第二次才是出手自亮规则。[^{}]* 会跨字符撞上第一条，
    //   于是测的其实是「hover 规则里有 animation」—— 恒 false，
    //   而且看不出是哪一条对不上。
    // ⚠️ animation 的值**不能按源码顺序匹配**。CSSOM 会规范化：
    //   源码写animation: intent-pop 1.1s ease-out both，
    //   cssText 里会变成 1.1s ease-out 0s 1 normal both running intent-pop
    //   —— 关键字被展开并排序，动画名挪到末尾。所以只能判「值里含 intent-pop」。
    // ⚠️ 本段注释里禁用反引号：探针脚本是模板字符串，注释中的反引号
    //   会提前闭合模板，后面全被当成 JS 解析（SyntaxError）。
    log('m45RevealCss', /\\.eunit \\.intent\\.intent-reveal\\s*\\{[^}]*animation:[^}]*intent-pop/.test(cssTop));
    log('m45IntentPopKeyframes', cssTop.indexOf('@keyframes intent-pop') >= 0);
    log('m45NoIntentOnPlayer', !q('#player-panel .intent'));
    log('m43PendAbsent', !q('#enemy-panel .hpbar .hp-pending'));
    // 上毒 3 层：绿段出现，宽 = 3/maxHp，贴在当前血右端
    en43.buffs.poison = 3;
    Render.draw();
    var pend43 = q('#enemy-panel .eunit[data-eidx="0"] .hpbar .hp-pending');
    log('m43PendShown', !!pend43);
    log('m43PendWidthOk', pend43
      ? Math.abs(parseFloat(pend43.style.width) - (3 / max43) * 100) < 0.01
      : false);
    log('m43PendLeftOk', pend43
      ? Math.abs(parseFloat(pend43.style.left) - ((hp43 - 3) / max43) * 100) < 0.01
      : false);
    // 毒 ≥ 当前血：绿段从 0 起盖满当前血（这一口毒致命，一眼看出）
    en43.buffs.poison = hp43 + 5;
    Render.draw();
    var pend43b = q('#enemy-panel .eunit[data-eidx="0"] .hpbar .hp-pending');
    log('m43PendCappedLeft', pend43b ? parseFloat(pend43b.style.left) === 0 : false);
    log('m43PendCappedW', pend43b
      ? Math.abs(parseFloat(pend43b.style.width) - (hp43 / max43) * 100) < 0.01
      : false);
    // 毒清掉：绿段消失；玩家没中毒，自己的血条也不该有预告段
    delete en43.buffs.poison;
    Render.draw();
    log('m43PendGone', !q('#enemy-panel .hpbar .hp-pending'));
    log('m43PlayerNoPend', !q('#player-panel .hpbar .hp-pending'));
    // CSSOM 文本断言（M24 惯例：无头读不到应用规则，读规则文本）。
    // M45 后意图与铭牌分道扬镳，三条断言也跟着拆开：
    //   铭牌 —— 仍走 M43 的默认 hidden（悬停才亮）
    //   意图 —— 默认常显（m45IntentVisible 已在上面按 computed 验过）
    log('m43HoverRule',
      /\\.eunit:hover \\.intent[\\s\\S]{0,200}?visibility:\\s*visible/.test(cssTop));
    log('m45PlateHideRuleCss',
      /\\.eunit \\.boss-plate\\s*\\{[^}]*visibility:\\s*hidden/.test(cssTop));
    // M45：意图常显规则写在媒体查询**外**（不依赖设备能力探测 ——
    // 首版套了 @media (hover:hover) and (pointer:fine)，触屏/粗指针机型全灭）
    // ⚠️ 必须用 cssTop：「写在查询外」正是这条断言的全部意义，用 cssAll
    // 的话规则被裹进 @media 也照样命中。同理 hover 全亮与铭牌隐身两条。
    // ⚠️ 匹配用 0?\\.82 而不是 \\.82：CSSOM 的 cssText 会把 .82 归一化成 0.82。
    // （这行注释里**不能出现反引号**：整个探针脚本是一段模板字符串，
    //   注释里的反引号会提前闭合模板，后面所有内容被当成 JS 解析，
    //   直接SyntaxError: Unexpected number。同理反斜杠要双写。）
    log('m45IntentAlwaysRule',
      /\\.eunit \\.intent\\s*\\{[^}]*visibility:\\s*visible/.test(cssTop) &&
      /\\.eunit \\.intent\\s*\\{[^}]*opacity:\\s*0?\\.82/.test(cssTop));
    // 这条反过来：触屏常驻**必须**在 @media (hover: none) 里，读 cssAll。
    log('m45TouchAlways',
      /\\.eunit \\.intent,\\s*\\.eunit \\.boss-plate\\s*\\{[^}]*opacity:\\s*1/.test(cssAll));

    // ==================== 6. 人物动态与打击特效（M26） ====================
    // 待机分流：def.hover 的敌人（拾荒者残影）挂 is-hover + 地面影，
    // 其余接地。断言两层：运行时 HTML 挂对 + CSSOM 规则写对（M24 同法）。
    Combat.start(20260926, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 5, locTag: '探针 · M26',
      deck: Run.state.deck, enemyId: 'scavenger_shade'
    });
    Render.resetFeedback();
    Render.draw();
    log('hoverUnitClass', qa('#enemy-panel .eunit.is-hover').length);
    log('hoverHasOshadow', !!q('#enemy-panel .eunit.is-hover .oshadow'));
    var shImg = q('#enemy-panel .eunit .unit-bm');
    log('idleDelayInline',
      shImg ? (shImg.getAttribute('style') || '').indexOf('animation-delay') >= 0 : false);
    log('idleRuleGround', /\\.unit-art\\s*>[^{}]*\\{[^}]*idle-ground/.test(cssAll));
    log('idleRuleBob', /is-hover[^{}]*\\{[^}]*idle-bob/.test(cssAll));
    log('idleRuleShadow', /\\.oshadow[^{}]*\\{[^}]*idle-shadow/.test(cssAll));
    log('idleKeyframesExist',
      cssAll.indexOf('@keyframes idle-ground') >= 0 &&
      cssAll.indexOf('@keyframes idle-bob') >= 0 &&
      cssAll.indexOf('@keyframes idle-shadow') >= 0);
    // M45 待机幅度：「人物动态掉了」的修复落点。
    // idle-ground 原为写死的 scale(1.008,.988) —— 一个比例，头顶行程 =
    // (1−scaleY)×立绘高。M26 按 150px 身板标定 = 1.8px，经 M23（×0.88）
    // 与 M44（×0.74）两轮压缩后小兵只剩 0.88px，亚像素级、肉眼看不出。
    // 现在改成按目标行程反推的变量，并在窄窗/满编档补偿二次缩放。
    // 无头环境读不到应用值（媒体查询与自定义属性都活着但动画不匹配），
    // 故分三层验：keyframes 文本用了变量 + 变量在标定块里有值 + 实际
    // computed 能解析出变量（自定义属性不受 reduce 影响，getComputedStyle
    // 照样返回声明值 —— 这一点让幅度本身可被无头校验）。
    var ua45 = q('#enemy-panel .eunit .unit-art');
    // 读 cssTop：keyframes 必须写在媒体查询外才能在恒 reduce 的无头环境里
    // 被读到 ——「写在查询外」本身就是这条断言要守住的东西。
    log('idleKeyframesUseVars',
      /@keyframes idle-ground[\\s\\S]{0,300}?scale\\(var\\(--idle-sx/.test(cssTop) &&
      /@keyframes idle-ground[\\s\\S]{0,300}?var\\(--idle-sy/.test(cssTop));
    //
    // ⚠️ 这里的窗口**不能写死区间**。初版写的是 sy45 > .96 && sy45 < .99，
    // 看起来是「宽松区间」，其实把 M45 的刻度锁死了：M48 提到 .9400 后
    // 落在窗口外，立刻一条假失败。这类「区间断言」比等号断言更隐蔽 ——
    // 它读起来像在容忍变化，实际上任何跨区间的调参都会被当成缺陷。
    // 正确的判据是**物理约束**：横向必须 >1（挤压时才宽）、纵向必须 <1
    // （挤压时才矮）；具体刻度交给 m48-travel-matrix 在真实浏览器里量。
    // （另：本段整体在一个模板字符串里，注释中不能出现反引号。）
    var sx45 = ua45
      ? parseFloat(getComputedStyle(ua45).getPropertyValue('--idle-sx')) : NaN;
    var sy45 = ua45
      ? parseFloat(getComputedStyle(ua45).getPropertyValue('--idle-sy')) : NaN;
    log('idleVarsDeclared', isNaN(sx45) ? 'no-var' : (sx45 > 1));
    log('idleVarsDeclaredY', isNaN(sy45) ? 'no-var' : (sy45 < 1 && sy45 > 0.5));
    // 小兵 73px 身板的行程 = 73 × (1 − sy)。这是「看不看得见」的绝对量：
    // 写死比例 scale(1.008,.988) 的旧值只有 0.88px（亚像素，用户说的
    // 「动态掉了」）。断言给**下限**而非等号：往上调幅度不会伪造失败，
    // 退回亚像素才会被抓。M48 基准 .9400 → 4.38px。
    log('idleTravelPx', isNaN(sy45) ? 'no-var'
      : (73 * (1 - sy45)).toFixed(2));
    // 窄窗两档（≤900 --bm-scale .8 / ≤640 .67）把比例往上补 —— 立绘缩小
    // 会把行程再乘一次，不补回来就重蹈 M44 的覆辙。
    //
    // 下面按数值统计 --idle-sy 的各处声明。
    // ⚠️ 本段在 PROBE_SCRIPT 这个**模板字符串**里（见文件头），所以正则的
    // 反斜杠必须写**两个**（\\s）。这是「双反斜杠」在此**唯一正确**的场合 ——
    // 与我记忆里那个「两处 Edit 并发互相覆盖」的坑不同，这里是模板字符串转义，
    // 写成单反斜杠会被模板层吃掉，运行时变成 [^s] 之类，**一条都匹配不到**。
    //
    // 而且 CSSOM 序列化后有两种形态，都要认：
    //   声明式  .unit-art { --idle-sy: .9400; }
    //   引用式  50% { transform: scale(var(--idle-sx, 1.04), var(--idle-sy, .9400)); }
    // 实测 cssAll 里 --idle-sy 共 5 处：基准 1 + ≤900 + ≤640 + 两组 keyframes 的 fallback。
    var syAll = [];
    var syRe = /--idle-sy:\\s*([\\d.]+)|--idle-sy,\\s*([\\d.]+)/g, syM;
    while ((syM = syRe.exec(cssAll))) {
      syAll.push(parseFloat(syM[1] !== undefined ? syM[1] : syM[2]));
    }
    // 先断言集合非空 —— 空集会让下面的全称断言真空成立
    log('idleSyParsedCount', syAll.length);
    // ⚠️ 分界线用**实测基准**（sy45），不写死 .97：写死等于把基准刻度锁成
    // 常量，M48 把基准提到 .9400 后，基准自己会被判成补偿档（0/3 的由来）。
    var baseSy = isNaN(sy45) ? .97 : sy45;
    log('idleNarrowCompensation', syAll.filter(function (v) { return v < baseSy; }).length);
    log('idleBaseDeclared', syAll.filter(function (v) { return v >= baseSy; }).length);

    // 命中特效层结构：headless 恒报 reduce（见第 5 组说明），hitEffect 的
    // matchMedia 分支不会生成特效层 —— 直接调 Render.hitFx 验 DOM 结构。
    var shUnit = q('#enemy-panel .eunit');
    Render.hitFx(shUnit);
    var fx26 = q('#view-combat > .fxlayer');
    log('fxLayerInHost', !!fx26);
    log('fxSlashExists', !!(fx26 && fx26.querySelector('.fx-slash')));
    log('fxRingExists', !!(fx26 && fx26.querySelector('.fx-ring')));
    log('fxSparkCount', fx26 ? fx26.querySelectorAll('.fx-spark').length : 0);
    log('fxKeyframesExist',
      cssAll.indexOf('@keyframes fx-slash') >= 0 &&
      cssAll.indexOf('@keyframes fx-ring') >= 0 &&
      cssAll.indexOf('@keyframes fx-spark') >= 0 &&
      cssAll.indexOf('@keyframes fx-ghost') >= 0);
    // 爆点定位在受击单位附近（容忍 ±60px 的取整与布局浮动）
    log('fxNearUnit', !!(fx26 && shUnit &&
      Math.abs(parseFloat(fx26.style.left) -
        (shUnit.getBoundingClientRect().left +
         shUnit.getBoundingClientRect().width / 2)) < 60));

    // 降级路径（M58 P1 起判据 = td-fx 总开关；系统 reduce 不再参与 ——
    // 实测玩家机器报 reduce，跟着走 = 全套动效消失）：td-fx=0 时
    // hitEffect / attackEffect 都不出特效 DOM，飘字照常。
    // 手动生成的 fxlayer 先删掉，别让它冒充运行时输出。
    fx26.remove();
    try { window.localStorage.setItem('td-fx', '0'); } catch (e26) {}
    log('fxAllowedAfterZero', Render.fxAllowed() === false);
    var gw26 = null;
    for (var i26 = 0; i26 < Run.state.deck.length; i26++) {
      if (Run.state.deck[i26].def.type === 'attack') { gw26 = Run.state.deck[i26]; break; }
    }
    Combat.state.player.energy = 9;
    Combat.state.hand.push(gw26);
    Combat.playCard(gw26.uid);
    Render.draw();
    log('fxOffNoFxLayer', qa('#view-combat > .fxlayer').length === 0);
    log('fxOffNoGhost', qa('.unit-art .ghost').length === 0);
    log('floatStillFlows', qa('#view-combat .dmg-float').length >= 1);
    try { window.localStorage.removeItem('td-fx'); } catch (e26) {}

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
  }

  var pre = document.createElement('pre');
  pre.id = 'probe-out';
    // ==================== 5. 强化标记（M50）====================
    // 独立 try：这一段是后加的，不能让它把前面 1000+ 条断言的产出一起带走。
    try {
    // 5.1 三关的中 Boss 图标各不相同 —— 同一个 type、不同 depth 要拿到三枚不同的图。
    // 不传 depth 时退回第一关那枚（老调用点一个没改，行为也不能变）。
    var eIcons = [3, 15, 28].map(function (d) { return Art.node('elite', d); });
    log('eliteIconPerSegment',
      eIcons[0] !== eIcons[1] && eIcons[1] !== eIcons[2] && eIcons[0] !== eIcons[2]);
    log('eliteIconBackCompat', Art.node('elite') === Art.node('elite', 5));

    // 5.2 战斗里的强化层：M56 起进化体取代「壮大版」——
    // 换皮变体没了（is-variant/is-grown 不再挂在普通敌人上），
    // 「更强」改由进化体自己的立绘 / 体型 / 名字 / 招式表达；词缀照旧。
    Combat.start(20260923, {
      charId: 'digger', hp: 70, maxHp: 75, depth: 20, locTag: '探针 · M50',
      deck: Run.state.deck, enemyId: 'rat_king',
      enemies: [
        { id: 'rat_king', affixes: ['atk_up'] },
        { id: 'crawler', affixes: ['armored'] }
      ]
    });
    Render.resetFeedback();
    Render.draw();
    log('variantClassOnUnit', qa('#enemy-panel .eunit.is-variant.is-grown').length);
    log('variantUnitCount', qa('#enemy-panel .eunit.is-variant').length);
    log('affixChipCount', qa('#enemy-panel .affix-chip').length);
    log('affixChipText', qa('#enemy-panel .affix-chip').map(function (c) {
      return c.textContent; }).join('/'));
    // 常显：不悬停也要看得见（getComputedStyle 的 display / 高度都是真值）
    log('affixRowVisible', (function () {
      var r = q('#enemy-panel .affix-row');
      return !!r && r.offsetHeight > 0 && getComputedStyle(r).visibility !== 'hidden';
    })());
    // M56：进化体「更大」落在立绘上 —— 二阶体（96px 档）比同场的一阶（73px 档）高
    log('evolvedBigger', (function () {
      var imgs = qa('#enemy-panel .eunit .unit-bm');
      if (imgs.length < 2) return false;
      return Math.round(imgs[0].getBoundingClientRect().height) >
             Math.round(imgs[1].getBoundingClientRect().height);
    })());
    log('evolvedArtOwn', (function () {
      var img = q('#enemy-panel .eunit .unit-bm');
      return img && img.getAttribute('src').indexOf('rat_king-cut.png') >= 0;
    })());
    log('variantNameFromEngine', qa('#enemy-panel .eunit .unit-name').map(function (n) {
      return n.textContent; }).join('/'));
    log('affix0Count', (function () {
      Combat.start(20260923, {
        charId: 'digger', hp: 70, maxHp: 75, depth: 3, locTag: '探针 · M50',
        deck: Run.state.deck, enemyId: 'rats'
      });
      Render.resetFeedback();
      Render.draw();
      return qa('#enemy-panel .affix-row').length;
    })());
    var plainBmH = Math.round(q('#enemy-panel .eunit .unit-bm').getBoundingClientRect().height);
    log('plainBmHeight', plainBmH);

    // 5.3 中 Boss 的「精锐」特殊形态（M56b）：恒定变体 + 专属徽记 + 双环黄铜光环。
    // 与普通敌人彻底分开：普通场不加料，buff 特殊形态只属于中 Boss。
    Combat.start(20260923, {
      charId: 'digger', hp: 70, maxHp: 75, depth: 15, locTag: '探针 · M56b',
      deck: Run.state.deck, enemyId: 'warlord',
      enemies: [{ id: 'warlord', variant: 'elite', affixes: ['atk_up'] }]
    });
    Render.resetFeedback();
    Render.draw();
    log('eliteVarClass', (function () {
      var u = q('#enemy-panel .eunit');
      return !!u && u.className.indexOf('is-variant is-elite') >= 0 ? 1 : 0;
    })());
    log('eliteChipText', qa('#enemy-panel .affix-chip').map(function (c) {
      return c.textContent; }).join('/'));
    log('eliteRing', (function () {
      var a = q('#enemy-panel .eunit .unit-art');
      if (!a) return false;
      var s = getComputedStyle(a).boxShadow;
      return s !== 'none' && s.indexOf('rgb(138, 106, 31)') >= 0;
    })());
    log('eliteName', (q('#enemy-panel .eunit .unit-name') || {}).textContent || '');
    } catch (e) {
      log('EXCEPTION_M50', e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
    }

    pre.textContent = out.join('\\n');
  document.body.appendChild(pre);

  // ==================== 4. 移动端视口（M13） ====================
  // headless 窗口有最小宽度（实测 --window-size=390 量到的视口是 510），
  // 所以手机布局只能靠 iframe 复现 —— iframe 的宽度就是它内部的视口宽度。
  // 两个 iframe：一个预置好的双敌战斗页，一个首页（量地图区）。
  // 需要 node 侧启动参数带 --allow-file-access-from-files 才读得到 contentDocument。
  function addFrame(src, fn) {
    var fr = document.createElement('iframe');
    fr.setAttribute('width', '390');
    fr.setAttribute('height', '844');
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;border:0';
    fr.src = src;
    fr.onload = function () {
      var mm = [];
      try { fn(fr, mm); } catch (e) { mm.push('mobileError = ' + String(e && e.message || e)); }
      pre.textContent += '\\n' + mm.join('\\n');
    };
    document.body.appendChild(fr);
  }

  addFrame('_ui-probe-art-frame.html', function (fr, mm) {
    var w = fr.contentWindow, d = fr.contentDocument;
    var qw = function (s) { var e = d.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : -1; };
    var sw = function (s) { var e = d.querySelector(s); return e ? e.scrollWidth : -1; };
    mm.push('mobileViewport = ' + w.innerWidth);
    mm.push('mobileNoHScroll = ' + (d.documentElement.scrollWidth <= w.innerWidth));
    mm.push('mobileStageStacked = ' + w.getComputedStyle(d.querySelector('.battle-stage')).flexDirection);
    mm.push('mobileEnemyFits = ' + (sw('#enemy-panel') <= qw('#enemy-panel') + 1));
    // 手牌张数随抽牌变化，直接比宽度会时紧时松 —— M66 起手牌自适应有
    // 两种合法形态：整排缩放进容器（transform scale，无裁切）或横滚兜底。
    // 断言共同的结果 = 没有任何一张卡被舞台右缘切掉。
    var handEl = d.querySelector('.hand');
    var hcs = w.getComputedStyle(handEl);
    var scaled = hcs.transform && hcs.transform !== 'none';
    var handFits;
    if (scaled) {
      // 缩放态：#hand 自己的 rect 也跟着缩，不能当右缘用 —— 真正会「切卡」
      // 的只有视口。断言任何一张卡的右缘都不超出视口宽。
      handFits = ![].slice.call(handEl.querySelectorAll('.card')).some(function (c) {
        return c.getBoundingClientRect().right > w.innerWidth + 1;
      });
    } else {
      handFits = hcs.overflowX === 'auto' || handEl.scrollWidth <= handEl.clientWidth + 1;
    }
    mm.push('mobileHandFits = ' + handFits);
  });

  addFrame('index.html', function (fr, mm) {
    var d = fr.contentDocument;
    // M55：首屏是主菜单 —— 先 boot 进地图再量（菜单上地图视图是隐藏的）。
    // ⚠️ App 是顶层 const，不挂 window —— 跨 iframe 拿不到 w.App，
    // 必须在 iframe 自己的全局作用域里 eval 裸名。
    try { fr.contentWindow.eval('App.boot()'); }
    catch (e) { mm.push('mobileBootError = ' + String(e && e.message || e)); }
    var ms = d.querySelector('.mapscroll');
    var h = Math.round(ms.getBoundingClientRect().height);
    mm.push('mobileMapPaneFits = ' + (h > 300 && h < 900 && ms.scrollHeight > h));
  });
})();
</script>
`;

// ---- 生成探针页 ----
// FRAME_FILE 专供「移动端视口」那组断言：探针用 390px 宽的 iframe 复现手机，
// 里面预先把一局双敌战斗摆好。Progress.reset() 必须在 App.boot() 之前 ——
// 否则 boot 会先按旧存档渲染一遍，我们再改状态就白改了。
const FRAME_FILE = path.join(BASE, '_ui-probe-art-frame.html');
const FRAME_ENTER = `<script>
var edges = Run.current().edges, bn = null;
for (var i = 0; i < edges.length; i++) {
  var t = Run.state.map.nodes[edges[i]].type;
  if (t === 'monster' || t === 'elite') { bn = edges[i]; break; }
}
App.enterNode(bn); Combat.addEnemy('hound'); Render.draw();
</script>`;

let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
const frameHtml = html
  .replace(/<script>App\.boot\((\{ menu: true \})?\);<\/script>/, '<script>Progress.reset();App.boot();</script>')
  .replace('</body>', FRAME_ENTER + '\n</body>');
fs.writeFileSync(FRAME_FILE, frameHtml);
fs.writeFileSync(PROBE_FILE, html.replace('</body>', PROBE_SCRIPT + '\n</body>'));

// ---- 跑 headless ----
// --allow-file-access-from-files 是移动端断言需要的：file:// 下每个文件都是
// opaque origin，不给这个参数父页读不到 iframe 的 contentDocument。
let dom;
try {
  dom = execFileSync(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-art',
      '--allow-file-access-from-files',
      '--virtual-time-budget=8000', '--window-size=1200,900', '--dump-dom',
      'file:///' + PROBE_FILE.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
} finally {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
  if (fs.existsSync(FRAME_FILE)) fs.unlinkSync(FRAME_FILE);
}

// ---- 解析结果 ----
const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('未找到探针输出 —— 页面脚本在探针执行前就挂了。DOM 长度：' + dom.length);
  process.exit(1);
}

const text = m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// 注意：Edge 的 --dump-dom 会把 <pre> 里的换行序列化成 \r\n，
// 所以每个值尾部都带一个 \r —— 必须 trim，否则断言会「期望 8 实际 8」地假失败。
// （只有最后一行没有 \r，这也是为什么不加 trim 时只有最后一条断言会过。）
const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

// ---- 断言表：[键, 期望, 说明] ----
const CASES = [
  // 1. 图形库
  ['nodeKindCount', '10', '节点图标有 10 种（8 种节点 + M50 的两枚分关中 Boss 图标）'],
  ['enemyKindCount', '29', '敌人剪影有 29 种（17 老 + M56 十二只进化体）'],
  ['charKindCount', '3', '角色形象有 3 种'],
  ['intentKindCount', '5', '意图图标有 5 种'],
  ['allNodesRender', 'true', '8 种节点图标全部产出非空 svg'],
  ['allEnemiesRender', 'true', '11 种敌人剪影全部产出非空 svg'],
  ['allCharsRender', 'true', '3 种角色形象全部产出非空 svg'],
  ['allIntentsRender', 'true', '5 种意图图标全部产出非空 svg'],
  ['unknownNodeFallback', 'true', '未知节点类型退回小怪图形（不产空图）'],
  ['unknownEnemyFallback', 'true', '未知敌人退回腐蚀鼠群'],
  ['unknownIntentFallback', 'true', '未知意图退回四角星'],
  ['cacheReuse', 'true', '同一图形复用同一个字符串实例'],

  // 2. 地图
  ['mapNodeCount', '120', '地图 120 个节点'],
  ['mapNodesWithArt', '120', '每个节点里都有图形（没有空白按钮）'],
  ['mapIconsAreSvg', 'true', '节点的一级内容全部是 svg'],
  ['mapCheckIconsMatchDone', 'true', '每个已走节点都显示勾（入口除外）'],
  ['mapBossCount', '3', '三个大 Boss 节点'],
  ['mapBossBadgeCount', '3', '每个大 Boss 都有难度角标'],
  ['mapBossTiers', '1,2,3', '角标上的难度是 1/2/3'],
  ['mapLineCount', 'true', '连线已绘制（M70 曲线化）'],
  ['mapEdgeCurved', 'true', '连线是贝塞尔曲线（M70）'],
  
  ['mapNodePaintText', '""', '画面上的汉字已撤走'],
  ['mapNodeTitleKept', 'true', '汉字保留在 title 上（悬停提示）'],
  ['mapNodeAriaKept', 'true', '汉字保留在 aria-label 上（无障碍）'],
  ['mapIconSize', '27x27', '普通节点图标 27px（M87/V7 放大）'],
  ['mapBossIconSize', '31x31', '大 Boss 图标放大到 31px（M87/V7）'],
  ['mapColorFollowsType', 'true', '图标颜色跟着节点类型走（currentColor 生效）'],
  ['mapStratumCount', '33', '波浪层理逐层生成（33 层 33 条）'],
  ['mapWalkGlow', 'true', '已走路径有淡晕双层描边（M70）'],

  // 3. 战斗
  ['enemyUnitCount', '1', '一只敌人'],
  ['enemyHasArt', '1', '敌人有位图立绘'],
  ['bitmapCoversAll', 'true', '29 只敌人 + 3 个角色全部有位图立绘路径（M51/M56）'],
  ['enemyArtFollowsId', 'true', '换敌人立绘跟着换（鼠群 ≠ 锈冠）'],
  ['bossKindClass', '1', '大 Boss 走 boss 档样式'],
  ['playerHasArt', '1', '玩家有位图立绘'],
  ['playerImgSrc', 'preview-assets-v3/digger-cut.png', '玩家立绘指向掘者的图'],
  ['intentHasIcon', '1', '意图前有图标'],
  ['intentTextKept', 'true', '「意图 · 」文字前缀未被图标挤掉'],

  // 5. 强化标记（M50）
  ['eliteIconPerSegment', 'true', '三关的中 Boss 图标各不相同'],
  ['eliteIconBackCompat', 'true', '不传 depth 时仍是第一关那枚（老调用点行为不变）'],
  ['variantClassOnUnit', '0', '普通敌人不再有壮大版变体类（M56 退役）'],
  ['variantUnitCount', '0', '变体轴整体归零（进化体是独立 def，不是变体）'],
  ['affixChipCount', '2', '徽章 = 暴戾 + 铁甲'],
  ['affixChipText', '暴戾/铁甲', '徽章文案（词缀短名）'],
  ['affixRowVisible', 'true', '强化标记常显（不悬停也占高度）'],
  ['evolvedBigger', 'true', '进化体立绘真的更大（二阶 96px 档 > 一阶 73px 档）'],
  ['evolvedArtOwn', 'true', '进化体用自己的新立绘（rat_king-cut.png）'],
  ['variantNameFromEngine', '锈牙鼠王/井壁爬虫', '名字来自引擎（进化体是独立 def，不是前缀拼接）'],
  ['affix0Count', '0', '没有强化层的单位不生成空徽章行'],
  ['eliteVarClass', '1', '中 Boss 带精锐变体类（is-variant is-elite）'],
  ['eliteChipText', '★ 精锐/暴戾', '精锐徽记图标 + 词缀徽章（图标特殊形态）'],
  ['eliteRing', 'true', '精锐双环黄铜光环（与强化版单层红光区分）'],
  ['eliteName', '精锐·铁颚督军', '名字前缀来自引擎（精锐· + 本名）'],
  ['plainBmHeight', '73', '一阶小兵立绘基准不变（M21 宽度预算不动）'],
  ['cardTypeColorDiffers', 'true', '卡面按类型分色（攻击 ≠ 技能）'],
  ['cardArtInHand', '5', '手牌 5 张全部带画窗位图'],
  ['cardArtCoversAll', 'true', '卡画注册表覆盖卡池全部 134 张卡'],
  ['cardArtShared', 'true', '泛化卡共用一张图（撬动 = 撬棍）'],

  // 3.5 地形背景
  ['terrainBandBounds', 'true', '深度带边界与 bossDepths 对齐（11/12、22/23 分界）'],
  ['battleBgShown', 'true', 'D3 战斗挂上 band1 背景层'],
  ['battleBgFollowsDepth', 'true', '背景跟着深度换带（D20→band2、D30→band3）'],
  ['groundBandRemoved', 'true', 'M15 地面延伸带已删（背景图自带大地面，M19）'],
  ['groundFallbackFollowsBand', 'true', '背景兜底色随深度带换（位图加载前的 background-color）'],
  ['restSceneShown', 'true', '休息点面板有场景横幅（scene-rest.jpg）'],
  ['sceneSrcNullForReward', 'true', '战斗结算面板不加场景图'],
  ['bossSceneUsesBattleBg', 'true', 'Boss 预告横幅用所在深度带的战斗背景'],
  ['enemyNotClipped', 'true', '800×600 视口下最右敌人不越出舞台右缘（窄窗口回归）'],
  // 满编 4 敌（M21）：菌母 + 3 孢囊行者是全局最挤的编队
  ['crowdUnits', '4', '召唤到 3 只手下时全部渲染出来（没被裁掉）'],
  ['crowdNotClipped', 'true', '满编 4 敌时最右单位仍在舞台内'],
  ['crowdShrinksUnit', 'true', '满编时单位整体等比缩小（zoom 生效）'],
  ['afterDeathUnits', '4', '死亡瞬间：2 活 + 2 具溶解中尸体仍在渲染（P1-3 过渡窗口）'],
  ['dyingPlaying', '2', '溶解中的 2 具挂 is-dying 类'],
  ['afterDeathUnits2', '2', '过渡结束（0.55s）后尸体摘除（M21 铁律不破）'],
  ['afterDeathNotClipped', 'true', '减员后仍不越界'],
  ['afterDeathWidens', 'true', '减员后缩放撤销，剩下的单位变回宽松档'],

  // 窄屏 gap 的特异性覆盖（M44 回归：媒体查询不提升特异性，
  // 桌面档 [data-crowd] 的 gap 会静默压掉窄屏媒体查询里的值）
  // M58b：本探针开头注入了动画终止 style（几何量测用），可读样式表 2 → 3。
  // 哨兵的意义是「可读条数与已知清单一致」—— 读不到会静默假绿。
  ['cssSheetsReadable', '3', '三份样式表（style/art/animKill）的 cssRules 都读得到'],
  ['crowdGapRules', '5', 'battle-stage 的 data-crowd gap 规则：桌面 2 条 + ≤900 档 2 条 + ≤640 档 1 条'],
  ['narrowGapOverridden', 'true', '≤900 / ≤640 两档都复写了 data-crowd 的 gap（否则窄屏会被桌面值压掉）'],

  // 名牌精简与站位（M22）
  ['statsMoreExists', 'true', '名牌里有悬停浮层容器（状态 / 牌堆 / 深度的去处）'],
  ['statsMoreHidden', 'true', '浮层默认不可见 —— 鼠标移上去才展开'],
  ['statsMoreNotLaid', 'true', '浮层绝对定位，不参与布局（宽度预算不受影响）'],
  ['statsMoreHasPiles', 'true', '浮层里真装着牌堆信息，不是空壳'],
  // M43：单位常驻只剩血条 + 中毒绿色预告段；M45：意图胶囊改回常显
  ['m45IntentVisible', 'true', '敌人意图胶囊默认就看得见（M43 的隐身已被 M45 推翻）'],
  ['m45IntentDim', 'true', '常显但压到半亮 —— 看得见又不跟立绘抢戏（刻度由 CSSOM 断言把关）'],
  ['m43IntentStillLaid', 'true', '意图胶囊藏着也占位（display 不为 none，立绘不移位）'],
  ['m45RevealClass', 'true', '出手自亮：JS 给出手者的意图胶囊挂上 .intent-reveal'],
  ['m45RevealCss', 'true', '.intent-reveal 的动画规则在样式表里（挂 intent-pop）'],
  ['m45IntentPopKeyframes', 'true', 'intent-pop keyframes 在媒体查询外（无头可读）'],
  ['m45NoIntentOnPlayer', 'true', '玩家单位没有意图胶囊（出手自亮不会误挂）'],
  ['m43PendAbsent', 'true', '没中毒时血条上没有预告段'],
  ['m43PendShown', 'true', '上毒后血条出现绿色预告段'],
  ['m43PendWidthOk', 'true', '预告段宽度 = 毒层数 / maxHp（回合开始要扣的血）'],
  ['m43PendLeftOk', 'true', '预告段贴在当前血量的右端（left = (hp−毒)/maxHp）'],
  ['m43PendCappedLeft', 'true', '毒层数 ≥ 当前血时预告段从 0 起铺（这一口毒致命）'],
  ['m43PendCappedW', 'true', '毒 ≥ 血时预告段盖满当前血条'],
  ['m43PendGone', 'true', '毒清掉后预告段消失'],
  ['m43PlayerNoPend', 'true', '玩家没中毒时自己的血条也没有预告段'],
  ['m43HoverRule', 'true', '悬停显示意图/铭牌的 CSS 规则在样式表里'],
  ['m45PlateHideRuleCss', 'true', 'Boss 铭牌仍走 M43 的默认 hidden（身份信息，不是待办动作）'],
  ['m45IntentAlwaysRule', 'true', '意图常显规则写在媒体查询外（不靠设备能力探测）'],
  ['m45TouchAlways', 'true', '触屏（hover:none）意图/铭牌常驻的规则在样式表里'],
  ['moreHasName', 'true', '名字搬进了浮层（脚下不再常驻）'],
  ['moreHasNoResForDigger', 'true', '掘者没有资源，浮层里不会凭空多出一个空标签'],
  ['moreHasDepth', 'true', '深度也搬进了浮层'],
  ['footOnlyArtAndHp', 'true', '玩家脚下只剩立绘 + 血条，名牌白框退役'],
  ['noUnitBody', 'true', '整个界面不再出现 .unit-body（白框彻底退役）'],
  ['enemyMoreHasName', 'true', '敌人浮层里也有名字（与玩家同构）'],

  // 点自己 → 钉住浮层（M64b）：常驻 + 指针放行；点其他内容解除
  ['pinToggled', 'true', '点玩家单位 → is-pinned 钉住'],
  ['pinShown', 'true', '钉住后浮层常驻可见（不随鼠标离开消失）'],
  ['pinPointer', 'true', '钉住后浮层放行指针（悬停 icon 能弹 title 注释）'],
  ['pinCleared', 'true', '点其他内容 → 钉住解除'],
  ['pinHiddenAgain', 'true', '解除后浮层回到默认隐身'],
  ['hudExists', 'true', '舞台 HUD 容器存在'],
  ['hudIsStageChild', 'true', 'HUD 是 .battle-stage 的直接子元素（不会被敌人面板带偏）'],
  ['energyInHud', 'true', '能量条挂在舞台 HUD 上'],
  ['energyFirstInHud', 'true', '能量条是 HUD 行的第一块（贴最左）'],
  ['energyTextInHud', '能量 3 / 3', '能量条文本仍是「能量 N / M」'],
  ['energyNotOnUnit', 'true', '玩家脚下不再有能量文字（搬去左上角了）'],
  ['hudAtStageTopLeft', '19,15', 'HUD 贴在舞台左上角（相对舞台 19,15）'],
  ['playerArtDirectChild', 'true', '玩家立绘直接挂在单位上（与敌人同款竖排）'],
  ['enemyArtDirectChild', 'true', '敌人立绘直接挂在单位上（两侧版式一致）'],
  ['stageCentered', 'true', '舞台内容居中：玩家左留白与敌人右留白基本相等'],

  // 前后排与站位（M23）
  ['rearRankExists', 'true', '多重敌人时后排有单位（Boss / 精英退到后排）'],
  ['frontRankForMinions', 'true', '小怪站前排'],
  ['rearSitsAfter', 'true', '后排排在所有前排之后（视觉上更靠右 = 离我方更远）'],
  ['rearUnitHigher', 'true', '后排整体抬高（同屏时 top 比前排小）'],
  ['unitsNotOverlap', 'true', '相邻单位不重叠（间距是正的）'],
  ['soloNoRear', 'true', '单敌时没有后排（不误抬）'],
  ['artFitsStage', 'true', '单敌立绘不超过舞台高度的 45%（角色尺寸有上限）'],

  // 3.6 移动端视口（390px iframe 复现真机宽度）
  ['mobileViewport', '390', 'iframe 复现的视口确实是 390px（headless 窗口压不到这么窄）'],
  ['mobileNoHScroll', 'true', '390px 下页面整体无横向溢出'],
  ['mobileStageStacked', 'column', '手机档舞台改成上下两行（敌我各一行）'],
  ['mobileEnemyFits', 'true', '390px 下敌人面板内容不溢出面板块（意图折行后）'],
  ['mobileHandFits', 'true', '手牌不被舞台右缘切卡（M66：缩放适配或横滚兜底）'],
  ['mobileMapPaneFits', 'true', '地图区占满一屏剩余高度且内部可滚（不是被撑成整张图高）'],

  // 4. 受击反馈
  ['foundAttackCard', 'true', '牌堆里找得到攻击牌'],
  ['enemyHpDropped', 'true', '打出的牌真的扣了敌人血'],
  ['dmgFloatCount', '1', '敌人身上飘出一个伤害数字'],
  ['dmgFloatIsNumber', 'true', '飘字内容形如 −6'],
  ['enemyGotShake', '1', '被打的敌人抖了'],
  ['playerNotShaken', '0', '没受伤的玩家不抖'],
  ['floatHostIsView', 'true', '飘字挂在不重绘的 #view-combat 上'],

  // 打斗反馈（M24）
  ['playerSwings', '1', '打出攻击牌时玩家出手前冲'],
  ['playerSwingDir', 'true', 'M73b：玩家攻击原地化（CSS 不再带向右突进）'],
  ['enemyKnockedBack', '1', '挨打的敌人被击退'],
  ['playerStillOnOwnAttack', '0', '自己出手的那一帧不会同时显示挨打'],
  ['hitFlashOnArtLayer', 'true', '闪红挂在立绘层，不与单位位移抢 transform'],
  ['enemySwings', '1', '敌方回合里敌人出手前冲'],
  ['enemySwingDir', 'true', '敌人出手的动画朝左（玩家方向）'],
  ['playerKnockedBack', '1', '玩家被打时被击退'],
  ['playerKnockDir', 'true', '玩家被击退的动画朝左（背离敌人）'],
  ['enemyKnockDir', 'true', '敌人被击退的动画朝右（背离玩家）'],
  ['blockAbsorbedAll', 'true', '格挡把这次伤害全吸收了，血量没掉'],
  ['blockedStillReacts', '1', '被完全格挡也算挨了一下，仍有受击反应'],
  ['blockedNoFakeZero', '0', '被完全格挡时不飘一个假的「−0」'],

  // 人物动态与打击特效（M26）
  ['hoverUnitClass', '1', '悬浮敌人（拾荒者残影）挂 is-hover 类'],
  ['hoverHasOshadow', 'true', '悬浮敌人脚下有地面影（接地单位没有）'],
  ['idleDelayInline', 'true', '待机动画相位错开（内联 animation-delay）'],
  ['idleRuleGround', 'true', '接地待机 = 脚底为轴的呼吸挤压（idle-ground）'],
  ['idleRuleBob', 'true', '悬浮待机 = 上下浮动（idle-bob，只有 is-hover 走）'],
  ['idleRuleShadow', 'true', '地面影随浮动反向缩放（idle-shadow）'],
  ['idleKeyframesExist', 'true', '三组待机 keyframes 都在媒体查询外（无头可读）'],
  // M45 待机幅度重修：比例型 keyframes 未随立绘压缩重标定 = 「动态掉了」
  ['idleKeyframesUseVars', 'true', 'idle-ground 改走 --idle-sx/--idle-sy（幅度可标定、可补偿）'],
  ['idleVarsDeclared', 'true', '标定块给 --idle-sx 真值（横向必须 >1，挤压时才变宽）'],
  ['idleVarsDeclaredY', 'true', '标定块给 --idle-sy 真值（纵向必须 <1，挤压时才变矮）'],
  ['idleTravelPx', '4.38', '小兵 73px 待机行程（M48 提到 6% 幅度；M44 旧值 0.88px 是亚像素）'],
  ['idleSyParsedCount', '5', 'CSSOM 里 --idle-sy 共 5 处（基准声明 1 + ≤900 + ≤640 + idle-ground/idle-boss 的 fallback 2）'],
  ['idleBaseDeclared', '3', '与基准同值的 3 处（.unit-art 声明 + 两组 keyframes 的 fallback）'],
  ['idleNarrowCompensation', '2', '≤900 / ≤640 两档各补一条更深的比例（立绘缩小会二次缩水行程）'],
  ['fxLayerInHost', 'true', '特效层挂在 #view-combat（躲面板全量重建）'],
  ['fxSlashExists', 'true', '特效层里有斩击弧光'],
  ['fxRingExists', 'true', '特效层里有冲击环'],
  ['fxSparkCount', '8', '特效层里碎屑 8 片'],
  ['fxKeyframesExist', 'true', '弧光/环/碎屑/残影 keyframes 齐全'],
  ['fxNearUnit', 'true', '爆点定位在受击单位身上'],
  ['fxAllowedAfterZero', 'true', 'td-fx=0 → fxAllowed() false（P1 分控判据）'],
  ['fxOffNoFxLayer', 'true', '关动效（td-fx=0）不出特效层（降级只剩飘字）'],
  ['fxOffNoGhost', 'true', '关动效不出手残影'],
  ['floatStillFlows', 'true', '关动效下飘字仍然工作'],

  // 卡面铭牌化（M27）
  ['rarBorderOk', 'true', '手牌每张卡的边框色 = 自身稀有度色'],
  ['rarBorderCounted', 'true', '手牌存在可校验的卡（稀有度类齐全）'],
  ['cssomRarVars', 'true', '样式表注入了各稀有度的 --rar 铭牌色'],
  ['cssomPlaqueLayers', 'true', '铭牌工艺层（四角铆钉 ::before / 内刻线 ::after）在样式表里'],
  ['cardHtmlRarClass', 'true', 'NodePanel.cardHtml 输出带稀有度类（商店/奖励同款）'],
  ['cssomHoverGlow', 'true', '选中发光：hover 亮环规则在样式表里（M27b）'],
  ['cssomActiveGlow', 'true', '按下瞬间 active 光更强（M27b）'],

  ['jsError', 'none', '页面无 JS 运行时错误'],
];

const SKIP_OK = { cardTypeColorDiffers: 'skip' };

let total = 0, fail = 0;
const groups = { 1: '图形库', 2: '地图', 3: '战斗', 4: '受击反馈' };
const bounds = { nodeKindCount: 1, mapNodeCount: 2, enemyUnitCount: 3, foundAttackCard: 4 };
let group = 1;

CASES.forEach(function (c) {
  if (bounds[c[0]]) {
    group = bounds[c[0]];
    console.log('\n【' + groups[group] + '】');
  }
  total++;
  let actual = got[c[0]];
  let ok = actual === c[1];
  if (!ok && SKIP_OK[c[0]] && String(actual).indexOf('skip') === 0) ok = true;
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] +
    (ok ? '' : '（期望 ' + c[1] + '，实际 ' + actual + '）'));
});

console.log('\n图形层 UI 链路' + (fail ? '有失败：' : '全部通过：') + total + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
