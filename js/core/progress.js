// 等级进度与存档（设计文档 §3.1 / §17 第 1、4 条）。
//
// 纯逻辑，**不碰 DOM、也不直接碰 localStorage** —— 存储通过 init(storage) 注入：
// 浏览器传 localStorage，Node 测试传一个内存假对象。这样它能和 combat / map / run
// 一样无头跑断言，也顺带保住「隐私模式下 storage 抛错不能把游戏带崩」这条。
//
// 存两份东西（同一个 key 下两块结构）：
//   ① chars[角色].dl  —— 井壁刻痕，永久保留。三个角色各一条独立的 DL1–DL10 线
//   ② chars[角色].run —— 该角色**进行中的那一局**的快照，节点结束时刷新
//
// 为什么「进行中的局」要按角色分槽：切角色 = 换一套卡组与一套资源，两局的进度没法
// 互相继承。只存一份的话，切一下角色就丢掉整局进度（§17 第 4 条要的是"随时退出、
// 回到上次节点继续"）。

const SAVE_KEY = 'tower-descend/save';
const SAVE_VERSION = 1; // 结构一变就跳号，旧档自动丢弃（见 _read 的宽容处理）
const MAX_DL = 10;

const Progress = {
  _store: null,
  data: null,

  // storage: { getItem(k), setItem(k, v) }。浏览器传 localStorage，测试传内存假对象。
  init(storage) {
    this._store = storage || null;
    this.data = this._read();
    return this.data;
  },

  _blank() {
    return {
      version: SAVE_VERSION,
      chars: {},
      daily: { wins: {} },
      // R1（M76）：图鉴与战绩。旧档没有这两块 —— 就地补默认，不跳版本号。
      codex: { cards: {}, relics: {}, enemies: {}, events: {}, potions: {} },
      stats: { chars: {}, lastDaily: '' },
      // R2（M77）：新手引导标记。seen 过的提示不再弹 —— 旧档缺块就地补。
      tut: {},
    };
  },

  // codex / stats 的结构保障：缺块就地补齐（宽容读取与云端合并共用）。
  _ensure() {
    if (!this.data) this.data = this._blank();
    if (!this.data.codex || typeof this.data.codex !== 'object') {
      this.data.codex = { cards: {}, relics: {}, enemies: {}, events: {}, potions: {} };
    }
    const c = this.data.codex;
    ['cards', 'relics', 'enemies', 'events', 'potions'].forEach(function (k) {
      if (!c[k] || typeof c[k] !== 'object') c[k] = {};
    });
    if (!this.data.stats || typeof this.data.stats !== 'object') {
      this.data.stats = { chars: {}, lastDaily: '' };
    }
    const s = this.data.stats;
    if (!s.chars || typeof s.chars !== 'object') s.chars = {};
    if (typeof s.lastDaily !== 'string') s.lastDaily = '';
    if (!this.data.tut || typeof this.data.tut !== 'object') this.data.tut = {};
  },

  // ---- R2（M77）新手引导标记 ----
  // tutSeen(id)：这个提示是否已经弹过。
  tutSeen(id) {
    this._ensure();
    return !!this.data.tut[id];
  },

  // tutMark(id)：标记为已弹过并落盘。tip 展示时调用（展示即算看过，
  // 玩家关掉浮条不算「没看过」—— 不然每次进战斗都要再关一遍）。
  tutMark(id) {
    this._ensure();
    this.data.tut[id] = true;
    this._write();
  },

  // 宽容读取：没有存档 / JSON 坏了 / 版本对不上 / storage 抛错 —— 一律当「新玩家」。
  // 绝不 throw：一个坏存档不能让游戏打不开。
  _read() {
    try {
      const raw = this._store && this._store.getItem(SAVE_KEY);
      if (!raw) return this._blank();
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return this._blank();
      if (d.version !== SAVE_VERSION) return this._blank();
      if (!d.chars || typeof d.chars !== 'object') d.chars = {};
      // 每日挑战记录（M60）：旧档没有这块，就地补上 —— 不跳版本号，
      // 因为旧档的 chars 完全兼容，丢了每日记录反而伤体验。
      if (!d.daily || typeof d.daily !== 'object' || !d.daily.wins) d.daily = { wins: {} };
      // R1（M76）：codex / stats 同款处理 —— 旧档就地补空块，绝不为它跳版本号。
      this.data = d;
      this._ensure();
      return this.data;
    } catch (e) {
      return this._blank();
    }
  },

  // 写失败（配额满 / 隐私模式）只影响「能不能续档」，不影响本局继续玩 —— 所以吞掉异常。
  _write() {
    try {
      if (!this._store) return false;
      this._store.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      return false;
    }
  },

  // ---------- 刻痕与等级 ----------

  // 每个角色一个槽。首次访问时补默认值（DL1、没有进行中的局）。
  slot(charId) {
    // 没 init 就直接用（只在内存里跑，不落盘）—— 否则随手调一次 API 就整页抛异常。
    // 和 run.js 里那句 `Progress.data` 判断保持一致：读进度不该有前置条件。
    if (!this.data) this.data = this._blank();
    const id = characterOf(charId).id;
    let c = this.data.chars[id];
    if (!c || typeof c !== 'object') {
      c = { dl: 1, run: null };
      this.data.chars[id] = c;
    }
    if (typeof c.dl !== 'number' || c.dl < 1) c.dl = 1;
    if (c.dl > MAX_DL) c.dl = MAX_DL;
    if (c.run === undefined) c.run = null;
    return c;
  },

  dl(charId) { return this.slot(charId).dl; },

  // §3.1 难度系数，严格线性：1 + 0.15 × (DL − 1)。DL1 = 1.00、DL10 = 2.35
  difficulty(charId) { return 1 + 0.15 * (this.dl(charId) - 1); },

  // 打通一次完整下潜 → 该角色 +1（封顶 10），另外两个角色不受影响。
  // 返回「是否真的涨了」（满级时 false），上层据此显示不同的收尾文案。
  gainDl(charId) {
    const c = this.slot(charId);
    if (c.dl >= MAX_DL) return false;
    c.dl += 1;
    this._write();
    return true;
  },

  // 直接设定等级（夹在 1–MAX_DL）。用来构造不同 DL 的场景 —— 测试与将来的
  // 调试面板走这条；**正式流程只走 gainDl**。
  setDl(charId, n) {
    const c = this.slot(charId);
    c.dl = Math.max(1, Math.min(MAX_DL, n | 0));
    this._write();
    return c.dl;
  },

  // ---------- 解锁链（§3.1）----------
  // 只看「任一角色」的最高 DL，与当前选的是谁无关 —— 别写成只看当前角色。

  bestDl() {
    const self = this;
    return Object.keys(CHARACTERS).reduce(function (mx, id) {
      return Math.max(mx, self.slot(id).dl);
    }, 1);
  },

  isUnlocked(charId) {
    const need = characterOf(charId).unlockDl || 0;
    return this.bestDl() >= need;
  },

  // ---------- 进行中的局 ----------

  saveRun(charId, snap) {
    this.slot(charId).run = snap;
    return this._write();
  },

  loadRun(charId) { return this.slot(charId).run; },

  clearRun(charId) {
    this.slot(charId).run = null;
    return this._write();
  },

  // ---------- 每日挑战（M60）----------
  // 全局一份（不按角色分槽）：一天一卷，打完就是打完了。
  // wins[dateKey] = true；只记通关，失败次数没有记录价值（第二天卷子就换了）。

  dailyWon(dateKey) {
    if (!this.data) this.data = this._blank();
    if (!this.data.daily || !this.data.daily.wins) return false;
    return !!this.data.daily.wins[dateKey];
  },

  recordDailyWin(dateKey) {
    if (!this.data) this.data = this._blank();
    if (!this.data.daily) this.data.daily = { wins: {} };
    this.data.daily.wins[dateKey] = true;
    this._ensure();
    this.data.stats.lastDaily = dateKey; // R1 战绩页「最近通关」
    // 记录簿别无限膨胀：只留最近 60 天
    const keys = Object.keys(this.data.daily.wins);
    if (keys.length > 60) {
      keys.sort().slice(0, keys.length - 60).forEach(function (k) {
        delete Progress.data.daily.wins[k];
      });
    }
    return this._write();
  },

  // ---------- 图鉴（R1 / M76）----------
  // 只改内存，不主动落盘 —— 写盘跟着既有存档点走（saveRun / settleRunEnd /
  // recordDailyWin / gainDl 都会 _write）。出牌是高频动作，每次都 stringify
  // 整个存档（含整张地图）不值；丢的窗口只有「打出后、下一个存档点前退出」，
  // 与本局快照同一粒度，可接受。

  recordCard(id) {
    if (!id) return;
    this._ensure();
    const c = this.data.codex.cards;
    c[id] = (c[id] || 0) + 1;
  },

  recordRelic(id) {
    if (!id) return;
    this._ensure();
    const c = this.data.codex.relics;
    c[id] = (c[id] || 0) + 1;
  },

  // 药水图鉴（M85 / G1）：获得即记录 —— 商店、宝箱、掉落都走 addPotion
  recordPotion(id) {
    if (!id) return;
    this._ensure();
    const c = this.data.codex.potions;
    c[id] = (c[id] || 0) + 1;
  },

  // 攀绳（M85 / G3 成就数据源）：全局累计，云合并按数值取大
  recordClimb() {
    this._ensure();
    this.data.stats.climbs = (this.data.stats.climbs || 0) + 1;
  },

  recordEnemy(id) {
    if (!id) return;
    this._ensure();
    const c = this.data.codex.enemies;
    c[id] = (c[id] || 0) + 1;
  },

  // 事件遭遇计数（M79）：事件链的「第二次遇到」就看它。
  // 不 _write —— 与 recordEnemy 同理由，随下一个存档点落盘。
  recordEvent(id) {
    if (!id) return;
    this._ensure();
    const c = this.data.codex.events;
    c[id] = (c[id] || 0) + 1;
  },

  eventSeen(id) {
    this._ensure();
    return this.data.codex.events[id] || 0;
  },

  // 局末结算：每局恰好一次（挂在 settleRunEnd 的 _ended 幂等标记之后）。
  // runs 数的是「打完的局」，中途弃局不计 —— 与云统计的 start/end 配对口径一致。
  recordRunEnd(charId, info) {
    this._ensure();
    const st = this._statsSlot(charId);
    info = info || {};
    st.runs += 1;
    st.battles += info.battles | 0;
    if ((info.depth | 0) > st.bestDepth) st.bestDepth = info.depth | 0;
    if (info.won) {
      st.wins += 1;
      const dl = info.dl | 0;
      if (dl >= 1) st.dlWins[dl] = (st.dlWins[dl] || 0) + 1;
    }
    this._write();
  },

  // Boss 击杀：战斗胜利时按节点类型记。低频事件，直接落盘。
  recordBossKill(charId) {
    this._ensure();
    const st = this._statsSlot(charId);
    st.bossKills = (st.bossKills || 0) + 1;
    this._write();
  },

  _statsSlot(charId) {
    this._ensure();
    const id = String(charId || '');
    if (!id) return null;
    let s = this.data.stats.chars[id];
    if (!s || typeof s !== 'object') {
      s = { runs: 0, wins: 0, bestDepth: 0, battles: 0, bossKills: 0, dlWins: {} };
      this.data.stats.chars[id] = s;
    }
    if (!s.dlWins || typeof s.dlWins !== 'object') s.dlWins = {};
    return s;
  },

  // 云端合并（R1）：计数器「数值取大」，其余字段照旧走新者胜整体覆盖。
  // 场景：两台设备各打过几局 —— 整档覆盖会让旧设备把新设备的图鉴/战绩
  // 一起抹掉，而这两个块是单调累加的，取大永远正确。
  mergeCounters(remote) {
    this._ensure();
    if (!remote || typeof remote !== 'object') return false;
    let changed = false;
    const maxInto = function (dst, src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) {
        const v = src[k];
        if (typeof v === 'number') {
          if ((dst[k] || 0) < v) { dst[k] = v; changed = true; }
        } else if (v && typeof v === 'object') {
          if (!dst[k] || typeof dst[k] !== 'object') { dst[k] = {}; changed = true; }
          maxInto(dst[k], v);
        }
        // 字符串与其它类型不掺和（lastDaily 在下面单独处理）
      });
    };
    if (remote.codex) maxInto(this.data.codex, remote.codex);
    if (remote.stats) maxInto(this.data.stats, remote.stats);
    // lastDaily：字符串比大小 = 更近的日期胜
    const ld = remote.stats && remote.stats.lastDaily;
    if (typeof ld === 'string' && ld > this.data.stats.lastDaily) {
      this.data.stats.lastDaily = ld;
      changed = true;
    }
    if (changed) this._write();
    return changed;
  },

  // 测试 / 调试用：抹掉全部进度
  reset() {
    this.data = this._blank();
    return this._write();
  },
};
