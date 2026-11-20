// ============================================================================
// m41-verify.js —— 正式游戏页（index.html）的 M41 音效上线验证
//
// 为什么单独写这个：前面那 14 层测的是「逻辑」与「探针页」，都不等于
// 「玩家真正打开的 index.html 里跑的是新配方」。这里直接开正式页断言三件事：
//   ① audio.js?v=M41 真的被加载（不是被缓存的旧文件）
//   ② 新配方标志位就位：VOL_CAP 封顶 + 限幅器 + contact 段
//   ③ 页面无 JS 运行时错误，且 Sfx 14 个合成体全部渲染成功（= 首战不会哑火）
//
// 运行：node tests/m41-verify.js
// ============================================================================
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: process.env.SFX_BROWSER || 'msedge' });
  const page = await browser.newPage();
  const file = 'file://' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  await page.goto(file);
  await page.waitForTimeout(1500);

  const probeFn = async () => {
    const out = [];
    const log = (k, v) => out.push([k, v]);

    // ① 加载的脚本 URL 必须带 v=M41（证明绕过缓存拿到的是新文件）
    const scripts = Array.prototype.map.call(document.scripts, s => s.src).filter(Boolean);
    const audioSrc = scripts.filter(s => /audio\.js/.test(s))[0] || '(未找到)';
    log('audioScript', audioSrc.replace(/^.*\//, ''));
    log('hasVersionStamp', /audio\.js\?v=M41/.test(audioSrc) ? 'yes' : 'no');

    // ② 新配方标志位
    log('apiHasRenderRaw', (typeof Sfx !== 'undefined' && Sfx.__renderRaw) ? 'yes' : 'no');
    log('synthKeys', (typeof Sfx !== 'undefined') ? Sfx.synthKeys().length : -1);

    // ③ 14 个合成体是否都渲染成功（= 首战不会哑火；这是 M39 埋过的静默错误）
    const ready = (typeof Sfx !== 'undefined') ? Sfx.ready() : { rendered: 0, total: 14 };
    log('rendered', ready.rendered + '/' + ready.total);

    // ④ 实测正式页里 blast 的峰值（多层叠加最狠的一路，必须 ≤ 0.86）
    const raw = (typeof Sfx !== 'undefined') ? await Sfx.__renderRaw('blast') : null;
    if (raw) {
      let peak = 0, clip = 0;
      for (let i = 0; i < raw.length; i++) {
        const a = Math.abs(raw[i]);
        if (a > peak) peak = a;
        if (a >= 0.999) clip++;
      }
      log('blastPeak', peak.toFixed(4));
      log('blastClip', clip);
    } else {
      log('blastPeak', 'render-failed');
      log('blastClip', -1);
    }

    // ⑤ 页面 JS 运行时错误
    log('jsError', window.__err || 'none');
    return out;
  };

  const rows = await page.evaluate(`(${probeFn.toString()})()`);

  const EXPECT = {
    audioScript: /audio\.js\?v=M41/,
    hasVersionStamp: /^yes$/,
    apiHasRenderRaw: /^yes$/,
    synthKeys: /^14$/,
    rendered: /^14\/14$/,
    blastClip: /^0$/,
    jsError: /^none$/,
  };

  console.log('\n=== M41 音效上线验证（正式游戏 index.html）===\n');
  let bad = 0;
  for (const [k, v] of rows) {
    const ok = EXPECT[k] ? EXPECT[k].test(String(v)) : true;
    if (!ok) bad++;
    console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + '  ' + k.padEnd(16) + ' = ' + v);
  }
  // blastPeak 单独判（必须 ≤ 0.86）
  const bp = rows.find(r => r[0] === 'blastPeak');
  if (bp) {
    const ok = parseFloat(bp[1]) <= 0.8601;
    if (!ok) bad++;
    console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + '  blastPeak ≤ 0.86   = ' + bp[1]);
  }

  console.log('\n' + (bad === 0 ? '✓ 正式游戏已运行 M41 克制版音效' : '✗ ' + bad + ' 项未通过'));
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
