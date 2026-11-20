// M53 拖拽出牌 · UI 探针 —— 红框退役 / 常驻角标 / 拖拽投放 / 落空弹回 / 点按流仍在
// M53b：技能 / 能力牌（作用自己）落到哪都出牌 —— 落空不再弹回；投到敌人身上不偷换目标
// 真机（Playwright + Edge）跑真实指针事件；CSS 静态断言用源文本。
// 手牌用 mkCard 钉死（打击×2 / 防御×2），不依赖起手抓牌的随机性。
// 传一个 URL 就量线上（同 m48-travel-matrix 的约定）；源文本断言仍读本地文件，
// 依赖「发布后逐字节 diff 已证线上与本地一致」这道前置闸。
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
  // ── 静态：源文本 ──
  const styleCss = fs.readFileSync(path.join(BASE, 'css', 'style.css'), 'utf8');
  const artCss = fs.readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
  const renderJs = fs.readFileSync(path.join(BASE, 'js', 'ui', 'render.js'), 'utf8');
  console.log('== 静态 ==');
  chk('红框选择器已删（.eunit.is-target::before）', !/is-target::before/.test(styleCss));
  // ⚠️ 按选择器形态（.eunit 前缀 + {）匹配 —— 注释里留着「is-target::after」
  //   的历史记载，裸 grep 会撞上注释（M45 线上脚本同款教训）
  chk('常驻角标已移除（M53c：用户反馈不再画红框）',
    !/\.eunit\.is-target::after\s*\{/.test(styleCss),
    (/\.eunit\.is-target::after\s*\{/.test(styleCss)).toString());
  chk('瞄准高亮已改金（红色退出选敌交互，受击闪红除外）',
    /rgba\(198, 156, 68/.test(artCss) &&
    !/rgba\(206, 54, 44, \.32\)/.test(artCss) && !/rgba\(206, 54, 44, \.55\)/.test(artCss));
  // M53d：PC 端「还是红圈」的两个残余 —— 悬停浮层的红底「目标」标 + 攻击意图红框
  chk('「目标」小标已换中性墨底（不再是红底）',
    /\.target-tag\s*\{[^}]*background:\s*#5F5E5A/.test(styleCss) &&
    !/\.target-tag\s*\{[^}]*#A32D2D/.test(styleCss));
  chk('攻击意图红边框 + 红内环已退役',
    !/2px solid #D98A82/.test(styleCss) && !/rgba\(217, 138, 130/.test(styleCss));
  chk('瞄准光晕占 ::before（.eunit.is-aim::before）', /\.eunit\.is-aim::before/.test(artCss));
  chk('幽灵卡样式（.play-ghost）', /\.play-ghost/.test(artCss));
  chk('落空回弹过渡（.play-ghost.back）', /\.play-ghost\.back/.test(artCss));
  chk('瞄准聚焦（.is-aiming 退半步）', /is-aiming \.eunit:not\(\.is-aim\)/.test(artCss));
  chk('卡片禁页面滚动（touch-action）', /touch-action:\s*none/.test(artCss));
  chk('拖拽已接线（bindCardDrag）', /bindCardDrag\(\)/.test(renderJs) && /this\.bindCardDrag\(\)/.test(renderJs));
  chk('点按流防重入（_justDragged）', /_justDragged/.test(renderJs));
  // M53b：投放语义按卡类型分叉，自我牌落空也出牌
  chk('投放语义按类型分叉（isAttack）',
    /def\.type === 'attack'/.test(renderJs) && /落到哪都出牌/.test(renderJs));
  chk('HUD 提示改文案', renderJs.indexOf('拖卡出牌 · 攻击卡拖到敌人身上') >= 0 &&
    renderJs.indexOf('点敌人切换目标') < 0);

  // ── 真机 ──
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() =>
    [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(600);

  await p.evaluate(() => {
    Progress.reset(); App.boot({ fresh: true });
    Run.start('act1', 20261012); App.showMap();
    Combat.start(20261012, {
      charId: 'digger', hp: 75, maxHp: 75, depth: 3, locTag: 'M53 探针',
      deck: Run.state.deck, enemyId: 'rats'
    });
    Combat.addEnemy('spore_walker');
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    Render.resetFeedback(); Render.draw();
  });
  await p.waitForTimeout(400);

  // 钉死手牌：打击×2（attack）+ 防御×2（skill 自我），能量拉满
  await p.evaluate(() => {
    const s = Combat.state;
    s.hand = [mkCard('strike'), mkCard('defend'), mkCard('defend'), mkCard('strike')];
    s.player.energy = 50;
    Render.draw();
  });
  await p.waitForTimeout(250);

  const uidOf = (id) => p.evaluate((id) => {
    const c = Combat.state.hand.find((x) => x.def.id === id);
    return c ? c.uid : null;
  }, id);
  const snap = () => p.evaluate(() => ({
    handLen: Combat.state.hand.length,
    block: Combat.state.player.block,
    target: (document.querySelector('.eunit.is-target') || {}).dataset ?
      document.querySelector('.eunit.is-target').dataset.eidx : null,
    hp1: Combat.state.enemies[1].hp,
    log: Combat.state.log.length,
    ghost: document.querySelectorAll('.play-ghost').length,
    lift: document.querySelector('.card.is-lift') ? true : false
  }));
  const dragTo = async (uid, tx, ty) => {
    const c = await p.locator('.card[data-uid="' + uid + '"]').boundingBox();
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await p.mouse.down();
    await p.mouse.move(tx, ty, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(450);
  };

  console.log('\n== 真机 computed ==');
  const ring = await p.evaluate(() => {
    const t = document.querySelector('.eunit.is-target');
    return {
      beforeContent: getComputedStyle(t, '::before').content,
      afterBg: getComputedStyle(t, '::after').backgroundImage.slice(0, 30),
      hint: (document.querySelector('.target-hint') || {}).textContent || null
    };
  });
  chk('选中单位 ::before 已无内容（红框没了）', ring.beforeContent === 'none', ring.beforeContent);
  chk('选中敌人无常驻视觉（::after 已无背景）', ring.afterBg === 'none', ring.afterBg);
  chk('HUD 提示 = 拖卡出牌 · 攻击卡拖到敌人身上',
    ring.hint === '拖卡出牌 · 攻击卡拖到敌人身上', ring.hint);

  const enemyArt = async (idx) => {
    const r = await p.locator('.eunit[data-eidx="' + idx + '"] .unit-art').boundingBox();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };

  // ── A. 自我牌（防御）落空 → 照样出牌，飞向掘者，不换目标 ──
  console.log('\n== A. 技能牌落空投放 ==');
  let s0 = await snap();
  let uid = await uidOf('defend');
  await dragTo(uid, 250, 620);
  let s1 = await snap();
  chk('落空照样出牌（手牌 4 → 3）', s1.handLen === s0.handLen - 1, s1.handLen);
  chk('格挡 +5（作用到自己身上）', s1.block === s0.block + 5, s0.block + ' → ' + s1.block);
  chk('当前目标没动（仍是 ' + s0.target + '）', s1.target === s0.target, s1.target);
  chk('幽灵卡无残留 / 占位已摘', s1.ghost === 0 && s1.lift === false,
    'ghost=' + s1.ghost + ' lift=' + s1.lift);

  // ── B. 自我牌投到敌人身上 → 出牌但不偷换目标 ──
  console.log('\n== B. 技能牌投到敌人身上 ==');
  s0 = await snap();
  uid = await uidOf('defend');
  const e1 = await enemyArt(1);
  await dragTo(uid, e1[0], e1[1]);
  s1 = await snap();
  chk('照样出牌（手牌 3 → 2）', s1.handLen === s0.handLen - 1, s1.handLen);
  chk('格挡再 +5', s1.block === s0.block + 5, s0.block + ' → ' + s1.block);
  chk('不偷换攻击目标（仍 ' + s0.target + '）', s1.target === s0.target, s1.target);

  // ── C. 攻击卡投到敌人身上 → 指定目标 + 掉血 ──
  console.log('\n== C. 攻击卡投放 ==');
  s0 = await snap();
  uid = await uidOf('strike');
  await dragTo(uid, e1[0], e1[1]);
  s1 = await snap();
  chk('投放即换目标（is-target → 1）', s1.target === '1', s1.target);
  chk('命中掉血（打击 6 伤）', s1.hp1 === s0.hp1 - 6, s0.hp1 + ' → ' + s1.hp1);
  chk('卡已消耗（手牌 2 → 1）', s1.handLen === s0.handLen - 1, s1.handLen);

  // ── D. 攻击卡落空 → 弹回，不消耗 ──
  console.log('\n== D. 攻击卡落空弹回 ==');
  s0 = await snap();
  uid = await uidOf('strike');
  await dragTo(uid, 250, 620);
  s1 = await snap();
  chk('卡没消耗（手牌不变）', s1.handLen === s0.handLen, s1.handLen);
  chk('没有出牌日志', s1.log === s0.log, s1.log);
  chk('占位已摘 / 幽灵卡已移除', !s1.lift && s1.ghost === 0,
    'lift=' + s1.lift + ' ghost=' + s1.ghost);
  chk('目标没动', s1.target === s0.target, s1.target);

  // ── E. 点按流仍在（剩下的攻击卡打当前目标）──
  console.log('\n== E. 点按流 ==');
  s0 = await snap();
  uid = await uidOf('strike');
  if (uid !== null) {
    await p.click('.card[data-uid="' + uid + '"]');
    await p.waitForTimeout(400);
    s1 = await snap();
    chk('点按出牌打当前目标（血量再降）', s1.hp1 < s0.hp1, s0.hp1 + ' → ' + s1.hp1);
    chk('手牌消耗', s1.handLen === s0.handLen - 1, s1.handLen);
  } else {
    console.log('  [skip] 手牌里没有攻击卡');
  }

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM53 拖拽探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
