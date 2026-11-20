// M82 / R7：整局 AI 平衡统计 —— 无头跑 N 场真实对局。
// 用法：node tools/ai-runs.js [每格局数]
// 策略是「合格的普通玩家」：有威胁先补挡，然后按 攻击 > 能力 > 技能 出牌，
// 资源卡照打；地图上低血找休息点，商店买药水/最便宜卡，其余随机选路。
// 它不追求最强打法 —— 平衡统计要的是「中等水平玩家的曲线」，不是 solver。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/cards-medic.js',
  'js/data/cards-keeper.js',
  'js/data/potions.js',
  'js/data/sfx-profile.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/story.js',
  'js/data/enemies.js',
  'js/core/progress.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];
const sandbox = { console: console };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}
const S = function (expr) { return vm.runInContext(expr, sandbox); };

// ---------- 战斗 AI ----------
function incomingDamage() {
  return S('(function(){var inc=0;Combat.state.enemies.forEach(function(e){' +
    'if(e.hp>0&&e.intent&&e.intent.kind==="attack")inc+=Combat.intentDamage(e)||0});return inc})()');
}

function aiTurn() {
  const s = S('Combat.state');
  const alive = s.enemies.findIndex(function (e) { return e.hp > 0; });
  if (alive >= 0) S('Combat.setTarget(' + alive + ')');
  let played = 0;
  let guard = 0;
  while (S('Combat.state.phase') === 'player' && guard++ < 40) {
    const hand = S('Combat.state.hand');
    const playable = hand.filter(function (c) { return S('Combat.canPlay(Combat.state.hand[' + hand.indexOf(c) + '])'); });
    if (!playable.length) break;
    const inc = incomingDamage();
    const playerBlock = S('Combat.state.player.block');
    const playerHp = S('Combat.state.player.hp');
    let best = null, bestScore = -1;
    playable.forEach(function (c) {
      const d = c.def;
      let score = 0;
      if (d.type === 'attack') score = 10 + ((d.v && d.v.dmg) || 5);
      else if (d.type === 'power') score = 8;
      else score = 4;
      // 有威胁就补挡（对照模式可用 AI_BLOCK=always 放开阈值）
      const blk = (d.v && d.v.block) || 0;
      const blockGate = process.env.AI_BLOCK === 'always' ? 0 : 4;
      if (inc > blockGate && playerBlock < inc && blk) score = 25 + blk;
      // 自伤牌：血量不健康时坚决不碰（引火者的卖血卡是策略，AI 只学保命）
      if (d.v && d.v.hp && playerHp <= d.v.hp * 4) score = -100;
      // 资源门槛高的牌降权（打不出的牌不该占评分首位，canPlay 已挡住大部分）
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (!best) break;
    S('Combat.playCard(' + best.uid + ')');
    played++;
  }
  return played > 0;
}

function playBattle(node) {
  // 全部在 vm 内构建：编队 → Combat.start（与 app.startBattle 同款参数）
  S('(function(){var enc=Run.encounterOf(Run.current());' +
    'var enemies=enc.enemyIds.map(function(id,i){return{id:id,' +
    'hpMul:(enc.enemyHpMul||[])[i]||1,variant:(enc.enemyVariant||[])[i]||null,' +
    'affixes:(enc.enemyAffixes||[])[i]||[]}});' +
    'Combat.start(Run.battleSeed(Run.current().id),{charId:Run.state.charId,' +
    'hp:Run.state.hp,maxHp:Run.state.maxHp,depth:Run.current().depth,locTag:"ai",' +
    'deck:Run.state.deck,relics:Run.state.relics,potions:Run.state.potions||[],' +
    'enemyId:Run.current().enemyId,enemies:enemies,' +
    'enemyHpPct:Run.modSum("enemyHpPct"),dlScale:1+0.15*(Run.curDl()-1)})})()');
  // 低血先喝回复药水 —— 商店买它就是干这个的
  S('(function(){if(Run.state.hp>=Run.state.maxHp*0.4)return;' +
    'var i=Combat.state.potions.indexOf("poultice");' +
    'if(i>=0&&Combat.state.phase==="player")Combat.usePotion(i)})()');
  let guard = 0;
  while (S('Combat.state.phase') !== 'win' && S('Combat.state.phase') !== 'lose' && guard++ < 600) {
    if (S('Combat.state.phase') === 'player') {
      // 出不了牌就结束回合 —— 否则 AI 会空转到 guard 上限（已在实测踩过）
      if (!aiTurn()) S('Combat.endTurn()');
    } else {
      S('Combat.endTurn()');
    }
  }
  const won = S('Combat.state.phase') === 'win';
  if (process.env.AI_VERBOSE) {
    console.log('  battle', node.id, node.type, won ? 'WIN' : 'LOSE',
      'php', S('Combat.state.player.hp') + '/' + S('Combat.state.player.maxHp'),
      'turn', S('Combat.state.turn'),
      'enemyHp', S('Combat.state.enemies.map(function(e){return e.hp+"|"+e.maxHp}).join(",")'));
  }
  return won;
}

// ---------- 整局 ----------
function aiRun(charId, dl, seed) {
  S('Run.start("act1", ' + seed + ', "' + charId + '", ' + dl + ')');
  let guard = 0;
  while (!S('Run.state.finished') && guard++ < 300) {
    const node = S('Run.current()');
    const cleared = S('Run.state.cleared["' + node.id + '"]');
    const type = node.type;
    if (!cleared || cleared === 'entry') {
      if (type === 'monster' || type === 'elite' || type === 'boss') {
        const won = playBattle(node);
        S('Run.settle("' + (won ? 'win' : 'lose') + '", Combat.state.player.hp)');
        if (won) {
          // 拿奖励：跳过诅咒，优先攻击牌
          S('(function(){var rw=Run.rollBattleReward(Run.current());if(!rw.cards||!rw.cards.length)return;' +
            'var good=rw.cards.filter(function(id){return CARDS[id].rarity!=="curse"});' +
            'var atk=good.filter(function(id){return CARDS[id].type==="attack"});' +
            'var pick=atk.length?atk[0]:(good.length?good[0]:null);' +
            'if(pick)Run.addCard(pick)})()');
        }
      } else if (type === 'event') {
        // 普通玩家本能：避开「risky」代价型选项，实在没有才选第一个
        S('(function(){var ev=Run.rollEvent();var safe=ev.options.map(function(o,i){return o.risky?-1:i}).filter(function(i){return i>=0});' +
          'var i=safe.length?safe[Math.floor(Math.random()*safe.length)]:Math.floor(Math.random()*ev.options.length);' +
          'try{ev.options[i].run(Run.eventCtx())}catch(e){}})()');
        S('Run.settle("done")');
      } else if (type === 'shop') {
        S('(function(){var shop=Run.state.shop||Run.rollShop();var bought=false;' +
          'for(var i=0;i<shop.potions.length;i++){var p=shop.potions[i];' +
          'if(!p.sold&&Run.potionSpace()>0&&Run.state.gold>=p.price){Run.spendGold(p.price);Run.addPotion(p.id);p.sold=true;bought=true;break;}}' +
          'if(!bought){var aff=shop.cards.filter(function(c){return !c.sold&&Run.state.gold>=c.price}).sort(function(a,b){return a.price-b.price})[0];' +
          'if(aff){Run.spendGold(aff.price);Run.addCard(aff.id);aff.sold=true;}}})()');
        S('Run.settle("done")');
      } else if (type === 'rest') {
        S('(function(){if(Run.state.hp<Run.state.maxHp*0.6)Run.heal(Run.restHealAmount());else Run.upgradeCardRandom()})()');
        S('Run.settle("done")');
      } else if (type === 'chest') {
        S('Run.openChest()');
        S('Run.settle("done")');
      }
    }
    if (S('Run.state.finished')) break;
    const moves = S('Run.current().edges.filter(function(id){return Run.canMoveTo(id)})');
    if (!moves.length) break;
    let next = S('(function(){var m=' + JSON.stringify(moves) + ';' +
      'if(Run.state.hp<Run.state.maxHp*0.35){var r=m.find(function(id){return Run.state.map.nodes[id].type==="rest"});if(r)return r;}' +
      'return m[Math.floor(Math.random()*m.length)]})()');
    S('Run.moveTo("' + next + '")');
  }
  return S('(function(){var s=Run.state;return {won: s.finished && s.hp>0, depth: Run.current().depth, battles: s.battles, hp: s.hp}})()');
}

// ---------- 主流程 ----------
const N = Number(process.argv[2]) || 20;
const CHARS = S('CHAR_ORDER');
const DLS = [1, 5, 10];
let seedBase = 820000;
console.log('AI 平衡统计：每格 ' + N + ' 场 | 策略：普通玩家（挡伤优先 + 攻击倾向）');
console.log('角色\\DL    胜率      平均深度   平均战斗   平均余血');
for (const ch of CHARS) {
  for (const dl of DLS) {
    let wins = 0, dsum = 0, bsum = 0, hsum = 0;
    for (let i = 0; i < N; i++) {
      const r = aiRun(ch, dl, seedBase++);
      if (r.won) wins++;
      dsum += r.depth; bsum += r.battles; hsum += r.hp;
    }
    const name = S('CHARACTERS["' + ch + '"].name');
    console.log(
      name + ' DL' + String(dl).padEnd(2) + '   ' +
      (wins / N * 100).toFixed(0).padStart(3) + '%      ' +
      (dsum / N).toFixed(1).padStart(6) + '    ' +
      (bsum / N).toFixed(1).padStart(6) + '    ' +
      (hsum / N).toFixed(1).padStart(6)
    );
  }
}
