// M48 线上动效真因诊断 —— 不解包媒体块、不注入任何东西，
// 只读「浏览器自己怎么判」和「computed style 现在是什么」。
// 上一次（M47）的线上回归把 no-preference 媒体块解包后注入，
// 等于替浏览器做了「要不要播」的决定 —— 那证明不了用户的浏览器在播。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'https://tower-descend-game-60674.app.workbuddy.host/';
const SHOT = path.join(__dirname, 'm48-online-diag.png');

(async () => {
  // headed + 独立 profile：走系统真实的动效设置
  const b = await chromium.launch({
    executablePath: EDGE,
    headless: false,
    args: ['--no-first-run', '--disable-features=CalculateNativeWinOcclusion'],
  });
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  const fails = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 120)); });
  // 404 是重点线索：把失败资源的 URL 抓出来
  p.on('response', (r) => { if (r.status() >= 400) fails.push(r.status() + ' ' + r.url()); });
  p.on('requestfailed', (r) => fails.push('FAILED ' + r.url() + ' :: ' + ((r.failure() || {}).errorText || '')));

  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  // ---- 1. 浏览器自己的动效判定（未经任何篡改）----
  const mq = await p.evaluate(() => ({
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    noPref: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    visibility: document.visibilityState,
    focus: document.hasFocus(),
  }));
  console.log('== 浏览器判定（未篡改）==');
  console.log('  prefers-reduced-motion: reduce      = ' + mq.reduce);
  console.log('  prefers-reduced-motion: no-preference = ' + mq.noPref);
  console.log('  visibilityState = ' + mq.visibility + ' / hasFocus = ' + mq.focus);

  // ---- 2. 进战斗，看立绘的 computed animation ----
  const probe = await p.evaluate(async () => {
    try {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let out = { ok: false, note: '' };

      // 顶层 const 落在全局**词法**作用域，不是 window 的属性 —— 必须用裸名
      const AppG = typeof App !== 'undefined' ? App : window.App;
      const CombatG = typeof Combat !== 'undefined' ? Combat : window.Combat;
      const ProgG = typeof Progress !== 'undefined' ? Progress : window.Progress;
      const RenderG = typeof Render !== 'undefined' ? Render : window.Render;
      const RunG = typeof Run !== 'undefined' ? Run : window.Run;
      out.globals = {
        App: !!AppG, Combat: !!CombatG, Progress: !!ProgG,
        Render: !!RenderG, Run: !!RunG,
      };
      if (!AppG || !CombatG || !RenderG) { out.note = 'App/Combat/Render 未就绪'; return out; }

      if (ProgG && ProgG.reset) ProgG.reset();
      AppG.boot({ fresh: true });
      CombatG.start(20261009, {
        charId: 'digger', hp: 70, maxHp: 75, depth: 3, locTag: 'M48',
        deck: RunG.state.deck, enemyId: 'warlord',
      });
      RenderG.resetFeedback();
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      RenderG.draw();
      await sleep(400);

      const el = document.querySelector('#enemy-panel .unit-art > img');
      const pel = document.querySelector('.unit-art-player > img');
      if (!el) { out.note = '找不到敌人立绘 img'; return out; }
      const cs = getComputedStyle(el);
      const pcs = pel ? getComputedStyle(pel) : null;

      // 规则是否真被应用：animationName 不是 none
      const anims = el.getAnimations ? el.getAnimations() : [];
      const panims = pel && pel.getAnimations ? pel.getAnimations() : [];

      // 实测行程：采样 900ms 内 top 的极差
      const N = 30;
      let topMin = 1e9, topMax = -1e9, botMin = 1e9, botMax = -1e9, sxMin = 1e9, sxMax = -1e9;
      for (let i = 0; i < N; i++) {
        const r = el.getBoundingClientRect();
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        topMin = Math.min(topMin, r.top); topMax = Math.max(topMax, r.top);
        botMin = Math.min(botMin, r.bottom); botMax = Math.max(botMax, r.bottom);
        sxMin = Math.min(sxMin, m.a); sxMax = Math.max(sxMax, m.a);
        await sleep(30);
      }
      out = {
        ok: true,
        enemy: {
          cls: el.className,
          parentCls: el.parentElement.className,
          animName: cs.animationName,
          animDur: cs.animationDuration,
          animPlayState: cs.animationPlayState,
          animDelay: cs.animationDelay,
          transformOrigin: cs.transformOrigin,
          inlineStyle: el.getAttribute('style') || '(无内联)',
          runningCount: anims.length,
          runningStates: anims.map((a) => a.playState),
          travel: +(topMax - topMin).toFixed(2),
          foot: +(botMax - botMin).toFixed(2),
          sxRange: +(sxMax - sxMin).toFixed(4),
        },
        player: pcs ? {
          animName: pcs.animationName,
          animDur: pcs.animationDuration,
          runningCount: panims.length,
        } : null,
      };
      return out;
    } catch (e) { return { ok: false, note: 'THROWN ' + (e && e.message || e) }; }
  });

  console.log('\n== 立绘 computed style（浏览器实际生效的值）==');
  if (!probe.ok) { console.log('  探测失败：' + probe.note); }
  else {
    console.log('  敌人 img class        = ' + probe.enemy.cls);
    console.log('  父元素 class          = ' + probe.enemy.parentCls);
    console.log('  animation-name        = ' + probe.enemy.animName);
    console.log('  animation-duration    = ' + probe.enemy.animDur);
    console.log('  animation-play-state  = ' + probe.enemy.animPlayState);
    console.log('  animation-delay       = ' + probe.enemy.animDelay);
    console.log('  transform-origin      = ' + probe.enemy.transformOrigin);
    console.log('  内联 style            = ' + probe.enemy.inlineStyle);
    console.log('  getAnimations() 数量  = ' + probe.enemy.runningCount +
                ' [' + probe.enemy.runningStates.join(',') + ']');
    console.log('  --- 900ms 实测 ---');
    console.log('  身体起伏（top 极差） = ' + probe.enemy.travel + 'px');
    console.log('  脚底位移              = ' + probe.enemy.foot + 'px');
    console.log('  横向 scaleX 摆幅      = ' + probe.enemy.sxRange);
    if (probe.player) console.log('  玩家 animation-name   = ' + probe.player.animName + ' (' + probe.player.runningCount + ' 条)');
  }

  console.log('\n== 页面错误 ==');
  console.log(errs.length ? errs.slice(0, 6).join('\n') : '  无');
  console.log('\n== 失败请求（≥400）==');
  console.log(fails.length ? fails.slice(0, 12).join('\n') : '  无');

  await p.screenshot({ path: SHOT });
  console.log('\n截图：' + SHOT);
  await b.close();
})();
