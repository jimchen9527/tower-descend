// M45 在线验证：拉线上 URL，核对「意图胶囊改回常显」与「待机幅度重标定」真的上线了。
// 与 tests/online-verify-m44.js 同款做法（那几个坑都沿用：不用 networkidle、
// 等图解码完再量、断言用 computed 而不是 rect），只是换成本里程碑的关键值。
//
// 为什么单独一个文件而不是改 m44 那份：M44 的期望值（立绘 111/130、血条 14/18、
// gap 205.92、idle-bob -4.4px）在 M45 里**一个都没变**，那份脚本继续有效；
// M45 新增的是另一批量（意图可见性 + 待机幅度变量），混在一起会让失败原因难分。
const { chromium } = require('playwright');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'https://tower-descend-game-60674.app.workbuddy.host/';

// 关键期望值（与 css/ 里的落盘值一一对应）
//
// ⚠️ M48 起这里**不再断言具体数值**，只断言下限。
// 原先把 idleSx/idleSy/行程写死成 1.0200/.9700/2.19px，结果 M48 为了
// 「真的看得见」把幅度提到 6%、行程提到 7.32px 之后，这三条立刻变成三条
// 假失败 —— 它们断言的是「M45 那批改动存在过」，数值却在替后续版本把关。
// M45 真正要证明的是两件事，都与数值无关：
//   ① 待机幅度由 CSS 变量驱动（不是写死的比例 —— 写死的正是 M44 丢动态的根因）
//   ② 行程达到了「看得见」的量级（给下限，不给等号）
// 精确标定值由 tests/m48-travel-matrix.js 在真实浏览器里逐档量，那是唯一该管它的地方。
const EXPECT = {
  minTravelPx: 2.0, // 小兵 73px 身板的行程下限；旧值 0.88px / M45 的 2.19px 均在此之上，
                     // 而「放大后被上限压扁」这类回归会把它打回 1px 以下 —— 那是真缺陷
  intentOp: 0.82,    // .eunit .intent { opacity: .82 }（触屏档是全亮 1，故断言取 >= ）
};

(async () => {
  const b = await chromium.launch({ executablePath: EDGE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const resp = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);

  // 远程样式表是同源的（css/art.css），cssRules 读得到。
  // ⚠️ 只收**顶层**规则：CSSMediaRule.cssText 含内部规则，混在一起的话
  // 「规则写在媒体查询外」这件事就验不出来了（本地探针踩坑 46 同款）。
  const r = await p.evaluate(() => {
    let top = '';
    let sheetsRead = 0;
    Array.prototype.forEach.call(document.styleSheets, function (ss) {
      try {
        const rs = ss.cssRules;
        sheetsRead++;
        Array.prototype.forEach.call(rs, function (r) {
          if (r.media) return;       // 媒体查询整块跳过
          top += (r.cssText || '');
        });
      } catch (e) { /* 跨源样式表读不到，sheetsRead 不加 */ }
    });
    return {
      title: document.title,
      styleSheets: document.styleSheets.length,
      sheetsRead: sheetsRead,
      top: top,
      jsBoot: typeof App !== 'undefined' && typeof Combat !== 'undefined' &&
              typeof Run !== 'undefined' && typeof Render !== 'undefined'
    };
  });

  // 进一场普通战斗（单敌，大鼠）：意图胶囊在，且玩家侧不该有
  await p.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20261009); App.showMap();
    Combat.start(20261009, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '线上验证 · M45',
      deck: Run.state.deck, enemyId: 'rats'
    });
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    document.getElementById('turn-box').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await p.waitForTimeout(600);

  // 等位图解码完再量（首版截图 600ms 后拍，背景与立绘全空，像布局崩了）
  await p.waitForFunction(() => {
    const all = Array.prototype.slice.call(document.images);
    return all.length > 0 && all.every(i => i.complete && i.naturalWidth > 0);
  }, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(500);

  const live = await p.evaluate(() => {
    function q(s) { return document.querySelector(s); }
    const it = q('#enemy-panel .eunit .intent');
    const ua = q('#enemy-panel .eunit .unit-art');
    const cs = it ? getComputedStyle(it) : null;
    return {
      // 意图常显（M45 的核心）
      intentExists: !!it,
      intentVisibility: cs ? cs.visibility : 'none',
      intentOpacity: cs ? parseFloat(cs.opacity) : -1,
      intentTextHead: it ? (it.textContent || '').slice(0, 2) : '',
      intentDisplay: cs ? cs.display : 'none',
      // 玩家侧不该有意图胶囊（revealIntent 不误挂）
      playerIntent: !!q('#player-panel .intent'),
      // 待机幅度（M45 的核心）
      idleSx: ua ? parseFloat(getComputedStyle(ua).getPropertyValue('--idle-sx')) : NaN,
      idleSy: ua ? parseFloat(getComputedStyle(ua).getPropertyValue('--idle-sy')) : NaN,
      // 待机周期（M49 的核心）。只能量 computed —— CSS 源文本里到处是
      // 注释里写着的历史周期，按文本 grep 会撞上注释。
      idleDur: (function () {
        const im = q('#enemy-panel .eunit .unit-art > img');
        return im ? getComputedStyle(im).animationDuration : 'none';
      })(),
      playerDur: (function () {
        const im = q('#player-panel .unit-art > img');
        return im ? getComputedStyle(im).animationDuration : 'none';
      })()
    };
  });

  await p.screenshot({ path: 'tests/m45-online-verify.png' });

  const top = r.top;
  const idleTravel = isNaN(live.idleSy) ? NaN : 73 * (1 - live.idleSy);

  // 周期的第二个落点是 js/ui/render.js 里的相位模数 —— 漏改会静默错相
  // （delay 越过周期回绕，「有的单位在动、有的几乎不动」）。线上逐字节 diff
  // 已覆盖它，这里再独立断言一次，两份证据互不依赖。
  const rjs = await (await fetch(URL + 'js/ui/render.js')).text();
  const modHit = (/%\s*[\d.]+\)\.toFixed\(2\)/.exec(rjs) || ['未命中'])[0];

  const checks = [
    ['页面可访问 (HTTP)', resp.status() === 200, resp.status()],
    ['JS 全部初始化', r.jsBoot, r.jsBoot],
    ['样式表 2 份', r.styleSheets === 2, r.styleSheets],
    ['样式表可读（CSSOM 断言的前提）', r.sheetsRead === 2, r.sheetsRead],
    // 版本号只用来确认「本次发布含M45 那批改动」，不要求恰好停在 M45 ——
    // M47（敌人尺寸 / 呼吸微动上线）之后的版本号都算通过。绑死字符串会
    // 让每次升版本号都伪造出一条失败。
    ['版本号 ≥ M45（含本批改动）', /M(\d+)/.test(r.title) && parseInt(RegExp.$1, 10) >= 45, r.title],

    // ① 意图「加上」
    ['敌人有意图胶囊', live.intentExists, live.intentExists],
    ['意图默认可见 (visibility)', live.intentVisibility === 'visible', live.intentVisibility],
    ['意图默认半亮或全亮 (opacity ≥ .82)', live.intentOpacity >= EXPECT.intentOp,
      live.intentOpacity],
    ['意图文字前缀仍以「意图」开头', live.intentTextHead === '意图', live.intentTextHead],
    ['意图仍占位 (display 不为 none)', live.intentDisplay !== 'none', live.intentDisplay],
    ['玩家单位没有意图胶囊', !live.playerIntent, live.playerIntent],
    ['常显规则写在媒体查询外',
      /\.eunit \.intent\s*\{[^}]*visibility:\s*visible/.test(top) &&
      /\.eunit \.intent\s*\{[^}]*opacity:\s*0?\.82/.test(top),
      'cssTop 命中 .eunit .intent'],
    ['出手自亮规则在顶层 (.intent-reveal → intent-pop)',
      // 两个坑：①选择器后要 \s*\{，.intent.intent-reveal 在 art.css 出现两次，
      //   第一次是 hover 规则（无 animation），跨字符匹配会撞上它。
      //   ② CSSOM 把 animation 规范化成 `1.1s ease-out 0s 1 normal both running
      //      intent-pop` —— 动画名在末尾，不能按源码顺序匹配，只能判「含」。
      /\.eunit \.intent\.intent-reveal\s*\{[^}]*animation:[^}]*intent-pop/.test(top),
      'cssTop 命中'],
    ['intent-pop keyframes 在媒体查询外', top.indexOf('@keyframes intent-pop') >= 0,
      'cssTop 命中'],

    // ② 人物动态「补上」—— 断的是「变量驱动」与「量级够」，不是具体刻度（见 EXPECT 注释）
    ['--idle-sx 已声明', !isNaN(live.idleSx), live.idleSx],
    ['--idle-sy 已声明', !isNaN(live.idleSy), live.idleSy],
    // 用下限而不是等号：M44 的 0.88px（写死比例导致）会被这条抓住，
    // 而后续版本把幅度调大不会伪造失败。
    ['小兵待机行程 ≥ 2.0px（M44 旧值 0.88px 为亚像素）',
      !isNaN(idleTravel) && idleTravel >= EXPECT.minTravelPx,
      isNaN(idleTravel) ? 'NaN' : idleTravel.toFixed(2) + 'px'],
    ['idle-ground 走变量',
      /@keyframes idle-ground[\s\S]{0,300}?scale\(var\(--idle-sx/.test(top) &&
      /@keyframes idle-ground[\s\S]{0,300}?var\(--idle-sy/.test(top),
      'cssTop 命中 scale(var(--idle-sx…))'],

    // ③ 待机周期（M49）—— 只量 computed 时长，不 grep 源文本
    //   （源文件里到处是注释写的历史周期，文本匹配会撞上注释）
    // ⚠️ 必须按数值比，不能比字符串：CSSOM 会把时长序列化成**最短形式**，
    //   源码写的 `2.0s` 读回来是 `2s`（同族坑：`.82` 读回来是 `0.82`）。
    ['敌人待机周期 = 2.0s（M49 回退档）', parseFloat(live.idleDur) === 2, live.idleDur],
    ['玩家待机周期同为 2.0s', parseFloat(live.playerDur) === 2, live.playerDur],
    ['相位模数已跟周期同步（render.js）', /%\s*2\.0\)\.toFixed\(2\)/.test(rjs), modHit],

    ['无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none']
  ];
  let fail = 0;
  checks.forEach(c => {
    if (!c[1]) fail++;
    console.log((c[1] ? '  ok  ' : '  FAIL') + ' ' + c[0] + '（' + c[2] + '）');
  });
  console.log('\nM45 线上验证：' + (checks.length - fail) + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
