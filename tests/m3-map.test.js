// M3 地图生成验证：33 层结构 + 固定 4 条主干 + 本局移动流程。
// 只加载逻辑层，不加载 render.js / render-map.js。
//
// 运行：node tests/m3-map.test.js

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
  'js/core/map.js',
  'js/core/run.js',
];

// 批量生成的种子数 —— 校验是统计意义上的，单看一张图说明不了问题。
// suite 会被序列化后丢进沙箱执行，所以常量必须挂在 sandbox 上，不能用文件作用域的 const。
const sandbox = { console: console, SEEDS: 500 };
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

  // 批量生成，失败就返回 null（不抛，避免测试中断）
  function batch(n) {
    const maps = [];
    const failures = [];
    for (let i = 0; i < n; i++) {
      try {
        maps.push(MapGen.generate('act1', 100000 + i * 13));
      } catch (e) {
        failures.push({ seed: 100000 + i * 13, message: e.message });
      }
    }
    return { maps: maps, failures: failures };
  }

  // ==========================================================
  console.log('\n[1] 批量生成：' + SEEDS + ' 个种子全部通过校验');
  const { maps, failures } = batch(SEEDS);
  assert(failures.length === 0, SEEDS + ' 个种子全部生成成功（失败 ' + failures.length + ' 个）');
  if (failures.length) {
    failures.slice(0, 3).forEach(function (f) {
      console.log('         种子 ' + f.seed + '：' + f.message);
    });
  }

  // 空数据会让后面所有"坏 X 计数 === 0"的断言假通过 —— 直接停下来，不要让空的绿骗人
  if (!maps.length) throw new Error('没有任何一张图生成成功，后续断言没有意义');

  // ==========================================================
  console.log('\n[2] 结构：层数 / 单入口 / Boss 层 / 每层节点数');
  let badDepth = 0, badEntry = 0, badBossLayer = 0, badCount = 0;
  maps.forEach(function (m) {
    const act = ACTS[m.actId];
    if (m.depth !== act.depth || m.layers.length !== act.depth) badDepth++;
    if (m.layers[0].length !== 1 || m.entryId !== m.layers[0][0].id) badEntry++;
    m.bossDepths.forEach(function (d) {
      if (m.layers[d - 1].length !== 1 || m.layers[d - 1][0].type !== 'boss') badBossLayer++;
    });
    m.layers.forEach(function (layer, idx) {
      const d = idx + 1;
      const single = d === 1 || m.bossDepths.indexOf(d) >= 0;
      if (layer.length !== (single ? 1 : m.lanes)) badCount++;
    });
  });
  assert(badDepth === 0, '全部 33 层（Act1）');
  assert(badEntry === 0, '入口唯一且在第 1 层');
  assert(badBossLayer === 0, '三个 Boss 层各自只有一个节点，且类型正确');
  assert(badCount === 0, '非单节点层的节点数等于该图主干路线数，无合并、无缺失');

  // ==========================================================
  console.log('\n[3] 主干路线数固定为 4（§5.1 硬指标）');
  const laneHist = {};
  maps.forEach(function (m) {
    laneHist[m.lanes] = (laneHist[m.lanes] || 0) + 1;
  });
  // 横向数量不随机 —— 地图宽度由它反推（§5.5），随机会让最坏情况失控。
  assert(maps.every(function (m) { return m.lanes === 4; }), '主干数恒为 4（是定值，不是区间）');
  assert(Object.keys(laneHist).length === 1, '所有图的主干数完全一致，不随种子变');
  console.log('         分布：' + Object.keys(laneHist).sort().map(function (k) {
    return k + ' 条 × ' + laneHist[k];
  }).join(' ｜ '));

  // ==========================================================
  console.log('\n[4] 可走性：入口到末层的走法数 ≥ 主干数');
  let minPaths = Infinity, maxPaths = 0;
  let sumPaths = 0, badPaths = 0;
  maps.forEach(function (m) {
    const pc = m.pathCount;
    if (pc < m.lanes) badPaths++;
    minPaths = Math.min(minPaths, pc);
    maxPaths = Math.max(maxPaths, pc);
    sumPaths += pc;
  });
  assert(badPaths === 0, '没有断头的图（走法数全部 ≥ 主干数）');
  console.log('         走法数：最少 ' + minPaths + '，最多 ' + maxPaths +
              '，平均 ' + Math.round(sumPaths / maps.length));

  // ==========================================================
  console.log('\n[5] 主干路线差异度 ≥ 50%（"互不完全重合"的量化）');
  let minDiv = 1;
  maps.forEach(function (m) { minDiv = Math.min(minDiv, m.divergence); });
  assert(minDiv >= 0.5, '最低差异度 ' + (minDiv * 100).toFixed(1) + '%（阈值 50%）');

  // ==========================================================
  console.log('\n[6] 边：只向下、无重复、每个节点都接得上');
  let badUp = 0, badDup = 0, noOut = 0, noIn = 0, badCol = 0;
  maps.forEach(function (m) {
    m.layers.forEach(function (layer, idx) {
      const d = idx + 1;
      const cols = {};
      layer.forEach(function (n) {
        if (cols[n.col]) badCol++;
        cols[n.col] = true;

        if (d < m.depth && n.edges.length === 0) noOut++;
        if (d > 1 && n.in.length === 0) noIn++;

        const seen = {};
        n.edges.forEach(function (id) {
          if (seen[id]) badDup++;
          seen[id] = true;
          if (m.nodes[id].depth !== d + 1) badUp++;
        });
      });
    });
  });
  assert(badUp === 0, '所有边都指向下一层，没有回溯');
  assert(badDup === 0, '同一节点没有重复出边');
  assert(noOut === 0, '每个非末层节点都有出边');
  assert(noIn === 0, '每个非入口节点都有入边');
  assert(badCol === 0, '同一层内列位置不重复');

  // ==========================================================
  console.log('\n[7] Boss：三个全登场 + 难度升序（§6）');
  let badBossSet = 0, badTier = 0;
  maps.forEach(function (m) {
    const act = ACTS[m.actId];
    if (m.bossNodes.length !== act.bosses.length) badBossSet++;
    m.bossNodes.forEach(function (b, i) {
      if (b.bossId !== act.bosses[i].id || b.depth !== act.bossDepths[i]) badBossSet++;
    });
    for (let i = 1; i < m.bossNodes.length; i++) {
      if (m.bossNodes[i].tier <= m.bossNodes[i - 1].tier) badTier++;
    }
  });
  assert(badBossSet === 0, '每张图 3 个 Boss 全部登场，按名单顺序落在 D11 / D22 / D33');
  assert(badTier === 0, 'Boss 难度严格随深度递增');
  const one = maps[0];
  console.log('         ' + one.bossNodes.map(function (b) {
    return 'D' + b.depth + ' ' + b.name + '（tier' + b.tier + '）';
  }).join('  →  '));

  // ==========================================================
  console.log('\n[8] 节点类型规则：D32 全休息 / D10·D21 休息加成 / 每层有战斗');
  let badLast = 0, badCombatFloor = 0;
  maps.forEach(function (m) {
    m.layers[m.depth - 2].forEach(function (n) {
      if (n.type !== 'rest') badLast++;
    });
    // 入口层 / Boss 层 / D(末-1) 的类型是规则定的，不该参与「每层要有战斗」的检查
    const fixed = {};
    m.bossDepths.forEach(function (d) { fixed[d] = true; });
    fixed[1] = true;
    fixed[m.depth - 1] = true;

    m.layers.forEach(function (layer, idx) {
      if (fixed[idx + 1]) return;
      const has = layer.some(function (n) {
        return n.type === 'monster' || n.type === 'elite';
      });
      if (!has) badCombatFloor++;
    });
  });
  assert(badLast === 0, '末层 Boss 的上一层全是休息点');
  assert(badCombatFloor === 0, '每个随机层至少有一个战斗节点（入口/Boss/强制休息层除外）');

  // D10 / D21 的休息点占比应明显高于普通层（权重 ×3 的实际效果）
  function restRate(ms, depth) {
    let rest = 0, total = 0;
    ms.forEach(function (m) {
      m.layers[depth - 1].forEach(function (n) {
        total++;
        if (n.type === 'rest') rest++;
      });
    });
    return rest / total;
  }
  const r10 = restRate(maps, 10);
  const r13 = restRate(maps, 13);
  const r21 = restRate(maps, 21);
  const r24 = restRate(maps, 24);
  assert(r10 > r13 * 1.5, 'D10 休息点占比 ' + (r10 * 100).toFixed(1) + '% 明显高于普通层 D13 的 ' + (r13 * 100).toFixed(1) + '%');
  assert(r21 > r24 * 1.5, 'D21 休息点占比 ' + (r21 * 100).toFixed(1) + '% 明显高于普通层 D24 的 ' + (r24 * 100).toFixed(1) + '%');

  // M28：精英不入前列 —— 每个 Boss 段的前 1/3 随机层不出精英
  const g = maps[0];
  assert(MapGen.eliteAllowedAt(g, 4) === false && MapGen.eliteAllowedAt(g, 5) === true,
         '段 1（D2–10）：D4 禁精英、D5 起可出');
  assert(MapGen.eliteAllowedAt(g, 14) === false && MapGen.eliteAllowedAt(g, 15) === true,
         '段 2（D12–21）：D14 禁精英、D15 起可出');
  assert(MapGen.eliteAllowedAt(g, 25) === false && MapGen.eliteAllowedAt(g, 26) === true,
         '段 3（D23–31）：D25 禁精英、D26 起可出');
  let earlyElite = 0, totalElite = 0;
  maps.forEach(function (m) {
    Object.keys(m.nodes).forEach(function (id) {
      if (m.nodes[id].type === 'elite') {
        totalElite++;
        if (!MapGen.eliteAllowedAt(m, m.nodes[id].depth)) earlyElite++;
      }
    });
  });
  assert(earlyElite === 0, SEEDS + ' 张图里精英零次出现在段内前列（共 ' + totalElite + ' 个精英）');
  assert(totalElite > 0, '门槛没有把精英从地图里清零（' + SEEDS + ' 张图共 ' + totalElite + ' 个精英）');

  // ==========================================================
  console.log('\n[9] 换道可用性');
  let withFork = 0;
  let forkEdges = 0, totalEdges = 0, totalNodes = 0;
  maps.forEach(function (m) {
    let fork = false;
    Object.keys(m.nodes).forEach(function (id) {
      const n = m.nodes[id];
      totalNodes++;
      totalEdges += n.edges.length;
      if (n.edges.length > 1) { fork = true; forkEdges++; }
    });
    if (fork) withFork++;
  });
  assert(withFork === maps.length, '每张图都存在分岔节点（不是一条线的走廊）');
  console.log('         平均每个节点 ' + (totalEdges / totalNodes).toFixed(2) +
              ' 条出边，存在分岔的节点占比 ' + ((forkEdges / totalNodes) * 100).toFixed(0) + '%');

  // ==========================================================
  console.log('\n[10] 同种子可复现');
  const a = MapGen.generate('act1', 424242);
  const b = MapGen.generate('act1', 424242);
  assert(JSON.stringify(a) === JSON.stringify(b), '同种子生成的两张图完全一致');
  const c = MapGen.generate('act1', 424243);
  assert(JSON.stringify(a) !== JSON.stringify(c), '换种子生成的图不同');

  // ==========================================================
  console.log('\n[11] 本局流程（Run）');
  Run.start('act1', 20260923);
  assert(Run.state.currentId === Run.state.map.entryId, '开局站在入口');
  assert(Run.state.hp === 75 && Run.state.maxHp === 75, '开局 75 血');
  assert(Object.keys(Run.state.visited).length === 1, '只访问过入口');

  const route = Run.state.map.routes[0];
  assert(Run.canMoveTo(route[1]) === true, '能从入口走到主干第 1 层节点');
  assert(Run.canMoveTo(route[3]) === false, '不能跳层（只能走相邻下层）');

  let steps = 0;
  for (let i = 1; i < route.length; i++) {
    if (!Run.canMoveTo(route[i])) { steps = -1; break; }
    Run.moveTo(route[i]);
    steps++;
  }
  assert(steps === 32, '沿主干走完 D1→D33 共 32 步（实际 ' + steps + '）');
  assert(Run.state.currentId === route[route.length - 1], '停在末层 Boss 节点');
  assert(Run.canMoveTo('d1-0') === false, '末层没有下一步');

  Run.settle('win', 42);
  assert(Run.state.hp === 42, '战斗后的血量写回本局进度');
  assert(Run.state.finished === true, '走到末层并结算 → 本大关结束');
  assert(Run.state.cleared[route[route.length - 1]] === 'win', '末层节点标记为已通过');

  Run.start('act1', 777);
  const r0 = Run.state.map.routes[1];
  Run.moveTo(r0[1]);
  Run.settle('lose', 0);
  assert(Run.state.finished === true, '战败 → 本局立即结束');

  // ==========================================================
  console.log('\n[12] 战斗种子：同局同节点可复现、跨节点不同');
  Run.start('act1', 555);
  const s1 = Run.battleSeed('d3-0');
  const s2 = Run.battleSeed('d3-0');
  const s3 = Run.battleSeed('d3-1');
  assert(s1 === s2, '同一节点两次取种子一致');
  assert(s1 !== s3, '不同节点种子不同');
  assert(s1 >= 0 && s1 <= 4294967295, '种子落在 uint32 范围内');

  console.log('\n' + (fail === 0 ? '全部通过' : '存在失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败\n');
  if (fail > 0) throw new Error('M3 地图测试未全部通过');
}

vm.runInContext('(' + suite.toString() + ')()', sandbox);
