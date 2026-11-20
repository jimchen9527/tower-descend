// M53c 复查：PC 端「红圈」到底还有没有 —— 选中 / 悬停 / 拖拽瞄准三态实拍
const path = require('path');
const { chromium } = require('playwright');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const arg = process.argv[2] || 'local';
const URL = arg === 'local'
  ? 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/')
  : arg;

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() =>
    [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20261012); App.showMap();
    Combat.start(20261012, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: '红圈复查',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Combat.addEnemy('spore_walker');
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await p.waitForTimeout(600);

  // ① 选中态（点敌人 = is-target）——先 hover 再点，模拟 PC 真实操作
  const e0 = await p.locator('.eunit[data-eidx="0"] .unit-art').boundingBox();
  await p.mouse.move(e0.x + e0.width / 2, e0.y + e0.height / 2);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, 'm53c-hover.png') });
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, 'm53c-selected.png') });

  // ② 拖拽瞄准态
  const card = await p.locator('#hand .card').nth(0).boundingBox();
  const e1 = await p.locator('.eunit[data-eidx="1"] .unit-art').boundingBox();
  await p.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await p.mouse.down();
  await p.mouse.move(e1.x + e1.width / 2, e1.y + e1.height / 2, { steps: 10 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, 'm53c-aiming.png') });
  await p.mouse.up();

  // ③ 把三张图里敌人区域的红色像素数出来（红圈=红色轮廓像素；金晕/HP条不算）
  const counts = await p.evaluate(() => ({}));
  console.log('截图已出：m53c-hover / m53c-selected / m53c-aiming');
  await b.close();
})();
