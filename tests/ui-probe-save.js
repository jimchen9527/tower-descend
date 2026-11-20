// M7 UI 探针：等级进度 + 自动存档 + 「关掉浏览器再打开能续上」。
//
// 为什么不能像别的探针那样单趟跑完：M7 的存档点是「节点结束」，落盘在 localStorage，
// 而「关掉浏览器再打开」这句话只有**真的重开一次页面**才算验过 —— 在同一个页面里
// 把 Run.state 抹掉重装只是模拟，盖不住「index.html 加载时那次自动 boot」这条路。
//
// 所以这里用**同一个 --user-data-dir 连跑三趟 Edge**（目录名带时间戳，天生干净）：
//   第 1 趟 act     ：清干净 → 走节点 → 切角色分槽 → 新的一局，把事实写进 localStorage
//   第 2 趟 resume  ：什么都不做，只等页面自己 boot —— 该续上第 1 趟留下的那一局
//   第 3 趟 nostore ：页面脚本执行前就把 localStorage 弄成「一碰就抛」，验降级不崩
//
// 第 1 趟报出来的种子 / 位置 / 血量 / 深度会喂给第 2 趟当期望值（种子是 Date.now() 派生的，
// 写死不了）。三趟共用同一个探针文件名 —— file:// 下 localStorage 按源隔离，换名会换源。
//
// 运行：node tests/ui-probe-save.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-save.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 三趟共用这一个 profile —— 这就是「同一个浏览器没关过」的那份存储。
const PROFILE = path.join(os.tmpdir(), 'edge-probe-save-' + Date.now()).replace(/\\/g, '/');

// 注入到 <head>：必须在 index.html 自己的脚本之前跑，否则挂到的是别人的错误
const EARLY = `
<script>
window.onerror = function (m) { window.__err = String(m); };
// M89：「新的一局」有进行中的局时会弹确认；探针验的是点击链路，不是弹窗本身
window.confirm = function () { return true; };
</script>`;

// 第 3 趟专用：把 localStorage 换成「一碰就抛」。这是隐私模式 / 配额满的等价物，
// 也是 App._storage() 里那个 try/catch 存在的理由。
const POISON = `
<script>
(function () {
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: function () { throw new Error('storage disabled by probe'); }
    });
  } catch (e) { window.__poisonErr = e.message; }
})();
</script>`;

const HELPERS = `
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  // 当前节点的出边里第一条指定类型的边
  function edgeOf(types) {
    var e = Run.current().edges;
    for (var i = 0; i < e.length; i++) {
      if (types.indexOf(Run.state.map.nodes[e[i]].type) >= 0) return e[i];
    }
    return null;
  }
  // 秒杀当前战斗 → 领完奖励 → 回地图。手法与 ui-probe-map.js 一致：
  // 回地图的那一下才触发 saveRun()，也就是 M7 的存档点。
  function winAndReturn(hpAfter) {
    Combat.state.player.hp = hpAfter;
    Combat.state.enemy.hp = 0;
    Combat.state.phase = 'win';
    Render.draw();
    document.getElementById('result-next').click();
    var go = q('#placeholder [data-act="leave"]');
    if (go) go.click();
  }
  function pickChar(cid) {
    var sel = q('#char-select');
    sel.value = cid;
    sel.dispatchEvent(new Event('change'));
  }
  function dump() {
    var pre = document.createElement('pre');
    pre.id = 'probe-out';
    pre.textContent = out.join('\\n');
    document.body.appendChild(pre);
  }
`;

// ==================== 第 1 趟：走流程 + 落盘 ====================
const ACT_SCRIPT = `
<script>
(function () {
${HELPERS}
  try {
    // 从干净状态开始：localStorage 是跨进程留着的，不清就是上一轮探针的档
    Progress.reset();
    App.boot();

    var raw0 = window.localStorage.getItem('tower-descend/save');
    var boot0 = raw0 ? JSON.parse(raw0) : null;
    log('lsHasKeyAfterBoot', raw0 !== null);
    // 三个槽都会在（bestDl / isUnlocked 要遍历三角色，顺手把未玩过的建成 dl:1 的占位），
    // 所以这里验的是语义：只有当前角色有「进行中的局」。
    log('saveSlotsWithRun', boot0 ? Object.keys(boot0.chars).filter(function (id) {
      return !!boot0.chars[id].run;
    }).join(',') : 'NONE');
    log('saveSlotCount', boot0 ? Object.keys(boot0.chars).length : 0);
    log('dlAtStart', Progress.dl('digger'));
    log('runDlAtStart', q('#run-dl').textContent);
    log('medicLockedAtStart', qa('#char-select option')[1].disabled);
    log('entryIsCurrent', Run.state.currentId === Run.state.map.entryId);

    // ---- 走一个战斗节点 → 回地图：存档必须跟着节点走 ----
    var battleId = edgeOf(['monster', 'elite']);
    log('foundBattleEdge', battleId !== null);
    App.enterNode(battleId);
    winAndReturn(58);

    var s1 = Progress.loadRun('digger');
    log('saveCurrentFollowedNode', s1.currentId === battleId);
    log('saveHpUpdated', s1.hp);
    log('saveBattles', s1.battles);
    log('saveClearedCount', Object.keys(s1.cleared).length);
    log('saveNodeDepth', s1.map.nodes[s1.currentId].depth);

    // ---- 把掘者推到 DL2（医师的解锁条件），顶栏刻痕要跟着变 ----
    Progress.setDl('digger', 2);
    App.boot();
    log('runDlAfterDl2', q('#run-dl').textContent);
    log('resumeInPageSameNode', Run.state.currentId === battleId);
    log('medicUnlockedNow', !qa('#char-select option')[1].disabled);
    log('diggerSaveIntact', Progress.loadRun('digger').currentId === battleId);
    log('difficultyAtDl2', Progress.difficulty('digger'));

    // ---- 切到医师：每个角色各存一局 ----
    pickChar('medic');
    log('charAfterSwitchMedic', Run.state.charId);
    log('medicFreshAtEntry', Run.state.currentId === Run.state.map.entryId);
    log('medicDepthIs1', Run.current().depth);
    log('diggerSaveStillThere', Progress.loadRun('digger').currentId === battleId);
    log('medicHasOwnSave', Progress.loadRun('medic') !== null);
    log('twoSeedsDiffer', Progress.loadRun('medic').seed !== Progress.loadRun('digger').seed);

    var medicBattle = edgeOf(['monster', 'elite']);
    App.enterNode(medicBattle);
    winAndReturn(70);
    log('medicSaveAdvanced', Progress.loadRun('medic').currentId === medicBattle);
    log('diggerNotTouched', Progress.loadRun('digger').currentId === battleId);

    // ---- 切回掘者：续上的必须是掘者自己那一局，不是医师的 ----
    pickChar('digger');
    log('backToDigger', Run.state.charId);
    log('diggerResumedOwnRun', Run.state.currentId === battleId);
    log('diggerHpResumed', Run.state.hp);
    log('resumeHintShown', q('#placeholder').hidden === false &&
        (q('#placeholder').textContent || '').indexOf('已续上') >= 0);

    // ---- 「新的一局」：清掉续档，从入口重开 ----
    document.getElementById('new-run').click();
    var s2 = Progress.loadRun('digger');
    log('newRunAtEntry', Run.state.currentId === Run.state.map.entryId);
    log('newRunBattlesReset', s2.battles);
    log('newRunClearedReset', Object.keys(s2.cleared).length);
    log('medicSaveUntouched', Progress.loadRun('medic').currentId === medicBattle);

    // ---- 留一个「非入口」的档给第 2 趟续 ----
    var battle2 = edgeOf(['monster', 'elite']);
    App.enterNode(battle2);
    winAndReturn(63);
    var saved = Progress.loadRun('digger');
    log('pass2Seed', saved.seed);
    log('pass2CurrentId', saved.currentId);
    log('pass2Depth', saved.map.nodes[saved.currentId].depth);
    log('pass2Hp', saved.hp);
    log('pass2Dl', Progress.dl('digger'));
    log('pass2RawHasKey', window.localStorage.getItem('tower-descend/save') !== null);

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }
  dump();
})();
</script>`;

// ==================== 第 2 趟：只等页面自己续档 ====================
const RESUME_SCRIPT = `
<script>
(function () {
${HELPERS}
  try {
    // 页面加载 → 主菜单（M55）：不再自动开局，「继续游戏」显式续档。
    // 第 1 趟给掘者、医师各留了一局，所以继续按钮亮着，点了要列两个档让人挑。
    log('menuShownOnLoad', q('#view-menu').hidden === false);
    log('menuContinueEnabled', q('#menu-continue').disabled === false);
    q('#menu-continue').click();
    var items = qa('#menu-continue-list [data-mc]');
    log('continueListCount', items.length);
    var diggerBtn = items.filter(function (b) { return b.getAttribute('data-mc') === 'digger'; })[0];
    if (diggerBtn) diggerBtn.click();
    log('hasRun', !!Run.state);
    log('resumedSeed', Run.state ? Run.state.seed : 'NORUN');
    log('resumedCurrentId', Run.state ? Run.state.currentId : 'NORUN');
    log('resumedDepth', Run.state && Run.current() ? Run.current().depth : 'NORUN');
    log('resumedHp', Run.state ? Run.state.hp : 'NORUN');
    log('resumedCharId', Run.state ? Run.state.charId : 'NORUN');
    log('resumeHintShown', q('#placeholder').hidden === false &&
        (q('#placeholder').textContent || '').indexOf('已续上') >= 0);
    log('topbarDl', q('#run-dl').textContent);
    log('topbarHp', q('#run-hp').textContent);
    log('mapViewVisible', q('#view-map').hidden === false);
    log('lsKeyStillThere', window.localStorage.getItem('tower-descend/save') !== null);

    // 放弃续档 → 回到入口重开
    document.getElementById('ph-newrun').click();
    log('afterDiscardAtEntry', Run.state.currentId === Run.state.map.entryId);
    log('afterDiscardHp', Run.state.hp);
    log('afterDiscardBattles', Run.state.battles);

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }
  dump();
})();
</script>`;

// ==================== 第 3 趟：存储不可用 ====================
const NOSTORE_SCRIPT = `
<script>
(function () {
${HELPERS}
  try {
    log('poisonApplied', window.__poisonErr === undefined);
    log('appStorageNull', App._storage() === null);
    log('progressMemoryMode', Progress._store === null);
    // M55：首屏落在主菜单上；没有存档 → 继续按钮禁用；
    // 「开始游戏」进选择页 → 默认预选掘者（DL1 只能选 DL1）→ 开始下潜开局。
    log('menuShownOnLoad', q('#view-menu').hidden === false);
    log('menuContinueDisabled', q('#menu-continue').disabled === true);
    q('#menu-start').click();
    log('selectPageShown', q('#menu-select').hidden === false);
    log('menuCardsRendered', qa('#menu-chars .mchar').length);
    log('medicCardLocked', (function () {
      var el = qa('#menu-chars .mchar').filter(function (c) {
        return c.getAttribute('data-mchar') === 'medic';
      })[0];
      return !!(el && el.classList.contains('is-locked'));
    })());
    log('onlyDl1Enabled', qa('#menu-dls .mdl-btn:not([disabled])').length);
    q('#menu-go').click();
    log('runStillStarted', !!Run.state);
    log('charDefault', Run.state ? Run.state.charId : 'NORUN');
    log('mapViewVisible', q('#view-map').hidden === false);
    log('topbarDl', q('#run-dl').textContent);
    log('dlReadable', Progress.dl('digger'));

    Progress.setDl('digger', 3);
    log('dlAdvanceInMemory', Progress.dl('digger'));
    log('saveRunReturnsFalse', App.saveRun() === false);

    var b = edgeOf(['monster', 'elite']);
    App.enterNode(b);
    log('canStillPlay', q('#view-combat').hidden === false);

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }
  dump();
})();
</script>`;

// ==================== 第 4 趟：一局收尾 ====================
const FINISH_SCRIPT = `
<script>
(function () {
${HELPERS}
  try {
    Progress.reset();
    App.boot();
    log('dlBeforeFinish', Progress.dl('digger'));
    log('topbarDlBeforeFinish', q('#run-dl').textContent);

    // 走一个节点，再把这一局推到收尾态 —— Act1 有 33 层，headless 里没法真打完
    var b = edgeOf(['monster', 'elite']);
    App.enterNode(b);
    winAndReturn(58);
    Run.state.finished = true;
    App.showMap();

    var panel = q('#placeholder');
    log('finishPanelShown', panel.hidden === false &&
        (panel.textContent || '').indexOf('刻痕 +1') >= 0);
    log('dlAfterFinish', Progress.dl('digger'));
    log('topbarDlAfterFinish', q('#run-dl').textContent);
    log('charOptionAfterFinish', qa('#char-select option')[0].textContent);
    log('topbarMatchesPanel', q('#run-dl').textContent === 'DL' + Progress.dl('digger'));
    log('runClearedAfterFinish', Progress.loadRun('digger') === null);

    // 收尾面板会被反复 showMap，刻痕不能一级一级往上涨
    App.showMap();
    App.showMap();
    log('dlStableAfterRepeatShowMap', Progress.dl('digger'));

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }
  dump();
})();
</script>`;

// ==================== 跑一趟 Edge ====================
function run(pass, script, headExtra) {
  let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
  if (html.indexOf('<head>') < 0) throw new Error('index.html 里找不到 <head>');
  if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
  html = html.replace('<head>', '<head>' + EARLY + (headExtra || ''));
  html = html.replace('</body>', script + '\n</body>');
  fs.writeFileSync(PROBE_FILE, html);

  let dom;
  try {
    dom = execFileSync(
      EDGE,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--user-data-dir=' + PROFILE,
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

  const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('\n[' + pass + '] 未找到探针输出 —— 说明页面脚本在探针执行前就挂了。');
    console.log('DOM 长度：' + dom.length);
    process.exit(1);
  }
  const text = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  const got = {};
  text.split('\n').forEach(function (line) {
    const i = line.indexOf(' = ');
    if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
  });

  console.log('\n=== 第 ' + pass + ' 趟结果 ===');
  console.log(text);
  return got;
}

// ==================== 断言 ====================
let fail = 0;
let total = 0;

function check(got, want, why) {
  total++;
  const ok = got === want;
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + why +
    (ok ? '' : '（期望 ' + want + '，实际 ' + got + '）'));
}

try {
  // ---------- 第 1 趟 ----------
  const act = run('1 · act', ACT_SCRIPT);

  console.log('\n=== 断言 · 第 1 趟（走流程 + 落盘）===');
  const ACT = [
    ['lsHasKeyAfterBoot', 'true', '开局就有档（回到地图 = 存档点）'],
    ['saveSlotsWithRun', 'digger', '只有一个槽有「进行中的局」，其余是空占位'],
    ['saveSlotCount', '3', '三个角色各占一槽（等级各存各的）'],
    ['dlAtStart', '1', '全新玩家从 DL1 起'],
    ['runDlAtStart', 'DL1', '顶栏刻痕显示 DL1'],
    ['medicLockedAtStart', 'true', 'DL1 时医师在下拉里禁用（§3.1 解锁链）'],
    ['entryIsCurrent', 'true', '开局停在入口节点'],

    ['foundBattleEdge', 'true', '入口出边里能找到战斗节点'],
    ['saveCurrentFollowedNode', 'true', '存档跟着节点走（currentId 已更新）'],
    ['saveHpUpdated', '58', '存档里的血量 = 战后血量'],
    ['saveBattles', '1', '存档里的战斗场次 +1'],
    ['saveClearedCount', '2', '存档里 cleared = 入口 + 刚打过的节点'],
    ['saveNodeDepth', '2', '存的是「节点结束」那一刻的位置（D2）'],

    ['runDlAfterDl2', 'DL1', '进行中的局顶栏显示本局冻结的 DL（M55：DL 只在开局定，中途升刻痕不影响这一局）'],
    ['resumeInPageSameNode', 'true', '同页面内重新 boot 也会续上（currentId 不丢）'],
    ['medicUnlockedNow', 'true', '掘者到 DL2 后医师解锁（看的是「任一角色」）'],
    ['diggerSaveIntact', 'true', 'boot 不会把正在读的那一槽写坏'],
    ['difficultyAtDl2', '1.15', 'DL2 的难度系数 = 1.15'],

    ['charAfterSwitchMedic', 'medic', '切到医师后本局角色跟着换'],
    ['medicFreshAtEntry', 'true', '医师没打过 → 从入口新开一局'],
    ['medicDepthIs1', '1', '新局在 D1'],
    ['diggerSaveStillThere', 'true', '切角色不覆盖掘者的档'],
    ['medicHasOwnSave', 'true', '医师写了自己那一槽'],
    ['twoSeedsDiffer', 'true', '两个角色各是一局（种子不同）'],

    ['medicSaveAdvanced', 'true', '医师的档随它自己走的节点推进'],
    ['diggerNotTouched', 'true', '医师走节点不会动掘者的档'],

    ['backToDigger', 'digger', '切回掘者'],
    ['diggerResumedOwnRun', 'true', '续上的是掘者自己那一局，不是医师的'],
    ['diggerHpResumed', '58', '续档把血量也带回来了'],
    ['resumeHintShown', 'true', '续档后原地提示一句（否则会以为该从 D1 开始）'],

    ['newRunAtEntry', 'true', '「新的一局」从入口重开'],
    ['newRunBattlesReset', '0', '新局的战斗场次归零'],
    ['newRunClearedReset', '1', '新局 cleared 只剩入口 —— 旧进度真的被清掉了'],
    ['medicSaveUntouched', 'true', '重开掘者的一局不影响医师的档'],

    ['pass2Depth', '2', '留给第 2 趟的档在 D2'],
    ['pass2Hp', '63', '留给第 2 趟的血量 63'],
    ['pass2Dl', '2', '留给第 2 趟的等级 DL2'],
    ['pass2RawHasKey', 'true', '落盘的 JSON 里确实有存档键'],
    ['jsError', 'none', '第 1 趟页面无 JS 运行时错误'],
  ];
  ACT.forEach(function (c) { check(act[c[0]], c[1], c[2]); });

  // ---------- 第 2 趟（真·重新打开）----------
  const res = run('2 · resume', RESUME_SCRIPT);

  console.log('\n=== 断言 · 第 2 趟（关掉重开 → 主菜单 → 继续游戏）===');
  check(res.menuShownOnLoad, 'true', '首屏落在主菜单上（不再自动开局）');
  check(res.menuContinueEnabled, 'true', '有存档 → 继续按钮亮着');
  check(res.continueListCount, '2', '两个角色都有档 → 列出来让人挑');
  check(res.hasRun, 'true', '点掘者的档 → 有局了');
  check(res.resumedSeed, act.pass2Seed, '续上的是同一局（种子一致）');
  check(res.resumedCurrentId, act.pass2CurrentId, '位置也续上了（不是回到入口）');
  check(res.resumedDepth, act.pass2Depth, '深度一致');
  check(res.resumedHp, act.pass2Hp, '血量一致');
  check(res.resumedCharId, 'digger', '续上的是掘者那一槽');
  check(res.resumeHintShown, 'true', '「已续上……」的提示在场');
  check(res.topbarDl, 'DL2', '顶栏刻痕 = 本局冻结的 DL（那一局是「新的一局」在 DL2 时开的）');
  check(res.topbarHp, act.pass2Hp, '顶栏血量与存档一致');
  check(res.mapViewVisible, 'true', '落地在地图视图上');
  check(res.lsKeyStillThere, 'true', '存档还在');

  check(res.afterDiscardAtEntry, 'true', '「放弃，重开一局」回到入口');
  check(res.afterDiscardHp, '75', '重开后血量满（75）');
  check(res.afterDiscardBattles, '0', '重开后战斗场次归零');
  check(res.jsError, 'none', '第 2 趟页面无 JS 运行时错误');

  // ---------- 第 3 趟（存储不可用）----------
  const no = run('3 · nostore', NOSTORE_SCRIPT, POISON);

  console.log('\n=== 断言 · 第 3 趟（隐私模式 / 配额满的等价物）===');
  const NO = [
    ['poisonApplied', 'true', '成功把 localStorage 弄成「一碰就抛」'],
    ['appStorageNull', 'true', '拿不到存储时退回 null（异常不上抛）'],
    ['progressMemoryMode', 'true', 'Progress 退到纯内存模式'],
    ['menuShownOnLoad', 'true', '主菜单照常渲染'],
    ['menuContinueDisabled', 'true', '没有存档 → 继续按钮禁用'],
    ['selectPageShown', 'true', '「开始游戏」进角色选择页'],
    ['menuCardsRendered', '3', '三张角色卡都渲染了'],
    ['medicCardLocked', 'true', 'DL1 时医师卡带锁标不可选'],
    ['onlyDl1Enabled', '1', 'DL1 只有 DL1 这一档可选'],
    ['runStillStarted', 'true', '点「开始下潜」后本局照常开起来'],
    ['charDefault', 'digger', '照常用默认角色'],
    ['mapViewVisible', 'true', '照常落在地图上'],
    ['topbarDl', 'DL1', '顶栏刻痕照常渲染'],
    ['dlReadable', '1', '读等级不炸（新玩家 DL1）'],
    ['dlAdvanceInMemory', '3', '存储不可用时等级仍能在内存里推进'],
    ['saveRunReturnsFalse', 'true', '存不进盘时返回 false，而不是抛异常'],
    ['canStillPlay', 'true', '还能点进战斗节点继续玩'],
    ['jsError', 'none', '存储不可用也没有 JS 运行时错误'],
  ];
  NO.forEach(function (c) { check(no[c[0]], c[1], c[2]); });

  // ---------- 第 4 趟（一局收尾：刻痕结算 / 清档 / 顶栏同步）----------
  const fin = run('4 · finish', FINISH_SCRIPT);

  console.log('\n=== 断言 · 第 4 趟（一局收尾）===');
  const FIN = [
    ['dlBeforeFinish', '1', '收尾前是 DL1'],
    ['topbarDlBeforeFinish', 'DL1', '顶栏此刻也是 DL1'],
    ['finishPanelShown', 'true', '收尾面板出现并写明「刻痕 +1」'],
    ['dlAfterFinish', '2', '通关给该角色 +1 道刻痕（DL1 → DL2）'],
    ['topbarDlAfterFinish', 'DL2', '顶栏刻痕跟着结算刷新（不能停在旧等级）'],
    ['charOptionAfterFinish', '掘者（DL2）', '角色下拉里的等级标签也跟着刷新'],
    ['topbarMatchesPanel', 'true', '顶栏与收尾面板说的是同一个等级'],
    ['runClearedAfterFinish', 'true', '收尾清掉「进行中的那一局」（下次进来是新局）'],
    ['dlStableAfterRepeatShowMap', '2', '反复 showMap 不会重复升 DL（settleRunEnd 幂等）'],
    ['jsError', 'none', '第 4 趟页面无 JS 运行时错误'],
  ];
  FIN.forEach(function (c) { check(fin[c[0]], c[1], c[2]); });
} finally {
  // 本次跑出来的临时 profile，用完就删 —— 只删我们自己刚建的这个目录
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* Edge 还占着就留着 */ }
}

console.log('\n' + (fail === 0
  ? 'M7 存档链路全部通过'
  : 'M7 存档链路存在失败项') + '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
