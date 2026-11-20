// M65 卡片尺寸统一探针 —— 卡片库 / 商店 / 选卡界面里所有 .npc 卡同宽同高
// 背景：.npc 原是 min-height，文本行数决定高度（实测 192/201/220/239 四档参差）。
// M65 改定高 240（实测三角色全卡池最大 239 + 遗物最大 192）。
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
  const css = require('fs').readFileSync(path.join(BASE, 'css', 'style.css'), 'utf8');
  const artCss = require('fs').readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
  console.log('== 静态 ==');
  chk('.npc 定高 240（替换 min-height）',
    /\.npc\s*\{[^}]*height:\s*240px/.test(css) && !/\.npc\s*\{[^}]*min-height/.test(css));
  chk('art.css 旧 min-height 覆盖已退役', !/\.npc\s*\{\s*min-height/.test(artCss));

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
    Run.start('act1', 20261017); App.showMap();
    // 卡组故意混装「最短文本」与「最长文本」的卡 —— 修复前这两档高度差 47px
    Run.state.deck = [mkCard('strike'), mkCard('crowbar'), mkCard('defend'), mkCard('hardhat')];
    NodePanel.showShop();
  });
  await p.waitForTimeout(500);

  // 尺寸量取：一组 .npc 的宽高是否完全一致
  const measure = (sel) => p.evaluate((sel) => {
    const cards = [].slice.call(document.querySelectorAll(sel + ' .npc'));
    const ws = cards.map((c) => Math.round(c.getBoundingClientRect().width));
    const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    return {
      n: cards.length,
      wEqual: ws.every((w) => Math.abs(w - ws[0]) <= 1),
      hEqual: hs.every((h) => Math.abs(h - hs[0]) <= 1),
      w: ws[0], h: hs[0]
    };
  }, sel);

  console.log('\n== 商店 ==');
  let m = await measure('.np-cards');
  chk('商店卡 ' + m.n + ' 张同宽', m.n > 0 && m.wEqual, 'w=' + m.w);
  chk('商店卡同高（240）', m.n > 0 && m.hEqual && m.h === 240, 'h=' + m.h);

  console.log('\n== 卡片库（混装长短文本卡）==');
  await p.click('.np-lib-btn');
  await p.waitForTimeout(250);
  m = await measure('.np-lib');
  chk('卡片库卡同宽', m.n >= 4 && m.wEqual, 'n=' + m.n + ' w=' + m.w);
  chk('卡片库卡同高（240）', m.n >= 4 && m.hEqual && m.h === 240, 'h=' + m.h);
  await p.click('.np-lib-bar [data-act="libclose"]');
  await p.waitForTimeout(200);

  console.log('\n== 战斗奖励选卡 ==');
  await p.evaluate(() => { NodePanel.showReward(Run.current()); });
  await p.waitForTimeout(300);
  m = await measure('.np-cards');
  chk('奖励选卡同宽同高', m.n > 0 && m.wEqual && m.hEqual && m.h === 240,
    'n=' + m.n + ' ' + m.w + 'x' + m.h);

  console.log('\n== 休息点升级列表（deckPicker 同壳）==');
  await p.evaluate(() => { NodePanel.hide(); NodePanel.showRest(); NodePanel.act('restupgrade'); });
  await p.waitForTimeout(300);
  m = await measure('.np-cards');
  chk('升级选卡同宽同高', m.n > 0 && m.wEqual && m.hEqual && m.h === 240,
    'n=' + m.n + ' ' + m.w + 'x' + m.h);

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  // ── M66：手机端（390）手牌溢出适配 —— 修复前 4 张牌就超宽、第 4 张被裁半张 ──
  console.log('\n== 手机端 390 手牌适配 ==');
  const pm = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const merrs = [];
  pm.on('pageerror', (e) => merrs.push(String(e)));
  await pm.goto(URL, { waitUntil: 'load' });
  await pm.waitForTimeout(700);
  await pm.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20261017); App.showMap();
    // 6 张：修复前 scrollWidth 588 > 374，右侧两张被裁
    Run.state.deck = [mkCard('strike'), mkCard('defend'), mkCard('crowbar'),
      mkCard('hardhat'), mkCard('ballast'), mkCard('blast_charge')];
    Combat.start(20261017, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: 'M66 手机',
      deck: Run.state.deck, enemyId: 'rats'
    });
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await pm.waitForTimeout(500);
  const mh = await pm.evaluate(() => {
    const hand = document.getElementById('hand');
    const cards = [].slice.call(hand.querySelectorAll('.card'));
    const ws = cards.map((c) => Math.round(c.getBoundingClientRect().width));
    const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    const rights = cards.map((c) => Math.round(c.getBoundingClientRect().right));
    const panelR = Math.round(document.querySelector('#view-combat').getBoundingClientRect().right);
    return {
      ws, hs, rights, panelR,
      uniformW: ws.every((w) => Math.abs(w - ws[0]) <= 1),
      uniformH: hs.every((h) => Math.abs(h - hs[0]) <= 1),
      allInside: rights.every((r) => r <= panelR + 1),
      scale: hand.style.transform || 'none'
    };
  });
  chk('6 张手牌全部等宽等高（整排缩放）',
    mh.uniformW && mh.uniformH, JSON.stringify(mh.ws) + ' / ' + JSON.stringify(mh.hs));
  chk('没有牌被屏幕右缘裁掉', mh.allInside,
    'maxRight=' + Math.max.apply(null, mh.rights) + ' panelR=' + mh.panelR);
  chk('缩放已生效（transform scale）', mh.scale.indexOf('scale') >= 0, mh.scale);
  await pm.screenshot({ path: path.join(__dirname, 'm66-hand-mobile.png') });
  chk('手机端无 JS 运行时错误', merrs.length === 0, merrs.length ? merrs[0] : 'none');
  await pm.close();

  await b.close();
  console.log('\nM65 卡片尺寸探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
