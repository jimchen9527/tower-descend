// 复盘用截图走查：桌面 1440 + 手机 414 两档，覆盖主要观感面
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'review-m86');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [tag, vw, vh] of [['d', 1440, 900], ['m', 414, 896]]) {
    const p = await b.newPage({ viewport: { width: vw, height: vh } });
    p.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
    await p.goto(URL, { waitUntil: 'load' });
    await p.evaluate(() => { Progress.reset(); App.boot({ fresh: true }); });
    await p.waitForTimeout(600);
    const shot = async (name, wait) => {
      await p.waitForTimeout(wait || 400);
      await p.screenshot({ path: path.join(OUT, tag + '-' + name + '.png') });
    };

    // 1 主菜单
    await shot('menu');

    // 2 角色选择
    await p.evaluate(() => { App.menuPage('select'); });
    await shot('select');

    // 3 进局 → 地图
    await p.evaluate(() => { Run.start('act1', 20261017); App.showMap(); });
    await shot('map');

    // 4 图鉴（卡区）
    await p.evaluate(() => { App.showMenu('menu'); App.menuCodex(); });
    await shot('codex-cards');

    // 5 图鉴 · 遗物区
    await p.evaluate(() => {
      const el = document.querySelector('.codex-sec:nth-of-type(1)');
      if (el) el.scrollIntoView();
    });
    await shot('codex-relics', 300);

    // 6 战绩页
    await p.evaluate(() => { App._codexTab = 'stats'; App.renderCodex(); });
    await shot('stats');

    // 7 成就页
    await p.evaluate(() => { App._codexTab = 'ach'; App.renderCodex(); });
    await shot('ach');

    // 8 战斗（带手牌）
    await p.evaluate(() => {
      const edges = Run.current().edges;
      let bid = null;
      edges.forEach((id) => {
        const t = Run.state.map.nodes[id].type;
        if ((t === 'monster' || t === 'elite') && !bid) bid = id;
      });
      if (!bid) Object.keys(Run.state.map.nodes).forEach((id) => {
        const t = Run.state.map.nodes[id].type;
        if ((t === 'monster' || t === 'elite') && !bid) bid = id;
      });
      Run.state.currentId = bid; App.startBattle();
    });
    await shot('combat');

    // 9 战斗 · 出牌中（鼠标悬停一张牌的效果先不管，拍整场）
    await p.evaluate(() => { Combat.state.turn = 1; Render.draw(); });
    await shot('combat-playing');

    // 10 商店
    await p.evaluate(() => {
      const edges = Run.current().edges;
      let sid = null;
      edges.forEach((id) => { if (Run.state.map.nodes[id].type === 'shop' && !sid) sid = id; });
      if (!sid) Object.keys(Run.state.map.nodes).forEach((id) => {
        if (Run.state.map.nodes[id].type === 'shop' && !sid) sid = id;
      });
      Run.state.currentId = sid; App.showMap(); NodePanel.showShop();
    });
    await shot('shop');

    // 11 Boss 预告
    await p.evaluate(() => {
      let bid = null;
      Object.keys(Run.state.map.nodes).forEach((id) => {
        if (Run.state.map.nodes[id].type === 'boss' && !bid) bid = id;
      });
      Run.state.currentId = bid;
      const n = Run.current();
      n.enemyId = n.bossId;
      NodePanel.showBoss();
    });
    await shot('boss-preview');

    // 12 Boss 战利品 · 遗物三选一（M86 修复项，留证）
    await p.evaluate(() => {
      NodePanel.act('fightboss');
      Combat.state.enemy.hp = 0;
      Combat.state.phase = 'win';
      Render.draw();
      document.getElementById('result-next').click();
      NodePanel.act('bossskip');
    });
    await shot('boss-relic');

    await p.close();
  }
  await b.close();
  console.log('shots in ' + OUT);
})();
