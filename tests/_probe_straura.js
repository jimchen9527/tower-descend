// M57 力量气场设计稿探针 —— 触发 / 飘字 / 力度缩放 / 连点重触发 / 自动清理
const path = require('path');
const { chromium } = require('playwright');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'file:///' + path.join(__dirname, '..', 'preview-str-aura.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function chk(name, ok, actual) {
  if (ok) { pass++; console.log('  [ok] ' + name + (actual !== undefined ? '（' + actual + '）' : '')); }
  else { fail++; console.log('  [FAIL] ' + name + ' ← 实测 ' + actual); }
}

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() =>
    [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 20000 });
  await p.waitForTimeout(300);

  // ── ① 敌人 +2：气场类 / 飘字 / 力度缩放 ──
  await p.click('.ctl button[data-side="e"][data-n="2"]');
  await p.waitForTimeout(220);   // 气场在 22% 关键帧附近 = 峰值
  const s1 = await p.evaluate(() => {
    const u = document.querySelector('#enemy-panel .eunit');
    const f = u.querySelector('.str-float');
    return {
      cls: u.classList.contains('is-strbuff'),
      n: u.querySelector('.unit-art').style.getPropertyValue('--str-n').trim(),
      floatText: f ? f.querySelector('b').textContent : null,
      floatSize: f ? getComputedStyle(f.querySelector('b')).fontSize : null,
      ring: !!u.querySelector('.unit-art'),
      chip: u.querySelector('.str-chip').textContent,
      chipShown: !u.querySelector('.str-chip').hidden
    };
  });
  chk('气场类挂上（is-strbuff）', s1.cls, s1.cls);
  chk('力度变量 --str-n = 2', s1.n === '2', s1.n);
  chk('飘字「+2」', s1.floatText === '+2', s1.floatText);
  chk('字号随力度涨（18+2×4=26px）', s1.floatSize === '26px', s1.floatSize);
  chk('计数小牌「力量 2」且常显', s1.chip === '力量 2' && s1.chipShown, s1.chip);
  await p.screenshot({ path: path.join(__dirname, 'm57-aura-enemy.png') });

  // ── ② 玩家 +3：字号更大 ──
  await p.click('.ctl button[data-side="p"][data-n="3"]');
  await p.waitForTimeout(220);
  const s2 = await p.evaluate(() => {
    const u = document.querySelector('#player-panel .unit');
    const f = u.querySelector('.str-float');
    return {
      cls: u.classList.contains('is-strbuff'),
      floatText: f ? f.querySelector('b').textContent : '+',
      floatSize: f ? getComputedStyle(f.querySelector('b')).fontSize : '0',
      chip: u.querySelector('.str-chip').textContent
    };
  });
  chk('玩家气场触发', s2.cls, s2.cls);
  chk('飘字「+3」且 30px', s2.floatText === '+3' && s2.floatSize === '30px',
    s2.floatText + ' / ' + s2.floatSize);
  chk('玩家计数「力量 3」', s2.chip === '力量 3', s2.chip);
  await p.screenshot({ path: path.join(__dirname, 'm57-aura-player.png') });

  // ── ③ 自动清理：1.2s 后气场类摘除、飘字移除 ──
  await p.waitForTimeout(1200);
  const s3 = await p.evaluate(() => ({
    eCls: document.querySelector('#enemy-panel .eunit').classList.contains('is-strbuff'),
    pCls: document.querySelector('#player-panel .unit').classList.contains('is-strbuff'),
    floats: document.querySelectorAll('.str-float').length
  }));
  chk('气场类自动摘除', !s3.eCls && !s3.pCls, JSON.stringify(s3));
  chk('飘字自动移除', s3.floats === 0, s3.floats);

  // ── ④ 连点重触发：摘除后立即可再播（不卡在「播过一次就没了」）──
  await p.click('.ctl button[data-side="e"][data-n="1"]');
  await p.waitForTimeout(1000);   // 等第一轮播完摘类
  await p.click('.ctl button[data-side="e"][data-n="1"]');
  await p.waitForTimeout(150);
  const s4 = await p.evaluate(() =>
    document.querySelector('#enemy-panel .eunit').classList.contains('is-strbuff'));
  chk('连点可重触发', s4, s4);
  const chipE = await p.evaluate(() =>
    document.querySelector('#enemy-panel .eunit .str-chip').textContent);
  chk('计数累加（+1+1+2 = 力量 4）', chipE === '力量 4', chipE);

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM57 力量气场探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
