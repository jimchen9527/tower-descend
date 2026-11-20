// M47 · 角色待机呼吸微动复核（诊断脚本，不改任何产品代码）
//
// 问题：用户反馈「角色微动 / 呼吸感没有了」。M26 定的语言是
//   接地单位 = 以脚底为轴的挤压舒展（transform-origin: 50% 100%），
//   translate 分量恒 0 → 脚部像素不动，只有身体微起伏。
// M45 把幅度从「写死比例」改成「按目标行程反推的 --idle-sx/--idle-sy」。
//
// 本脚本要回答四个问题，全部在**真实 headed 浏览器**里量
// （headless Edge 恒报 prefers-reduced-motion: reduce，
//  动画整条被降级掉，量到的会是「没动」—— 那是环境假象不是 bug）：
//   Q1 动画到底有没有在跑（animationName / playState）
//   Q2 脚动不动（bottom 的位移量）
//   Q3 身体动多少（top 的位移量 = 行程）
//   Q4 幅度够不够「肉眼可见」（阈值 1.5px，低于此重采样一糊就平）
//
// 用法：node tests/m47-idle-probe.js

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.join(__dirname, 'm47-idle-probe.json');

// 采样：每 60ms 采一次，共 ~3.2s，覆盖 idle-ground 2.8s 一整个周期
const SAMPLES = 54;
const PERIOD_MS = 60;

async function probeCase(page, enemyId, tag) {
  return await page.evaluate(async ({ enemyId, tag, SAMPLES, PERIOD_MS }) => {
    Progress.reset();
    App.boot({ fresh: true });
    Combat.start(20261009, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 5, locTag: 'M47 探针',
      deck: Run.state.deck, enemyId: enemyId,
    });
    Render.resetFeedback();
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.draw();

    const enemyImg = document.querySelector('#enemy-panel .eunit .unit-art > img');
    const playerImg = document.querySelector('.unit-art-player .unit-bm');
    if (!enemyImg) return { tag: tag, err: 'no-enemy-img' };

    const cs = getComputedStyle(enemyImg);
    const info = {
      tag: tag,
      enemyId: enemyId,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      animationPlayState: cs.animationPlayState,
      animationDelay: cs.animationDelay,
      transformOrigin: cs.transformOrigin,
      idleSx: getComputedStyle(enemyImg.parentElement).getPropertyValue('--idle-sx').trim(),
      idleSy: getComputedStyle(enemyImg.parentElement).getPropertyValue('--idle-sy').trim(),
      bmHeight: cs.height,
      isHover: !!enemyImg.closest('.eunit.is-hover'),
    };

    // 逐帧采样 getBoundingClientRect（动画插值只影响 transform，rect 会跟着动）
    const tops = [], bottoms = [], lefts = [], rights = [], scales = [];
    for (let i = 0; i < SAMPLES; i++) {
      const r = enemyImg.getBoundingClientRect();
      tops.push(r.top);
      bottoms.push(r.bottom);
      lefts.push(r.left);
      rights.push(r.right);
      // 直接读 matrix(1,0,0,1,tx,ty) 里的 a/d 分量 = 真实 scale
      const m = new DOMMatrixReadOnly(getComputedStyle(enemyImg).transform);
      scales.push({ sx: m.a, sy: m.d });
      await new Promise(function (res) { setTimeout(res, PERIOD_MS); });
    }

    // 脚底与玩家脚底是否同一条线（贴地保真度）
    const pr = playerImg ? playerImg.getBoundingClientRect() : null;
    const er = enemyImg.getBoundingClientRect();

    const span = function (a) { return Math.max.apply(null, a) - Math.min.apply(null, a); };

    return Object.assign(info, {
      samples: SAMPLES,
      // 关键量：脚底位移必须 ≈ 0（接地），身体位移 = 行程
      footTravelPx: span(bottoms).toFixed(2),
      bodyTravelPx: span(tops).toFixed(2),
      widthTravelPx: span(rights).toFixed(2),
      sxRange: (Math.max.apply(null, scales.map(function (s) { return s.sx; })) -
                Math.min.apply(null, scales.map(function (s) { return s.sx; }))).toFixed(4),
      syRange: (Math.max.apply(null, scales.map(function (s) { return s.sy; })) -
                Math.min.apply(null, scales.map(function (s) { return s.sy; }))).toFixed(4),
      playerFootGapPx: pr ? (pr.bottom - er.bottom).toFixed(2) : 'no-player',
    });
  }, { enemyId, tag, SAMPLES, PERIOD_MS });
}

(async function () {
  if (!fs.existsSync(EDGE)) {
    console.error('找不到 Edge：' + EDGE);
    process.exit(2);
  }
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: false,          // 必须 headed：无头恒 reduce，动画被整条降级
    args: ['--disable-gpu', '--no-first-run', '--window-size=1280,900'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e)); });

  const url = 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 环境自证：这版浏览器报不报 reduce —— 报了下面所有「没动」都是环境假象
  const reduce = await page.evaluate(function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  console.log('环境：prefers-reduced-motion: reduce = ' + reduce);
  if (reduce) console.log('⚠️ 浏览器仍报 reduce，动画在降级分支里，采样不可信');

  const cases = [
    ['rats', '小怪 · 73px'],
    ['warlord', '中 Boss · M46 后 122px'],
    ['rust_crown', '大 Boss · 130px'],
    ['scavenger_shade', '悬浮单位（拾荒者残影）'],
  ];
  const results = [];
  for (const [id, tag] of cases) {
    const r = await probeCase(page, id, tag);
    results.push(r);
    if (r.err) { console.log('  ' + tag + ' → ' + r.err); continue; }
    console.log('\n── ' + r.tag);
    console.log('   animation : ' + r.animationName + ' / ' + r.animationDuration +
                ' / delay ' + r.animationDelay + ' / ' + r.animationPlayState);
    console.log('   轴心      : ' + r.transformOrigin + (r.isHover ? '  [悬浮单位]' : ''));
    console.log('   变量      : --idle-sx ' + r.idleSx + ' / --idle-sy ' + r.idleSy +
                '（立绘 ' + r.bmHeight + '）');
    console.log('   采样 ' + r.samples + ' 帧 / ' + (SAMPLES * PERIOD_MS / 1000).toFixed(1) + 's：');
    console.log('     脚底位移 : ' + r.footTravelPx + 'px   ← 必须 ≈ 0');
    console.log('     身体位移 : ' + r.bodyTravelPx + 'px   ← 行程，呼吸感来源');
    console.log('     宽度位移 : ' + r.widthTravelPx + 'px');
    console.log('     scale 实测: sx 摆幅 ' + r.sxRange + ' / sy 摆幅 ' + r.syRange);
    console.log('     敌我脚底差: ' + r.playerFootGapPx + 'px');
  }

  await browser.close();

  fs.writeFileSync(OUT, JSON.stringify({ reduce: reduce, results: results, errs: errs }, null, 2));
  console.log('\n原始数据：tests/m47-idle-probe.json');
  if (errs.length) console.log('页面错误：' + errs.join(' | '));
})();