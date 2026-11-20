// M68 大 Boss 战利品探针 —— 稀有卡三选一 → 稀有遗物三选一（两段式，可跳）
// 也回归中 Boss / 普通奖励面板不受影响。
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
  });
  await p.waitForTimeout(400);

  // 定位一个 Boss 节点，按 enterNode 的方式补 enemyId，并把它设为当前节点
  const bossInfo = await p.evaluate(() => {
    let boss = null;
    Run.state.map.layers.forEach((layer) => layer.forEach((n) => {
      if (n.type === 'boss' && !boss) boss = n;
    }));
    boss.enemyId = boss.bossId;     // enterNode 的等价动作（不触发 rollEncounter）
    Run.state.currentId = boss.id;
    NodePanel.showReward(boss);
    const rw = NodePanel.state.reward;
    return {
      id: boss.id,
      boss: !!rw.boss,
      cap: Run.dlCap(),
      cards: rw.cards.map((id) => ({ id: id, rar: CARDS[id].rarity, dl: CARDS[id].dl || 0 })),
      relicChoices: rw.relicChoices.map((id) => ({ id: id, rar: RELICS[id].rarity }))
    };
  });
  await p.waitForTimeout(300);

  console.log('== 奖励数据 ==');
  chk('boss 标记已挂', bossInfo.boss, bossInfo.boss);
  chk('三张候选卡（按 DL 解锁档抽，rare 优先逐级兜底）', bossInfo.cards.length === 3 &&
    bossInfo.cards.every((c) => ['rare', 'uncommon', 'common'].indexOf(c.rar) >= 0),
    JSON.stringify(bossInfo.cards.map((c) => c.rar)));
  chk('不提前解锁：全部候选 dl ≤ dlCap（dlCap=' + bossInfo.cap + '）',
    bossInfo.cap == null || bossInfo.cards.every((c) => c.dl <= bossInfo.cap),
    JSON.stringify(bossInfo.cards.map((c) => c.dl)));
  chk('三件稀有遗物', bossInfo.relicChoices.length === 3 &&
    bossInfo.relicChoices.every((r) => r.rar === 'rare'),
    JSON.stringify(bossInfo.relicChoices.map((r) => r.rar)));
  chk('卡不重复 / 遗物不重复',
    new Set(bossInfo.cards.map((c) => c.id)).size === 3 &&
    new Set(bossInfo.relicChoices.map((r) => r.id)).size === 3);

  console.log('\n== 第一段：稀有卡三选一 ==');
  let ui = await p.evaluate(() => ({
    heads: [].slice.call(document.querySelectorAll('.np-h')).map((h) => h.textContent),
    picks: document.querySelectorAll('.np-pick .npc').length,
    skip: !!document.querySelector('[data-act="bossskip"]'),
    deckLen: Run.state.deck.length
  }));
  chk('面板标题「稀有卡 · 三选一」', ui.heads.indexOf('稀有卡 · 三选一') >= 0, JSON.stringify(ui.heads));
  chk('三张卡可选', ui.picks === 3, ui.picks);
  chk('有「卡就不要了」按钮', ui.skip, ui.skip);

  const deck0 = ui.deckLen;
  await p.click('[data-act="bossgetcard"][data-arg="0"]');
  await p.waitForTimeout(250);
  const afterCard = await p.evaluate(() => ({
    heads: [].slice.call(document.querySelectorAll('.np-h')).map((h) => h.textContent),
    deckLen: Run.state.deck.length,
    lastCard: Run.state.deck[Run.state.deck.length - 1].def.id,
    relicPicks: document.querySelectorAll('[data-act="bossgetrelic"]').length,
    // M86 回归哨：三张遗物卡必须都带立绘（位图 img 或 SVG 兜底各算一件）
    relicArt: document.querySelectorAll('[data-act="bossgetrelic"] .npc-relic-art').length,
    relicArtMedia: document.querySelectorAll(
      '[data-act="bossgetrelic"] .npc-relic-art img, [data-act="bossgetrelic"] .npc-relic-art svg').length
  }));
  chk('进入第二段（稀有遗物 · 三选一）',
    afterCard.heads.indexOf('稀有遗物 · 三选一') >= 0, JSON.stringify(afterCard.heads));
  chk('选中的卡已进卡组', afterCard.deckLen === deck0 + 1 &&
    afterCard.lastCard === bossInfo.cards[0].id, afterCard.lastCard);
  chk('三件遗物可选', afterCard.relicPicks === 3, afterCard.relicPicks);
  chk('三张遗物卡都带立绘（位图或 SVG）',
    afterCard.relicPicks === 3 && afterCard.relicArt === 3 && afterCard.relicArtMedia === 3,
    'art=' + afterCard.relicArt + ' media=' + afterCard.relicArtMedia);

  console.log('\n== 第二段：稀有遗物三选一 ==');
  await p.click('[data-act="bossgetrelic"][data-arg="0"]');
  await p.waitForTimeout(300);
  const afterRelic = await p.evaluate(() => ({
    panel: !!document.querySelector('.np'),
    relics: Run.state.relics.slice(),
    cleared: Run.state.cleared
  }));
  chk('领完后面板关闭（回到地图）', !afterRelic.panel, afterRelic.panel);
  chk('遗物已入袋', afterRelic.relics.indexOf(bossInfo.relicChoices[0].id) >= 0,
    afterRelic.relics.join(','));
  chk('Boss 节点已结算为 win', afterRelic.cleared[bossInfo.id] === 'win',
    afterRelic.cleared[bossInfo.id]);

  console.log('\n== 跳过流程 ==');
  const skipRes = await p.evaluate(() => {
    const boss = Run.state.map.layers
      .reduce((a, l) => a.concat(l), [])
      .find((n) => n.type === 'boss');
    Run.state.currentId = boss.id;
    NodePanel.showReward(boss);
    const deck = Run.state.deck.length;
    NodePanel.act('bossskip');
    const relicStage = document.querySelectorAll('[data-act="bossgetrelic"]').length;
    NodePanel.act('leave');
    return {
      deck: deck, deckAfter: Run.state.deck.length,
      relicStage: relicStage,
      panel: !!document.querySelector('.np')
    };
  });
  chk('跳过卡 → 直接进遗物段', skipRes.relicStage === 3, skipRes.relicStage);
  chk('遗物也不要 → 面板关闭且卡组不变',
    !skipRes.panel && skipRes.deckAfter === skipRes.deck,
    skipRes.deck + '→' + skipRes.deckAfter);

  console.log('\n== DL 高了之后：候选回到稀有 ==');
  const highDl = await p.evaluate(() => {
    // dlCap 读的是本局的 state.dl（Run.start 时定档），不是 Progress —— 直接改局内档位
    Run.state.dl = 10;
    const boss = Run.state.map.layers.reduce((a, l) => a.concat(l), [])
      .find((n) => n.type === 'boss');
    Run.state.currentId = boss.id;
    NodePanel.showReward(boss);
    return {
      cap: Run.dlCap(),
      rars: NodePanel.state.reward.cards.map((id) => CARDS[id].rarity)
    };
  });
  chk('DL 10 时三张卡全为 rare', highDl.cap === 10 && highDl.rars.length === 3 &&
    highDl.rars.every((r) => r === 'rare'), JSON.stringify(highDl.rars));

  console.log('\n== 中 Boss 奖励不受影响 ==');
  const elite = await p.evaluate(() => {
    const n = Run.state.map.layers.reduce((a, l) => a.concat(l), [])
      .find((x) => x.type === 'elite');
    if (!n) return { skip: true };
    n.enemyId = n.enemyId || 'warlord';
    Run.state.currentId = n.id;
    NodePanel.showReward(n);
    return {
      boss: !!NodePanel.state.reward.boss,
      hasRareHead: [].slice.call(document.querySelectorAll('.np-h'))
        .some((h) => h.textContent.indexOf('稀有遗物') >= 0),
      picks: document.querySelectorAll('.np-pick .npc').length
    };
  });
  if (elite.skip) console.log('  [skip] 本图没有中 Boss 节点');
  else {
    chk('中 Boss 不走两段式', !elite.boss && !elite.hasRareHead, JSON.stringify(elite));
    chk('中 Boss 仍是普通三选一', elite.picks === 3, elite.picks);
  }

  chk('页面无 JS 运行时错误', errs.length === 0, errs.length ? errs[0] : 'none');

  await b.close();
  console.log('\nM68 Boss 战利品探针：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
