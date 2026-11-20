const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = path.join(__dirname, '..');
const FILES = ['js/core/rng.js', 'js/data/characters.js', 'js/data/acts.js', 'js/data/cards.js',
  'js/data/cards-medic.js', 'js/data/cards-keeper.js', 'js/data/potions.js', 'js/data/sfx-profile.js',
  'js/data/relics.js', 'js/data/events.js', 'js/data/story.js', 'js/data/enemies.js',
  'js/core/progress.js', 'js/core/combat.js', 'js/core/map.js', 'js/core/run.js'];
const sb = { console }; vm.createContext(sb);
FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sb, { filename: f }));
const S = (e) => vm.runInContext(e, sb);

for (const dl of [1, 5, 10]) {
  S("Run.start('act1',1,'digger'," + dl + ")");
  S("Combat.start(1,{depth:11,charId:'digger',hp:75,maxHp:75,enemyId:'rust_crown'," +
    "enemies:[{id:'rust_crown',hpMul:1}],dlScale:" + (1 + 0.15 * (dl - 1)) + ",deck:Run.state.deck})");
  S("Combat.state.enemies[0].intent = ENEMIES.rust_crown.moves.slam");
  const shown = S('Combat.intentDamage(Combat.state.enemies[0])');
  const real = S('Combat.rawDamage(Combat.state.enemies[0], Combat.state.player, 12)');
  console.log('DL' + dl, '意图显示', shown, '/ 实际', real, '（偏差', (real - shown) + '）');
}
