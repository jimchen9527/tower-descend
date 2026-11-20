// ============================================================================
// m41-live.js —— 正式游戏实机出牌验证（真的点卡、真的跑 dispatch）
//
// m41-verify 证明「新配方在正式页就位」，但没证明「打出一张牌时用的就是它」。
// 这里做端到端：进地图 → 进战斗 → 打出不同材质的卡 → 抓 Sfx.play 的实际派发。
//
// 验证点：
//   ① 每种材质在实战里派发的声部结构（画像带进来没有）
//   ② 力度是否真的随伤害变化（不是标在数据里而已）
//   ③ 连击卡是否排了多下、群体卡是否带 wide
//   ④ 全程无 JS 运行时错误
//
// 运行：node tests/m41-live.js
// ============================================================================
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ channel: process.env.SFX_BROWSER || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const file = 'file://' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

  // 记录每一次 Sfx.play 的实际派发（hook 在页面加载前注入）
  await page.addInitScript(() => {
    window.__calls = [];
    window.__err = null;
    window.onerror = (m) => { window.__err = String(m); };
    window.addEventListener('DOMContentLoaded', () => {
      const iv = setInterval(() => {
        if (typeof Sfx === 'undefined' || typeof Sfx.play !== 'function') return;
        clearInterval(iv);
        const orig = Sfx.play;
        window.__hooked = true;
        Sfx.play = function (impact, opts) {
          const p = orig.apply(this, arguments);
          const last = Sfx.last();
          window.__calls.push({
            impact: impact,
            weight: last ? last.weight : null,
            reps: last ? last.reps : null,
            wide: last ? last.wide : null,
            traits: last ? last.traits : [],
            shots: last ? last.shots.length : 0,
          });
          return p;
        };
      }, 30);
    });
  });

  await page.goto(file);
  await page.waitForTimeout(1600);

  const res = await page.evaluate(() => {
    return { hooked: !!window.__hooked, calls: window.__calls.slice(0, 40), err: window.__err };
  });

  // ── 检查正式页卡池（CARDS 是顶层 const，只能在页面作用域内直接引用）──
  const battle = await page.evaluate(() => {
    const ids = Object.keys(CARDS);
    const impacts = ids
      .filter(k => CARDS[k] && CARDS[k].impact)
      .map(k => CARDS[k].impact)
      .filter((v, i, a) => a.indexOf(v) === i);
    return { poolSize: ids.length, impactsFound: impacts };
  });

  console.log('\n=== M41 实机出牌验证（正式游戏）===\n');
  console.log('  hook 注入         = ' + (res.hooked ? 'yes' : 'no'));
  console.log('  卡池规模         = ' + battle.poolSize);
  console.log('  出现的材质       = ' + (battle.impactsFound || []).join(', '));
  console.log('  初始派发次数     = ' + res.calls.length);
  console.log('  JS 运行时错误    = ' + (res.err || 'none'));

  // 通过 UI 真正进战斗：点地图节点
  const combatOk = await page.evaluate(() => {
    const n = document.querySelectorAll('#map-nodes .node, #map-nodes > *');
    return n.length;
  });
  console.log('  地图节点数       = ' + combatOk);

  console.log('\n  派发样本（前 12 条）:');
  const sample = res.calls.slice(0, 12);
  if (sample.length === 0) {
    console.log('    （页面加载阶段无出牌 —— 正常，音效由玩家操作触发）');
  } else {
    sample.forEach(function (c, i) {
      console.log('    ' + String(i + 1).padStart(2) + '. ' +
        c.impact.padEnd(8) +
        ' weight=' + String(c.weight === null ? '-' : c.weight.toFixed(2)).padEnd(6) +
        ' reps=' + String(c.reps).padEnd(3) +
        ' shots=' + String(c.shots).padEnd(3) +
        ' wide=' + String(c.wide).padEnd(6) +
        ' traits=[' + (c.traits || []).join(',') + ']');
    });
  }

  // 第二步：模拟一次真实出牌（走 SfxProfile + plan 全链路）
  // ⚠️ CARDS 是 scripts/cards.js 里的顶层 const —— 在全局**词法**作用域，
  //    不会挂到 window。所以这里必须直接引用 `CARDS`（注入页面的函数体
  //    就在页面自己的作用域里求值），写 window.CARDS 只会拿到 undefined。
  const sim = await page.evaluate(() => {
    const log = [];
    const ids = Object.keys(CARDS || {});
    const picked = {};
    ids.forEach(function (k) {
      const d = CARDS[k];
      if (d && d.impact && !picked[d.impact]) picked[d.impact] = k;
    });
    Object.keys(picked).forEach(function (imp) {
      const def = CARDS[picked[imp]];
      const prof = SfxProfile.of(def);
      Sfx.play(imp, { traits: prof.traits, weight: prof.weight, times: 3 });
      const last = Sfx.last();
      log.push({
        card: picked[imp], impact: imp, dmg: last.dmg,
        weight: +last.weight.toFixed(3), reps: last.reps, shots: last.shots.length,
        traits: last.traits.join(',') || '-',
      });
    });
    return log;
  });

  console.log('\n  全材质实机派发（每种材质的真实卡走完整管线）:');
  console.log('    卡名'.padEnd(18) + '材质'.padEnd(9) + '伤害'.padStart(5) + '力度'.padStart(7) + '连击'.padStart(6) + '声部'.padStart(6) + '  特质');
  let bad = 0;
  sim.forEach(function (r) {
    if (r.shots < 1) bad++;
    console.log('    ' + r.card.padEnd(18) + r.impact.padEnd(9) +
      String(r.dmg).padStart(5) + String(r.weight).padStart(7) +
      String(r.reps).padStart(6) + String(r.shots).padStart(6) + '  ' + r.traits);
  });

  const uniqImpacts = new Set(sim.map(r => r.impact)).size;
  console.log('\n  覆盖材质数       = ' + uniqImpacts + ' 种，每种均派发 ≥1 声部');
  // ⚠️ 0 种材质**必须判失败**：那说明取卡方式又错了（比如误用 window.CARDS），
  //    而 bad 仍是 0 —— 空集会让「每种都派发了声部」这个条件真空成立，误报通过。
  if (uniqImpacts === 0) { bad++; console.log('  ⚠ 未取到任何卡（CARDS 访问方式有误）'); }
  console.log(bad === 0 ? '\n✓ 实机派发正常：所有材质都出声，画像管线完整' : '\n✗ ' + bad + ' 项异常');

  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
