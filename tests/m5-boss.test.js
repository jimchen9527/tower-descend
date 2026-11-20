// M5 验证：完整敌人池（5 小怪 + 3 中 Boss + 3 大 Boss）、深压、多敌人机制、Boss 奖励。
// 只加载逻辑层，不加载任何 render-*.js —— 战斗逻辑一行 document 都没有。
//
// 这一层验的是「数值与机制」：每个敌人的招式循环、三个大 Boss 的独特机制、
// 深压系数、多敌人的目标切换与胜负判定、中 Boss 必掉遗物。
// UI 只负责把这些显示出来，另由 ui-probe-boss.js 验证。
//
// 运行：node tests/m5-boss.test.js

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

const sandbox = { console: console };
vm.createContext(sandbox);

for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}

function suite() {
  let pass = 0;
  let fail = 0;

  function assert(cond, label) {
    if (cond) {
      pass++;
      console.log('  [ok]   ' + label);
    } else {
      fail++;
      console.log('  [FAIL] ' + label);
    }
  }

  // 开一场战斗。玩家血量给足，避免测试中途被打死干扰断言。
  function fight(enemyId, opts) {
    opts = opts || {};
    return Combat.start(opts.seed === undefined ? 1 : opts.seed, {
      enemyId: enemyId,
      depth: opts.depth === undefined ? 1 : opts.depth,
      hp: opts.hp === undefined ? 300 : opts.hp,
      maxHp: opts.maxHp === undefined ? 300 : opts.maxHp,
      deck: opts.deck,
      relics: opts.relics,
      enemyHpPct: opts.enemyHpPct,
    });
  }

  const E = () => Combat.state.enemies[0];
  const P = () => Combat.state.player;

  // ==========================================================
  console.log('\n[1] 敌人池结构：17 个敌人，招式引用无悬空');
  const allIds = Object.keys(ENEMIES);
  // M50：池子扩容 —— 小怪加 4 只（第二关 2 + 第三关专属 2），中 Boss 加 2 只
  // （每关各一个专属新中 Boss）。大 Boss 仍是 3 台，没动。
  assert(allIds.length === 29, '共 29 个敌人（21 小怪 + 5 中 Boss + 3 大 Boss；M56 起含 12 只进化体）');

  const normals = allIds.filter((k) => ENEMIES[k].kind === 'normal');
  const elites = allIds.filter((k) => ENEMIES[k].kind === 'elite');
  const bosses = allIds.filter((k) => ENEMIES[k].kind === 'boss');
  assert(normals.length === 21, '小怪 21 个（§9.1 五只 + M50 四只 + M56 十二只进化体）');
  assert(elites.length === 5, '中 Boss 5 个（§9.2 三只 + M50 两只）');
  assert(bosses.length === 3, '大 Boss 3 个（§9.3）');

  const dangling = [];
  const noRun = [];
  allIds.forEach(function (id) {
    const def = ENEMIES[id];
    (def.pattern || []).forEach(function (k) {
      if (!def.moves[k]) dangling.push(id + '.' + k);
    });
    (def.phaseMoves || []).forEach(function (k) {
      if (!def.moves[k]) dangling.push(id + '.phase:' + k);
    });
    Object.keys(def.moves).forEach(function (k) {
      if (typeof def.moves[k].run !== 'function') noRun.push(id + '.' + k);
    });
  });
  assert(dangling.length === 0, '所有 pattern / phaseMoves 引用的招式都存在' +
    (dangling.length ? '：' + dangling.join(',') : ''));
  assert(noRun.length === 0, '每个招式都有 run()' +
    (noRun.length ? '：' + noRun.join(',') : ''));

  const noGold = allIds.filter((k) => !ENEMIES[k].gold);
  assert(noGold.length === 0, '每个敌人都配了金币掉落区间');
  assert(bosses.every((k) => ENEMIES[k].tier), '三个大 Boss 都标了难度档位');
  assert(bosses.every((k) => ENEMIES[k].noDepthScale), '三个大 Boss 都不叠深压（noDepthScale）');

  // ==========================================================
  console.log('\n[2] 深压：小怪与中 Boss 按深度放大，大 Boss 不叠');
  // §13 深压 = 1 + 0.05 × (depth − 1)，取整后是闭区间
  function hpSpan(enemyId, depth, hpPct) {
    const out = [];
    for (let i = 1; i <= 120; i++) {
      fight(enemyId, { seed: i, depth: depth, enemyHpPct: hpPct });
      out.push(E().maxHp);
    }
    return { min: Math.min.apply(null, out), max: Math.max.apply(null, out) };
  }

  const d1 = hpSpan('rats', 1);
  assert(d1.min === 12 && d1.max === 18, 'D1 腐蚀鼠群 12–18（×1.00）');
  const d11 = hpSpan('rats', 11);
  assert(d11.min === 18 && d11.max === 27, 'D11 腐蚀鼠群 18–27（×1.50）');
  const d15 = hpSpan('rats', 15);
  assert(d15.min === 20 && d15.max === 31, 'D15 腐蚀鼠群 20–31（×1.70）');

  const elite15 = hpSpan('warlord', 15);
  assert(elite15.min === 153 && elite15.max === 187, 'D15 铁颚督军 153–187（中 Boss 叠深压）');

  const boss5 = hpSpan('rust_crown', 5);
  const boss15 = hpSpan('rust_crown', 15);
  assert(boss5.min === 220 && boss5.max === 220, 'D5 锈冠固定 220（大 Boss 不叠深压）');
  assert(boss15.min === 220 && boss15.max === 220, 'D15 锈冠仍是 220');

  const modded = hpSpan('rats', 1, -10);
  assert(modded.min === 11 && modded.max === 16, '事件给的「小怪生命 −10%」仍生效（×0.9）');

  // ==========================================================
  console.log('\n[3] 小怪池：逐个验证招式循环');

  // 腐蚀鼠群
  fight('rats');
  assert(E().intent.name === '咬', '鼠群起手是「咬」');
  assert(Combat.intentDamage(E()) === 5, '「咬」的意图伤害是 5');
  let hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 5, '咬造成 5 点伤害');
  assert(E().intent.name === '鼠群集结', '第二回合预告「鼠群集结」');
  Combat.endTurn();
  assert(E().buffs.str === 2, '鼠群集结给自己 +2 力量');
  assert(Combat.intentDamage(E()) === 7, '力量加成反映到意图上（5 + 2）');

  // 锈蚀哨兵
  fight('sentinel');
  assert(E().intent.name === '盾击', '哨兵起手是「盾击」');
  Combat.endTurn();
  assert(E().block === 4, '盾击给自己 4 点格挡');
  assert(E().intent.name === '重锤', '第二回合预告「重锤」');
  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 11, '重锤造成 11 点伤害');

  // 孢囊行者。这里直接执行招式，不走 endTurn —— endTurn 末尾会进玩家回合，
  // 回合一开始就把中毒结算掉了，读不到刚施加的 3 层
  fight('spore_walker');
  E().intent.run(Combat.ctx(E()));
  assert(P().buffs.poison === 3, '孢子施加 3 层中毒');
  hp0 = P().hp;
  Combat.startPlayerTurn();
  assert(hp0 - P().hp === 3 && P().buffs.poison === 2, '中毒回合开始扣 3 血并衰减到 2 层');

  // 井壁爬虫
  fight('crawler');
  assert(E().intent.desc(E()) === '攻击 4 × 2', '爬虫意图写明是两段攻击');
  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 8, '撕咬打两次，共 8 点伤害');
  assert(E().intent.name === '遁入墙缝', '第二回合预告「遁入墙缝」');
  Combat.endTurn();
  assert(E().block === 6, '遁入墙缝给自己 6 点格挡');

  // 拾荒者残影 —— 模仿你的上一张牌
  fight('scavenger_shade');
  Combat.endTurn();
  assert(E().block === 8, '你没出过牌 → 残影抓空，改为叠 8 格挡');

  fight('scavenger_shade');
  Combat.state.hand = [mkCard('strike')];
  Combat.playCard(Combat.state.hand[0].uid); // 打击：1 费攻击牌
  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 8, '模仿「打击」（1 费攻击）→ 造成 5 + 1×3 = 8 点伤害');

  fight('scavenger_shade');
  Combat.state.hand = [mkCard('hardhat')]; // 安全帽：1 费技能牌
  if (Combat.state.hand[0] && Combat.canPlay(Combat.state.hand[0])) {
    Combat.playCard(Combat.state.hand[0].uid);
  }
  Combat.endTurn();
  assert(E().block === 8, '上一张不是攻击牌 → 仍然只是叠格挡');

  // ==========================================================
  console.log('\n[4] 中 Boss：铁颚督军 / 双头犬 / 蚀骨工匠');

  // 铁颚督军：每 3 回合战吼
  fight('warlord');
  assert(E().intent.name === '横扫', '督军起手「横扫」');
  assert(E().intent.name === '横扫' && E().patternIndex === 1, '招式循环推进到第 2 位');
  Combat.state.enemies[0].intent = ENEMIES.warlord.moves.cleave;
  Combat.endTurn();
  Combat.state.enemies[0].intent = ENEMIES.warlord.moves.cleave;
  Combat.endTurn();
  Combat.state.enemies[0].intent = ENEMIES.warlord.moves.war_cry;
  Combat.addEnemy('rats', { hp: 12 }); // 借一只鼠群验证「全体」
  Combat.endTurn();
  assert(E().buffs.str >= 3, '战吼给自己 +3 力量');
  assert(Combat.state.enemies[1].buffs.str >= 3, '战吼是「全体」—— 同伴也吃到 +3 力量');

  // 双头犬：两颗头各自行动，一头死后另一头狂暴
  fight('hound');
  assert(Combat.state.enemies.length === 2, '双头犬开局就有两颗头');
  assert(Combat.state.enemies[0].name === '双头犬' &&
         Combat.state.enemies[1].name === '双头犬 #2', '重复名字自动加 #2 后缀');
  assert(ENEMIES.hound.onSpawn !== undefined, '第二颗头由 onSpawn 召唤');

  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp >= 9, '两颗头各行动一次（至少吃到一次撕咬）');

  Combat.state.enemies[0].hp = 0;
  Combat.checkEnd();
  assert(Combat.state.enemies[1].buffs.str >= 5, '一头死后，另一头 +5 力量狂暴');
  assert(Combat.state.phase === 'player', '还有一头活着，不算胜利');

  // 蚀骨工匠：骨甲跨回合累积（keepBlock）；砸击 / 叠甲交替，
  // 甲厚到 16 才发动骨刺；残血改拆骨狂击。
  // 这里要锁住的正是 M14 修的回归：旧版 pattern 只有 calcify、骨刺靠「甲 ≥16」触发，
  // 而玩家一回合打掉 8 点甲太容易 —— 甲永远到不了 16，它就成了「只会防御」的木桩。
  fight('bonewright');
  assert(ENEMIES.bonewright.keepBlock === true, '骨甲标记 keepBlock');
  assert(E().intent.name === '骨锤砸击', '起手「骨锤砸击」—— 不再只会叠甲');

  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 9, '骨锤砸击打 9 点（常态输出）');
  assert(E().intent.name === '骨质增生', '第二回合改叠骨甲（砸 / 叠 交替）');

  Combat.endTurn();
  assert(E().block === 8, '骨甲累积到 8（敌人回合不清零）');
  assert(E().intent.name === '骨锤砸击', '第三回合回到砸击，节奏可预测');

  Combat.endTurn();
  assert(E().block === 8, '砸击不消耗骨甲（甲仍停在 8）');
  assert(E().intent.name === '骨质增生', '甲不够厚 → 再叠一次');

  Combat.endTurn();
  assert(E().block === 16, '骨甲累积到 16');
  assert(E().intent.name === '骨刺', '骨甲够厚 → 改打骨刺（这条以前永远走不到）');

  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 18, '骨刺打 10 + 16÷2 = 18 点伤害');
  assert(E().block === 0, '骨刺把骨甲一起带出去');
  assert(E().intent.name === '骨质增生', '破甲后回去继续叠');

  // 核心：玩家打掉骨甲只是「延后」骨刺，不会把它打回只会叠甲的木桩
  fight('bonewright');
  E().block = 12;
  E().intent = ENEMIES.bonewright.moves.bone_slam;
  Combat.endTurn();
  assert(E().block === 12, '砸击不碰骨甲');
  assert(E().intent.name === '骨质增生', '甲只有 12（未到 16）→ 继续叠');
  E().block = 0; // 模拟玩家把骨甲打光
  Combat.endTurn();
  assert(E().block === 8, '被破甲后重新叠到 8');
  assert(E().intent.name === '骨锤砸击', '破甲之后下一手仍是砸击 —— 不是只会防御');

  // 残血阶段：拆下自己的骨头当投掷物，与砸击交替
  fight('bonewright');
  E().hp = Math.floor(E().maxHp * 0.3);
  E().patternIndex = 0;
  Combat.pickIntent(E());
  assert(E().intent.name === '碎骨狂击', '血量 ≤40% → 改用「碎骨狂击」');

  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 14, '碎骨狂击连打 2 次（7 × 2）');
  assert(E().intent.name === '骨锤砸击', '狂击与砸击交替，不是新的单调循环');

  // 骨甲上限：不设上限的话玩家一旦破不了甲就被锁死
  fight('bonewright');
  E().block = 24;
  E().intent = ENEMIES.bonewright.moves.calcify;
  hp0 = P().hp;
  Combat.endTurn();
  assert(E().block === 24, '骨甲封顶在 24，不会无限增长');
  assert(hp0 - P().hp === 9, '甲已封顶 → 不空转，改抡骨锤砸 9 点');

  // 骨甲被打光也拦不住骨刺 —— M14 的核心修正：
  // 爆发必然发生，玩家能改变的只是它带着多少甲出手（打甲 = 减伤，不是免疫）
  fight('bonewright');
  E().block = 0;
  E().charge = 2; // 模拟「叠满两轮，但每次都被玩家打掉」
  Combat.pickIntent(E());
  assert(E().intent.name === '骨刺', '甲被打光也照放骨刺（旧版这里永远是死循环叠甲）');
  hp0 = P().hp;
  Combat.endTurn();
  assert(hp0 - P().hp === 10, '甲为 0 时骨刺只剩基础 10 点 —— 打甲的价值是减伤');

  // ==========================================================
  console.log('\n[5] 大 Boss：锈冠 / 菌母 / 无首执械者');

  // 锈冠：常态交替「腐蚀 / 重砸」，血量过半后合并成「锈蚀重砸」
  fight('rust_crown');
  assert(E().intent.name === '锈蚀蔓延', '锈冠起手「锈蚀蔓延」');
  Combat.endTurn();
  assert(P().buffs.dex === -1, '锈蚀给我方 −1 敏捷');
  assert(E().intent.name === '重砸', '第二回合改「重砸」');

  E().hp = 100; // 220 的 45%，过半
  Combat.endTurn();
  assert(E().intent.name === '锈蚀重砸', '血量过半后改用合并招「锈蚀重砸」');
  assert(ENEMIES.rust_crown.choose !== undefined, '转换由 choose 驱动');

  fight('rust_crown');
  Combat.state.player.buffs.dex = -3;
  hp0 = P().hp;
  E().hp = 50;
  E().intent = ENEMIES.rust_crown.moves.rust_slam;
  Combat.endTurn();
  assert(hp0 - P().hp === 10, '锈蚀重砸造成 10 点伤害');
  assert(P().buffs.dex === -4, '并且继续叠锈（−1 敏捷）');

  // 菌母：每 2 回合召唤 1 只孢囊行者（HP 30），上限 3
  fight('mycelium_mother');
  assert(E().intent.name === '播散', '菌母起手就播散');
  Combat.endTurn();
  assert(Combat.state.enemies.length === 2, '召唤出 1 只孢囊行者');
  const minion = Combat.state.enemies[1];
  assert(minion.name.indexOf('孢囊行者') >= 0, '召唤物是孢囊行者');
  assert(minion.maxHp === 30, '召唤物固定 HP 30（§9.3，不叠深压）');
  assert(minion.intent !== null, '召唤物立刻有意图，不会行动时发呆');

  Combat.endTurn();
  Combat.endTurn();
  assert(Combat.state.enemies.length === 3, '继续召唤到第 2 只');
  Combat.endTurn();
  Combat.endTurn();
  assert(Combat.state.enemies.length === 4, '第 3 只');
  Combat.endTurn();
  Combat.endTurn();
  assert(Combat.state.enemies.length === 4, '上限 3 只，不再召唤');

  // 菌母死后小怪自爆
  fight('mycelium_mother');
  Combat.endTurn(); // 召出第 1 只
  Combat.endTurn();
  Combat.endTurn(); // 第 2 只
  const minionCount = Combat.state.enemies.length - 1;
  assert(minionCount === 2, '准备了 2 只小怪用于自爆测试');
  hp0 = P().hp;
  Combat.state.enemies[0].hp = 0; // 干掉本体
  Combat.checkEnd();
  assert(hp0 - P().hp === 10 * minionCount, '本体死后每只存活小怪自爆 10 点（共 ' + (10 * minionCount) + '）');
  assert(Combat.state.phase === 'win', '小怪随本体一起清空');

  // 自爆可以带走玩家 —— 这时算输，不算赢
  fight('mycelium_mother');
  Combat.endTurn();
  Combat.endTurn();
  Combat.endTurn();
  P().hp = 15; // 两只小怪 = 20 点，必死
  Combat.state.enemies[0].hp = 0;
  Combat.checkEnd();
  assert(Combat.state.phase === 'lose', '玩家被自爆带走时判负（死亡优先于敌人全灭）');

  // 无首执械者：每掉 1/3 血换姿态，换的当回合 +8 格挡
  fight('headless_executor');
  assert(E().phase === 1 && E().intent.name === '斩击', '第一段姿态是「斩击」');
  E().hp = 120; // 200 的 60%，掉到 2/3 以下
  Combat.endTurn();
  assert(E().phase === 2, '血量掉到 2/3 以下 → 切到第 2 套');
  assert(E().intent.name === '格挡反击', '第 2 套姿态的招是「格挡反击」');
  assert(E().block === 20, '切换当回合 +8 格挡，加上反击的 12 = 20');

  E().block = 0;
  E().hp = 60; // 掉到 1/3 以下
  Combat.endTurn();
  assert(E().phase === 3, '血量掉到 1/3 以下 → 切到第 3 套');
  assert(E().intent.name === '狂暴', '第 3 套姿态的招是「狂暴」');

  // ==========================================================
  console.log('\n[6] 多敌人：目标切换与胜负判定');

  fight('hound');
  assert(Combat.targetUnit() === Combat.state.enemies[0], '默认目标是第一个敌人');
  assert(Combat.setTarget(1) === true && Combat.targetUnit() === Combat.state.enemies[1],
    '可以手动切目标');
  assert(Combat.setTarget(99) === false, '切到不存在的目标返回 false');

  Combat.state.enemies[1].hp = 0;
  assert(Combat.targetUnit() === Combat.state.enemies[0],
    '当前目标死了，攻击自动落到还活着的敌人身上');

  // 单体攻击牌不会浪费在死人身上
  fight('hound');
  Combat.setTarget(1);
  Combat.state.enemies[1].hp = 0;
  hp0 = Combat.state.enemies[0].hp;
  Combat.state.hand = [mkCard('strike')];
  Combat.playCard(Combat.state.hand[0].uid);
  assert(hp0 - Combat.state.enemies[0].hp === 6, '目标已死时，打击打到了另一颗头');

  // state.enemy 兼容视图
  fight('hound');
  assert(Combat.state.enemy === Combat.state.enemies[0],
    'state.enemy 仍是「当前目标」的只读视图（M1–M4 的代码靠这个不动）');

  // 全灭才胜
  fight('hound');
  Combat.state.enemies[0].hp = 0;
  Combat.checkEnd();
  assert(Combat.state.phase === 'player', '只死一个不算赢');
  Combat.state.enemies[1].hp = 0;
  Combat.checkEnd();
  assert(Combat.state.phase === 'win', '全部清空才算赢');

  // 敌人死亡只结算一次
  fight('mycelium_mother');
  Combat.endTurn();
  const n1 = Combat.state.enemies.length;
  Combat.state.enemies[0].hp = 0;
  Combat.checkEnd();
  const logLen = Combat.state.log.length;
  Combat.checkEnd();
  Combat.checkEnd();
  assert(Combat.state.log.length === logLen, 'onDeath 不会重复触发（deadHandled 一次性）');
  assert(n1 >= 2, '自爆测试确实有召唤物');

  // ==========================================================
  console.log('\n[7] 地图：战斗节点的对手怎么定');

  Run.start('act1', 20260923);
  const map = Run.state.map;

  function walkTo(depth) {
    let guard = 0;
    while (Run.current().depth < depth && guard++ < 60) {
      const edges = Run.current().edges;
      if (!edges.length) break;
      Run.moveTo(edges[0]);
    }
  }

  walkTo(11);
  // 变量不能叫 d11 —— 上面深压那段（第 116 行）已经占了这个名字，同名会直接语法报错
  const boss1 = Run.current();
  assert(boss1.type === 'boss', 'D11 是 Boss 节点');
  assert(boss1.enemyId === 'rust_crown', 'D11 的对手是锈冠（§6 难度升序）');
  assert(boss1.bossTier === 1, '锈冠是难度 ①');

  walkTo(22);
  assert(Run.current().enemyId === 'mycelium_mother', 'D22 的对手是菌母');
  walkTo(33);
  assert(Run.current().enemyId === 'headless_executor', 'D33 的对手是无首执械者');

  // 小怪 / 中 Boss 从池子里抽，且抽到的一定在池子里
  const act = ACTS.act1;
  let badPool = 0;
  let sawMonster = 0;
  let sawElite = 0;
  for (let s = 1; s <= 40; s++) {
    Run.start('act1', s * 37 + 5);
    Run.state.map.layers.forEach(function (layer) {
      layer.forEach(function (n) {
        if (n.type === 'monster') {
          n.enemyId = Run.rollEnemyId(n);
          sawMonster++;
          if (act.enemyPool.indexOf(n.enemyId) < 0) badPool++;
        }
        if (n.type === 'elite') {
          n.enemyId = Run.rollEnemyId(n);
          sawElite++;
          if (act.elitePool.indexOf(n.enemyId) < 0) badPool++;
        }
      });
    });
  }
  assert(badPool === 0, '小怪与中 Boss 都从本关池子里抽（' + sawMonster + ' 个小怪 / ' +
    sawElite + ' 个中 Boss）');
  assert(sawElite > 0, '这些地图里确实出现了中 Boss 节点（不是空数据假通过）');

  // 同一节点的对手不会变 —— 中途退出再回到这个节点，还是同一种怪。
  // 从当前节点的出边里挑，不能随便取一层的节点：那多半走不过去。
  let checked = 0;
  for (let s2 = 1; s2 <= 40 && !checked; s2++) {
    Run.start('act1', s2 * 131 + 7);
    walkTo(2);
    const cand = Run.current().edges
      .map(function (id) { return Run.state.map.nodes[id]; })
      .filter(function (n) { return n.type === 'monster'; })[0];
    if (!cand) continue;

    Run.moveTo(cand.id);
    const first = cand.enemyId;
    assert(!!first && act.enemyPool.indexOf(first) >= 0, '进入战斗节点时定下对手');

    // 从入边节点重新走进来，模拟「退出之后又回到这个节点」
    Run.state.currentId = cand.in[0];
    assert(Run.moveTo(cand.id) !== null, '可以从上一层重新走进这个节点');
    assert(cand.enemyId === first, '重进同一节点，对手不变（不是每次重抽）');
    checked = 1;
  }
  assert(checked === 1, '找到了一个可以复现的战斗节点');

  // ==========================================================
  console.log('\n[8] 奖励：中 Boss 必掉遗物');

  Run.start('act1', 555);
  const eliteNode = { type: 'elite', enemyId: 'warlord' };
  const rw = Run.rollBattleReward(eliteNode);
  assert(!!rw.relicId, '中 Boss 一定会掉遗物');
  assert(Run.state.relics.indexOf(rw.relicId) >= 0, '掉落的遗物确实进了本局遗物栏');
  assert(rw.cards.length === 3, '仍然给 3 张候选卡');
  assert(rw.gold >= 60 && rw.gold <= 90, '金币落在铁颚督军的区间（60–90）');

  // 遗物拿满时折成金币 —— 「必掉」不能变成「什么都不掉」
  Run.start('act1', 556);
  Run.state.relics = relicPool();
  const rw2 = Run.rollBattleReward(eliteNode);
  assert(rw2.relicId === null, '遗物拿满时不再掉遗物');
  assert(rw2.bonusGold === 120, '改为补偿 120 金');
  assert(Run.state.gold === 99 + rw2.gold + 120, '补偿金确实进了口袋');

  // 小怪不掉遗物
  Run.start('act1', 557);
  const rw3 = Run.rollBattleReward({ type: 'monster', enemyId: 'rats' });
  assert(rw3.relicId === null && rw3.bonusGold === 0, '普通小怪不掉遗物');
  assert(rw3.gold >= 10 && rw3.gold <= 20, '鼠群金币 10–20');

  // Boss 的金币区间
  Run.start('act1', 558);
  const rw4 = Run.rollBattleReward({ type: 'boss', enemyId: 'rust_crown' });
  assert(rw4.gold >= 120 && rw4.gold <= 180, '大 Boss 金币 120–180');
  assert(rw4.relicId === null, '大 Boss 不额外掉遗物（遗物走中 Boss 与宝箱）');

  // ==========================================================
  console.log('\n[9] 一个完整 Boss 战能从头打到尾');

  Run.start('act1', 20260923);
  const bossDef = ENEMIES.rust_crown;
  const battle = Combat.start(12345, {
    enemyId: 'rust_crown',
    depth: 5,
    hp: 75,
    maxHp: 75,
    deck: Run.state.deck,
    relics: Run.state.relics,
  });
  assert(battle.enemies[0].maxHp === 220, '锈冠 220 血进场');

  let rounds = 0;
  while (Combat.state.phase === 'player' && rounds < 60) {
    rounds++;
    // 简单 AI：能出就打，打不动就结束回合
    let played = true;
    while (played && Combat.state.phase === 'player') {
      played = false;
      const card = Combat.state.hand.find((c) => Combat.canPlay(c));
      if (card) {
        Combat.playCard(card.uid);
        played = true;
      }
    }
    if (Combat.state.phase === 'player') Combat.endTurn();
  }
  assert(Combat.state.phase === 'win' || Combat.state.phase === 'lose',
    '整场 Boss 战有明确结局（' + Combat.state.phase + '，' + rounds + ' 回合）');
  assert(rounds >= 3, 'Boss 战不会一两回合就结束（预期 8–15 回合，简单 AI 打了 ' + rounds + ' 回合）');
  assert(Combat.state.log.length > 20, '战斗日志有内容（' + Combat.state.log.length + ' 行）');
  assert(Combat.state.log.every((l) => typeof l === 'string' && l.length > 0),
    '日志里没有空行或 undefined');
  assert(bossDef.tier === 1, '这场打的是难度 ① 的锈冠');

  // ==========================================================
  console.log('\n[10] 蚀骨工匠的实战节奏（M14：不许退回「只会防御」的木桩）');

  // 单点断言只能证明「机制存在」，证明不了「真实对局里会发生」。
  // 旧版就是反例：招式表里有骨刺、单元断言也能过，但玩家一回合打掉 8 点甲，
  // 甲永远到不了 16 —— 跑 60 场真实对局，骨刺 0 次，体感就是「只会防御」。
  // 这里用与 [9] 相同的简单 AI 打一场，统计它实际预告过的招式分布。
  Run.start('act1', 20260923);
  Combat.start(777, {
    enemyId: 'bonewright',
    depth: 5,
    hp: 75,
    maxHp: 75,
    deck: Run.state.deck,
    relics: Run.state.relics,
  });

  const usedMoves = {};
  let recRounds = 0;
  while (Combat.state.phase === 'player' && recRounds < 40) {
    recRounds++;
    const mv = Combat.state.enemies[0] && Combat.state.enemies[0].intent;
    if (mv) usedMoves[mv.id] = (usedMoves[mv.id] || 0) + 1;
    let acted = true;
    while (acted && Combat.state.phase === 'player') {
      acted = false;
      const card = Combat.state.hand.find((c) => Combat.canPlay(c));
      if (card) {
        Combat.playCard(card.uid);
        acted = true;
      }
    }
    if (Combat.state.phase === 'player') Combat.endTurn();
  }

  assert((usedMoves.bone_slam || 0) >= 2,
    '整场里「骨锤砸击」打出 ' + (usedMoves.bone_slam || 0) + ' 次（≥2，它真的会攻击）');
  assert((usedMoves.bone_spike || 0) >= 1,
    '整场里「骨刺」放出 ' + (usedMoves.bone_spike || 0) + ' 次（旧版这里是 0）');
  assert((usedMoves.calcify || 0) >= 1,
    '整场里「骨质增生」出现 ' + (usedMoves.calcify || 0) + ' 次（蓄力仍在）');
  assert(Object.keys(usedMoves).length >= 3,
    '整场用到 ' + Object.keys(usedMoves).length + ' 种招式（不是单调循环）');

  // ==========================================================
  console.log('\n' + (fail === 0 ? 'M5 全部通过' : 'M5 存在失败项') +
    '：' + pass + ' 通过 / ' + fail + ' 失败\n');
  return fail;
}

// suite 要送进 sandbox 里执行 —— 源文件里的 const 声明只活在 sandbox 的词法环境，
// 宿主脚本直接访问会 ReferenceError。返回失败数用来定退出码。
const failed = vm.runInContext(
  '(' + suite.toString() + ')()', sandbox, { filename: 'm5-suite.js' }
);
process.exit(failed === 0 ? 0 : 1);
