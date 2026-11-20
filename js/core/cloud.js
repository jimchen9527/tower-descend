// 云服务接入（M52）—— WorkBuddy 云服务的「云存档」层。
//
// 定位与边界：
//   · 本文件是 core 层：**不碰 DOM**。登录面板的交互在 ui/app.js，这里只出数据与状态。
//   · 只封装 WorkBuddy Cloud SDK（CDN 全局 WorkBuddyCloud），不手写 /.cloud/** 请求。
//   · endpoint / publishableKey / oauthRelayBaseUrl 只能来自开通时返回的 publicConfig
//     （见 workbuddy_cloud_service 文档：不允许从 location 或环境变量推）。
//
// 存档模型（数据库 cloud_saves 表，RLS：owner_id = auth.uid()）：
//   一名玩家一行，payload = Progress.data 的完整 JSON。客户端不发 owner_id，
//   由数据库 DEFAULT auth.uid() 填充 —— 谁登录就写到谁名下，越权写入被 RLS 拒绝。
//
// 同步策略（新者胜，时间戳在本地）：
//   · 写：适配器每次落盘都记 `tower-descend/save-ts`（毫秒），并把最新 JSON 推上云
//     （fire-and-forget，失败静默重试到下一次存档点 —— 本地档始终是即时兜底）。
//   · 读：登录成功后拉云端，与本地 ts 比，新的那个赢。云端空 = 首次上云，直接推本地。
//
// 身份：只支持手机号验证码登录（11 位大陆号），**没有匿名登录** —— 云端数据必须
// 挂真实身份，这是平台的安全边界，不做本地假身份绕过。

const CLOUD_CONFIG = {
  endpoint: 'https://tower-descend-game-60674.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_uN88KGOPMyOW0MmkU7S383_qyXqEOP2xIfzpKTDTte8fSITzjwUJrcU',
};

const SAVE_TS_KEY = 'tower-descend/save-ts';

const Cloud = {
  _client: null,
  _pending: null,   // 排队的最新存档 JSON（上一笔还没推完时顶掉旧的）
  _pushing: false,

  // ---- 状态（ui 层只读）----
  // mode: 'off'（SDK 没加载成）| 'out'（未登录）| 'in'（已登录）| 'busy'（请求中）
  mode: 'off',
  phone: null,       // 已登录手机号（脱敏后）
  lastSyncAt: null,  // 上次成功推送时间（Date）
  lastError: null,

  // SDK 可用吗（CDN script 加载失败时整块云功能退场，游戏不受影响）
  available() {
    return typeof WorkBuddyCloud !== 'undefined' && !!WorkBuddyCloud.createWorkBuddyCloud;
  },

  client() {
    if (!this._client) {
      this._client = WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CLOUD_CONFIG.endpoint,
        oauthRelayBaseUrl: CLOUD_CONFIG.oauthRelayBaseUrl,
        publishableKey: CLOUD_CONFIG.publishableKey,
      });
    }
    return this._client;
  },

  _setMode(m) { this.mode = m; },

  // ---------- 会话 ----------

  // 启动时调用：有没有仍然有效的会话（SDK 自己管 token 刷新）
  async restoreSession() {
    if (!this.available()) return null;
    try {
      const res = await this.client().auth.getSession();
      if (res.error || !res.data || !res.data.session) {
        this._setMode('out');
        return null;
      }
      this._setMode('in');
      this.phone = this._maskPhone(
        res.data.session.user && (res.data.session.user.phone || res.data.session.user.email));
      return res.data.session;
    } catch (e) {
      this._setMode('out');
      this.lastError = '会话检查失败';
      return null;
    }
  },

  // 发验证码。大陆手机号本地先校验（11 位、1 开头），不合法就不发请求。
  async sendOtp(phone) {
    this.lastError = null;
    if (!/^1\d{10}$/.test(phone || '')) {
      this.lastError = '请输入正确的 11 位手机号';
      return { ok: false };
    }
    if (!this.available()) { this.lastError = '云服务不可用'; return { ok: false }; }
    this._setMode('busy');
    const res = await this.client().auth.sendOtp({ phone: phone });
    if (res.error) {
      this._setMode('out');
      this.lastError = '验证码发送失败，请稍后再试';
      return { ok: false, isExistingUser: false };
    }
    // 信封原样带给调用方：verify 时必须回传同一套 verificationId / isExistingUser
    this._pending = { phone: phone, data: res.data };
    return { ok: true, isExistingUser: !!res.data.isExistingUser };
  },

  // 提交验证码。新用户（首次注册）需带密码；已有用户只填验证码。
  async verifyOtp(code, password) {
    this.lastError = null;
    const p = this._pending;
    if (!p) { this.lastError = '请先获取验证码'; return { ok: false }; }
    if (!this.available()) { this.lastError = '云服务不可用'; return { ok: false }; }
    this._setMode('busy');
    const res = await this.client().auth.verifyOtp({
      phone: p.phone,
      verificationId: p.data.verificationId,
      isExistingUser: !!p.data.isExistingUser,
      token: code,
      password: p.data.isExistingUser ? undefined : password,
    });
    if (res.error) {
      this._setMode('out');
      this.lastError = '验证码不正确，或密码不符合要求';
      return { ok: false };
    }
    this._pending = null;
    this._setMode('in');
    this.phone = this._maskPhone(p.phone);
    return { ok: true, user: res.data && res.data.user };
  },

  async signOut() {
    if (this.available()) {
      try { await this.client().auth.signOut(); } catch (e) { /* 本地状态照样清 */ }
    }
    this._setMode('out');
    this.phone = null;
  },

  _maskPhone(p) {
    if (!p) return null;
    return p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : p;
  },

  // ---------- 存档同步 ----------

  loggedIn() { return this.available() && this.mode === 'in'; },

  // 拉云端存档。返回 { payload: 'json字符串', updatedAt: 'ISO' } 或 null（云端没有）。
  async pullSave() {
    if (!this.loggedIn()) return null;
    const res = await this.client().database.from('cloud_saves')
      .select('payload, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) { this.lastError = '云端存档读取失败'; return null; }
    if (!res.data) return null;
    return { payload: JSON.stringify(res.data.payload), updatedAt: res.data.updated_at };
  },

  // 推送存档（新者胜的另一侧：本地更新时把整个 JSON 覆盖上去）。
  // fire-and-forget：调用方不等它。并发时只保留最新一份 JSON，在飞的那笔落地后
  // 若又来过新档就再推一笔 —— 云端最终收敛到最新。失败时 lastError 置位，
  // 等下一个存档点自然重试（本地档始终是即时兜底，不影响游玩）。
  pushSave(json) {
    if (!this.loggedIn() || !json) return Promise.resolve(false);
    this._latest = json;
    if (this._pushing) return Promise.resolve(false); // 在飞的那笔收尾时会看到新 _latest
    this._pushing = true;
    const self = this;
    const payload = this._latest;
    this._latest = null;
    const write = (row) => this.client().database.from('cloud_saves')
      .select('id').limit(1).maybeSingle()
      .then(function (found) {
        return found.data && found.data.id
          ? self.client().database.from('cloud_saves')
              .update({ payload: row.payload })
              .eq('id', found.data.id)
              .select()
          : self.client().database.from('cloud_saves').insert(row).select();
      });
    return write({ payload: JSON.parse(payload) })
      .then(function (done) {
        // update 命中 0 行 = RLS 拦了或行没了：不重试，等下次存档点（文档规定的判别法）
        if (done.error || !Array.isArray(done.data) || done.data.length === 0) {
          self.lastError = '云端保存未生效';
          return false;
        }
        self.lastSyncAt = new Date();
        self.lastError = null;
        return true;
      })
      .catch(function () { self.lastError = '云端保存失败'; return false; })
      .then(function (ok) {
        self._pushing = false;
        if (self._latest) self.pushSave(self._latest); // 推送期间又存了一次 → 补推
        return ok;
      });
  },

  // ---------- 游玩统计（M74）：日志型，每局结束插一行，只进不改 ----------

  // 设备标识：一台设备一个随机 id，localStorage 持久化。统计口径是「设备」
  // 不是「账号」—— 同一账号换设备也能分开数。拿不到存储就现造一个
  // （本次会话内自洽，只是跨会话认不出同一台）。
  device() {
    try {
      var k = 'tower-descend/device-id';
      var id = window.localStorage.getItem(k);
      if (!id) {
        id = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        window.localStorage.setItem(k, id);
      }
      return id;
    } catch (e) { return 'anon-' + Date.now().toString(36); }
  },

  // 开局上报（M75）：phase='start'，won 为空。与局末行用 seed 配对，
  // 弃局 = 只有 start 没有 end。
  logRunStart(info) {
    return this._logRun('start', info, null);
  },

  // 局末上报。失败完全静默 —— 统计不配打扰玩家，更不许碰存档链路的 lastError。
  // 只在已登录时上报：未登录的局没有 owner 归属，宁缺勿脏。
  logRunEnd(info) {
    return this._logRun('end', info, !!(info && info.won));
  },

  _logRun(phase, info, won) {
    if (!this.loggedIn() || !info) return Promise.resolve(false);
    var row = {
      phase: phase,
      device_id: this.device(),
      char_id: String(info.charId || ''),
      dl: info.dl | 0,
      won: won,
      battles: info.battles | 0,
      depth: info.depth | 0,
      daily: !!info.daily,
      seed: typeof info.seed === 'number' ? info.seed : null,
    };
    return this.client().database.from('run_log').insert(row)
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  },

  // ---------- 本地时间戳（适配层用，app.js 的混合 storage 维护）----------

  nowTs() { return Date.now(); },
  readLocalTs(local) {
    try { return parseInt(local.getItem(SAVE_TS_KEY), 10) || 0; } catch (e) { return 0; }
  },
  writeLocalTs(local) {
    try { local.setItem(SAVE_TS_KEY, String(Date.now())); } catch (e) { /* 只影响合并方向 */ }
  },
};
