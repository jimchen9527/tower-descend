// M89 批次回归探针：意图显示 / 新局确认 / 重打按钮 dev 化 / 休息点文案。
// 用法：node tests/_probe-m89.js
const path = require('path');
const { chromium } = require('playwright');
const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const out = {};
  await p.goto(URL, { waitUntil: 'load' });
  await p.evaluate(() => { Progress.reset(); App.boot({ fresh: true }); });

  // 1) 重打按钮默认隐藏
  out.restartHidden = await p.evaluate(() => document.getElementById('restart').hidden);

  // 2) 意图显示在 DL10 必须是缩放后的值（12 × 2.35 = 28）
  out.intentText = await p.evaluate(() => {
    Run.start('act1', 1, 'digger', 10);
    const id = Object.keys(Run.state.map.nodes).find((n) => Run.state.map.nodes[n].type === 'monster');
    Run.state.currentId = id; Run.state.cleared[id] = 'entry';
    App.startBattle();
    const e = Combat.state.enemies[0];
    e.intent = { kind: 'attack', value: 12 };
    Render.draw();
    return document.querySelector('#enemy-panel .intent').textContent.trim();
  });

  // 3) 休息点教程文案（不能再写“提升最大生命”）
  await p.evaluate(() => { App.showMap(); App._tips = []; App.tipNext(); });
  await p.waitForTimeout(120);
  out.restTip = await p.evaluate(() => {
    Run.state.currentId = Object.keys(Run.state.map.nodes).find((n) => Run.state.map.nodes[n].type === 'rest');
    NodePanel.showRest();
    return document.getElementById('tipbar-text').textContent;
  });

  // 4) Boss 预告也按 DL 缩放（DL10 锈冠 517 血 / 攻击 28）
  out.bossPreview = await p.evaluate(() => {
    NodePanel.hide();
    Run.start('act1', 1, 'digger', 10);
    const id = Object.keys(Run.state.map.nodes).find((n) => Run.state.map.nodes[n].type === 'boss');
    Run.state.currentId = id;
    Run.state.relics = ['ember_reader'];
    NodePanel.showBoss();
    const stats = document.querySelector('.np-bossstats').textContent.replace(/\s+/g, ' ').trim();
    const fc = document.querySelector('.np-forecast');
    return { stats: stats, forecast: fc ? fc.textContent.replace(/\s+/g, ' ').trim() : '' };
  });

  // 5) 新局确认：取消不动、确认重开
  await p.evaluate(() => {
    const id = Object.keys(Run.state.map.nodes).find((n) => Run.state.map.nodes[n].depth >= 3);
    Run.state.currentId = id; App.showMap();
    window.__asked = 0; window.confirm = function () { window.__asked++; return false; };
  });
  out.beforeDepth = await p.evaluate(() => Run.current().depth);
  await p.click('#new-run');
  await p.waitForTimeout(150);
  out.cancelledDepth = await p.evaluate(() => Run.current().depth);
  await p.evaluate(() => { window.confirm = function () { window.__asked++; return true; }; });
  await p.click('#new-run');
  await p.waitForTimeout(400);
  out.confirmedDepth = await p.evaluate(() => Run.current().depth);

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
