// 玩法盘点（诊断用，无副作用的只读采样器）：无头跑整局，记录
// 「死在哪一层 / 死在谁手里 / 打到那里带了多少资源」。
// 用法：node tools/audit-play.js [每格局数]
// 与 tools/ai-runs.js 的区别：ai-runs 只输出胜率九宫格；本脚本产出死因分布与
// 「死时 Boss 还剩多少血」，供「新手墙在哪一节」这类盘点用。策略是近似，不是 solver。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js', 'js/data/characters.js', 'js/data/acts.js',
  'js/data/cards.js', 'js/data/cards-medic.js', 'js/data/cards-keeper.js',
  'js/data/potions.js', 'js/data/sfx-profile.js', 'js/data/relics.js',
  'js/data/events.js', 'js/data/story.js', 'js/data/enemies.js',
  'js/core/progress.js', 'js/core/combat.js', 'js/core/map.js', 'js/core/run.js',
];
const sandbox = { console: console };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
const S = (expr) => vm.runInContext(expr, sandbox);

const N = Number(process.argv[2]) || 40;
const ENERGY_BONUS = Number(process.env.AUDIT_ENERGY) || 0;

// 参数敏感性实验（只改本进程内的数据副本，不碰产品文件）：
//   AUDIT_RUST_HP=180         → 锈冠血量
//   AUDIT_RUST_DMG=9          → 锈冠重砸伤害
//   AUDIT_PHASE2_ALT=1        → 二阶段回到两回合循环（不每回合 rust_slam）
//   AUDIT_NO_DEX=1            → 去掉锈冠的永久 −1 敏捷
//   AUDIT_DEX_CAP=3           → 敏捷衰减封顶
//   AUDIT_START_HP=90         → 玩家起始血量
//   AUDIT_ENERGY=1            → 起手 +1 能量
//   AUDIT_ENERGY_AFTER_BOSS=1 → 通过 D11 后 +1 能量
//   AUDIT_BOSS_FULL=1         → 进 Boss 时回满血
if (process.env.AUDIT_RUST_HP) {
  S('ENEMIES.rust_crown.hpMin=ENEMIES.rust_crown.hpMax=' + Number(process.env.AUDIT_RUST_HP));
}
if (process.env.AUDIT_RUST_DMG) {
  const d = Number(process.env.AUDIT_RUST_DMG);
  S('(function(){ENEMIES.rust_crown.moves.slam.value=' + d + ';' +
    'ENEMIES.rust_crown.moves.slam.run=function(ctx){ctx.dealDamage(ctx.enemy,ctx.player,' + d + ')};' +
    'ENEMIES.rust_crown.moves.rust_slam.value=' + Math.round(d * 0.83) + ';' +
    'ENEMIES.rust_crown.moves.rust_slam.run=function(ctx){ctx.dealDamage(ctx.enemy,ctx.player,' + Math.round(d * 0.83) + ');ctx.addBuff(ctx.player,"dex",-1)};})()');
}
if (process.env.AUDIT_PHASE2_ALT) {
  // 二阶段不切「每回合 rust_slam」，回到 pattern 的两回合循环 —— 隔离这一条 choose
  S('ENEMIES.rust_crown.choose=function(){return null}');
}
if (process.env.AUDIT_NO_DEX) {
  // 锈冠「锈蚀蔓延」不再扣敏捷（只保留文案）—— 隔离「永久减敏捷」这一个变量
  S('ENEMIES.rust_crown.moves.corrode.run=function(ctx){ctx.log("锈屑顺着铠甲的缝往里钻。")}');
}
if (process.env.AUDIT_DEX_CAP) {
  // 敏捷衰减封顶（-N 之后不再生效）
  const cap = Number(process.env.AUDIT_DEX_CAP);
  S('ENEMIES.rust_crown.moves.corrode.run=function(ctx){' +
    'if((ctx.player.buffs.dex||0)>-' + cap + '){ctx.addBuff(ctx.player,"dex",-1);' +
    'ctx.log("锈屑顺着铠甲的缝往里钻。")}else{ctx.log("锈屑落在已经锈死的护甲上，没有再咬进去。")}}');
}
if (process.env.AUDIT_START_HP) {
  // START_HP 是 const，改不了；包一层 Run.start，开局后补血（等价于起始血量上调）
  const bonus = Number(process.env.AUDIT_START_HP) - 75;
  S('(function(){var _s=Run.start;Run.start=function(){var st=_s.apply(Run,arguments);' +
    'st.maxHp+=' + bonus + ';st.hp+=' + bonus + ';return st;}})()');
}
// AUDIT_FIX_INTENT=1：保留作历史对照 —— M89 起产品代码的 intentDamage 已走 rawDamage，
// 这个开关不再改变结果（修复前用于模拟「意图显示已修」）。
if (process.env.AUDIT_FIX_INTENT) {
  S('(function(){Combat.intentDamage=function(u){var s=Combat.state;u=u||Combat.targetUnit();' +
    'var mv=u&&u.intent;if(!mv||mv.kind!=="attack")return null;' +
    'return Combat.rawDamage(u,s.player,mv.value)}})()');
}
// ---------- 战斗 ----------
function incomingDamage() {
  return S('(function(){var inc=0;Combat.state.enemies.forEach(function(e){' +
    'if(e.hp>0&&e.intent&&e.intent.kind==="attack")inc+=Combat.intentDamage(e)||0});return inc})()');
}

function aiTurn() {
  const hand = S('Combat.state.hand');
  const alive = S('Combat.state.enemies.findIndex(function(e){return e.hp>0})');
  if (alive >= 0) S('Combat.setTarget(' + alive + ')');
  let played = 0, guard = 0;
  while (S('Combat.state.phase') === 'player' && guard++ < 40) {
    const h = S('Combat.state.hand');
    const idx = [];
    h.forEach((c, i) => { if (S('Combat.canPlay(Combat.state.hand[' + i + '])')) idx.push(i); });
    if (!idx.length) break;
    const inc = incomingDamage();
    const block = S('Combat.state.player.block');
    const hp = S('Combat.state.player.hp');
    let best = -1, bestScore = -1e9;
    idx.forEach((i) => {
      const d = S('Combat.state.hand[' + i + '].def');
      let score;
      if (d.type === 'attack') score = 10 + ((d.v && d.v.dmg) || 4);
      else if (d.type === 'power') score = 9;
      else score = 5;
      const blk = (d.v && d.v.block) || 0;
      if (inc > 3 && block < inc && blk) score = 30 + blk;
      if (d.v && d.v.hp && hp <= d.v.hp * 4) score = -100;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) break;
    S('Combat.playCard(Combat.state.hand[' + best + '].uid)');
    played++;
  }
  return played > 0;
}

function drinkIfLow() {
  S('(function(){if(Combat.state.phase!=="player")return;' +
    'if(Combat.state.player.hp>=Combat.state.player.maxHp*0.45)return;' +
    'var order=["poultice","tonic","salve","draught"];' +
    'for(var k=0;k<order.length;k++){var i=Combat.state.potions.indexOf(order[k]);' +
    'if(i>=0){Combat.usePotion(i);return}}})()');
}

function playBattle(node) {
  S('(function(){var enc=Run.encounterOf(Run.current());' +
    'var enemies=enc.enemyIds.map(function(id,i){return{id:id,' +
    'hpMul:(enc.enemyHpMul||[])[i]||1,variant:(enc.enemyVariant||[])[i]||null,' +
    'affixes:(enc.enemyAffixes||[])[i]||[]}});' +
    'Combat.start(Run.battleSeed(Run.current().id),{charId:Run.state.charId,' +
    'hp:Run.state.hp,maxHp:Run.state.maxHp,depth:Run.current().depth,locTag:"audit",' +
    'deck:Run.state.deck,relics:Run.state.relics,potions:Run.state.potions||[],' +
    'enemyId:Run.current().enemyId,enemies:enemies,' +
    'enemyHpPct:Run.modSum("enemyHpPct"),dlScale:1+0.15*(Run.curDl()-1)})})()');
  const eBonus = ENERGY_BONUS + (process.env.AUDIT_ENERGY_AFTER_BOSS && node.depth > 11 ? 1 : 0);
  if (eBonus) {
    S('(function(){Combat.state.player.maxEnergy+=' + eBonus + ';' +
      'Combat.state.player.energy+=' + eBonus + '})()');
  }
  const entryHp = S('Combat.state.player.hp');
  if (process.env.AUDIT_BOSS_FULL && node.type === 'boss') {
    S('Combat.state.player.hp = Combat.state.player.maxHp');
  }
  drinkIfLow();
  let guard = 0;
  let lastTurn = -1;
  const TRACE = process.env.AUDIT_TRACE && node.type === 'boss';
  while (S('Combat.state.phase') !== 'win' && S('Combat.state.phase') !== 'lose' && guard++ < 600) {
    drinkIfLow();
    if (TRACE) {
      const t = S('Combat.state.turn');
      if (t !== lastTurn) {
        lastTurn = t;
        console.log('    T' + t + ' 我 ' + S('Combat.state.player.hp') + '(+' + S('Combat.state.player.block') + '挡)' +
          ' 敌 ' + S('Combat.state.enemies.map(function(e){return e.hp}).join("/")') +
          ' 手 ' + S('Combat.state.hand.map(function(c){return c.def.name}).join(",")'));
      }
    }
    if (S('Combat.state.phase') === 'player') {
      if (!aiTurn()) S('Combat.endTurn()');
    } else S('Combat.endTurn()');
  }
  return {
    won: S('Combat.state.phase') === 'win',
    turns: S('Combat.state.turn'),
    hp: S('Combat.state.player.hp'),
    entryHp: entryHp,
    // 敌方残血比例（Boss 墙有多厚：差 5% 还是差一倍，调法不同）
    foeLeftPct: S('(function(){var t=0,m=0;Combat.state.enemies.forEach(function(e){t+=Math.max(0,e.hp);m+=e.maxHp});return m?t/m:1})()'),
  };
}

// ---------- 拿牌 / 升级 / 商店 ----------
function cardScore(id) {
  const d = S('CARDS["' + id + '"]');
  if (!d || d.type === 'curse' || d.type === 'status') return -99;
  const v = d.v || {};
  const cost = Math.max(1, d.cost || 0);
  let s = ((v.dmg || 0) + (v.boost || 0) * 0.6) * 1.0
    + (v.block || 0) * 0.85
    + (v.draw || 0) * 3 + (v.energy || 0) * 3
    + (v.str || 0) * 7 + (v.poison || 0) * 4 + (v.burn || 0) * 2
    + (v.thorns || 0) * 3 + (v.heal || 0) * 0.8;
  s = s / cost;
  if (d.rarity === 'rare') s += 5;
  else if (d.rarity === 'uncommon') s += 2;
  return s;
}

function draftCard(choices) {
  const deckN = S('Run.state.deck.length');
  let best = null, bestS = 0;
  choices.forEach((id) => {
    const s = cardScore(id);
    if (s > bestS) { bestS = s; best = id; }
  });
  if (!best) return null;
  // 卡组过厚就只收明显强牌（普通玩家的「删牌直觉」）
  if (deckN >= 22 && bestS < 9) return null;
  return best;
}

function visitShop() {
  S('(function(){var shop=Run.state.shop||Run.rollShop();' +
    'var gold=function(){return Run.state.gold};' +
    'if(Run.state.deck.some(function(c){return c.def.type==="curse"})&&gold()>=Run.removePrice()){' +
    'Run.spendGold(Run.removePrice());Run.removeCardRandom();}' +
    'for(var i=0;i<shop.relics.length;i++){var r=shop.relics[i];' +
    'if(!r.sold&&gold()>=r.price){Run.spendGold(r.price);Run.addRelic(r.id);r.sold=true;}}' +
    'for(var j=0;j<shop.potions.length;j++){var p=shop.potions[j];' +
    'if(!p.sold&&Run.potionSpace()>0&&gold()>=p.price){Run.spendGold(p.price);Run.addPotion(p.id);p.sold=true;}}})()');
}

function pickPath() {
  const moves = S('Run.current().edges.filter(function(id){return Run.canMoveTo(id)})');
  if (!moves.length) return null;
  const hpPct = S('Run.state.hp/Run.state.maxHp');
  const want = (t) => moves.find((id) => S('Run.state.map.nodes["' + id + '"].type') === t);
  const rest = want('rest');
  if (hpPct < 0.45 && rest) return rest;
  if (hpPct < 0.6) {
    const safe = moves.find((id) => {
      const t = S('Run.state.map.nodes["' + id + '"].type');
      return t !== 'elite' && t !== 'monster';
    });
    if (safe) return safe;
  }
  const chest = want('chest');
  if (chest && Math.random() < 0.6) return chest;
  const shop = want('shop');
  if (shop && Math.random() < 0.4) return shop;
  return moves[Math.floor(Math.random() * moves.length)];
}

function aiRun(charId, dl, seed) {
  S('Run.start("act1", ' + seed + ', "' + charId + '", ' + dl + ')');
  let guard = 0, turns = 0;
  let death = null;
  while (!S('Run.state.finished') && guard++ < 300) {
    const node = S('Run.current()');
    const cleared = S('Run.state.cleared["' + node.id + '"]');
    const type = node.type;
    if (!cleared || cleared === 'entry') {
      if (type === 'monster' || type === 'elite' || type === 'boss') {
        const r = playBattle(node);
        turns += r.turns;
        S('Run.settle("' + (r.won ? 'win' : 'lose') + '", ' + r.hp + ')');
        if (!r.won) {
          death = {
            depth: node.depth, type: node.type,
            enemy: S('JSON.stringify((Run.encounterOf(Run.current()).enemyIds||[]))'),
            hp: S('Run.state.hp'), maxHp: S('Run.state.maxHp'),
            deck: S('Run.state.deck.length'), relics: S('Run.state.relics.length'),
            gold: S('Run.state.gold'), turns: turns,
            foeLeft: Math.round(r.foeLeftPct * 100),
            entryHp: r.entryHp,
          };
          break;
        }
        const rw = S('Run.rollBattleReward(Run.current())');
        if (rw.boss && rw.relicChoices && rw.relicChoices.length) {
          S('Run.addRelic(' + JSON.stringify(rw.relicChoices[0]) + ')');
        }
        const pick = draftCard(rw.cards || []);
        if (pick) S('Run.addCard("' + pick + '")');
      } else if (type === 'event') {
        S('(function(){var ev=Run.rollEvent();var safe=ev.options.map(function(o,i){return o.risky?-1:i}).filter(function(i){return i>=0});' +
          'var i=safe.length?safe[Math.floor(Math.random()*safe.length)]:Math.floor(Math.random()*ev.options.length);' +
          'try{ev.options[i].run(Run.eventCtx())}catch(e){}})()');
        S('Run.settle("done")');
      } else if (type === 'shop') {
        S('Run.state.shop=Run.rollShop()');
        visitShop();
        S('Run.settle("done")');
      } else if (type === 'rest') {
        S('(function(){if(Run.state.hp<Run.state.maxHp*0.55)Run.heal(Run.restHealAmount());else Run.upgradeCardRandom()})()');
        S('Run.settle("done")');
      } else if (type === 'chest') {
        S('Run.openChest()');
        S('Run.settle("done")');
      }
    }
    if (S('Run.state.finished')) break;
    const next = pickPath();
    if (!next) break;
    S('Run.moveTo("' + next + '")');
  }
  const st = S('(function(){var s=Run.state;return {finished:s.finished,hp:s.hp,depth:Run.current().depth,' +
    'battles:s.battles,gold:s.gold,deck:s.deck.length,relics:s.relics.length,maxHp:s.maxHp}})()');
  return { won: !!(st.finished && st.hp > 0), depth: st.depth, battles: st.battles, turns: turns, death: death, st: st };
}

// ---------- 主流程 ----------
const CHARS = S('CHAR_ORDER');
const DLS = [1, 5, 10];
let seedBase = 910000;
const rows = {};
for (const ch of CHARS) {
  for (const dl of DLS) {
    const key = ch + '|DL' + dl;
    const depthHist = {};
    const cause = {};
    let wins = 0, turnSum = 0;
    const bossLefts = [];
    const bossStates = [];
    for (let i = 0; i < N; i++) {
      const r = aiRun(ch, dl, seedBase++);
      if (r.won) wins++;
      const dep = r.won ? r.depth : (r.death ? r.death.depth : r.depth);
      depthHist[dep] = (depthHist[dep] || 0) + 1;
      turnSum += r.turns;
      if (r.death) {
        if (r.death.type === 'boss') {
          bossLefts.push(r.death.foeLeft);
          if (r.death.depth === 11) bossStates.push(r.death);
        }
        const k = r.death.type + ':' + r.death.enemy.replace(/[\[\]"]/g, '').replace(/,/g, '+');
        cause[k] = (cause[k] || 0) + 1;
      }
    }
    rows[key] = {
      wins: wins, depthHist: depthHist, cause: cause, avgTurns: turnSum / N,
      bossLeft: bossLefts.length ? bossLefts.reduce((a, b) => a + b, 0) / bossLefts.length : null,
      d11: bossStates.length ? {
        n: bossStates.length,
        deck: bossStates.reduce((a, b) => a + b.deck, 0) / bossStates.length,
        relics: bossStates.reduce((a, b) => a + b.relics, 0) / bossStates.length,
        gold: bossStates.reduce((a, b) => a + b.gold, 0) / bossStates.length,
        maxHp: bossStates.reduce((a, b) => a + b.maxHp, 0) / bossStates.length,
        entryHp: bossStates.reduce((a, b) => a + b.entryHp, 0) / bossStates.length,
      } : null,
    };
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('每格=' + N + ' 场');
console.log(pad('角色/DL', 16) + pad('胜率', 7) + pad('平均回合', 10) + '死亡深度直方图');
for (const key of Object.keys(rows)) {
  const r = rows[key];
  const name = S('CHARACTERS["' + key.split('|')[0] + '"].name');
  const hist = Object.keys(r.depthHist).sort((a, b) => a - b)
    .map((d) => 'D' + d + '×' + r.depthHist[d]).join(' ');
  console.log(pad(name + ' ' + key.split('|')[1], 16) + pad((r.wins / N * 100).toFixed(0) + '%', 7) + pad(r.avgTurns.toFixed(1), 10) +
    (r.bossLeft == null ? '' : '(Boss均余' + r.bossLeft.toFixed(0) + '%) ') + hist);
  if (r.d11) {
    console.log('    └ D11 Boss 阵亡时：牌库 ' + r.d11.deck.toFixed(1) + ' 张 · 遗物 ' + r.d11.relics.toFixed(1) +
      ' 件 · 金币 ' + r.d11.gold.toFixed(0) + ' · 最大血 ' + r.d11.maxHp.toFixed(0) +
      ' · 进场血 ' + r.d11.entryHp.toFixed(0) + '（' + r.d11.n + ' 例）');
  }
}
console.log('\n死因 Top（角色 DL | 节点:敌人 ×次数）');
for (const key of Object.keys(rows)) {
  const list = Object.keys(rows[key].cause).sort((a, b) => rows[key].cause[b] - rows[key].cause[a]).slice(0, 3);
  if (!list.length) continue;
  const name = S('CHARACTERS["' + key.split('|')[0] + '"].name');
  console.log(name + ' ' + key.split('|')[1] + ' | ' + list.map((k) => k + ' ×' + rows[key].cause[k]).join('  |  '));
}
