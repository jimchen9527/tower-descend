// 玩法盘点截图（诊断用）：按真实入口走一遍主要界面，两档视口。
// 用法：node tests/_audit-shots.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'review-audit');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const SEED = 20261119;

async function setup(p) {
  await p.goto(URL, { waitUntil: 'load' });
  await p.evaluate(() => { Progress.reset(); });
  // 三角色全解锁（DL4 起），便于看满编内容
  await p.evaluate(() => {
    ['digger', 'medic', 'keeper'].forEach((c) => Progress.setDl(c, 4));
  });
  await p.evaluate(() => App.boot({ menu: true }));
  await p.waitForTimeout(400);
}

async function enterMap(p, dl) {
  await p.evaluate((dlv) => {
    Run.start('act1', 20261119, 'digger', dlv);
    Run.state.gold = 210; Run.state.hp = 52; Run.state.maxHp = 78;
    Run.state.relics = ['shaft_pendant', 'brass_gear'];
    Run.state.potions = ['poultice', 'quickplate'];
    document.getElementById('view-menu').hidden = true;
    document.querySelector('.topbar').hidden = false;
    App.showMap();
  }, dl);
  await p.waitForTimeout(400);
}

async function enterBattle(p, wantElite) {
  await p.evaluate((elite) => {
    const nodes = Run.state.map.nodes;
    const cur = Run.current();
    let id = null;
    cur.edges.forEach((n) => {
      const t = nodes[n].type;
      if ((elite ? t === 'elite' : t === 'monster') && !id) id = n;
    });
    if (!id) Object.keys(nodes).forEach((n) => {
      const t = nodes[n].type;
      if ((elite ? t === 'elite' : t === 'monster') && !id && nodes[n].depth > 3) id = n;
    });
    Run.state.currentId = id;
    Run.state.cleared[id] = 'entry';
    App.startBattle();
  }, wantElite);
  await p.waitForTimeout(700);
}

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [tag, vw, vh] of [['d', 1440, 900], ['m', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
    await setup(p);
    const shot = async (name, wait) => {
      await p.waitForTimeout(wait || 350);
      await p.screenshot({ path: path.join(OUT, tag + '-' + name + '.png') });
    };

    // 主菜单
    await shot('menu');
    // 角色选择（走真实入口：会渲染三张角色卡 + DL 排）
    await p.evaluate(() => App.menuShowSelect());
    await shot('select');
    // 设置
    await p.evaluate(() => App.menuPage('settings'));
    await shot('settings');
    // 图鉴三页
    await p.evaluate(() => App.menuCodex());
    await shot('codex');
    await p.evaluate(() => { App._codexTab = 'stats'; App.renderCodex(); });
    await shot('stats');
    await p.evaluate(() => { App._codexTab = 'ach'; App.renderCodex(); });
    await shot('ach');
    // 地图（DL4，中段）
    await p.evaluate(() => App.menuPage('main'));
    await enterMap(p, 4);
    await shot('map');
    // 当前节点在最右列时，地图会不会自动横向跟随？（手机上 772 > 视口宽）
    await p.evaluate(() => {
      let pick = null;
      Object.keys(Run.state.map.nodes).forEach((id) => {
        const n = Run.state.map.nodes[id];
        if (n.col >= 7 && n.depth >= 3 && n.depth <= 8 && !pick) pick = id;
      });
      if (pick) {
        Run.state.currentId = pick;
        Run.state.cleared[pick] = 'entry';
        App.showMap();
      }
    });
    await shot('map-right');
    // 战斗
    await enterBattle(p, false);
    await shot('combat');
    // 去掉教学浮条后的首屏（看手牌折叠与结束回合按钮的真实关系）
    await p.evaluate(() => { document.getElementById('tipbar').hidden = true; });
    await shot('combat-clean');
    // 战斗中段（打一张牌）
    await p.evaluate(() => {
      const i = Combat.state.hand.findIndex((c) => Combat.canPlay(c));
      if (i >= 0) Combat.playCard(Combat.state.hand[i].uid);
      Render.draw();
    });
    await shot('combat-played');
    // 精英战（多敌/词缀）
    await p.evaluate(() => App.showMap());
    await enterBattle(p, true);
    await shot('combat-elite');
    // 商店
    await p.evaluate(() => {
      App.showMap();
      const nodes = Run.state.map.nodes;
      let id = null;
      Object.keys(nodes).forEach((n) => { if (nodes[n].type === 'shop' && !id) id = n; });
      Run.state.currentId = id; Run.state.cleared[id] = 'entry';
      Run.state.shop = Run.rollShop();
      NodePanel.showShop();
    });
    await shot('shop');
    // 事件
    await p.evaluate(() => {
      NodePanel.hide();
      const nodes = Run.state.map.nodes;
      let id = null;
      Object.keys(nodes).forEach((n) => { if (nodes[n].type === 'event' && !id) id = n; });
      Run.state.currentId = id;
      NodePanel.showEvent();
    });
    await shot('event');
    // 休息点
    await p.evaluate(() => {
      NodePanel.hide();
      const nodes = Run.state.map.nodes;
      let id = null;
      Object.keys(nodes).forEach((n) => { if (nodes[n].type === 'rest' && !id) id = n; });
      Run.state.currentId = id;
      NodePanel.showRest();
    });
    await shot('rest');
    // 胜利结算面板
    await p.evaluate(() => {
      NodePanel.hide();
      const nodes = Run.state.map.nodes;
      let id = null;
      Object.keys(nodes).forEach((n) => { if (nodes[n].type === 'monster' && !id && nodes[n].depth > 2) id = n; });
      Run.state.currentId = id; Run.state.cleared[id] = 'entry';
      App.startBattle();
      Combat.state.phase = 'win';
      Combat.state.enemies.forEach((e) => { e.hp = 0; });
      Render.draw();
      App.afterBattle();
    });
    await shot('reward');

    await p.close();
  }
  await b.close();
  console.log('shots in ' + OUT);
})();
