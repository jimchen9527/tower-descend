// 地图生成 —— 纯逻辑，不碰 DOM。
// 设计文档 §5：每个大关固定 4 条主干路线、21 层，入口到 Boss 层必须路路通。
//
// 结构：每层若干节点（入口层与 Boss 层为单节点），边只指向 depth+1，保证单调向下。
// 换道：相邻主干之间按概率加斜边，每对相邻主干在同一层最多一条，避免 X 交叉。

// 按权重抽一个键 —— Object.keys 顺序稳定，同种子可复现
function pickWeighted(weights, rng) {
  const keys = Object.keys(weights);
  let total = 0;
  for (let i = 0; i < keys.length; i++) total += weights[keys[i]];
  let r = rng.next() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[keys[i]];
    if (r < 0) return keys[i];
  }
  return keys[keys.length - 1];
}

const MapGen = {
  MAX_RETRY: 20,
  LANE_CHANGE_P: 0.25, // §5.3 第 3 条

  // ---------- 入口 ----------

  generate(actId, seed, dl) {
    const act = ACTS[actId];
    if (!act) throw new Error('未知大关：' + actId);

    let last = null;
    for (let i = 0; i < this.MAX_RETRY; i++) {
      // §5.3 第 9 条：校验不过就整体重生成（换种子）
      RNG.init((seed + i * 7919) >>> 0);
      const map = this.build(act, RNG, dl);
      const v = this.validate(map);
      if (v.ok) {
        map.attempts = i + 1;
        map.pathCount = v.pathCount;
        map.divergence = v.divergence;
        return map;
      }
      last = v.issues;
    }
    throw new Error(
      '地图生成失败：' + this.MAX_RETRY + ' 次重试仍不满足约束。最后一批问题：' + last.join('；')
    );
  },

  // ---------- 构建 ----------

  build(act, rng, dl) {
    const depth = act.depth;
    const lanes = 4; // §5.1：固定 4 条主干（横向不随机 —— 地图宽度由它反推，随机会让最坏情况失控）

    // §3.1 每级特殊调整（M31 补齐第 1 条）：DL3 起「中 Boss 数 +1」。
    // 存进 map 而不是每次现算 —— 地图整张进存档（§17 第 26 条），
    // 读档后要还原成生成时那套权重，不能按「读档时的 DL」重算。
    const dlv = dl || 1;
    const map = {
      actId: act.id,
      actName: act.name,
      depth: depth,
      lanes: lanes,
      seed: rng.seed,
      dl: dlv,                                  // 生成时的 DL（存档要带着）
      eliteBonus: dlv >= 3 ? 1 : 0,             // DL3+：精英权重整体上调一档
      bossDepths: act.bossDepths.slice(),
      layers: [],
      nodes: {},
      entryId: null,
      bossNodes: [],
      routes: [],
    };

    const bossSet = {};
    map.bossDepths.forEach(function (d) { bossSet[d] = true; });

    for (let d = 1; d <= depth; d++) {
      const count = (d === 1 || bossSet[d]) ? 1 : lanes;
      const cols = this.layerCols(count, lanes, rng);
      const layer = [];
      for (let i = 0; i < count; i++) {
        const id = 'd' + d + '-' + i;
        map.nodes[id] = {
          id: id, depth: d, lane: i, col: cols[i],
          type: 'monster', edges: [], in: [],
        };
        layer.push(map.nodes[id]);
      }
      map.layers.push(layer);
      if (d === 1) map.entryId = layer[0].id;
    }

    this.assignTypes(map, act, rng);
    this.ensureCombatFloor(map);
    this.connect(map, rng);
    this.buildRoutes(map);
    this.markBosses(map, act);
    return map;
  },

  // 每层每条主干的横向位置：均分 + 随机偏移，强制严格递增
  // 严格递增同时保证两件事：同层不重叠、主干不交叉（顺序恒定）
  layerCols(count, lanes, rng) {
    if (count === 1) return [lanes]; // 单节点居中
    const cols = [];
    let prev = -1;
    for (let i = 0; i < count; i++) {
      let c = 1 + i * 2 + rng.int(-1, 1);
      if (c <= prev) c = prev + 1;
      cols.push(c);
      prev = c;
    }
    return cols;
  },

  // M28：精英不入前列 —— 每个 Boss 段（bossDepths 划分）的前 1/3 随机层
  // 不出精英（中 Boss），玩家在前段先攒成长，精英集中在中后段当「段内小高潮」。
  // 段 1（D2–10）D5 起可出；段 2（D12–21）D15 起；段 3（D23–31）D26 起。
  // 入口/Boss/强制休息层由各自的规则定类型，不会走到权重抽样，无须在此排除。
  eliteAllowedAt(map, d) {
    const bosses = map.bossDepths;
    let start = 2; // 第一段从入口后一层起
    for (let i = 0; i < bosses.length; i++) {
      const end = bosses[i] - 1; // 段内最后一个可随机层（Boss 层前一层）
      if (d <= end) {
        const len = end - start + 1;
        return d - start >= Math.floor(len / 3);
      }
      start = bosses[i] + 1;
    }
    return true;
  },

  assignTypes(map, act, rng) {
    const lastD = map.depth;
    const bossSet = {};
    map.bossDepths.forEach(function (d) { bossSet[d] = true; });
    const self = this; // forEach 回调里要用 eliteAllowedAt（M28）

    map.layers.forEach(function (layer, idx) {
      const d = idx + 1;

      if (d === 1) { layer[0].type = 'entry'; return; }
      if (bossSet[d]) { layer[0].type = 'boss'; return; }
      if (d === lastD - 1) { // §5.3 第 7 条：末层 Boss 的上一层全休息
        layer.forEach(function (n) { n.type = 'rest'; });
        return;
      }

      const w = {};
      Object.keys(act.weights).forEach(function (k) { w[k] = act.weights[k]; });
      // §3.1 第 1 条（M31）：DL3 起精英权重 +1（8 → 9）—— 概率性「中 Boss 数 +1」。
      // 不能直接 +1 只精英节点数：地图类型是逐节点独立抽的，没有「配额」概念；
      // 上调权重是同一枚硬币的另一面（实测 5000 张图精英数有明显抬升，见 m3 断言）。
      if (map.eliteBonus) w.elite += map.eliteBonus;
      if (act.restBoostDepths.indexOf(d) >= 0) w.rest = w.rest * 3;
      if (!self.eliteAllowedAt(map, d)) delete w.elite; // M28：前列不出精英

      layer.forEach(function (n) { n.type = pickWeighted(w, rng); });
    });
  },

  // 一层全是商店/休息会把战斗节奏断掉。修复优于重生成：把最靠中间的节点改成小怪。
  // 只作用于「按权重随机」的层 —— 入口层 / Boss 层 / D(末-1) 强制休息层的类型是规则定的，
  // 不能被这里改写。
  ensureCombatFloor(map) {
    const bossSet = {};
    map.bossDepths.forEach(function (d) { bossSet[d] = true; });

    map.layers.forEach(function (layer, idx) {
      const d = idx + 1;
      if (d === 1 || bossSet[d] || d === map.depth - 1) return;

      const has = layer.some(function (n) {
        return n.type === 'monster' || n.type === 'elite';
      });
      if (has) return;
      layer[Math.floor(layer.length / 2)].type = 'monster';
    });
  },

  connect(map, rng) {
    for (let d = 1; d < map.depth; d++) {
      const a = map.layers[d - 1];
      const b = map.layers[d];

      // 单节点层：分岔（入口层）或汇聚（Boss 层）
      if (a.length === 1 || b.length === 1) {
        a.forEach(function (x) {
          b.forEach(function (y) { MapGen.addEdge(x, y); });
        });
        continue;
      }

      // 主干纵向边
      for (let i = 0; i < a.length; i++) {
        this.addEdge(a[i], b[Math.min(i, b.length - 1)]);
      }

      // 换道斜边：每对相邻主干最多一条，方向随机 —— 不产生 X 交叉
      const pairs = Math.min(a.length, b.length) - 1;
      for (let i = 0; i < pairs; i++) {
        if (rng.next() < this.LANE_CHANGE_P) {
          if (rng.next() < 0.5) this.addEdge(a[i], b[i + 1]);
          else this.addEdge(a[i + 1], b[i]);
        }
      }

      // 兜底：下层每个节点都要有入边
      b.forEach(function (y) {
        if (y.in.length) return;
        MapGen.addEdge(a[Math.min(y.lane, a.length - 1)], y);
      });
    }
  },

  addEdge(from, to) {
    if (from.edges.indexOf(to.id) >= 0) return false;
    from.edges.push(to.id);
    to.in.push(from.id);
    return true;
  },

  // 名义主干路线：每层取第 i 个节点。用于展示与「差异度」校验。
  buildRoutes(map) {
    map.routes = [];
    for (let i = 0; i < map.lanes; i++) {
      map.routes.push(
        map.layers.map(function (layer) {
          return layer[Math.min(i, layer.length - 1)].id;
        })
      );
    }
  },

  // §6：名单固定，顺序即难度升序
  markBosses(map, act) {
    map.bossNodes = map.bossDepths.map(function (d, i) {
      const node = map.layers[d - 1][0];
      const boss = act.bosses[i];
      node.bossId = boss.id;
      node.bossName = boss.name;
      node.bossTier = boss.tier;
      return { depth: d, nodeId: node.id, bossId: boss.id, name: boss.name, tier: boss.tier };
    });
  },

  // ---------- 度量 ----------

  // DAG 路径计数：入口走到末层的走法总数（精确，不枚举 —— 枚举会指数爆炸）
  pathCount(map) {
    const cnt = {};
    for (let d = map.depth; d >= 1; d--) {
      map.layers[d - 1].forEach(function (n) {
        if (d === map.depth) { cnt[n.id] = 1; return; }
        let c = 0;
        n.edges.forEach(function (id) { c += cnt[id]; });
        cnt[n.id] = c;
      });
    }
    return cnt[map.entryId];
  },

  // 任意两条主干路线在多少比例的层上位于不同节点（取最小值）
  routeDivergence(map) {
    let min = 1;
    for (let i = 0; i < map.routes.length; i++) {
      for (let j = i + 1; j < map.routes.length; j++) {
        let diff = 0;
        for (let d = 0; d < map.depth; d++) {
          if (map.routes[i][d] !== map.routes[j][d]) diff++;
        }
        min = Math.min(min, diff / map.depth);
      }
    }
    return min;
  },

  // ---------- 校验（§5.1 硬指标）----------

  validate(map) {
    const issues = [];
    const lanes = map.lanes;

    if (lanes !== 4) issues.push('主干路线数 ' + lanes + '，应为 4');
    if (map.layers[0].length !== 1) issues.push('D1 不是单入口');
    if (map.layers[map.depth - 1].length !== 1) issues.push('末层不是单节点');

    const bossSet = {};
    map.bossDepths.forEach(function (d) { bossSet[d] = true; });

    for (let d = 1; d <= map.depth; d++) {
      const layer = map.layers[d - 1];
      const expect = (d === 1 || bossSet[d]) ? 1 : lanes;
      if (layer.length !== expect) {
        issues.push('D' + d + ' 节点数 ' + layer.length + '，应为 ' + expect);
      }

      const cols = {};
      layer.forEach(function (n) {
        if (cols[n.col]) issues.push('D' + d + ' 列位置 ' + n.col + ' 重复');
        cols[n.col] = true;

        if (d < map.depth && n.edges.length === 0) issues.push(n.id + ' 没有出边');
        if (d > 1 && n.in.length === 0) issues.push(n.id + ' 没有入边');

        n.edges.forEach(function (id) {
          const t = map.nodes[id];
          if (!t) { issues.push(n.id + ' 指向不存在的节点 ' + id); return; }
          if (t.depth !== d + 1) {
            issues.push(n.id + ' → ' + id + ' 不是向下（D' + d + ' → D' + t.depth + '）');
          }
        });
      });

      if (d === map.depth - 1) {
        layer.forEach(function (n) {
          if (n.type !== 'rest') issues.push('D' + d + ' 应为全休息点，' + n.id + ' 是 ' + n.type);
        });
      }
      if (bossSet[d] && layer[0].type !== 'boss') issues.push('D' + d + ' 应为 Boss 层');
    }

    // §6 硬规则：不允许深层放弱 Boss
    for (let i = 1; i < map.bossNodes.length; i++) {
      const prev = map.bossNodes[i - 1];
      const cur = map.bossNodes[i];
      if (cur.tier <= prev.tier) {
        issues.push('Boss 难度未递增：D' + prev.depth + ' tier' + prev.tier +
                    ' → D' + cur.depth + ' tier' + cur.tier);
      }
    }

    // M28 硬规则：精英不出现在段内前列（eliteAllowedAt 判门槛）
    const self2 = this;
    map.layers.forEach(function (layer, idx) {
      const d = idx + 1;
      layer.forEach(function (n) {
        if (n.type === 'elite' && !self2.eliteAllowedAt(map, d)) {
          issues.push('精英出现在段内前列：' + n.id + '（D' + d + '）');
        }
      });
    });

    const pc = this.pathCount(map);
    if (pc < lanes) issues.push('入口到末层路径数 ' + pc + ' < 主干路线数 ' + lanes);

    const div = this.routeDivergence(map);
    if (div < 0.5) {
      issues.push('主干路线差异度 ' + (div * 100).toFixed(0) + '% < 50%');
    }

    return { ok: issues.length === 0, issues: issues, pathCount: pc, divergence: div };
  },
};
