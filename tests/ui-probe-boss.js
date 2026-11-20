// M5 Boss 战 UI 探针：验证多敌人渲染、目标切换、Boss 预告面板、Boss 战完整链路
// （走地图 → 预告 → 开打 → 胜利 → 奖励 → 回地图 → 节点结算）。
//
// 手法与 ui-probe.js / ui-probe-map.js / ui-probe-node.js 一致：复制 index.html、
// 注入操作脚本、Edge headless 跑、读回 DOM。用固定种子起局，探针本身可复现。
//
// 分工：小怪战斗的奖励面板已由 ui-probe-node.js 覆盖，这里只补 M5 新增的部分
// —— 多敌人列表、目标切换、负值状态、Boss 预告、召唤后列表增长、中 Boss 遗物奖励。
//
// 断言一律是「字符串 key → 字符串期望值」：所有需要比较的判断都在探针里算成
// true / false 再回读，不在 Node 侧写条件表达式（那会变成 got[true] 恒为 undefined）。
//
// 运行：node tests/ui-probe-boss.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-boss.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function click(el) { if (el) el.click(); return el; }
  function text(sel) { var el = q(sel); return el ? el.textContent : ''; }
  function has(sel, sub) { return text(sel).indexOf(sub) >= 0; }
  function panel() { return document.getElementById('placeholder'); }
  function units() { return qa('#enemy-panel .eunit'); }

  try {
    // M7：index.html 加载时已经 boot 过一次，而存档 / 等级是跨页面加载留着的，
    // 探针复用的又是同一个 --user-data-dir —— 不先清干净，上一轮的状态会渗进来。
    Progress.reset();
    App.boot();
    Run.start('act1', 20260923);
    App.showMap();

    // ==================== 走到 D11 的 Boss 节点（§5.3：Boss 层是 D11 / D22 / D33）====================
    var guard = 0;
    while (Run.current().depth < 11 && guard++ < 60) {
      Run.moveTo(Run.current().edges[0]);
    }
    var bossNode = Run.current();
    log('bossNodeType', bossNode.type);
    log('bossNodeEnemy', bossNode.enemyId);
    App.showMap();

    // ==================== Boss 预告面板 ====================
    NodePanel.showBoss();
    log('bossPanelShown', panel().hidden === false);
    log('bossTitle', q('.np-title').textContent);
    log('bossLoreOk', text('.np-text').length > 10);
    log('bossStatPills', qa('.np-bossstats span').length);
    log('bossFightBtn', !!q('[data-act="fightboss"]'));

    click(q('[data-act="fightboss"]'));
    log('bossPanelClosed', panel().hidden === true);
    log('combatViewShown', document.getElementById('view-combat').hidden === false);
    log('mapViewHidden', document.getElementById('view-map').hidden === true);
    log('bossInBattle', Combat.state.enemies[0].name);
    log('bossMaxHp', Combat.state.enemies[0].maxHp);
    // M35：Boss 战必须切到 boss 曲（不是普通战曲）。
    // 这条不能省 —— 「startBattle 里按 node.type 分派」若写成恒等（永远传 false），
    // 光断言「有音乐在播」照样全绿。
    log('bossBgmTrack', Bgm.state().track);
    log('bossBgmPlaying', Bgm.state().playing);
    // M25：地点标签从 #enemy-panel 搬到舞台 HUD（贴舞台左上角）——
    // 断言按语义找它（「战斗里标了 Boss 名」），不认它在哪个容器里
    log('locTagHasBoss', has('#stage-hud .unit-role', '锈冠'));
    log('bossUnits', units().length);
    log('bossIntentShown', text('#enemy-panel .intent').indexOf('意图') === 0);
    log('bossNoTargetHint', !q('.target-hint'));

    // ==================== M30：Boss 关底气势（存在感呈现）====================
    var stage30 = q('.battle-stage');
    log('m30DataBoss', !!stage30 && stage30.getAttribute('data-boss') === '1');
    var plate30 = q('#enemy-panel .boss-plate');
    log('m30PlateHasName', !!plate30 && plate30.textContent.indexOf('锈冠') >= 0);
    log('m30PlateHasTier', !!plate30 && plate30.textContent.indexOf('第 1 道闸门') >= 0);
    log('m30HprowBoss', !!q('#enemy-panel .hprow-boss'));
    var bar30 = q('#enemy-panel .hprow-boss .hpbar');
    log('m30BossBarH', bar30 ? getComputedStyle(bar30).height : 'none');
    var bm30 = q('#enemy-panel .art-kind-boss .unit-bm');
    log('m30BossArtH', bm30 ? getComputedStyle(bm30).height : 'none');
    // CSSOM 文本断言（M24 惯例：无头恒 reduce，应用规则读不到，读规则文本）
    var css30 = '';
    Array.prototype.forEach.call(document.styleSheets, function (ss) {
      try {
        Array.prototype.forEach.call(ss.cssRules, function (r) { css30 += r.cssText; });
      } catch (e) {}
    });
    log('m30CssEntrance', css30.indexOf('boss-entrance') >= 0);
    log('m30CssIdleBoss', css30.indexOf('idle-boss') >= 0);
    log('m30CssVignette', css30.indexOf('[data-boss="1"]') >= 0);
    // 开战瞬间（fightboss → App.startBattle → resetFeedback）：M58 P1 起判据
    // 是 td-fx 总开关（默认开），headless 也照常挂入场类 —— 动效常驻后
    // 无头能验「类挂上了」，动画本身仍由真机确认。
    log('m30EnteringOn', !!stage30 && stage30.classList.contains('boss-entering'));
    // 分控：td-fx=0 → fxAllowed false → resetFeedback 不再挂入场类
    try { window.localStorage.setItem('td-fx', '0'); } catch (e30) {}
    stage30.classList.remove('boss-entering');
    Render.resetFeedback();
    log('m30FxOffSkip', !!stage30 && !Render.fxAllowed() &&
        !stage30.classList.contains('boss-entering'));
    try { window.localStorage.removeItem('td-fx'); } catch (e30) {}

    // ==================== 打到胜利 → 奖励 → 回地图 ====================
    Combat.state.enemies[0].hp = 0;
    Combat.checkEnd();
    Render.draw();
    log('bossWin', Combat.state.phase);
    log('resultShown', document.getElementById('result').hidden === false);
    log('resultWinStyle', document.getElementById('result').classList.contains('result-win'));

    click(q('#result-next'));
    log('rewardPanelShown', panel().hidden === false);
    log('rewardMapVisible', document.getElementById('view-map').hidden === false);
    // M68：大 Boss 奖励改成两段式（稀有卡三选一 → 稀有遗物三选一）
    log('rewardCards', qa('#placeholder .np-pick[data-act="bossgetcard"]').length);
    log('rewardRareHead', [].slice.call(document.querySelectorAll('#placeholder .np-h'))
      .some(function (h) { return h.textContent.indexOf('稀有卡') >= 0; }));

    var deck0 = Run.state.deck.length;
    click(qa('#placeholder .np-pick[data-act="bossgetcard"]')[0]);
    log('rewardTaken', Run.state.deck.length === deck0 + 1);
    // 领完卡进遗物段：三件稀有遗物可选
    log('rewardRelicPicks', qa('#placeholder .np-pick[data-act="bossgetrelic"]').length);
    var relic0 = Run.state.relics.length;
    click(qa('#placeholder .np-pick[data-act="bossgetrelic"]')[0]);
    log('rewardRelicTaken', Run.state.relics.length === relic0 + 1);
    log('bossNodeCleared', Run.state.cleared[bossNode.id]);
    log('backOnMap', document.getElementById('view-map').hidden === false);
    log('topbarDepth', document.getElementById('loc-depth').textContent);

    // ==================== 多敌人：列表与目标切换（双头犬）====================
    Combat.start(7, { enemyId: 'hound', depth: 3, hp: 75, maxHp: 75 });
    Render.draw();
    log('houndUnits', units().length);
    // M30 对照组：普通战没有 Boss 排场
    log('m30HoundDataBoss', !!stage30 && stage30.getAttribute('data-boss') === '0');
    log('m30HoundNoPlate', !q('#enemy-panel .boss-plate'));
    var barN30 = q('#enemy-panel .hpbar');
    log('m30HoundBarH', barN30 ? getComputedStyle(barN30).height : 'none');
    log('houndTargetMarks', qa('#enemy-panel .is-target').length);
    log('houndTargetTag', q('.target-tag') ? 'yes' : 'no');
    log('houndHintShown', !!q('.target-hint'));
    log('houndSecondName', units()[1].querySelector('.unit-name').textContent);

    click(units()[1]);
    log('targetIdx', Combat.state.targetIdx);
    log('secondIsTarget', units()[1].classList.contains('is-target'));
    log('firstNotTarget', !units()[0].classList.contains('is-target'));

    var hpA = Combat.state.enemies[0].hp;
    var hpB = Combat.state.enemies[1].hp;
    Combat.state.hand = [mkCard('strike')];
    Render.draw();
    click(q('#hand .card'));
    log('hitSecond', Combat.state.enemies[1].hp === hpB - 6);
    log('firstUntouched', Combat.state.enemies[0].hp === hpA);

    Combat.state.enemies[1].hp = 0;
    Render.draw();
    // M58 P1 死亡表现：死亡瞬间仍渲染（is-dying 溶解过渡 0.55s），
    // 快进过渡期后再验「尸体不占位」—— M21 铁律的窗口期版本。
    log('dyingRendered', qa('#enemy-panel .eunit.is-dying').length === 1);
    (Render._dying || []).forEach(function (d) { d.t = 0; });
    Render.draw();
    // M21 起死亡单位不再进 DOM：以前保留半透明尸体，但它在 flex 流里
    // 仍占着一整格宽，菌母满编召唤时会把后来者挤出舞台右缘。
    log('deadRemoved', units().length === 1);
    log('deadIndexGone', !q('#enemy-panel .eunit[data-eidx="1"]'));
    log('autoTargetFirst', units()[0].classList.contains('is-target'));

    // ==================== 意图文案：招式自带的 desc ====================
    Combat.start(11, { enemyId: 'crawler', depth: 2, hp: 75, maxHp: 75 });
    Render.draw();
    log('crawlerIntent', text('#enemy-panel .intent'));
    log('crawlerIntentHasTimes', has('#enemy-panel .intent', '× 2'));

    Combat.start(13, { enemyId: 'scavenger_shade', depth: 4, hp: 75, maxHp: 75 });
    Render.draw();
    log('shadeIntentMentionMimic', has('#enemy-panel .intent', '模仿'));

    // ==================== 负值状态（锈冠的锈蚀）====================
    Combat.start(15, { enemyId: 'rust_crown', depth: 5, hp: 75, maxHp: 75 });
    Render.draw();
    log('noNegStatBefore', !q('#player-panel .stat-neg'));
    Combat.state.player.buffs.dex = -2;
    Render.draw();
    log('negStatShown', !!q('#player-panel .stat-neg'));
    log('negStatHasMinus', has('#player-panel .stat-neg', '-2'));

    // ==================== 召唤后敌人列表增长 ====================
    Combat.start(17, { enemyId: 'mycelium_mother', depth: 10, hp: 200, maxHp: 200 });
    Render.draw();
    log('motherUnitsBefore', units().length);
    Combat.endTurn();
    Render.draw();
    log('motherUnitsAfter', units().length);
    // M23：单位顺序不再等于引擎顺序（小怪站前排、Boss 退后排），
    // 原来按「面板里第 2 个单位」定位召唤物，重排后那一格变成菌母本体 ——
    // 改成按名字找，不再绑位置。
    var sporeUnit = null;
    units().forEach(function (u) {
      var nm = u.querySelector('.unit-name');
      if (nm && nm.textContent.indexOf('孢囊行者') >= 0) sporeUnit = u;
    });
    log('summonNameOk', !!sporeUnit);
    log('summonHasIntent', !!sporeUnit &&
        sporeUnit.querySelector('.intent').textContent.indexOf('意图') === 0);
    // M30：2 敌档（未满编）铭牌与宽血条保留 —— 回退只发生在 alive 3/4
    log('m30MotherDataBoss', !!stage30 && stage30.getAttribute('data-boss') === '1');
    var plateM30 = q('#enemy-panel .boss-plate');
    log('m30MotherPlateVisible', !!plateM30 &&
        getComputedStyle(plateM30).display !== 'none');

    // ==================== 中 Boss 必掉遗物（奖励面板）====================
    Run.start('act1', 4242);
    App.showMap();
    var eliteNode = null;
    var i, j;
    for (i = 0; i < Run.state.map.layers.length && !eliteNode; i++) {
      for (j = 0; j < Run.state.map.layers[i].length; j++) {
        if (Run.state.map.layers[i][j].type === 'elite') {
          eliteNode = Run.state.map.layers[i][j];
          break;
        }
      }
    }
    log('foundElite', !!eliteNode);
    if (eliteNode) {
      eliteNode.enemyId = 'warlord';
      Run.state.currentId = eliteNode.id;
      Run.state.relics = [];
      NodePanel.showReward(eliteNode);
      log('eliteRelicCard', !!q('#placeholder .npc-relic'));
      log('eliteHeadingOk', has('#placeholder .np-h', '必掉'));
      log('eliteStillPicks', qa('#placeholder .np-pick[data-act="pickcard"]').length);
      click(q('#placeholder [data-act="leave"]'));
    }

    log('jsError', window.__err || 'none');
  } catch (e) {
    out.push('EXCEPTION = ' + (e && e.message ? e.message : String(e)));
    out.push('AT = ' + (e && e.stack ? String(e.stack).split('\\n')[1] : ''));
  }

  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);
  // M30 入场类的时序断言：resetFeedback 挂类 0.95s 后自摘。
  // 同步段做不到「等」，借 virtual-time-budget 推进 setTimeout 补一刀。
  setTimeout(function () {
    var s = document.querySelector('.battle-stage');
    out.push('m30EnteringCleared = ' + (s ? !s.classList.contains('boss-entering') : ''));
    pre.textContent = out.join('\\n');
  }, 1400);
})();
</script>
`;

let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
// M30：新版 Edge 对 file:// 下 <link> 样式表的 cssRules 拒读（M27 时还能读，
// CSSOM 断言因此拿不到规则文本）—— 把两个 CSS 内联成 <style>，同文档
// 样式表一定能读。内容与 link 加载的一致，重复规则无副作用。
const cssInline =
  fs.readFileSync(path.join(BASE, 'css/style.css'), 'utf8') + '\n' +
  fs.readFileSync(path.join(BASE, 'css/art.css'), 'utf8');
html = html.replace('</body>',
  '<style data-probe-inline>\n' + cssInline + '\n</style>\n' +
  PROBE_SCRIPT + '\n</body>');
fs.writeFileSync(PROBE_FILE, html);

// ---- 跑 headless ----
let dom;
try {
  dom = execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-boss',
      '--virtual-time-budget=5000',
      '--window-size=1200,900',
      '--dump-dom',
      'file:///' + PROBE_FILE.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
} finally {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
}

// ---- 解析结果 ----
const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('未找到探针输出 —— 说明页面脚本在探针执行前就挂了。');
  console.log('DOM 长度：' + dom.length);
  process.exit(1);
}

const text = m[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .trim();

console.log('\n=== M5 Boss 战 UI 探针结果 ===');
console.log(text);

const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

const checks = [
  // Boss 节点
  ['bossNodeType', 'boss', 'D11 是 Boss 节点'],
  ['bossNodeEnemy', 'rust_crown', 'D11 的对手是锈冠'],

  // 预告面板
  ['bossPanelShown', 'true', 'Boss 战前弹出预告面板'],
  ['bossTitle', '锈冠', '预告面板标题是 Boss 名'],
  ['bossLoreOk', 'true', '预告面板写了世界观台词（' + got.bossLoreLen + '）'],
  ['bossStatPills', '3', '预告面板列出生命 / 难度 / 位置'],
  ['bossFightBtn', 'true', '预告面板有「迎战」按钮'],

  // 进战斗
  ['bossPanelClosed', 'true', '点迎战后预告面板关闭'],
  ['combatViewShown', 'true', '切到战斗视图'],
  ['mapViewHidden', 'true', '地图视图隐藏'],
  ['bossInBattle', '锈冠', '战斗里确实是锈冠'],
  ['bossMaxHp', '220', '锈冠 220 血（不叠深压）'],
  ['bossBgmTrack', 'boss', 'M35：Boss 战切到 boss 曲（不是普通战曲）'],
  ['bossBgmPlaying', 'true', 'M35：Boss 战 BGM 处于播放中'],
  ['locTagHasBoss', 'true', '战斗顶栏标注了 Boss 名'],
  ['bossUnits', '1', 'Boss 战只有一个敌人单位'],
  ['bossIntentShown', 'true', 'Boss 的意图已渲染'],
  ['bossNoTargetHint', 'true', '单敌人时不显示「点敌人切换目标」'],

  // 胜利与奖励
  ['bossWin', 'win', '击杀 Boss 后判定胜利'],
  ['resultShown', 'true', '弹出战斗结果'],
  ['resultWinStyle', 'true', '结果面板用的是胜利样式'],
  ['rewardPanelShown', 'true', '战斗胜利后弹出奖励面板'],
  ['rewardMapVisible', 'true', '奖励面板盖在地图视图上'],
  ['rewardCards', '3', '奖励给 3 张候选卡（M68：稀有卡三选一）'],
  ['rewardRareHead', 'true', '首段标题写明「稀有卡」'],
  ['rewardTaken', 'true', '选中的奖励卡进了卡组'],
  ['rewardRelicPicks', '3', 'M68：第二段给 3 件稀有遗物可选'],
  ['rewardRelicTaken', 'true', '选中的遗物已入袋'],
  ['bossNodeCleared', 'win', 'Boss 节点结算为 win'],
  ['backOnMap', 'true', '领完奖励回到地图'],
  ['topbarDepth', 'D11', '顶栏深度停在 D11'],

  // 多敌人
  ['houndUnits', '2', '双头犬渲染成两个单位'],
  ['houndTargetMarks', '1', '同一时刻只有一个目标'],
  ['houndTargetTag', 'yes', '目标单位带「目标」标记'],
  ['houndHintShown', 'true', '多敌人时提示可以切目标'],
  ['houndSecondName', '双头犬 #2', '第二颗头自动带 #2 后缀'],
  ['targetIdx', '1', '点第二个单位切换了当前目标'],
  ['secondIsTarget', 'true', '第二个单位变成目标'],
  ['firstNotTarget', 'true', '第一个单位不再是目标'],
  ['hitSecond', 'true', '攻击打到了新选的目标'],
  ['firstUntouched', 'true', '没选中的敌人不掉血'],
  ['dyingRendered', 'true', '死亡瞬间尸体仍渲染并挂 is-dying（P1-3 溶解过渡）'],
  ['deadRemoved', 'true', '过渡结束（0.55s）后尸体摘除（M21 起尸体不占位）'],
  ['deadIndexGone', 'true', '阵亡单位对应的 data-eidx 元素已消失'],
  ['autoTargetFirst', 'true', '目标阵亡后自动落到还活着的敌人身上'],

  // 意图文案
  ['crawlerIntentHasTimes', 'true', '爬虫意图写明两段攻击（' + got.crawlerIntent + '）'],
  ['shadeIntentMentionMimic', 'true', '残影意图里写了「模仿」'],

  // 负值状态
  ['noNegStatBefore', 'true', '初始没有负值状态'],
  ['negStatShown', 'true', '锈蚀后渲染出负值状态'],
  ['negStatHasMinus', 'true', '负值状态显示 −2'],

  // 召唤
  ['motherUnitsBefore', '1', '菌母开局只有本体'],
  ['motherUnitsAfter', '2', '召唤后敌人列表增长到 2'],
  ['summonNameOk', 'true', '召唤物名字是孢囊行者'],
  ['summonHasIntent', 'true', '召唤物立刻显示自己的意图'],

  // 中 Boss 遗物
  ['foundElite', 'true', '地图里能找到中 Boss 节点'],
  ['eliteRelicCard', 'true', '中 Boss 奖励面板显示遗物卡'],
  ['eliteHeadingOk', 'true', '遗物区标明了「中 Boss 必掉」'],
  ['eliteStillPicks', '3', '遗物之外仍然给 3 张候选卡'],

  // M30 Boss 关底气势
  ['m30DataBoss', 'true', 'Boss 战舞台标记 data-boss=1'],
  ['m30PlateHasName', 'true', '铭牌常驻显示 Boss 名（锈冠）'],
  ['m30PlateHasTier', 'true', '铭牌显示头衔「第 1 道闸门」'],
  ['m30HprowBoss', 'true', 'Boss 血条挂 hprow-boss 类'],
  ['m30BossBarH', '18px', 'Boss 血条加高到 18px（小兵 14px）—— M44 基准整体 ×0.9'],
  ['m30BossArtH', '130px', 'Boss 立绘升到 130px 档 —— M44 立绘基准 ×0.74（原 176）'],
  ['m30CssEntrance', 'true', '入场 keyframes 已并入样式表'],
  ['m30CssIdleBoss', 'true', 'Boss 沉重待机 keyframes 已并入'],
  ['m30CssVignette', 'true', '暗角规则（data-boss 驱动）已并入'],
  ['m30EnteringOn', 'true', '开战瞬间挂入场类（M58 起判据 td-fx，headless 也挂）'],
  ['m30FxOffSkip', 'true', 'td-fx=0 时 resetFeedback 不挂入场类（分控分流正确）'],
  ['m30EnteringCleared', 'true', '0.95s 后入场类自动摘除（虚拟时间推进）'],
  ['m30HoundDataBoss', 'true', '普通战 data-boss 归零'],
  ['m30HoundNoPlate', 'true', '小兵没有铭牌'],
  ['m30HoundBarH', '14px', '小兵血条维持 14px —— M44：9px 数字的最小可用条高'],
  ['m30MotherDataBoss', 'true', '菌母战 data-boss=1'],
  ['m30MotherPlateVisible', 'true', '召唤战（2 敌）铭牌仍显示'],

  ['jsError', 'none', '页面无 JS 运行时错误'],
];

let fail = 0;
console.log('\n=== 断言 ===');
checks.forEach(function (c) {
  const ok = got[c[0]] === c[1];
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] +
              '（期望 ' + c[1] + '，实际 ' + got[c[0]] + '）');
});

const total = checks.length;
console.log('\n' + (fail === 0 ? 'M5 Boss 战 UI 链路全部通过' : 'M5 Boss 战 UI 链路存在失败项') +
            '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
