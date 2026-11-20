// M4 节点面板 UI 探针：验证事件 / 商店 / 休息 / 宝箱 / 战斗奖励五类面板的交互链路
// （点选项 → 状态变化 → 重绘 → 结算 → 回地图）。逻辑层测试跑不到事件绑定与面板重绘。
//
// 手法与 ui-probe.js / ui-probe-map.js 一致：复制 index.html、注入操作脚本、
// Edge headless 跑、读回 DOM。用固定种子起局，保证探针本身可复现。
//
// 分工：「点地图节点 → 弹面板」已由 ui-probe-map.js 覆盖，这里直接调 NodePanel.show*
// 打开面板，专注面板内部的交互，避免两个探针重复覆盖同一段逻辑。
//
// 运行：node tests/ui-probe-node.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-node.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function click(el) { el.click(); return el; }
  function panel() { return document.getElementById('placeholder'); }

  try {
    // M7：index.html 加载时已经 boot 过一次，而存档 / 等级是跨页面加载留着的，
    // 探针复用的又是同一个 --user-data-dir —— 不先清干净，上一轮的状态会渗进来。
    Progress.reset();
    App.boot();
    Run.start('act1', 20260924);
    App.showMap();

    // 让位置落到一个真实节点上 —— settle 会标记"当前节点"
    Run.moveTo(Run.current().edges[0]);
    App.showMap();

    // ==================== 随机事件 ====================
    NodePanel.showEvent();
    log('evShown', panel().hidden === false);
    log('evTitleNotEmpty', (q('.np-title').textContent || '').length > 0);
    log('evBackdrop', !!q('#placeholder .np-status') && !!q('#placeholder .np-head'));
    log('evOptionCount', qa('#placeholder .np-opt').length);
    log('evEveryOptionHasHint', qa('#placeholder .np-opt').length === qa('#placeholder .np-opt-hint').length);

    var goldBefore = Run.state.gold;
    click(qa('#placeholder .np-opt').pop()); // 8 个事件的最后一项都是零副作用的"离开 / 不管"类
    log('evStep', NodePanel.state.step);
    log('evResultText', (q('.np-got').textContent || '').length > 0);
    log('evHasContinue', !!q('#placeholder [data-act="leave"]'));
    log('evNoSideEffect', Run.state.gold === goldBefore);

    click(q('#placeholder [data-act="leave"]'));
    log('evClosed', panel().hidden === true);
    log('evBackToMap', document.getElementById('view-map').hidden === false &&
        document.getElementById('view-combat').hidden === true);
    log('evCleared', Run.state.cleared[Run.state.currentId]);

    // ---- 有副作用的事件：值班日志·读完全部 = +80 金、最大生命 −5 ----
    var g0 = Run.state.gold;
    var m0 = Run.state.maxHp;
    NodePanel.showEvent();
    NodePanel.state.event = EVENTS.duty_log;
    NodePanel.paint();
    log('dlTitle', q('.np-title').textContent);
    // M56d：事件专属场景图 —— 横幅 src 必须按事件 id 取图，不再共用一张
    log('eventScenePerEvent', (function () {
      var img = q('#placeholder .np-scene');
      return img && img.getAttribute('src').indexOf('scene-event-duty_log.jpg') >= 0 ? 'true' : 'false';
    })());
    click(qa('#placeholder .np-opt')[0]);
    log('dlGold', Run.state.gold === g0 + 80);
    log('dlMaxHp', Run.state.maxHp === m0 - 5);
    click(q('#placeholder [data-act="leave"]'));

    // ---- 要选卡的事件：无面商贩·买卡 → 3 张稀有卡选 1 ----
    NodePanel.showEvent();
    NodePanel.state.event = EVENTS.faceless_trader;
    NodePanel.paint();
    // M56d：换事件后横幅跟着换（每事件一张）
    log('eventSceneSwaps', (function () {
      var img = q('#placeholder .np-scene');
      return img && img.getAttribute('src').indexOf('scene-event-faceless_trader.jpg') >= 0 ? 'true' : 'false';
    })());
    Run.state.gold = 99;
    var deck0 = Run.state.deck.length;
    click(qa('#placeholder .np-opt')[0]);
    log('ftSpent', Run.state.gold === 39);
    log('ftPickCount', qa('#placeholder .np-pick[data-act="pickcard"]').length);
    log('ftPickNoContinue', !q('#placeholder [data-act="leave"]'));
    click(qa('#placeholder .np-pick[data-act="pickcard"]')[1]);
    log('ftDeckGrew', Run.state.deck.length === deck0 + 1);
    log('ftPickGone', qa('#placeholder .np-pick[data-act="pickcard"]').length === 0);
    log('ftHasContinue', !!q('#placeholder [data-act="leave"]'));
    click(q('#placeholder [data-act="leave"]'));

    // ---- 要升级选卡的事件：熔渣池·把撬棍淬火 ----
    NodePanel.showEvent();
    NodePanel.state.event = EVENTS.slag_pool;
    NodePanel.paint();
    var up0 = Run.upgradableCards().length;
    click(qa('#placeholder .np-opt')[1]);
    log('spUpgradeList', qa('#placeholder .np-pick[data-act="upgradecard"]').length === up0);
    click(qa('#placeholder .np-pick[data-act="upgradecard"]')[0]);
    log('spUpgraded', Run.upgradableCards().length === up0 - 1);
    click(q('#placeholder [data-act="leave"]'));

    // ---- M31 §3.1 第②条：DL7 起事件削掉 1 条安全选项（端到端，走真实 rollEvent）----
    // 只验数据层会漏掉「渲染时 index 错位」这类问题 —— 必须从 rollEvent 一路点到面板。
    (function () {
      var realDl = Progress.dl ? Progress.dl('digger') : 1;
      if (Progress.setDl) Progress.setDl('digger', 1);
      var seenDl1 = {}, seenDl7 = {}, i, ev;
      for (i = 0; i < 200; i++) { Run.state.eventsUsed = {}; ev = Run.rollEvent(); seenDl1[ev.id] = ev; }
      if (Progress.setDl) Progress.setDl('digger', 7);
      Run.start('act1', 20260924); // M55：DL 冻结进本局，拧完旋钮重开一局
      for (i = 0; i < 200; i++) { Run.state.eventsUsed = {}; ev = Run.rollEvent(); seenDl7[ev.id] = ev; }
      var riskyIds = Object.keys(seenDl1).filter(function (id) {
        return seenDl1[id].options.some(function (o) { return o.risky; });
      });
      var allShrunk = riskyIds.length > 0 && riskyIds.every(function (id) {
        return seenDl7[id].options.length === seenDl1[id].options.length - 1;
      });
      log('m31Dl7AllRiskyShrunk', allShrunk);

      // 端到端：把 DL7 抽到的一个含代价型事件塞进面板，选项数必须与数据层一致
      var targetId = riskyIds[0];
      NodePanel.showEvent();
      NodePanel.state.event = seenDl7[targetId];
      NodePanel.paint();
      var domOpts = qa('#placeholder .np-opt').length;
      log('m31Dl7PanelOptCount', domOpts === seenDl7[targetId].options.length);
      log('m31Dl7PanelShrunk', domOpts === seenDl1[targetId].options.length - 1);
      // 面板第 0 项文案必须与数据层第 0 项一致（防 index 错位）
      var firstLabel = q('#placeholder .np-opt .np-opt-label').textContent;
      log('m31Dl7FirstOptMatches', firstLabel === seenDl7[targetId].options[0].label);
      log('m31Dl7FirstIsRisky', seenDl7[targetId].options[0].risky === true);

      // 每个按钮点下去都真的能结算（不越界、不跑空）
      var clickedAll = true;
      for (i = 0; i < domOpts; i++) {
        NodePanel.showEvent();
        NodePanel.state.event = seenDl7[targetId];
        NodePanel.paint();
        var btns = qa('#placeholder .np-opt');
        if (!btns[i]) { clickedAll = false; break; }
        Run.state.hp = 60; Run.state.gold = 99;
        btns[i].click();
        if (NodePanel.state.step !== 'choose' && !q('.np-got')) { clickedAll = false; break; }
        var lv = q('#placeholder [data-act="leave"]');
        if (lv) lv.click();
      }
      log('m31Dl7EveryOptClickable', clickedAll);
      if (Progress.setDl) Progress.setDl('digger', realDl);
      Run.start('act1', 20260924); // 恢复真实 DL 后同样重开，免得后面拿到 DL7 的局
      Run.state.eventsUsed = {};
    })();

    // ==================== 商店 ====================
    NodePanel.showShop();
    log('shopShown', panel().hidden === false);
    log('shopCardCount', qa('#placeholder .np-shopitem').length);
    log('shopHasRemove', !!q('#placeholder [data-act="removeservice"]'));
    log('shopHasLeave', !!q('#placeholder [data-act="leave"]'));
    log('shopPricesShown', qa('#placeholder .np-buy').length > 0);

    // M41 版式规格：面板不再按内容撑宽（旧版实测事件 458 / 商店 527 / 奖励 512 / 休息 393）
    log('m41PanelWide', Math.round(panel().getBoundingClientRect().width) >= 1000);
    var _scn = q('#placeholder .np-scene');
    log('m41SceneNoShrink', _scn ? getComputedStyle(_scn).flexShrink === '0' : 'no-scene');
    // M42 版式规格：面板绝对定位铺满整块地图区（旧版 max-height:80vh，地图还露着一条）
    log('m42PanelCoversMap', (function () {
      var pr = panel().getBoundingClientRect();
      var vr = q('#view-map').getBoundingClientRect();
      return pr.left <= vr.left && pr.top <= vr.top &&
             pr.right >= vr.right && pr.bottom >= vr.bottom;
    })());

    Run.state.gold = 500;
    NodePanel.paint();
    log('shopTopbarGold', document.getElementById('run-gold').textContent === '500');
    var deckN = Run.state.deck.length;
    var buyBtn = qa('#placeholder .np-buy[data-act="buycard"]:not([disabled])')[0];
    var price = Number(String(buyBtn.textContent).replace(/[^0-9]/g, ''));
    click(buyBtn);
    log('shopBought', Run.state.deck.length === deckN + 1);
    log('shopGoldSpent', Run.state.gold === 500 - price);
    log('shopSoldMark', qa('#placeholder .np-sold').length >= 1);

    // 买不起的时候按钮是禁用的
    var beforePoor = Run.state.gold;
    Run.state.gold = 0;
    NodePanel.paint();
    log('shopPoorDisabled', qa('#placeholder .np-buy:not([disabled])').length === 0);
    Run.state.gold = beforePoor;
    NodePanel.paint();

    // ---- 删牌服务 ----
    var deckM = Run.state.deck.length;
    click(q('#placeholder [data-act="removeservice"]'));
    log('removeMode', NodePanel.state.mode === 'remove');
    log('removeListSize', qa('#placeholder .np-pick[data-act="removecard"]').length === deckM);
    // M41：面板定宽 1040 后一行能排更多卡（旧版 780 上限 + 按内容撑宽，只排 4 张）
    log('m41DeckRowGrew', (function () {
      var tops = {};
      qa('#placeholder .npc').forEach(function (c) {
        var t = Math.round(c.getBoundingClientRect().top);
        tops[t] = (tops[t] || 0) + 1;
      });
      var mx = 0;
      Object.keys(tops).forEach(function (k) { if (tops[k] > mx) mx = tops[k]; });
      return mx > 4;
    })());
    click(qa('#placeholder .np-pick[data-act="removecard"]')[0]);
    log('removedOne', Run.state.deck.length === deckM - 1);
    log('removeCountUp', Run.state.removedCount === 1);
    log('removeBackToBrowse', NodePanel.state.mode === 'browse');
    log('removeUsedMark', qa('#placeholder [data-act="removeservice"]')[0].disabled === true);

    click(q('#placeholder [data-act="leave"]'));
    log('shopClosed', panel().hidden === true);

    // ==================== 休息点 ====================
    NodePanel.showRest();
    log('restOptions', qa('#placeholder .np-opt').length);
    log('restHealHint', /回复 \\d+ 点生命/.test(qa('#placeholder .np-opt-hint')[0].textContent));
    log('restUpHint', /升级 1 张卡/.test(qa('#placeholder .np-opt-hint')[1].textContent));

    var upBefore = Run.upgradableCards().length;
    click(qa('#placeholder .np-opt')[1]); // 打磨装备
    log('restUpgradeMode', NodePanel.state.mode === 'upgrade');
    log('restUpgradeList', qa('#placeholder .np-pick[data-act="upgradecard"]').length === upBefore);
    click(qa('#placeholder .np-pick[data-act="upgradecard"]')[0]);
    log('restUpgraded', Run.upgradableCards().length === upBefore - 1);
    log('restClosed', panel().hidden === true);

    // ---- 休息回血（另一条分支）----
    NodePanel.showRest();
    Run.state.hp = 30;
    NodePanel.paint();
    var expectHeal = Math.ceil(Run.state.maxHp * 0.3);
    click(qa('#placeholder .np-opt')[0]);
    log('restHealed', Run.state.hp === 30 + expectHeal);
    log('restHealClosed', panel().hidden === true);

    // ==================== 宝箱 ====================
    var relics0 = Run.state.relics.length;
    NodePanel.showChest();
    log('chestShown', panel().hidden === false);
    log('chestText', (q('.np-got').textContent || '').length > 0);
    log('chestGotRelic', Run.state.relics.length === relics0 + 1);
    click(q('#placeholder [data-act="leave"]'));
    log('chestClosed', panel().hidden === true);

    // ==================== 战斗奖励 ====================
    var battleId = null;
    Run.current().edges.forEach(function (id) {
      var t = Run.state.map.nodes[id].type;
      if ((t === 'monster' || t === 'elite') && !battleId) battleId = id;
    });
    if (!battleId) {
      Object.keys(Run.state.map.nodes).forEach(function (id) {
        var t = Run.state.map.nodes[id].type;
        if ((t === 'monster' || t === 'elite') && !battleId) battleId = id;
      });
      Run.state.currentId = battleId;
    } else {
      Run.moveTo(battleId);
    }
    App.startBattle();
    log('rwInBattle', document.getElementById('view-combat').hidden === false);

    Combat.state.enemy.hp = 0;
    Combat.state.player.hp = 66;
    Combat.state.phase = 'win';
    Render.draw();
    document.getElementById('result-next').click();
    log('rwPanelShown', panel().hidden === false);
    log('rwMapVisible', document.getElementById('view-map').hidden === false);
    log('rwCards', qa('#placeholder .np-pick[data-act="pickcard"]').length);
    log('rwGoldLine', /金/.test(q('.np-got').textContent));

    var rwDeck = Run.state.deck.length;
    click(qa('#placeholder .np-pick[data-act="pickcard"]')[0]);
    log('rwCardTaken', Run.state.deck.length === rwDeck + 1);
    log('rwClosed', panel().hidden === true);
    log('rwCleared', Run.state.cleared[Run.state.currentId]);
    // M78 起宝箱可能开出火漆印一家（winHeal 3/6/10，胜利回血）——
    // 期望值 = min(maxHp, 66 + winHeal)，别再赌宝箱摇了什么。
    var winHeal = (Run.relicEffect && Run.relicEffect('winHeal')) || 0;
    var expectHp = Math.min(Run.state.maxHp, 66 + winHeal);
    log('rwHpWritten', Run.state.hp === expectHp);
    log('rwTopbarGold', document.getElementById('run-gold').textContent === String(Run.state.gold));

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }

  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);
})();
</script>
`;

// ---- 生成探针页 ----
let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
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
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-node',
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

console.log('\n=== M4 节点面板 UI 探针结果 ===');
console.log(text);

const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

// 确定性结果用等值断言
const checks = [
  // 事件
  ['evShown', 'true', '事件面板弹出'],
  ['evTitleNotEmpty', 'true', '面板显示事件名'],
  ['evBackdrop', 'true', '面板有图标 / 标题 / 状态栏'],
  ['evStep', 'result', '点选项后进入结果态'],
  ['evResultText', 'true', '结果文本非空'],
  ['evHasContinue', 'true', '结果态有「继续下潜」'],
  ['evNoSideEffect', 'true', '选「离开」类选项不改状态'],
  ['evClosed', 'true', '点继续后面板关闭'],
  ['evBackToMap', 'true', '回到地图视图（战斗视图隐藏）'],
  ['evCleared', 'done', '事件节点结算为 done'],

  ['dlTitle', '值班日志', '能指定具体事件渲染'],
  ['eventScenePerEvent', 'true', '事件横幅用专属图（duty_log）'],
  ['eventSceneSwaps', 'true', '换事件后横幅跟着换（faceless_trader）'],
  ['dlGold', 'true', '值班日志·读完全部 +80 金币'],
  ['dlMaxHp', 'true', '值班日志·读完全部 最大生命 −5'],

  ['ftSpent', 'true', '无面商贩·买卡扣 60 金币'],
  ['ftPickCount', '3', '进入 3 选 1 稀有卡界面'],
  ['ftPickNoContinue', 'true', '选卡未完成时不显示「继续下潜」'],
  ['ftDeckGrew', 'true', '选中的卡进了卡组'],
  ['ftPickGone', 'true', '选完卡后候选列表消失'],
  ['ftHasContinue', 'true', '选完卡后才出现「继续下潜」'],

  ['spUpgradeList', 'true', '熔渣池·淬火列出可升级的卡'],
  ['spUpgraded', 'true', '淬火确实升级了 1 张卡'],

  // 商店
  ['shopShown', 'true', '商店面板弹出'],
  ['shopCardCount', '6', '商店摆 3 张卡 + 2 个遗物 + 1 瓶药水（M78 起货架常备药水）'],
  ['shopHasRemove', 'true', '商店有删牌服务'],
  ['shopHasLeave', 'true', '商店有「离开」'],
  ['shopPricesShown', 'true', '每件货品都标了价格'],
  // M41/M42 版式规格（面板不再按内容撑宽 → 绝对定位铺满地图区；横幅不被 flex 压扁）
  ['m41PanelWide', 'true', '面板宽度 ≥1000px（旧版按内容撑宽，最窄只有 393px）'],
  ['m41SceneNoShrink', 'true', '场景横幅 flex-shrink:0（旧版被压到 2px）'],
  ['m42PanelCoversMap', 'true', '面板铺满整块地图区（旧版 max-height:80vh，地图还露着一条）'],
  ['m41DeckRowGrew', 'true', '删牌列表一行排 >4 张（旧版一行只排 4 张）'],
  ['shopTopbarGold', 'true', '面板里改了金币，顶栏立即同步'],
  ['shopBought', 'true', '买卡后卡组 +1'],
  ['shopGoldSpent', 'true', '买卡扣掉了对应的金币'],
  ['shopSoldMark', 'true', '买过的货品标记为已买下'],
  ['shopPoorDisabled', 'true', '钱不够时购买按钮全部禁用'],
  ['removeMode', 'true', '点删牌服务进入选牌模式'],
  ['removeListSize', 'true', '删牌列表列出整副卡组'],
  ['removedOne', 'true', '删牌后卡组 −1'],
  ['removeCountUp', 'true', '删牌次数 +1（下次更贵）'],
  ['removeBackToBrowse', 'true', '删完回到商店浏览态'],
  ['removeUsedMark', 'true', '删过牌后服务按钮被禁用'],
  ['shopClosed', 'true', '离开商店后面板关闭'],

  // 休息点
  ['restOptions', '2', '休息点两个选项（回血 / 升级）'],
  ['restHealHint', 'true', '回血选项写明了回复量'],
  ['restUpHint', 'true', '升级选项写明了升级张数'],
  ['restUpgradeMode', 'true', '点升级进入选牌模式'],
  ['restUpgradeList', 'true', '升级列表只列可升级的卡'],
  ['restUpgraded', 'true', '升级后卡组里少一张可升级卡'],
  ['restClosed', 'true', '升级完直接结束节点'],
  ['restHealed', 'true', '休息回血 = 最大生命的 30%'],
  ['restHealClosed', 'true', '回血后节点结束'],

  // 宝箱
  ['chestShown', 'true', '宝箱面板弹出'],
  ['chestText', 'true', '宝箱写出了开出的东西'],
  ['chestGotRelic', 'true', '宝箱的遗物进了遗物列表'],
  ['chestClosed', 'true', '点继续后宝箱面板关闭'],

  // 战斗奖励
  ['rwInBattle', 'true', '地图节点能进入战斗'],
  ['rwPanelShown', 'true', '战斗胜利后弹出奖励面板'],
  ['rwMapVisible', 'true', '奖励面板盖在地图视图上'],
  ['rwCards', '3', '奖励给 3 张候选卡'],
  ['rwGoldLine', 'true', '奖励面板写明金币入袋'],
  ['rwCardTaken', 'true', '选中的奖励卡进了卡组'],
  ['rwClosed', 'true', '领完奖励面板关闭'],
  ['rwCleared', 'win', '战斗节点结算为 win'],
  ['rwHpWritten', 'true', '战后血量写回本局'],
  ['rwTopbarGold', 'true', '顶栏金币与状态同步'],

  // M31 §3.1 第②条：DL7 事件削项（端到端，走真实 rollEvent）
  ['m31Dl7AllRiskyShrunk', 'true', 'DL7 下全部含代价型的事件都削掉 1 条选项'],
  ['m31Dl7PanelOptCount', 'true', '事件面板渲染的选项数与数据层一致'],
  ['m31Dl7PanelShrunk', 'true', '事件面板比 DL1 少 1 条选项（削项真的落到界面）'],
  ['m31Dl7FirstOptMatches', 'true', '面板第 0 项文案与数据层第 0 项一致（无 index 错位）'],
  ['m31Dl7FirstIsRisky', 'true', 'DL7 面板第一个选项是代价型'],
  ['m31Dl7EveryOptClickable', 'true', '削项后每个按钮都点得动、能结算'],

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
console.log('\n' + (fail === 0 ? 'M4 节点面板 UI 链路全部通过' : 'M4 节点面板 UI 链路存在失败项') +
            '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
