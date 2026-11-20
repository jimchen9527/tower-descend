// M3 地图 UI 探针：验证「地图渲染 → 点击节点 → 视图切换 → 战斗结算 → 回到地图」
// 这条链路。逻辑层测试（m3-map.test.js）跑不到事件绑定与重绘。
//
// 手法与 ui-probe.js 一致：复制 index.html、注入操作脚本、Edge headless 跑、读回 DOM。
// 用固定种子起局，保证探针本身可复现。
//
// 运行：node tests/ui-probe-map.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-map.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }

  // 秒杀当前战斗 → 点「返回地图」→ 领走战斗奖励 → 回到地图。
  // M4 起「返回地图」后面还挂着一层战斗奖励面板，不能直接到地图。
  function winBattleAndReturn(playerHpAfter) {
    Combat.state.player.hp = playerHpAfter;
    Combat.state.enemy.hp = 0;
    Combat.state.phase = 'win';
    Render.draw();
    document.getElementById('result-next').click();

    var go = document.querySelector('#placeholder [data-act="leave"]');
    if (go) go.click();
  }

  try {
    // ---- 起局（固定种子，探针可复现）----
    // M7：index.html 加载时已经 boot 过一次，而存档 / 等级是跨页面加载留着的，
    // 探针复用的又是同一个 --user-data-dir —— 不先清干净，上一轮的状态会渗进来。
    Progress.reset();
    App.boot();
    Run.start('act1', 20260923);
    App.showMap();

    var map = Run.state.map;
    log('actName', document.getElementById('act-name').textContent);
    log('lanes', document.getElementById('run-lanes').textContent);
    log('pathsText', document.getElementById('run-paths').textContent);
    log('topSeed', document.getElementById('seed-val').textContent === String(map.seed));
    log('mapViewVisible', document.getElementById('view-map').hidden === false);
    log('combatViewHidden', document.getElementById('view-combat').hidden === true);

    // ---- 渲染：节点数量 / 连线数量 ----
    log('nodeCount', document.querySelectorAll('#map-nodes .mnode').length);
    log('expectedNodes', Object.keys(map.nodes).length);
    log('edgeCount', document.querySelectorAll('#map-svg path.edge').length);

    // ---- §5.1 硬指标的 UI 侧验收：4 条主干的地图必须一屏放得下 ----
    // 逻辑层只能证明"生成了 4 条主干"，证明不了"画得下" —— 后者取决于
    // CELL_W / #app 宽度 / 视口三者的配合，只有真浏览器里量得出来。
    var scroller = document.querySelector('.mapscroll');
    log('mapW', document.getElementById('map-nodes').offsetWidth);
    log('viewW', scroller.clientWidth);
    log('noHScroll', scroller.scrollWidth <= scroller.clientWidth + 1);

    // ---- 初始状态：入口是当前节点，D2 有可走节点 ----
    log('curNodeIsEntry', document.querySelectorAll('#map-nodes .is-cur').length === 1 &&
        document.querySelector('#map-nodes .is-cur').dataset.id === map.entryId);
    log('openCount', document.querySelectorAll('#map-nodes .is-open').length);
    log('lockedCount', document.querySelectorAll('#map-nodes .is-locked').length);
    log('topDepth', document.getElementById('loc-depth').textContent);

    // ---- 点一个远处节点（D3）应该无效：不是当前节点的出边 ----
    var farId = map.layers[2][0].id;
    var farEl = document.querySelector('.mnode[data-id="' + farId + '"]');
    farEl.click();
    log('curAfterFarClick', Run.state.currentId === map.entryId);

    // ---- 点相邻下层的小怪节点 → 进入战斗 ----
    var edges = Run.current().edges;
    var battleId = null;
    for (var i = 0; i < edges.length; i++) {
      var t = map.nodes[edges[i]].type;
      if (t === 'monster' || t === 'elite') { battleId = edges[i]; break; }
    }
    document.querySelector('.mnode[data-id="' + battleId + '"]').click();
    log('inBattle', document.getElementById('view-combat').hidden === false);
    log('mapHiddenInBattle', document.getElementById('view-map').hidden === true);
    log('battleDepth', Combat.state.depth);
    log('battleHp', Combat.state.player.hp);
    // M25：地点标签搬进了舞台 HUD（同 ui-probe-boss 的 locTagHasBoss）
    log('locTag', (document.querySelector('#stage-hud .unit-role') || {}).textContent || 'MISSING');
    log('turnBoxShown', document.getElementById('turn-box').hidden === false);

    // ---- 战斗胜利 → 返回地图，血量写回本局进度 ----
    var nodeAfterBattle = map.nodes[Run.state.currentId];
    winBattleAndReturn(61);
    log('backToMap', document.getElementById('view-map').hidden === false);
    log('clearedNode', Run.state.cleared[nodeAfterBattle.id]);
    log('battles', Run.state.battles);
    log('runHp', Run.state.hp);
    log('curMoved', document.querySelector('#map-nodes .is-cur').dataset.id === nodeAfterBattle.id);
    log('hpInTopbar', document.getElementById('run-hp').textContent);

    // ---- 继续往下走，直到踩到一个非战斗节点 ----
    // M4 起四类节点各有自己的面板。这里只验证"点进去会弹面板、面板对应这个节点"，
    // 面板内部的交互（选选项 / 买东西 / 选牌）交给 ui-probe-node.js，
    // 免得两个探针重复覆盖同一段逻辑。
    //
    // ⚠️ 不要假设 map.routes[0] 那条主干经过当前节点。上面打的是「入口出边里第一个
    //    战斗节点」，它未必是该层第 0 个。地图规格一变（主干数 / 层数）同一种子的类型
    //    序列就全变，这个假设随时会崩 —— 崩了还不报错，只是 phId 变成 null、后面一整片
    //    断言跟着挂。正确做法：从当前位置做 BFS，找「真的走得到」的最近非战斗节点。
    var PANEL_TYPES = ['event', 'shop', 'rest', 'chest'];

    function pathToPanel() {
      var start = Run.state.currentId;
      var queue = [start];
      var prev = {};
      var seen = {};
      seen[start] = true;
      while (queue.length) {
        var id = queue.shift();
        if (id !== start && PANEL_TYPES.indexOf(map.nodes[id].type) >= 0) {
          var path = [];
          for (var c = id; c !== start; c = prev[c]) path.unshift(c);
          return path;
        }
        map.nodes[id].edges.forEach(function (e) {
          // Boss 层不走 —— 点它会弹「Boss 战预告」，不是普通节点面板
          if (seen[e] || map.nodes[e].type === 'boss') return;
          seen[e] = true;
          prev[e] = id;
          queue.push(e);
        });
      }
      return null;
    }

    var phPath = pathToPanel();
    var phType = 'none';
    var phId = null;
    if (phPath) {
      for (var s = 0; s < phPath.length; s++) {
        var step = map.nodes[phPath[s]];
        document.querySelector('.mnode[data-id="' + phPath[s] + '"]').click();
        if (PANEL_TYPES.indexOf(step.type) >= 0) { phType = step.type; phId = step.id; break; }
        winBattleAndReturn(Run.state.hp); // 血量保持不变，继续往下找
      }
    }
    log('phType', phType);
    log('phDepth', phId ? map.nodes[phId].depth : -1);
    log('phShown', document.getElementById('placeholder').hidden === false);
    log('phIsCurrent', Run.state.currentId === phId);
    log('phHasActs', document.querySelectorAll('#placeholder [data-act]').length > 0);
    log('phStatusBar', !!document.querySelector('#placeholder .np-status'));

    // 面板内部另测 —— 这里直接按"处理完"收掉，继续验证地图侧的状态
    NodePanel.finish('done');
    log('phHidden', document.getElementById('placeholder').hidden === true);
    log('phCleared', Run.state.cleared[phId]);
    log('canMoveAfterPh', !!phId && Run.canMoveTo(map.nodes[phId].edges[0]) === true);
    log('stillOnNode', Run.state.currentId === phId);
    // 离开之后回头再看：打过的那个节点才是 is-done（当前节点显示为 is-cur 才对）
    log('nodeDoneClass', document.querySelector('.mnode[data-id="' + nodeAfterBattle.id + '"]')
        .classList.contains('is-done'));

    // ---- 最坏情况复核：换一张图、换一个种子，宽度上界照样成立 ----
    // 横向数量已固定，宽度只随「最大列号」抖动（8 或 9 列 → 696 / 772px）。
    // 换种子的意义从「抽到最宽的主干数」变成「确认宽度压根与种子无关」。
    Run.start('act1', 100000);
    App.showMap();
    var wide = document.querySelector('.mapscroll');
    log('wideLanes', Run.state.map.lanes);
    log('wideMapW', document.getElementById('map-nodes').offsetWidth);
    log('wideNoHScroll', wide.scrollWidth <= wide.clientWidth + 1);

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
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-map',
      '--virtual-time-budget=5000',
      // §5.1 的地图宽 772px、#app 1100px —— 1600 宽的窗口足以让 max-width 真正生效
      // （窄于 #app + 页边距就会退化成横滚，断言也就没意义了）。
      '--window-size=1600,1000',
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

console.log('\n=== M3 地图 UI 探针结果 ===');
console.log(text);

// ---- 断言 ----
const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

// 确定性结果用等值断言
const checks = [
  ['actName', '废墟层', '顶栏显示大关名'],
  ['topSeed', 'true', '顶栏种子与地图种子一致'],
  ['mapViewVisible', 'true', '开局落在地图视图'],
  ['combatViewHidden', 'true', '开局战斗视图隐藏'],
  ['curNodeIsEntry', 'true', '入口节点是当前所处位置（唯一 is-cur）'],
  ['topDepth', 'D1', '顶栏深度为 D1'],
  ['curAfterFarClick', 'true', '点非相邻层节点无效（不能跳层）'],

  ['inBattle', 'true', '点小怪节点 → 切到战斗视图'],
  ['mapHiddenInBattle', 'true', '战斗中地图视图隐藏'],
  ['battleDepth', '2', '战斗深度 = 节点所在层 D2'],
  ['battleHp', '75', '战斗血量继承自本局进度（75）'],
  ['turnBoxShown', 'true', '战斗中显示回合数'],

  ['backToMap', 'true', '战斗胜利后回到地图'],
  ['clearedNode', 'win', '该节点标记为已通过'],
  ['battles', '1', '本局战斗场次 +1'],
  ['runHp', '61', '战后血量写回本局进度（61）'],
  ['nodeDoneClass', 'true', '已通过的节点带 is-done 样式'],
  ['hpInTopbar', '61', '顶栏血量同步'],

  ['phShown', 'true', '非战斗节点弹出节点面板'],
  ['phIsCurrent', 'true', '面板对应刚走到的节点'],
  ['phHasActs', 'true', '面板里有可点击的操作（data-act）'],
  ['phStatusBar', 'true', '面板顶部显示 HP / 金币 / 卡组'],
  ['phHidden', 'true', '处理完节点后面板关闭'],
  ['phCleared', 'done', '该节点按「已处理」记录'],
  ['canMoveAfterPh', 'true', '处理完可以继续往下走'],
  ['stillOnNode', 'true', '结算节点不会替玩家选路'],

  ['jsError', 'none', '页面无 JS 运行时错误'],
];

// 随机结果用范围 / 一致性断言（每一局的地图都不一样，不能写死等值）
const rangeChecks = [
  [Number(got.lanes) === 4, '主干路线数恒为 4（' + got.lanes + '）'],
  [got.noHScroll === 'true',
   '地图一屏放得下（地图 ' + got.mapW + 'px ≤ 可视区 ' + got.viewW + 'px，无需横向滚动）'],
  [Number(got.mapW) <= 772 && Number(got.wideMapW) <= 772,
   '地图宽度不超 §5.5 预算 772px（实测 ' + got.mapW + ' / ' + got.wideMapW + 'px）'],
  [Number(got.wideLanes) === Number(got.lanes),
   '换种子后主干数不变（' + got.wideLanes + '）—— 横向数量与种子无关'],
  [got.wideNoHScroll === 'true',
   '换种子后也一屏放得下（地图 ' + got.wideMapW + 'px ≤ 可视区 ' + got.viewW + 'px）'],
  [Number(got.pathsText) >= Number(got.lanes), '走法数 ' + got.pathsText + ' ≥ 主干数 ' + got.lanes],
  [Number(got.nodeCount) > 0 && got.nodeCount === got.expectedNodes,
   '节点渲染数 ' + got.nodeCount + ' 与地图数据一致'],
  [Number(got.edgeCount) > 0, '连线已绘制（' + got.edgeCount + ' 条）'],
  [Number(got.openCount) === 4, '开局可走节点 ' + got.openCount + ' 个（入口连出全部 4 条主干）'],
  [Number(got.lockedCount) > 0, '远处节点标记为不可达（' + got.lockedCount + ' 个）'],
  [Number(got.phDepth) > 1, '非战斗节点位于 D' + got.phDepth],
  ['event shop rest chest'.indexOf(got.phType) >= 0,
   '非战斗节点类型是 ' + got.phType],
  [/D2/.test(got.locTag || ''), '战斗中位置标签含 D2（' + got.locTag + '）'],
];

let fail = 0;
console.log('\n=== 断言 ===');

rangeChecks.forEach(function (c) {
  if (!c[0]) fail++;
  console.log('  ' + (c[0] ? '[ok]  ' : '[FAIL]') + ' ' + c[1]);
});

checks.forEach(function (c) {
  const ok = got[c[0]] === c[1];
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] +
              '（期望 ' + c[1] + '，实际 ' + got[c[0]] + '）');
});

const total = checks.length + rangeChecks.length;
console.log('\n' + (fail === 0 ? 'M3 地图 UI 链路全部通过' : 'M3 地图 UI 链路存在失败项') +
            '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
