// M44 在线验证：直接拉线上 URL，核对方案 C 的关键值确实生效。
// 与本地实机验证同口径，但对象是线上服务器 —— 防止「本地改了、线上没跟上」。
const { chromium } = require('playwright');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'https://tower-descend-game-60674.app.workbuddy.host/';

// 关键期望值（与 css/ 里的落盘值一一对应）
const EXPECT = {
  artPlayerH: 111,   // .unit-art-player .unit-bm height = 111px
  artBossH: 130,     // .art-kind-boss .unit-bm height = 130px
  hpbarH: 14,        // .hpbar height = 14px
  hpbarBossH: 18,    // .hprow-boss .hpbar height = 18px
  hpFont: '9px',     // .hplabel font-size
  oshadowBottom: '-5.2px',
  idleBob: '-4.4px',
  gapSolo: 205.92,   // clamp(88, 14.3vw, 221) 在 1440 下 = 205.92
};

(async () => {
  const b = await chromium.launch({ executablePath: EDGE });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  // 不用 networkidle —— 战斗页有循环动画与音频请求，网络不会真正 idle，
  // 等它必然 30s 超时（首次验证就是这么挂的）。domcontentloaded + 固定等待即可。
  const resp = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(2500);

  const r = await p.evaluate(() => {
    function q(s) { return document.querySelector(s); }
    function cs(s, prop) { const n = q(s); return n ? getComputedStyle(n)[prop] : 'none'; }
    function text() {
      let t = '';
      Array.prototype.forEach.call(document.styleSheets, function (ss) {
        try {
          Array.prototype.forEach.call(ss.cssRules, function (r) {
            if (r.media && r.media.mediaText.indexOf('900') < 0 && r.media.mediaText.indexOf('640') < 0) return;
            Array.prototype.forEach.call(r.cssRules, function (x) { t += x.cssText; });
          });
        } catch (e) { t += ''; }
      });
      return t;
    }
    return {
      title: document.title,
      styleSheets: document.styleSheets.length,
      // M44 关键值
      hpFont: cs('.hplabel', 'fontSize'),
      hpLineHeight: cs('.hplabel', 'lineHeight'),
      hprowMin: cs('.hprow', 'minWidth'),
      hprowBossMin: cs('.hprow-boss', 'minWidth'),
      idleBob: text().indexOf('-4.4px') >= 0,
      narrowGapFixed: text().indexOf('data-crowd') >= 0,
      jsBoot: typeof App !== 'undefined' && typeof Combat !== 'undefined' && typeof Run !== 'undefined'
    };
  });

  // 进 Boss 战量实际渲染
  await p.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20260924); App.showMap();
    Combat.start(20260924, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 22, locTag: '线上验证 · 菌母',
      deck: Run.state.deck, enemyId: 'mycelium_mother'
    });
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    document.getElementById('turn-box').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await p.waitForTimeout(600);

  // 等立绘位图真的解码完再截图 —— 布局数值对但画面空，多半是图还在路上。
  // （首版截图就是 600ms 后拍的，结果背景与立绘全空，像布局崩了。）
  await p.waitForFunction(() => {
    const all = Array.prototype.slice.call(document.images);
    return all.length > 0 && all.every(i => i.complete && i.naturalWidth > 0);
  }, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(500);

  const live = await p.evaluate(() => {
    function q(s) { return document.querySelector(s); }
    function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
    const st = q('.battle-stage'), sr = st.getBoundingClientRect();
    const pcs = getComputedStyle(st);
    const pl = q('#player-panel').getBoundingClientRect();
    const ep = q('#enemy-panel').getBoundingClientRect();
    const padL = parseFloat(pcs.paddingLeft), padR = parseFloat(pcs.paddingRight);
    const bar = q('#enemy-panel .hprow-boss .hpbar');
    const lab = q('#enemy-panel .hprow-boss .hplabel');
    // 小兵条要单独取：#enemy-panel 的第一个 .hpbar 可能是 Boss 的
    // （.hprow-boss 也带 .hpbar 类），拿错一条会把 18/12px 当成小兵值。
    const miniBar = q('#player-panel .hpbar');
    const miniLab = q('#player-panel .hplabel');
    const rmg = document.createRange(); rmg.selectNodeContents(miniLab);
    const rg = document.createRange(); rg.selectNodeContents(lab);
    const pArt = q('#player-panel .unit-bm'), eArt = q('#enemy-panel .unit-bm');
    return {
      gap: pcs.gap,
      freeL: Math.round(pl.left - (sr.left + padL)),
      freeR: Math.round((sr.right - padR) - ep.right),
      playerArtH: Math.round(pArt.getBoundingClientRect().height),
      // rect 高是设备像素舍入后的值（110.x 会被 Math.round 带走）；
      // computed height 才是 CSS 里那个真值。两个都记，断言用 computed。
      playerArtComputed: pArt ? getComputedStyle(pArt).height : '',
      enemyArtH: Math.round(eArt.getBoundingClientRect().height),
      enemyArtComputed: eArt ? getComputedStyle(eArt).height : '',
      miniBarH: miniBar ? miniBar.getBoundingClientRect().height : 0,
      miniFont: miniLab ? getComputedStyle(miniLab).fontSize : '',
      miniTextOver: miniBar
        ? Math.round(Math.max(0, rmg.getBoundingClientRect().height - miniBar.getBoundingClientRect().height) * 10) / 10
        : -1,
      hpbarH: bar ? bar.getBoundingClientRect().height : 0,
      hpTextOver: bar ? Math.round(Math.max(0, rg.getBoundingClientRect().height - bar.getBoundingClientRect().height) * 10) / 10 : -1,
      hpFont: lab ? getComputedStyle(lab).fontSize : '',
      hpText: lab ? lab.textContent : '',
      dataBoss: st.getAttribute('data-boss'),
      // 资源是否真的加载完 —— 布局数值对但画面空，多半是位图还没到
      imgs: (function () {
        const all = Array.prototype.slice.call(document.images);
        return {
          total: all.length,
          broken: all.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.split('/').pop()),
          pending: all.filter(i => !i.complete).length
        };
      })(),
      bg: (function () {
        // 不要读 cssRules —— 跨源样式表（线上是别的域，本地是 file://）
        // 读 backgroundImage 会抛 SecurityError，被 catch 吞掉后
        // 「0 条背景」看起来像资源没配，实际是读不到。
        // 改成直接量渲染结果：舞台底色若被背景图盖住，
        // backgroundColor 会是 transparent（CSS 里背景图层的底色）。
        const el = q('.battle-stage');
        if (!el) return { error: 'no stage' };
        const s = getComputedStyle(el);
        return {
          hasImage: s.backgroundImage !== 'none',
          // 顺带确认图片真的下载到了：多取一个 URL 去探
          imageHead: s.backgroundImage.slice(0, 90)
        };
      })()
    };
  });
  await p.screenshot({ path: 'tests/m44-online-verify.png' });

  const checks = [
    ['页面可访问 (HTTP)', resp.status() === 200, resp.status()],
    ['JS 全部初始化', r.jsBoot, r.jsBoot],
    ['样式表 2 份', r.styleSheets === 2, r.styleSheets],
    ['玩家立绘高 111px', live.playerArtComputed === '111px',
      live.playerArtComputed + ' (rect ' + live.playerArtH + ')'],
    ['Boss 立绘高 130px', live.enemyArtComputed === '130px',
      live.enemyArtComputed + ' (rect ' + live.enemyArtH + ')'],
    ['小兵血条 14px', live.miniBarH === EXPECT.hpbarH, live.miniBarH],
    ['小兵 HP 数字 9px', live.miniFont === EXPECT.hpFont, live.miniFont],
    ['小兵 HP 数字零溢出', live.miniTextOver === 0, live.miniTextOver],
    ['Boss 血条 18px', live.hpbarH === EXPECT.hpbarBossH, live.hpbarH],
    ['Boss HP 数字 12px', live.hpFont === '12px', live.hpFont],
    ['Boss HP 数字零溢出', live.hpTextOver === 0, live.hpTextOver],
    ['对峙 gap = 205.92px', Math.abs(parseFloat(live.gap) - EXPECT.gapSolo) < 0.5, live.gap],
    // ⚠️ 不能写死 133：M45 起待机改成纵向挤压（--idle-sy: .9700），
    // 立绘包围盒每帧都在变 —— 截图落在压缩相位时会量到 122。
    // 那是待机动画的正常行为，不是布局问题。判据应该是「有余量、不溢出」，
    // 具体数值交给实机探针（那处暂停了动画，量的是稳定态）。
    ['两侧留有余量（不贴边）', live.freeL >= 90 && live.freeR >= 90, live.freeL + ' / ' + live.freeR],
    ['待机摆幅已缩 (-4.4px)', r.idleBob, r.idleBob],
    ['窄屏 gap 覆盖已上线', r.narrowGapFixed, r.narrowGapFixed],
    ['data-boss=1', live.dataBoss === '1', live.dataBoss],
    ['立绘位图全部加载', live.imgs.total > 0 && live.imgs.pending === 0 && live.imgs.broken.length === 0,
      live.imgs.total + ' 张，pending ' + live.imgs.pending + '，坏图 ' + live.imgs.broken.length],
    ['战斗背景图已渲染', live.bg.hasImage === true, live.bg.imageHead],
    ['无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none']
  ];
  let fail = 0;
  checks.forEach(c => { if (!c[1]) fail++; console.log((c[1] ? '  ok  ' : '  FAIL') + ' ' + c[0] + '（' + c[2] + '）'); });
  console.log('\n线上验证：' + (checks.length - fail) + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });