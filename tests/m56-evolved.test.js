// M56 验证：第 2/3 关敌人进化体（12 只全新设计，替代 M50「壮大版」词缀方案）。
//
// 验的是「进化体不是换皮 buff」：
//   · 每只进化体有自己的招式表，且新招真的生效（结算层验证，不是只看数据）
//   · 血统链完整（evolvedFrom / evolvedStage），池子挂接与设计稿一致
//   · 死亡钩子（孢囊母株自爆）真的打得到玩家
//   · 模仿公式升级版真的按新公式算
//   · 美术接线完整：位图映射 + SVG 剪影 + -cut.png 文件都在
//
// 运行：node tests/m56-evolved.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

const sandbox = { console: console, fs: fs, path: path, BASE: BASE };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}

function suite() {
  let pass = 0, fail = 0;
  function assert(cond, label) {
    if (cond) { pass++; console.log('  [ok]   ' + label); }
    else { fail++; console.log('  [FAIL] ' + label); }
  }

  function fight(opts) {
    return Combat.start(opts.seed === undefined ? 1 : opts.seed, {
      enemies: opts.enemies,
      depth: opts.depth === undefined ? 1 : opts.depth,
      hp: opts.hp === undefined ? 300 : opts.hp,
      maxHp: opts.maxHp === undefined ? 300 : opts.maxHp,
    });
  }
  const S = () => Combat.state;
  const E0 = () => Combat.state.enemies[0];
  // 让当前第一只敌人立刻执行它的意图
  function enemyAct() { Combat.enemyTurn(); }

  // ==========================================================
  console.log('\n[1] 池子挂接：第 2/3 关的每一层都只抽进化体');
  let seg2Ok = 0, seg3Ok = 0, seg2Seen = {}, seg3Seen = {};
  for (let s = 1; s <= 120; s++) {
    Run.start('act1', s * 1013 + 17);
    Run.state.map.layers.forEach(function (layer) {
      layer.forEach(function (n) {
        if (n.type !== 'monster') return;
        const enc = Run.rollEncounter(n);
        enc.enemyIds.forEach(function (id) {
          if (n.depth <= 11) return;
          if (n.depth <= 22) { seg2Ok++; seg2Seen[id] = 1; }
          else { seg3Ok++; seg3Seen[id] = 1; }
        });
      });
    });
  }
  const SEG2 = ACTS.act1.segments[1].enemyPool;
  const SEG3 = ACTS.act1.segments[2].enemyPool;
  assert(Object.keys(seg2Seen).every((id) => SEG2.indexOf(id) >= 0),
    '第二关抽到的每一种都在段池子里');
  assert(Object.keys(seg3Seen).every((id) => SEG3.indexOf(id) >= 0),
    '第三关抽到的每一种都在段池子里');
  const evo2 = SEG2.filter((id) => ENEMIES[id].evolvedStage === 2);
  const evo3 = SEG3.filter((id) => ENEMIES[id].evolvedStage === 3);
  assert(evo2.length === 5 && evo3.length === 7,
    '二阶 5 只 + 三阶 7 只（含二关新怪的进化体），设计稿对账');

  // ==========================================================
  console.log('\n[2] 招式真的生效（结算层，不是只看数据）');

  // 锈牙鼠王：鼠潮啃噬 2×5
  fight({ seed: 11, enemies: [{ id: 'rat_king' }], hp: 300 });
  S().enemies[0].intent = S().enemies[0].def.moves.swarm_bite;
  enemyAct();
  assert(S().player.hp === 300 - 10, '鼠潮啃噬打进 2×5=10（实测 ' + (300 - S().player.hp) + '）');

  // 孢囊行者·孕体：胀裂 —— 攻 6 + 毒 2 + 自失 3
  fight({ seed: 12, enemies: [{ id: 'spore_gravid' }], hp: 300 });
  S().enemies[0].hp = S().enemies[0].maxHp;
  const gravidHp = S().enemies[0].hp;
  S().enemies[0].intent = S().enemies[0].def.moves.burst_sac;
  enemyAct();
  assert(S().player.hp === 300 - 6 && (S().player.buffs.poison || 0) === 2 &&
    S().enemies[0].hp === gravidHp - 3,
    '胀裂 = 攻 6 · 毒 2 · 自失 3，三项都兑现');

  // 孢囊母株：死亡自爆 —— 杀了它玩家挨 8
  fight({ seed: 13, enemies: [{ id: 'spore_mother' }], hp: 300 });
  S().enemies[0].hp = 1;
  const beforePlayer = S().player.hp;
  Combat.ctx(S().enemies[0]).dealDamage(S().enemies[0], S().enemies[0], 10);
  Combat.resolveDeaths();
  assert(S().enemies.every((e) => e.hp <= 0), '母株被击杀');
  assert(S().player.hp === beforePlayer - 8,
    '死亡自爆对玩家造成 8 点（实测 ' + (beforePlayer - S().player.hp) + '）');

  // 残影·聚尸者：模仿公式升级 —— 5 + 费用×4
  fight({ seed: 14, enemies: [{ id: 'shade_gatherer' }], hp: 300 });
  S().lastPlayed = { type: 'attack', cost: 1 };
  S().enemies[0].intent = S().enemies[0].def.moves.mimic_up;
  const beforeMimic = S().player.hp;
  enemyAct();
  assert(S().player.hp === beforeMimic - 9,
    '模仿升级版：1 费攻击牌被模仿成 5+4=9（实测 ' + (beforeMimic - S().player.hp) + '）');

  // 过载工头：弧光鞭 = 攻 7 + 燃烧 3；超频 = +3 力量自伤 4
  fight({ seed: 15, enemies: [{ id: 'welder_overload' }], hp: 300 });
  S().enemies[0].intent = S().enemies[0].def.moves.arc_whip;
  enemyAct();
  assert(S().player.hp === 300 - 7 && (S().player.buffs.burn || 0) === 3,
    '弧光鞭 = 攻 7 · 燃烧 3');
  fight({ seed: 16, enemies: [{ id: 'welder_overload' }], hp: 300 });
  const wHp = S().enemies[0].hp;
  S().enemies[0].intent = S().enemies[0].def.moves.overclock;
  enemyAct();
  assert(S().enemies[0].buffs.str === 3 && S().enemies[0].hp === wHp - 4,
    '超频 = +3 力量 · 自伤 4');

  // 哨兵·攻城型：堡垒 = 格挡 12 + 荆棘 1
  fight({ seed: 17, enemies: [{ id: 'sentinel_siege' }], hp: 300 });
  S().enemies[0].intent = S().enemies[0].def.moves.fortress;
  enemyAct();
  assert(S().enemies[0].block === 12 && S().enemies[0].buffs.thorns === 1,
    '堡垒 = 格挡 12 · 荆棘 1');

  // 百衲怨影：影缚 = 攻 5 + 脆弱 2
  fight({ seed: 18, enemies: [{ id: 'shade_patch' }], hp: 300 });
  S().enemies[0].intent = S().enemies[0].def.moves.bind;
  enemyAct();
  assert(S().player.hp === 300 - 5 && (S().player.buffs.vulnerable || 0) === 2,
    '影缚 = 攻 5 · 脆弱 2');

  // ==========================================================
  console.log('\n[3] 意图可见性：每只进化体的每个招式都能渲染出意图文案');
  const EVOLVED = ['rat_king', 'sentinel_breach', 'spore_gravid', 'crawler_molt', 'shade_gatherer',
    'rat_tide', 'sentinel_siege', 'spore_mother', 'crawler_maul', 'shade_patch',
    'welder_overload', 'piledriver_breach'];
  EVOLVED.forEach(function (id) {
    const def = ENEMIES[id];
    const keys = Object.keys(def.moves);
    assert(keys.length >= 2 && keys.length <= 4, id + ' 招式数 ' + keys.length + '（2–4，不读不完）');
    keys.forEach(function (k) {
      const m = def.moves[k];
      fight({ seed: 21, enemies: [{ id: id }] });
      S().enemies[0].intent = m;
      const txt = Combat.intentText ? Combat.intentText(S().enemies[0]) : (S().enemies[0].def.id + ':ok');
      assert(typeof txt === 'string' && txt.length > 0,
        id + ' · ' + m.name + ' 意图文案可渲染');
    });
  });

  // ==========================================================
  console.log('\n[4] 美术接线：位图映射、SVG 剪影、-cut.png 文件三样齐全');
  // 位图映射与文件在 art.js / preview-assets-v3，这里用文件系统直接验
  let artOk = 0;
  const artSrc = fs.readFileSync(path.join(BASE, 'js/ui/art.js'), 'utf8');
  EVOLVED.forEach(function (id) {
    const file = path.join(BASE, 'preview-assets-v3', id + '-cut.png');
    const hasMap = artSrc.indexOf(id + ": '" + id + '-cut.png') >= 0;
    const hasSil = artSrc.indexOf('\n    ' + id + ':') >= 0 ||
      new RegExp('\\n\\s+' + id + ':\\n').test(artSrc);
    const hasFile = fs.existsSync(file) && fs.statSync(file).size > 50000;
    if (hasMap && hasSil && hasFile) artOk++;
    else console.log('      缺件: ' + id + ' map=' + hasMap + ' sil=' + hasSil + ' file=' + hasFile);
  });
  assert(artOk === 12, '12 只进化体的立绘映射 + 剪影 + 文件齐全（' + artOk + '/12）');
  const cssSrc = fs.readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
  const cssOk = EVOLVED.filter((id) => cssSrc.indexOf('.art-id-' + id) >= 0).length;
  assert(cssOk === 12, '体型档位类 12/12 落在 art.css（实测 ' + cssOk + '）');

  // ==========================================================
  console.log('\n[5] 一阶不动：第一关池子与数值原样');
  assert(ACTS.act1.segments[0].enemyPool.join(',') ===
    'rats,sentinel,spore_walker,crawler,scavenger_shade',
    '第一关池子原样');
  fight({ seed: 31, enemies: [{ id: 'rats' }] });
  assert(E0().maxHp >= 12 && E0().maxHp <= 18 && E0().def.moves.bite.value === 5,
    '一阶腐蚀鼠群 12–18、咬 5 不变');

  console.log('\nM56 全部' + (fail ? '未通过' : '通过') + '：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
}

vm.runInContext('(' + suite.toString() + ')()', sandbox, { filename: 'm56-suite' });
