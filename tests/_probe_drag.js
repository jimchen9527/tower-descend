// 设计稿交互探针：拖拽全链路（拿起 → 瞄准 → 投放 / 弹回）+ 截图
const path = require('path');
const { chromium } = require('playwright');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'file:///' + path.join(__dirname, '..', 'preview-drag-target.html').replace(/\\/g, '/');

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() =>
    [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0), { timeout: 20000 });
  await p.waitForTimeout(400);

  const hp = () => p.evaluate(() => [].slice.call(document.querySelectorAll('.eunit'))
    .map((u) => u.dataset.hp + '/' + u.dataset.max).join(' '));

  // ── ① 默认态（无红框） ──
  const ringDefault = await p.evaluate(() =>
    getComputedStyle(document.querySelector('.eunit.is-target'), '::before').content);
  console.log('① 默认 ::before content =', ringDefault, ringDefault === 'none' ? '(红框已关)' : '!! 红框还在');
  await p.screenshot({ path: path.join(__dirname, 'm53-drag-default.png') });

  // ── ② 拖到铁颚督军（eidx=2）：瞄准态截图 ──
  const card2 = await p.locator('.card[data-uid="c2"]').boundingBox();
  const bossArt = await p.locator('.eunit[data-eidx="2"] .unit-art').boundingBox();
  await p.mouse.move(card2.x + card2.width / 2, card2.y + card2.height / 2);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(
      card2.x + card2.width / 2 + (bossArt.x + bossArt.width / 2 - card2.x - card2.width / 2) * i / 12,
      card2.y + card2.height / 2 + (bossArt.y + bossArt.height / 2 - card2.y - card2.height / 2) * i / 12);
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(250);
  const aimState = await p.evaluate(() => ({
    aiming: document.getElementById('stage').classList.contains('is-aiming'),
    aim: (document.querySelector('.eunit.is-aim') || {}).dataset ? document.querySelector('.eunit.is-aim').dataset.eidx : null,
    lifted: document.querySelector('.card.is-lift') ? true : false,
    ghost: !!document.querySelector('.ghost'),
    ghostTransform: (document.querySelector('.ghost') || {}).style ? document.querySelector('.ghost').style.transform.slice(0, 60) : ''
  }));
  console.log('② 瞄准态 =', JSON.stringify(aimState));
  await p.screenshot({ path: path.join(__dirname, 'm53-drag-aiming.png') });

  // ── ③ 松手投放：命中 + 血条实降 ──
  await p.mouse.up();
  await p.waitForTimeout(500);
  console.log('③ 命中后 HP =', await hp(), '（应 33/45）', 'ghost 残留 =', await p.locator('.ghost').count());
  await p.screenshot({ path: path.join(__dirname, 'm53-drag-hit.png') });

  // ── ④ 拖到空处：弹回，卡不消耗 ──
  const card1 = await p.locator('.card[data-uid="c1"]').boundingBox();
  await p.mouse.move(card1.x + card1.width / 2, card1.y + card1.height / 2);
  await p.mouse.down();
  await p.mouse.move(200, 220, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(450);
  const back = await p.evaluate(() => ({
    ghost: document.querySelector('.ghost') ? document.querySelector('.ghost').className : null,
    lifted: document.querySelector('.card.is-lift') ? true : false,
    handCards: document.querySelectorAll('#hand .card').length
  }));
  console.log('④ 弹回 =', JSON.stringify(back));

  // ── ⑤ 点按出牌（不拖）：打当前目标（上次打到的 eidx=2）──
  const card3 = await p.locator('.card[data-uid="c3"]').boundingBox();
  await p.mouse.click(card3.x + card3.width / 2, card3.y + card3.height / 2);
  await p.waitForTimeout(500);
  console.log('⑤ 点按后 HP =', await hp(), '（dmg=0 技能卡：数值应不变，目标应保持 2）');

  // ── ⑥ 旧版红框对照开关 ──
  await p.check('#old-ring');
  await p.waitForTimeout(150);
  const ringOn = await p.evaluate(() =>
    getComputedStyle(document.querySelector('.eunit.is-target'), '::before').borderTopStyle);
  console.log('⑥ 勾选对照后 ::before border =', ringOn);
  await p.screenshot({ path: path.join(__dirname, 'm53-drag-oldring.png') });
  await p.uncheck('#old-ring');

  // ── ⑦ AOE：灰烬风暴拖到任意敌人 → 全体掉血 ──
  const card4 = await p.locator('.card[data-uid="c4"]').boundingBox();
  const ratArt = await p.locator('.eunit[data-eidx="0"] .unit-art').boundingBox();
  await p.mouse.move(card4.x + card4.width / 2, card4.y + card4.height / 2);
  await p.mouse.down();
  await p.mouse.move(ratArt.x + ratArt.width / 2, ratArt.y + ratArt.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  console.log('⑦ AOE 后 HP =', await hp());

  console.log('\n页面错误：', errs.length ? errs.join(' | ') : '无');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
