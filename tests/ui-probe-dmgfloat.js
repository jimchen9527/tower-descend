// M71 伤害数字停留时长探针 —— 方案 B（1.8s 停一拍再散）
// 契约：飘字存活过 1.0s（旧版 0.9s 已消失的时间点）、2.1s 前移除、resetFeedback 清场。
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
  const artCss = fs.readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
  const rn = fs.readFileSync(path.join(BASE, 'js', 'ui', 'render.js'), 'utf8');
  console.log('== 静态 ==');
  chk('.dmg-float 动画时长 1.8s', /animation:\s*dmg-rise\s+1\.8s/.test(artCss));
  chk('关键帧含停留段（40% 全不透明）',
    /@keyframes dmg-rise[\s\S]*?40%\s*\{[^}]*opacity:\s*1/.test(artCss));
  chk('移除计时与动画同步（1850ms）', /t\.remove\(\); }, 1850\)/.test(rn));

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
    Run.start('act1', 20261018); App.showMap();
    Combat.start(20261018, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: 'M71 探针',
      deck: Run.state.deck, enemyId: 'rats'
    });
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await p.waitForTimeout(400);

  console.log('\n== 真机 ==');
  // 砸一发
  await p.evaluate(() => {
    Render.hitEffect(document.querySelector('#enemy-panel .eunit'), 9);
  });
  await p.waitForTimeout(150);
  chk('砸下即现（−9）',
    (await p.evaluate(() =>
      [].slice.call(document.querySelectorAll('#view-combat .dmg-float'))
        .some((f) => f.textContent === '−9'))));

  // 1.0s：还活着（旧版 0.9s 此时已消失 —— 本修复的核心验收点）
  await p.waitForTimeout(900);
  chk('1.0s 时仍在场（旧版这里已经没了）',
    (await p.evaluate(() => document.querySelectorAll('#view-combat .dmg-float').length)) > 0);

  // 2.2s：已移除
  await p.waitForTimeout(1200);
  chk('2.2s 前已移除',
    (await p.evaluate(() => document.querySelectorAll('#view-combat .dmg-float').length)) === 0);

  // resetFeedback 清场
  await p.evaluate(() => {
    Render.hitEffect(document.querySelector('#enemy-panel .eunit'), 5);
  });
  await p.waitForTimeout(150);
  await p.evaluate(() => { Render.resetFeedback(); });
  chk('resetFeedback 清掉残留飘字',
    (await p.evaluate(() => document.querySelectorAll('#view-combat .dmg-float').length)) === 0);

  console.log('\n== 伤害分层（M72）==');
  const tiers = [[5, 'tier-0', '24px'], [15, 'tier-1', '28px'], [25, 'tier-2', '32px'], [40, 'tier-3', '38px']];
  for (const [amt, cls, size] of tiers) {
    await p.evaluate((amt) => {
      Render.resetFeedback();
      Render.hitEffect(document.querySelector('#enemy-panel .eunit'), amt);
    }, amt);
    await p.waitForTimeout(150);
    const got = await p.evaluate(() => {
      const f = document.querySelector('#view-combat .dmg-float');
      return { cls: f.className, size: getComputedStyle(f).fontSize };
    });
    chk('伤害 ' + amt + ' → ' + cls + ' @ ' + size,
      got.cls.indexOf(cls) >= 0 && got.size === size, got.cls + ' / ' + got.size);
  }
  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM71 伤害数字探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
