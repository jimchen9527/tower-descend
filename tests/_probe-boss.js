// Boss 墙诊断（只读）：同一套打法，换不同强度的牌库打锈冠，看「差多少」。
// 用法：node tests/_probe-boss.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = path.join(__dirname, '..');
const FILES = ['js/core/rng.js', 'js/data/characters.js', 'js/data/acts.js', 'js/data/cards.js',
  'js/data/cards-medic.js', 'js/data/cards-keeper.js', 'js/data/potions.js', 'js/data/sfx-profile.js',
  'js/data/relics.js', 'js/data/events.js', 'js/data/story.js', 'js/data/enemies.js',
  'js/core/progress.js', 'js/core/combat.js', 'js/core/map.js', 'js/core/run.js'];
const sb = { console }; vm.createContext(sb);
FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sb, { filename: f }));
const S = (e) => vm.runInContext(e, sb);

const CI = { dmg: 1, boost: 0.6, block: 0.9, draw: 3, energy: 3, str: 7, poison: 4, burn: 2, thorns: 3, heal: 0.8 };
function score(id) {
  const d = S('CARDS["' + id + '"]');
  if (!d || d.type === 'curse' || d.type === 'status') return -99;
  const v = d.v || {}; const c = Math.max(1, d.cost || 0);
  let s = ((v.dmg || 0) + (v.boost || 0) * CI.boost) + (v.block || 0) * CI.block +
    (v.draw || 0) * CI.draw + (v.energy || 0) * CI.energy + (v.str || 0) * CI.str +
    (v.poison || 0) * CI.poison + (v.burn || 0) * CI.burn + (v.thorns || 0) * CI.thorns + (v.heal || 0) * CI.heal;
  s /= c;
  if (d.rarity === 'rare') s += 3; else if (d.rarity === 'uncommon') s += 1;
  return s;
}

const CAP = Number(process.argv[2]) || 2;
const pool = S('rewardPool("digger", ' + CAP + ')').slice().sort((a, b) => score(b) - score(a));
const extra = pool.filter((id) => score(id) > 0);

function aiTurn() {
  const idx = [];
  S('Combat.state.hand').forEach((c, i) => { if (S('Combat.canPlay(Combat.state.hand[' + i + '])')) idx.push(i); });
  if (!idx.length) return false;
  const inc = S('(function(){var n=0;Combat.state.enemies.forEach(function(e){if(e.hp>0&&e.intent&&e.intent.kind==="attack")n+=Combat.intentDamage(e)||0});return n})()');
  const block = S('Combat.state.player.block');
  let best = -1, bs = -1e9;
  idx.forEach((i) => {
    const d = S('Combat.state.hand[' + i + '].def');
    let s = d.type === 'attack' ? 10 + ((d.v && d.v.dmg) || 4) : d.type === 'power' ? 9 : 5;
    const blk = (d.v && d.v.block) || 0;
    if (inc > 3 && block < inc && blk) s = 30 + blk;
    if (s > bs) { bs = s; best = i; }
  });
  if (best < 0) return false;
  S('Combat.playCard(Combat.state.hand[' + best + '].uid)');
  return true;
}

function fight(deckIds, label, n) {
  let wins = 0, lefts = 0, turns = 0;
  for (let k = 0; k < n; k++) {
    S("Run.start('act1', 1, 'digger', 1)");
    S('Run.state.deck = ' + JSON.stringify(deckIds) + '.map(mkCard)');
    S("Combat.start(" + (700 + k) + ",{depth:11,charId:'digger',hp:75,maxHp:75,enemyId:'rust_crown'," +
      "enemies:[{id:'rust_crown',hpMul:1}],dlScale:1,deck:Run.state.deck})");
    let g = 0;
    while (S('Combat.state.phase') !== 'win' && S('Combat.state.phase') !== 'lose' && g++ < 400) {
      if (S('Combat.state.phase') === 'player') { if (!aiTurn()) S('Combat.endTurn()'); }
      else S('Combat.endTurn()');
    }
    if (S('Combat.state.phase') === 'win') wins++;
    lefts += S('Combat.state.enemies[0].hp') / S('Combat.state.enemies[0].maxHp');
    turns += S('Combat.state.turn');
  }
  console.log(label.padEnd(26) + ' 胜 ' + String(wins) + '/' + n +
    ' · 结束时 Boss 余 ' + (lefts / n * 100).toFixed(0) + '% · 平均 ' + (turns / n).toFixed(1) + ' 回合');
}

const starter = S('CHARACTERS.digger.starterDeck');
fight(starter, '起始 10 张（满血）', 40);
fight(starter.concat(extra.slice(0, 5)), '起始 + 5 张池内最好的', 40);
fight(starter.concat(extra.slice(0, 10)), '起始 + 10 张池内最好的', 40);
fight(starter.map((id) => id) .concat(extra.slice(0, 5)), '（对照）同上再跑一次', 40);
