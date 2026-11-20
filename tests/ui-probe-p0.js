// P0 专项探针：调试栏隐藏（P0-2）/ 顶栏遗物托盘（P0-3）/ 震屏 + 顿帧（P0-4）。
//
// 两趟 Edge 共用同一份注入脚本，按 location.search 分支：
//   第 1 趟（无参数）  ：poolbar 应默认隐藏 + 遗物托盘渲染/清空 + impactStage 类挂摘
//   第 2 趟（?dev=1）  ：poolbar 应显示
//
// 断言全是「类/属性」级 —— 按 M47 教训，headless 里不断言动画真的在动，
// 只断言机制挂对了类、超时摘得掉；真实观感由用户在真实浏览器里确认。
//
// 运行：node tests/ui-probe-p0.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-p0.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function write() {
    out.push('jsError = ' + (window.__err || 'none'));
    var pre = document.createElement('pre');
    pre.id = 'probe-out';
    pre.textContent = out.join('\\n');
    document.body.appendChild(pre);
  }

  var dev = /[?&]dev=1/.test(location.search);

  // ---- P0-2：poolbar 显隐（两个分支都测，页面加载即由 App.bindOnce 决定）----
  log('poolbarHidden', String(q('.poolbar').hidden));
  // M89：重打本节点是调试工具，默认藏；?dev=1 才露
  log('restartHidden', String(q('#restart').hidden));
  log('devMode', String(dev));
  if (dev) { write(); return; }

  try {
    // 探针复用同一 --user-data-dir 会渗状态，先清干净再开一局
    Progress.reset();
    App.boot();

    // ---- M60 P2-4：每日挑战菜单接线 ----
    var dailyBtn = q('#menu-daily');
    log('dailyBtnExists', String(!!dailyBtn));
    App.renderMenuMain();
    var dailyDesc = q('#menu-daily-desc').textContent;
    log('dailyDescHasToday', String(dailyDesc.indexOf('今日') === 0 && dailyDesc.length > 4));
    log('dailyDlFixed3', String(dailyFor(App.todayKey()).dl === 3));

    // ---- P0-3：遗物托盘 ----
    log('trayHiddenWhenEmpty', String(q('#relic-tray-box').hidden));
    Run.state.relics = ['alloy_compass', 'moss_charm', 'shaft_shard'];
    App.updateTopbar();
    var chips = qa('#relic-tray .relic-chip');
    log('trayChips', chips.length);
    log('trayFirstTitle', (chips[0] ? chips[0].title : 'MISSING'));
    log('trayBoxShown', String(!q('#relic-tray-box').hidden));
    log('trayRareColored', String(!!q('#relic-tray .relic-chip.rar-uncommon')));
    // P1-0：托盘 = 遗物图形的缩小版 —— 色片里是 SVG 物品图，不再是首字文本
    log('trayFirstHasSvg', String(!!(chips[0] && chips[0].querySelector('svg'))));
    // P1-1：每件遗物（含未实装的）都必须有登记图形，兜底不允许被常态命中
    var missingIcon = Object.keys(RELICS).filter(function (id) { return !Art.RELIC_BODY[id]; });
    log('relicIconsMissing', missingIcon.join(',') || 'none');
    // M63：每件遗物（含未实装件）都必须登记位图（面板大图），漏登记走 SVG 兜底
    var missingImg = Object.keys(RELICS).filter(function (id) { return !Art.RELIC_IMG[id]; });
    log('relicImgsMissing', missingImg.join(',') || 'none');
    // P1-1：可掉落池扩容到 22
    log('relicPoolSize', relicPool().length);
    Run.state.relics = [];
    App.updateTopbar();
    log('trayBoxHiddenAfterClear', String(q('#relic-tray-box').hidden));

    // ---- P0-4：震屏 + 顿帧 ----
    // 进真实战斗节点，保证 .battle-stage 处于和玩家看到的一样的状态
    var entryEdges = Run.current().edges;
    var battleNode = null;
    for (var i = 0; i < entryEdges.length; i++) {
      var nt = Run.state.map.nodes[entryEdges[i]].type;
      if (nt === 'monster' || nt === 'elite') { battleNode = entryEdges[i]; break; }
    }
    App.enterNode(battleNode);
    log('inBattle', String(document.getElementById('view-combat').hidden === false));

    // M58b：动效常驻后，运行时可直接验证呼吸动画真的应用在立绘上 ——
    // 以前规则包在 no-preference 查询里，无头恒 reduce，computed 永远是 none。
    // 进的节点是随机的：地面敌人 idle-ground / 悬浮敌人（is-hover）idle-bob，
    // 两个都算「呼吸动画在跑」，归一化成 idle-running 再断言。
    var idleEl = q('#enemy-panel .eunit .unit-art > img') ||
                 q('#enemy-panel .eunit .unit-art > svg');
    var animName = idleEl ? getComputedStyle(idleEl).animationName : 'MISSING';
    log('idleAnimName',
      (animName === 'idle-ground' || animName === 'idle-bob') ? 'idle-running' : animName);

    var stage = q('.battle-stage');

    // M58b：动效不再跟随系统 reduce（实测玩家机器报 reduce = 全套动效消失），
    // 改由 td-fx 总开关管。所以这里**无需 stub matchMedia**，直接断言：
    //   ① 默认（td-fx 未设）→ 震屏 / 顿帧照常挂；
    //   ② localStorage td-fx=0 → Render.fxOn() 为 false，impactStage 全停。
    // CSS 侧的 html.fx-off 规则读不到（file:// 下 link 的 cssRules 拒读，
    // M30 踩坑），类挂载逻辑由 app.js 在 boot 时做，这里只验 JS 侧闸门。
    Render.impactStage(true);
    log('shakeHeavyOn', String(stage.classList.contains('is-shake-l')));
    log('freezeOn', String(stage.classList.contains('is-freeze')));

    Render.impactStage(false);
    log('shakeLightOn', String(stage.classList.contains('is-shake-s')));
    log('shakeHeavyOffAfterLight', String(!stage.classList.contains('is-shake-l')));

    try { window.localStorage.setItem('td-fx', '0'); } catch (e) {}
    log('fxOnAfterZero', String(Render.fxOn()));
    // 同一 tick 里上一击的 90ms 顿帧定时器还没走 —— 先清残留类再验闸门，
    // 否则验的是「定时器没到点」而不是「总开关拦住了」
    stage.classList.remove('is-shake-l', 'is-shake-s', 'is-freeze');
    Render.impactStage(true);
    log('fxOffStopsShake', String(!stage.classList.contains('is-shake-l') &&
                                  !stage.classList.contains('is-freeze')));
    try { window.localStorage.removeItem('td-fx'); } catch (e) {}
    log('fxRestored', String(Render.fxOn()));

    // ---- M73：防御动作（defendEffect 挂类 + 盾光环节点 + fx 闸门拦装饰层）----
    try {
      var punit = q('#player-panel .unit');
      Render.defendEffect(punit);
      log('defendClassOn', String(!!punit && punit.classList.contains('is-defend')));
      log('blockRingOn', String(!!(punit && punit.querySelector('.unit-art > .block-ring'))));
      // 敌人单位静默（需求只做玩家侧）：不挂类、不出环
      var eunit = q('#enemy-panel .eunit');
      Render.defendEffect(eunit);
      log('defendEnemySilent',
        String(!eunit || !eunit.classList.contains('is-defend')));
      // fx 关 → 动作类照挂（CSS 侧由 fx-off 总开关停播），装饰环被 JS 闸门拦下
      // ⚠️ 先摘掉上一次调用挂的环 —— 它的 620ms 自删定时器还没走，
      // 不摘的话这里查到的是「上一环」而不是「fx 关后新挂的环」
      var oldRing = punit.querySelector('.unit-art > .block-ring');
      if (oldRing) oldRing.remove();
      try { window.localStorage.setItem('td-fx', '0'); } catch (e) {}
      punit.classList.remove('is-defend');
      if (punit) Render.defendEffect(punit);
      log('defendClassUnderFxOff', String(!!punit && punit.classList.contains('is-defend')));
      log('fxOffStopsRing', String(!(punit && punit.querySelector('.unit-art > .block-ring'))));
      try { window.localStorage.removeItem('td-fx'); } catch (e) {}
    } catch (eM73) { log('m73err', String(eM73 && eM73.message || eM73)); }

    // ---- P1-2：回合横幅（相位 diff → 节点创建；fxOn 时）----
    Render._lastPhase = 'enemy';
    Render.turnBanner(Combat.state); // 战斗内 phase='player' → 应挂「你的回合」
    var banner = q('.battle-stage .turn-banner');
    log('bannerShown', String(!!banner));
    log('bannerText', banner ? banner.textContent : 'MISSING');

    // ---- P1-3：死亡表现（首只敌人打至 0 血 → is-dying 且不画意图；复活即摘）----
    var e0 = Combat.state.enemies[0];
    var hp0 = e0.hp;
    e0.hp = 0;
    var ehtml = Render.enemiesHtml(Combat.state);
    log('dyingInHtml', String(ehtml.indexOf('is-dying') >= 0));
    e0.hp = hp0;
    log('dyingGoneAfterRevive', String(Render.enemiesHtml(Combat.state).indexOf('is-dying') < 0));

    // ---- P1-4：设置面板（菜单第三页：三个开关 + 即时生效）----
    App.showMenu('main');
    document.getElementById('menu-settings-btn').click();
    log('settingsShown', String(!document.getElementById('menu-settings').hidden));
    log('setBgmChecked', String(q('#set-bgm').checked));
    var fxBox = q('#set-fx');
    fxBox.checked = false;
    fxBox.dispatchEvent(new Event('change'));
    log('fxOffClassOn', String(document.documentElement.classList.contains('fx-off')));
    log('tdFxStored0', String(window.localStorage.getItem('td-fx') === '0'));
    fxBox.checked = true;
    fxBox.dispatchEvent(new Event('change'));
    log('fxRestoredAgain', String(!document.documentElement.classList.contains('fx-off')));
    try { window.localStorage.removeItem('td-fx'); } catch (e) {}

    // 超时自摘：震屏 ~240/320ms，顿帧 90ms
    setTimeout(function () {
      log('shakeCleared', String(!stage.classList.contains('is-shake-s') &&
                                 !stage.classList.contains('is-shake-l')));
      log('freezeCleared', String(!stage.classList.contains('is-freeze')));
      write();
    }, 600);
  } catch (e) {
    out.push('probeErr = ' + (e && e.message));
    write();
  }
})();
</script>
`;

function runEdge(label, url, profile) {
  const dom = execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=6000',
      '--window-size=1200,900',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error(label + '：未找到探针输出（页面脚本在探针执行前就挂了）');
  return m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
    .split('\n')
    .reduce(function (acc, line) {
      const i = line.indexOf(' = ');
      if (i > 0) acc[line.slice(0, i).trim()] = line.slice(i + 3).trim();
      return acc;
    }, {});
}

let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
fs.writeFileSync(PROBE_FILE, html);

const fileUrl = 'file:///' + PROBE_FILE.replace(/\\/g, '/');
const profiles = {
  a: path.join(os.tmpdir(), 'edge-probe-p0-a-' + Date.now()).replace(/\\/g, '/'),
  b: path.join(os.tmpdir(), 'edge-probe-p0-b-' + Date.now()).replace(/\\/g, '/'),
};

let fail = 0, total = 0;
function check(got, key, want, why) {
  total++;
  const ok = got[key] === want;
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + why +
    '（期望 ' + want + '，实际 ' + got[key] + '）');
}

try {
  console.log('\n=== 断言 · 第 1 趟（默认页）===');
  const a = runEdge('默认页', fileUrl, profiles.a);
  check(a, 'jsError', 'none', '页面无 JS 运行时错误');
  check(a, 'poolbarHidden', 'true', 'P0-2：调试卡池栏默认隐藏');
  check(a, 'restartHidden', 'true', 'M89：重打本节点默认隐藏（调试工具）');
  check(a, 'trayHiddenWhenEmpty', 'true', 'P0-3：没拿遗物时托盘整块隐藏');
  check(a, 'trayChips', '3', 'P0-3：放入 3 个遗物 → 3 枚图标');
  check(a, 'trayBoxShown', 'true', 'P0-3：有遗物后托盘显示');
  check(a, 'trayRareColored', 'true', 'P0-3：稀有度类挂上（取色走既有色板）');
  check(a, 'trayFirstHasSvg', 'true', 'P1-0：托盘图标是 SVG 物品图（非首字色片）');
  check(a, 'relicIconsMissing', 'none', 'P1-0：每件遗物都有登记图形（含未实装件）');
  check(a, 'relicImgsMissing', 'none', 'M63：每件遗物（含未实装件）都登记了面板位图');
  check(a, 'relicPoolSize', '24', 'P1-1：可掉落遗物池扩到 24（M78 解禁断绳 + 火种读数仪）');
  check(a, 'trayFirstTitle', '锈蚀罗盘：每场战斗开始时，抽 1 张额外的牌。',
    'P0-3：hover title = 名称 + 说明');
  check(a, 'trayBoxHiddenAfterClear', 'true', 'P0-3：清空遗物后托盘再次隐藏');
  check(a, 'dailyBtnExists', 'true', 'M60：主菜单有「每日挑战」按钮');
  check(a, 'dailyDescHasToday', 'true', 'M60：菜单显示今日修饰描述');
  check(a, 'dailyDlFixed3', 'true', 'M60：每日挑战固定 DL3');
  check(a, 'inBattle', 'true', '进真实战斗节点（P0-4 的舞台是实战状态）');
  check(a, 'idleAnimName', 'idle-running', 'M58b：呼吸动画真的应用在立绘上（地面/悬浮两套都算）');
  check(a, 'shakeHeavyOn', 'true', 'M58b：默认动效开，impactStage(true) 挂重震类');
  check(a, 'freezeOn', 'true', 'M58b：重击同时挂顿帧类');
  check(a, 'shakeLightOn', 'true', 'M58b：impactStage(false) 挂轻震类');
  check(a, 'shakeHeavyOffAfterLight', 'true', 'M58b：轻震替换重震（同帧不叠两套震）');
  check(a, 'fxOnAfterZero', 'false', 'M58b：td-fx=0 → Render.fxOn() 为 false');
  check(a, 'fxOffStopsShake', 'true', 'M58b：总开关关闭时震屏/顿帧全停');
  check(a, 'fxRestored', 'true', 'M58b：清掉 td-fx 后动效恢复');
  check(a, 'defendClassOn', 'true', 'M73：defendEffect 给玩家单位挂 is-defend');
  check(a, 'blockRingOn', 'true', 'M73：防御动作带脚底盾光环节点');
  check(a, 'defendEnemySilent', 'true', 'M73：敌人单位静默（防御动作只做玩家侧）');
  check(a, 'defendClassUnderFxOff', 'true', 'M73：fx 关时动作类照挂（停播交给 CSS 总开关）');
  check(a, 'fxOffStopsRing', 'true', 'M73：fx 关时盾光环被 JS 闸门拦下');
  check(a, 'bannerShown', 'true', 'P1-2：回合切换创建横幅节点');
  check(a, 'bannerText', '你的回合', 'P1-2：enemy→player 横幅文案正确');
  check(a, 'dyingInHtml', 'true', 'P1-3：敌人 0 血 → 渲染含 is-dying（溶解退场）');
  check(a, 'dyingGoneAfterRevive', 'true', 'P1-3：复活后 is-dying 摘除（名单按 hp 过滤）');
  check(a, 'settingsShown', 'true', 'P1-4：菜单设置页能打开');
  check(a, 'setBgmChecked', 'true', 'P1-4：音乐开关同步 Bgm.isMuted()');
  check(a, 'fxOffClassOn', 'true', 'P1-4：动效开关关 → html 挂 fx-off');
  check(a, 'tdFxStored0', 'true', 'P1-4：动效开关写 td-fx=0');
  check(a, 'fxRestoredAgain', 'true', 'P1-4：动效开关开 → fx-off 摘除');
  check(a, 'shakeCleared', 'true', 'P0-4：震屏超时自摘');
  check(a, 'freezeCleared', 'true', 'P0-4：顿帧超时自摘（90ms）');

  console.log('\n=== 断言 · 第 2 趟（?dev=1）===');
  const b = runEdge('dev页', fileUrl + '?dev=1', profiles.b);
  check(b, 'jsError', 'none', '页面无 JS 运行时错误');
  check(b, 'poolbarHidden', 'false', 'P0-2：?dev=1 时调试卡池栏显示');
  check(b, 'restartHidden', 'false', 'M89：?dev=1 时重打本节点显示');
} finally {
  fs.existsSync(PROBE_FILE) && fs.unlinkSync(PROBE_FILE);
  Object.keys(profiles).forEach(function (k) {
    try { fs.rmSync(profiles[k], { recursive: true, force: true }); } catch (e) { /* Edge 还占着就留着 */ }
  });
}

console.log('\n' + (fail === 0 ? 'P0 专项探针全部通过' : 'P0 专项探针存在失败项') +
  '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
