// M57 力量增强特效探针 —— feedback() 力量快照 diff → 红色气场 + 「力量 +N」飘字
// 无头恒 reduce：气场动画（媒体查询内）不播，但 is-strbuff 类由 JS 挂、
// 「+N」飘字（动画在媒体查询外，与 dmg-rise 同约定）照样出 —— 断言按此口径。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function chk(name, ok, actual) {
  if (ok) { pass++; console.log('  [ok] ' + name + (actual !== undefined ? '（' + actual + '）' : '')); }
  else { fail++; console.log('  [FAIL] ' + name + ' ← 实测 ' + actual); }
}

(async () => {
  // ── 静态 ──
  const artCss = fs.readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
  const rn = fs.readFileSync(path.join(BASE, 'js', 'ui', 'render.js'), 'utf8');
  console.log('== 静态 ==');
  chk('关键帧在媒体查询外（M24 约定，headless 可验）',
    /@keyframes str-glow/.test(artCss) && /@keyframes str-ring/.test(artCss));
  chk('应用规则在 no-preference 媒体块（装饰动画）',
    /\.unit-art\.is-strbuff\s*\{[^}]*str-glow/.test(artCss));
  chk('飘字样式 + 动画（媒体查询外，同 dmg-rise）',
    /\.str-float\s*\{/.test(artCss) && /@keyframes str-float-rise/.test(artCss));
  chk('触发挂钩已接线（_lastStr 快照 + strEffect）',
    /_lastStr/.test(rn) && /strEffect\(el, gained\)/.test(rn) &&
    /str: \(e\.buffs\.str \|\| 0\) \+ \(e\.buffs\.strTurn \|\| 0\)/.test(rn));

  // ── 真机 ──
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() =>
    [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20261014); App.showMap();
    Combat.start(20261014, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: 'M57 探针',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Combat.addEnemy('spore_walker');
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.resetFeedback(); Render.draw();   // 第一帧：只建快照
  });
  await p.waitForTimeout(400);

  console.log('\n== 真机 ==');
  chk('第一帧不飘（快照建立期无飘字）',
    (await p.evaluate(() => document.querySelectorAll('#view-combat .str-float').length)) === 0);

  // ── 玩家 +2：气场类 + 飘字「力量 +2」 ──
  await p.evaluate(() => {
    const s = Combat.state;
    s.player.buffs.str = (s.player.buffs.str || 0) + 2;
    Render.draw();
  });
  await p.waitForTimeout(200);
  let r = await p.evaluate(() => {
    const art = document.querySelector('#player-panel .unit .unit-art');
    const f = document.querySelector('#view-combat .str-float');
    return {
      cls: art.classList.contains('is-strbuff'),
      n: art.style.getPropertyValue('--str-n').trim(),
      text: f ? f.querySelector('b').textContent : null,
      label: f ? f.querySelector('i').textContent : null,
      floats: document.querySelectorAll('#view-combat .str-float').length
    };
  });
  chk('玩家气场类挂上（is-strbuff）', r.cls, r.cls);
  chk('力度变量 --str-n = 2', r.n === '2', r.n);
  chk('飘字「力量 +2」', r.text === '+2' && r.label === '力量', r.text + '/' + r.label);
  chk('飘字恰好 1 条', r.floats === 1, r.floats);

  // ── 敌人 +1：同时触发，各飘各的 ──
  await p.waitForTimeout(1100);   // 等上一条飘完，避免计数混叠
  await p.evaluate(() => {
    const s = Combat.state;
    s.enemies[0].buffs.str = (s.enemies[0].buffs.str || 0) + 1;
    Render.draw();
  });
  await p.waitForTimeout(200);
  r = await p.evaluate(() => {
    const floats = [].slice.call(document.querySelectorAll('#view-combat .str-float'));
    return {
      texts: floats.map((f) => f.querySelector('b').textContent),
      eCls: document.querySelector('.eunit[data-eidx="0"] .unit-art').classList.contains('is-strbuff')
    };
  });
  chk('敌人飘字「+1」', r.texts.indexOf('+1') >= 0, JSON.stringify(r.texts));
  chk('敌人气场类挂上', r.eCls, r.eCls);

  // ── 临时力量（strTurn）也算「力量增强」 ──
  await p.waitForTimeout(1100);
  await p.evaluate(() => {
    const s = Combat.state;
    s.player.buffs.strTurn = (s.player.buffs.strTurn || 0) + 2;
    Render.draw();
  });
  await p.waitForTimeout(200);
  r = await p.evaluate(() =>
    [].slice.call(document.querySelectorAll('#view-combat .str-float b')).map((x) => x.textContent));
  chk('临时力量 +2 同样触发（打的是 str+strTurn 之和）', r.indexOf('+2') >= 0, JSON.stringify(r));

  // ── 降幅静默：力量减少不飘、不挂类 ──
  await p.waitForTimeout(1100);
  await p.evaluate(() => {
    const s = Combat.state;
    s.player.buffs.str = Math.max(0, (s.player.buffs.str || 0) - 2);
    Render.draw();
  });
  await p.waitForTimeout(250);
  r = await p.evaluate(() => ({
    floats: document.querySelectorAll('#view-combat .str-float').length,
    cls: document.querySelector('#player-panel .unit .unit-art').classList.contains('is-strbuff')
  }));
  chk('力量减少静默（无飘字 / 无气场类）', r.floats === 0 && !r.cls, JSON.stringify(r));

  // ── 自动清理 ──
  await p.waitForTimeout(1200);
  chk('飘字自动移除',
    (await p.evaluate(() => document.querySelectorAll('#view-combat .str-float').length)) === 0);
  chk('气场类自动摘除',
    !(await p.evaluate(() =>
      document.querySelector('#player-panel .unit .unit-art').classList.contains('is-strbuff'))));

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM57 力量特效探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
