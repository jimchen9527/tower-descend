// M54 卡片库探针 —— 节点面板（商店 / 战斗奖励等）的「我的卡片库」查询层
// M54b：只显示本次游戏已经获得的卡（全池 + 未拥有灰标 + 过滤按钮均已退役）。
// 卡组用 mkCard 钉死，不依赖随机；断言查询层的开合、去重计数与徽标。
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
  const rn = require('fs').readFileSync(path.join(BASE, 'js', 'ui', 'render-node.js'), 'utf8');
  const css = require('fs').readFileSync(path.join(BASE, 'css', 'style.css'), 'utf8');
  console.log('== 静态 ==');
  chk('卡片库入口在共用头部（奖励/商店等都有）',
    /np-lib-btn/.test(rn) && /data-act="cardlib"/.test(rn));
  chk('查询层已接线（libHtml + paint 拼接）',
    /libHtml\(\)/.test(rn) && /this\.libHtml\(\)/.test(rn));
  // M54b：全池 / 未拥有 / 过滤按钮全部退役
  chk('M54b 改版已落（只显示已获得）',
    !/libOwnedOnly/.test(rn) && !/np-own-no/.test(rn) && !/data-act="libfilter"/.test(rn));
  chk('样式已落（.np-lib / 徽标 / 绿描边）',
    /\.np-lib\s*\{/.test(css) && /\.np-ownbadge/.test(css) && /is-owned \.npc/.test(css));

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
    Run.start('act1', 20261012); App.showMap();
    NodePanel.showShop();
  });
  await p.waitForTimeout(400);

  console.log('\n== 商店面板 ==');
  chk('面板头部有「我的卡片库」按钮',
    (await p.locator('.np-lib-btn').count()) === 1);

  // 空卡组：提示语
  await p.evaluate(() => { Run.state.deck = []; NodePanel.act('cardlib'); });
  await p.waitForTimeout(200);
  chk('空卡组显示引导语',
    (await p.evaluate(() => (document.querySelector('.np-lib .np-empty') || {}).textContent)) ===
    '本次游戏还没有获得卡。');

  // 钉死卡组：打击×1 + 防御×2 → 2 种 / 3 张
  await p.evaluate(() => {
    Run.state.deck = [mkCard('strike'), mkCard('defend'), mkCard('defend')];
    NodePanel.act('cardlib');   // 已开着 → paint 刷新
  });
  await p.waitForTimeout(200);
  let lib = await p.evaluate(() => ({
    head: (document.querySelector('.np-lib-bar .np-h') || {}).textContent || '',
    items: document.querySelectorAll('.np-lib .np-shopitem').length,
    owned: document.querySelectorAll('.np-lib .np-shopitem.is-owned').length,
    badges: [].slice.call(document.querySelectorAll('.np-lib .np-ownbadge')).map((b) => b.textContent),
    green: !!document.querySelector('.np-lib .np-shopitem.is-owned .npc'),
    filterBtn: document.querySelectorAll('.np-lib [data-act="libfilter"]').length
  }));
  chk('计数「2 种 / 3 张」（去重 + 总 copies）', lib.head === '我的卡片库 · 2 种 / 3 张', lib.head);
  chk('只出现已获得的 2 张（全 is-owned）', lib.items === 2 && lib.owned === 2,
    JSON.stringify(lib));
  chk('防御 ×2 徽标', lib.badges.indexOf('卡组 ×2') >= 0, JSON.stringify(lib.badges));
  chk('绿描边在场', lib.green, lib.green);
  chk('过滤按钮已退役', lib.filterBtn === 0, lib.filterBtn);
  await p.screenshot({ path: path.join(__dirname, 'm54-lib-open.png') });

  // 收起
  await p.click('.np-lib-bar [data-act="libclose"]');
  await p.waitForTimeout(200);
  chk('收起后查询层关闭、商店还在',
    !(await p.locator('.np-lib').count()) && (await p.locator('.np-shopitem').count()) > 0);

  // ── 战斗奖励面板同样可用 ──
  console.log('\n== 战斗奖励面板 ==');
  await p.evaluate(() => { NodePanel.showReward(Run.current()); });
  await p.waitForTimeout(300);
  chk('奖励面板头部同样有入口', (await p.locator('.np-lib-btn').count()) === 1);
  await p.click('.np-lib-btn');
  await p.waitForTimeout(200);
  const headTxt = await p.evaluate(() =>
    (document.querySelector('.np-lib-bar .np-h') || {}).textContent || '');
  chk('奖励面板里打开并计数正确', headTxt === '我的卡片库 · 2 种 / 3 张', headTxt);

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM54 卡片库探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
