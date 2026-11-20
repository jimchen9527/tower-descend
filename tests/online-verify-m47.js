// M46/M47 在线验证：拉线上 URL，核对本次发布的三批改动真的上线了。
//
// 覆盖范围（前两批由 m44/m45 两份脚本继续负责，本份只管新增的）：
//   M44·意图常显 + 待机幅度标定→ 由 online-verify-m45.js 钉（20 项，本份不重复）
//   M46 · 中 Boss 个头必须高过玩家（91 → 122），大 Boss 130 仍是全场最大
//   M47 · 待机呼吸微动在线上真的在动，且**脚立定**（这是M26 定稿的物理）
//
// 沿用 m44/m45 那几个坑：
//   不用 networkidle（远程静态站点挂在那儿不会「静」）；
//   等位图解码完再量（600ms 后拍全是空框）；
//   断言用 getComputedStyle 的CSS 真值，不用 getBoundingClientRect 的设备像素舍入值。
//
// ⚠️ 无头环境恒报 prefers-reduced-motion: reduce，动画规则整条不生效 ——
// 所以「微动在动」这条**不能**直接读 computed animation（会永远读到 none）。
// 办法是把 art.css 里no-preference 媒体块**原样抽出来**注入页面，
// 让浏览器执行产品CSS 里的真实 keyframes，再靠负delay + paused 定格采样。
// 这样量到的就是线上真实的幅度，而不是我在 JS 里另算的一套。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'https://tower-descend-game-60674.app.workbuddy.host/';
const BASE = path.join(__dirname, '..');
const SHOT = path.join(__dirname, 'm47-online-verify.png');

// 与 css/art.css 落盘值一一对应
const EXPECT = {
  playerH: 111,   // .unit-art-player .unit-bm
  eliteH: 122,    // .art-kind-elite .unit-bm（M46 从 91 提上来）
  bossH: 130,     // .art-kind-boss .unit-bm
  ratH: 73,       // .unit-bm
  minTravel: 1.5, // 身体起伏下限：低于此亚像素＝看不见（M45 修的就是这个）
  footTol: 0.5,   // 脚底位移上限：接地单位必须立定（M26 用户一眼否掉过 translateY）
};

// 从线上 CSS 文本里解包 no-preference 媒体块（括号配平扫描，不用正则）
function extractNoPreferenceRules(cssText) {
  const at = cssText.indexOf('@media (prefers-reduced-motion: no-preference)');
  if (at < 0) return '';
  const open = cssText.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < cssText.length; i++) {
    if (cssText[i] === '{') depth++;
    else if (cssText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return end < 0 ? '' : cssText.slice(open + 1, end);
}

const span = a => Math.max.apply(null, a) - Math.min.apply(null, a);

(async () => {
  const b = await chromium.launch({ executablePath: EDGE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const resp = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);

  // ---------- 静态层：版本、样式表、CSS 文本 ----------
  const r = await p.evaluate(() => {
    let top = '', read = 0;
    Array.prototype.forEach.call(document.styleSheets, function (ss) {
      try {
        read++;
        Array.prototype.forEach.call(ss.cssRules, function (x) {
          if (x.media) return;          // 媒体查询整块跳过（踩坑 46）
          top += (x.cssText || '');
        });
      } catch (e) { /* 跨源读不到 */ }
    });
    return {
      title: document.title,
      sheets: document.styleSheets.length,
      sheetsRead: read,
      top: top,
      jsBoot: typeof App !== 'undefined' && typeof Combat !== 'undefined' &&
              typeof Run !== 'undefined' && typeof Render !== 'undefined',
    };
  });
  const m = /M(\d+)/.exec(r.title);
  const ver = m ? parseInt(m[1], 10) : 0;

  // ---------- 尺寸层：逐个敌人开战，读 computed height ----------
  const CASES = [
    ['rats', 'normal', '小怪'],
    ['warlord', 'elite', '中 Boss'],
    ['rust_crown', 'boss', '大 Boss'],
  ];
  const heights = {};
  const classes = {};
  for (const [id, kind, label] of CASES) {
    await p.evaluate((opts) => {
      Progress.reset(); App.boot({ fresh: true });
      Run.start('act1', 20261009); App.showMap();
      Combat.start(20261009, {
        charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '线上验证 · M46/M47',
        deck: Run.state.deck, enemyId: opts.id,
      });
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      document.getElementById('turn-box').hidden = false;
      Render.resetFeedback(); Render.draw();
    }, { id });
    await p.waitForTimeout(400);
    await p.waitForFunction(() => {
      const a = Array.prototype.slice.call(document.images);
      return a.length > 0 && a.every(i => i.complete && i.naturalWidth > 0);
    }, { timeout: 30000 }).catch(() => {});
    const got = await p.evaluate((k) => {
      const img = document.querySelector('#enemy-panel .eunit .unit-bm');
      const art = document.querySelector('#enemy-panel .eunit .unit-art');
      return {
        h: img ? parseFloat(getComputedStyle(img).height) : NaN,
        cls: art ? art.className : '',
        delay: img ? (img.getAttribute('style') || '') : '',
      };
    }, kind);
    heights[kind] = got.h;
    classes[kind] = got;
  }
  // 玩家立绘单独量
  const playerH = await p.evaluate(() => {
    const el = document.querySelector('.unit-art-player .unit-bm');
    return el ? parseFloat(getComputedStyle(el).height) : NaN;
  });

  // ---------- 动态层：解包媒体块 + 相位定格，逐帧量 ----------
  const artCss = await (await fetch(URL + 'css/art.css')).text();
  const unwrapped = extractNoPreferenceRules(artCss);
  await p.addStyleTag({ content: unwrapped });

  const phaseInfo = await p.evaluate(() => {
    // 按 class 认角色，**不能**按 querySelectorAll 的下标 ——
    // 页面上永远只有「当前敌人 + 玩家」两张立绘，下标随最后一场战斗的敌种变化。
    function pick(sel) {
      const el = document.querySelector(sel + ' > img') ||
                 document.querySelector(sel.replace(' > img', '') + ' .unit-bm');
      return el || null;
    }
    const map = {
      normal: pick('#enemy-panel .eunit .unit-art:not(.art-kind-elite):not(.art-kind-boss)'),
      elite: pick('#enemy-panel .eunit .art-kind-elite'),
      boss: pick('#enemy-panel .eunit .art-kind-boss'),
      player: pick('.unit-art-player'),
    };
    const N = 12, out = [];
    for (let i = 0; i < N; i++) {
      const ph = i / N;
      const frame = {};
      Object.keys(map).forEach(function (k) {
        const el = map[k];
        if (!el) { frame[k] = null; return; }
        const dur = el.closest('.art-kind-boss') ? 4.2 : 2.8;
        el.style.animationPlayState = 'paused';
        el.style.animationDelay = (-ph * dur).toFixed(3) + 's';
      });
      void document.body.offsetHeight;   // 强制回流，让 paused 的新 delay 落上矩阵
      Object.keys(map).forEach(function (k) {
        const el = map[k];
        if (!el) { frame[k] = null; return; }
        const mm = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        const rc = el.getBoundingClientRect();
        frame[k] = { sx: +mm.a.toFixed(4), sy: +mm.d.toFixed(4),
                     top: +rc.top.toFixed(2), bottom: +rc.bottom.toFixed(2) };
      });
      out.push(frame);
    }
    return { out: out, present: Object.keys(map).filter(k => !!map[k]) };
  });

  // 最后一战是 rust_crown，所以页面上必然有 normal?否 —— 只有 boss + player。
  // 小怪/中 Boss 的动态值改用「本地已验证 + 线上尺寸已验证」的分工：
  // 线上量到什么就断言什么，量不到的显式报出来，不假装通过。
  const ORDER = phaseInfo.present;
  const travel = {}, foot = {}, sxRange = {};
  ORDER.forEach(function (k) {
    travel[k] = span(phaseInfo.out.map(function (f) { return f[k].top; }));
    foot[k] = span(phaseInfo.out.map(function (f) { return f[k].bottom; }));
    sxRange[k] = span(phaseInfo.out.map(function (f) { return f[k].sx; }));
  });
  // 中 Boss 场单独再跑一次，让它也进动态采样
  const eliteDyn = await p.evaluate(async () => {
    Combat.start(20261010, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 5, locTag: '线上验证 · 精英动态',
      deck: Run.state.deck, enemyId: 'warlord',
    });
    Render.resetFeedback(); Render.draw();
    await new Promise(function (r) { setTimeout(r, 300); });
    const el = document.querySelector('#enemy-panel .eunit .art-kind-elite > img');
    if (!el) return null;
    const N = 12, tops = [], bots = [], sxs = [];
    for (let i = 0; i < N; i++) {
      const ph = i / N;
      el.style.animationPlayState = 'paused';
      el.style.animationDelay = (-ph * 2.8).toFixed(3) + 's';
      void document.body.offsetHeight;
      const mm = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const rc = el.getBoundingClientRect();
      tops.push(rc.top); bots.push(rc.bottom); sxs.push(mm.a);
    }
    el.style.animationPlayState = ''; el.style.animationDelay = '';
    const mx = a => Math.max.apply(null, a) - Math.min.apply(null, a);
    return { travel: +mx(tops).toFixed(2), foot: +mx(bots).toFixed(2), sx: +mx(sxs).toFixed(4) };
  });
  if (eliteDyn) { travel.elite = eliteDyn.travel; foot.elite = eliteDyn.foot; sxRange.elite = eliteDyn.sx; }

  // 恢复播放，免得截图是定格态
  await p.evaluate(() => {
    document.querySelectorAll('.unit-art > img').forEach(function (el) {
      el.style.animationPlayState = '';
      el.style.animationDelay = '';
    });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: SHOT });

  const checks = [
    ['页面可访问 (HTTP)', resp.status() === 200, resp.status()],
    ['JS 全部初始化', r.jsBoot, r.jsBoot],
    ['样式表 2 份', r.sheets === 2, r.sheets],
    ['样式表可读（CSSOM 前提）', r.sheetsRead === 2, r.sheetsRead],
    ['版本号 ≥ M46', ver >= 46, r.title],
    ['art.css 含 no-preference 媒体块（动态层前提）', unwrapped.trim().length > 0,
      unwrapped.length + ' 字符'],

    // ---- M46：尺寸 ----
    ['小兵立绘 73px', heights.normal === EXPECT.ratH, heights.normal],
    ['玩家立绘 111px', playerH === EXPECT.playerH, playerH],
    ['中 Boss 立绘 122px（M46 从 91 提上来）', heights.elite === EXPECT.eliteH, heights.elite],
    ['大 Boss 立绘 130px', heights.boss === EXPECT.bossH, heights.boss],
    ['中 Boss 高过玩家（M46 的全部意义）', heights.elite > playerH,
      (heights.elite - playerH).toFixed(0) + 'px'],
    ['大 Boss 仍是全场最大', heights.boss > heights.elite,
      (heights.boss - heights.elite).toFixed(0) + 'px'],
    ['四档递进 小怪 < 玩家 < 中Boss < 大Boss',
      heights.normal < playerH && playerH < heights.elite && heights.elite < heights.boss,
      [heights.normal, playerH, heights.elite, heights.boss].join(' / ')],
    ['中 Boss 走 art-kind-elite 规则（class 没拼错）',
      /art-kind-elite/.test(classes.elite.cls), classes.elite.cls],

    // ---- M47：呼吸微动 ----
    ['idle-ground keyframes 走变量（不是写死比例）',
      /@keyframes idle-ground[\s\S]{0,300}?scale\(var\(--idle-sx/.test(r.top), 'cssTop 命中'],
    ['玩家身体起伏 ≥ 1.5px（可见阈值）', travel.player >= EXPECT.minTravel, travel.player.toFixed(2) + 'px'],
    ['中 Boss 身体起伏 ≥ 1.5px', travel.elite >= EXPECT.minTravel, travel.elite.toFixed(2) + 'px'],
    ['大 Boss 身体起伏 ≥ 1.5px', travel.boss >= EXPECT.minTravel, travel.boss.toFixed(2) + 'px'],
    ['体型越大呼吸越深（身板越大行程越深）',
      travel.elite < travel.boss,
      travel.elite.toFixed(2) + ' → ' + travel.boss.toFixed(2)],
    ['横向呼吸存在（scaleX 有摆幅）', sxRange.player > 0.005, sxRange.player.toFixed(4)],
    // 这条是 M26 定稿的物理：站着的不能飘，脚必须立定
    ['接地单位脚立定（玩家）', foot.player <= EXPECT.footTol, foot.player.toFixed(2) + 'px'],
    ['接地单位脚立定（中 Boss）', foot.elite <= EXPECT.footTol, foot.elite.toFixed(2) + 'px'],
    ['接地单位脚立定（大 Boss）', foot.boss <= EXPECT.footTol, foot.boss.toFixed(2) + 'px'],
    ['立绘带相位错开内联 delay（相邻单位不同步）',
      /animation-delay/.test(classes.boss.delay), classes.boss.delay.slice(0, 40)],

    ['无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none'],
  ];

  let fail = 0;
  checks.forEach(c => {
    if (!c[1]) fail++;
    console.log((c[1] ? '  ok  ' : '  FAIL') + ' ' + c[0] + '（' + c[2] + '）');
  });
  console.log('\nM46/M47 线上验证：' + (checks.length - fail) + ' 通过 / ' + fail + ' 失败');
  if (fs.existsSync(SHOT)) console.log('截图：tests/m47-online-verify.png');
  await b.close();
  process.exit(fail ? 1 : 0);
})();