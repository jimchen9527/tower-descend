// 单局形状（诊断用）：跳过战斗结算，只统计 33 层里到底有多少场战斗 / 商店 / 事件，
// 以及到达三个 Boss 闸门时的卡组、遗物、金币。用来回答「一局有多长、成长有多少」。
const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = path.join(__dirname, '..');
const FILES = ['js/core/rng.js', 'js/data/characters.js', 'js/data/acts.js', 'js/data/cards.js',
  'js/data/cards-medic.js', 'js/data/cards-keeper.js', 'js/data/potions.js', 'js/data/sfx-profile.js',
  'js/data/relics.js', 'js/data/events.js', 'js/data/story.js', 'js/data/enemies.js',
  'js/core/progress.js', 'js/core/combat.js', 'js/core/map.js', 'js/core/run.js'];
const sb = { console }; vm.createContext(sb);
FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sb, { filename: f }));
const S = (e) => vm.runInContext(e, sb);

const N = Number(process.argv[2]) || 30;
const acc = { battles: 0, events: 0, shops: 0, rests: 0, chests: 0, gold: 0, deck: 0, relics: 0, potions: 0, visits: 0 };
const atGate = { 11: [], 22: [], 33: [] };

for (let i = 0; i < N; i++) {
  S("Run.start('act1', " + (700000 + i) + ", 'digger', 1)");
  let guard = 0;
  while (!S('Run.state.finished') && guard++ < 200) {
    const node = S('Run.current()');
    const type = node.type;
    const cleared = S('Run.state.cleared["' + node.id + '"]');
    if (!cleared || cleared === 'entry') {
      acc.visits++;
      if (type === 'monster' || type === 'elite' || type === 'boss') {
        acc.battles++;
        // 直接判胜，保持满血（只量流程与资源，不量难度）
        S('Run.settle("win", Run.state.maxHp)');
        const rw = S('Run.rollBattleReward(Run.current())');
        if (rw.relicId) acc.relics++;
        if (rw.relicChoices && rw.relicChoices.length) S('Run.addRelic(' + JSON.stringify(rw.relicChoices[0]) + ')');
        if (rw.cards && rw.cards.length) S('Run.addCard("' + rw.cards[0] + '")');
      } else if (type === 'event') {
        acc.events++;
        S('Run.settle("done")');
      } else if (type === 'shop') {
        acc.shops++;
        S('Run.settle("done")');
      } else if (type === 'rest') {
        acc.rests++;
        S('Run.settle("done")');
      } else if (type === 'chest') {
        acc.chests++;
        S('Run.openChest()');
        S('Run.settle("done")');
      }
      const d = node.depth;
      if (atGate[d]) atGate[d].push(S('(function(){return {gold:Run.state.gold,deck:Run.state.deck.length,' +
        'relics:Run.state.relics.length,hp:Run.state.maxHp}})()'));
    }
    if (S('Run.state.finished')) break;
    const moves = S('Run.current().edges.filter(function(id){return Run.canMoveTo(id)})');
    if (!moves.length) break;
    S('Run.moveTo("' + moves[Math.floor(Math.random() * moves.length)] + '")');
  }
  acc.gold += S('Run.state.gold'); acc.deck += S('Run.state.deck.length');
  acc.relics += S('Run.state.relics.length'); acc.potions += (S('Run.state.potions||[]').length);
}
const avg = (k) => (acc[k] / N).toFixed(1);
console.log('每局平均：节点 ' + avg('visits') + ' · 战斗 ' + avg('battles') + ' · 事件 ' + avg('events') +
  ' · 商店 ' + avg('shops') + ' · 休息 ' + avg('rests') + ' · 宝箱 ' + avg('chests'));
console.log('通关时：金币 ' + avg('gold') + ' · 卡组 ' + avg('deck') + ' 张 · 遗物 ' + avg('relics') + ' 件 · 药水 ' + avg('potions'));
for (const d of [11, 22]) {
  const arr = atGate[d];
  if (!arr.length) continue;
  const m = (k) => (arr.reduce((a, b) => a + b[k], 0) / arr.length).toFixed(1);
  console.log('到 D' + d + '（' + arr.length + ' 例）：金币 ' + m('gold') + ' · 卡组 ' + m('deck') + ' 张 · 遗物 ' + m('relics') + ' 件 · 最大血 ' + m('hp'));
}
