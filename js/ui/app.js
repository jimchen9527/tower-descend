// 视图协调 —— 地图 ↔ 战斗。只做流程串联，不碰渲染细节。

const App = {
  _booted: false,

  // 当前角色。三个角色谁能选由 Progress 的解锁链决定（医师需任一角色 DL2、
  // 引火者需 DL4）—— 未解锁的在顶栏下拉里是 disabled。
  _charId: DEFAULT_CHAR,

  // 一局结束时的结算结果，供收尾面板显示（见 settleRunEnd）
  _lastResult: null,

  // Progress 自己不碰 localStorage —— 存储由这里注入。拿不到就传 null，
  // Progress 退回纯内存模式（本局照样能玩，只是存不住）。
  //
  // M52 云存档：包一层「混合存储」—— 写 = 本地立即落盘（游戏体验不变，离线可玩）
  // + 记时间戳 + 推云端（fire-and-forget，未登录时 Cloud.pushSave 自己就是 no-op）。
  // 读仍然只走本地（云端由 syncFromCloud 在登录后按「新者胜」合并进来）。
  _storage() {
    try {
      const local = window.localStorage;
      return {
        getItem: function (k) { return local.getItem(k); },
        setItem: function (k, v) {
          local.setItem(k, v);
          if (k === SAVE_KEY) {
            Cloud.writeLocalTs(local);
            Cloud.pushSave(v);
          }
        },
      };
    } catch (e) { return null; }
  },

  // 原始 localStorage（绕过混合层）—— 云端合并回写时用，避免触发推送循环
  _rawStorage() {
    try { return window.localStorage; } catch (e) { return null; }
  },

  // opts.fresh = 明确要重开一局（顶栏「新的一局」/ 收尾面板的「再来一局」），
  // 会先清掉这个角色进行中的存档；不传则优先续档。
  boot(opts) {
    opts = opts || {};
    if (!this._booted) {
      this._booted = true;
      Progress.init(this._storage());
      Render.boot();
      this.bindOnce();
      this.bindMenuOnce();
      this.cloudBoot(); // 异步：恢复会话 → 与云端合并存档。不阻塞首屏
    }
    // 下面几件事**每次都要做**，不能塞进上面那个 if ——
    // 「新的一局」和「切角色」都会再走进来，而那时角色可能已经换了。
    // 踩过的坑：fillCharSelect 原来只在首次 boot 里调，页面加载时
    // index.html 末尾已经 boot 过一次，于是切角色后顶栏下拉还是旧值
    // （对局角色其实是对的，只是顶栏在说谎）。
    this.fillCharSelect();
    this.applyCharTheme(this._charId);
    this._lastResult = null;

    // M55 主菜单：首轮加载（opts.menu）只出菜单不开局 —— 由「开始游戏 /
    // 继续游戏」显式选路。其余调用点（切角色 / 云端合并 / 测试直呼）
    // 走原有「续档优先」路径，菜单页随手隐藏。
    if (opts.menu) return this.showMenu();
    document.getElementById('view-menu').hidden = true;
    document.querySelector('.topbar').hidden = false;

    // 先试着续上这个角色没打完的那一局（§17 第 4 条），续不上才开新局
    let resumed = false;
    if (opts.fresh) {
      Progress.clearRun(this._charId);
    } else {
      resumed = Run.fromSnapshot(Progress.loadRun(this._charId));
    }
    if (!resumed) Run.start('act1', Date.now() % 1000000, this._charId);
    if (!resumed) this.logRunStart(); // M75 开局统计：续档不记

    Render.fillPoolSelect(); // 卡池验证栏要跟着角色换
    this.hidePanels();
    this.showMap();
    if (resumed) this.showResumed();
  },

  // 续档后就地提示一句 —— 否则玩家会奇怪"我怎么不是从 D1 开始"
  showResumed() {
    const el = document.getElementById('placeholder');
    el.innerHTML =
      '<div class="ph-desc">已续上上次未打完的那一局 —— D' + Run.current().depth +
      '，剩 ' + Run.state.hp + ' / ' + Run.state.maxHp + ' 血。' +
      '<br><button class="btn btn-ghost btn-sm" id="ph-newrun">放弃，重开一局</button></div>';
    el.hidden = false;
  },

  fillCharSelect() {
    // 当前角色若已不可选（进度被清过），先退回掘者
    if (!Progress.isUnlocked(this._charId)) this._charId = DEFAULT_CHAR;

    const sel = document.getElementById('char-select');
    sel.innerHTML = CHAR_ORDER.map(function (id) {
      const ch = CHARACTERS[id];
      const ok = Progress.isUnlocked(id);
      const label = ok
        ? ch.name + '（DL' + Progress.dl(id) + '）'
        : ch.name + '（未解锁 · ' + ch.unlock + '）';
      return '<option value="' + id + '"' + (ok ? '' : ' disabled') + '>' + label + '</option>';
    }).join('');
    sel.value = this._charId;
  },

  // 卡面框色跟角色走（§8：铁灰 / 病绿 / 燃橙）
  applyCharTheme(charId) {
    document.documentElement.style.setProperty('--char', characterOf(charId).frameColor);
  },

  bindOnce() {
    // 战斗 BGM 开关（M34）：文字随状态走；静音偏好 Bgm 自己写 localStorage
    var bgmBtn = document.getElementById('bgm-toggle');
    bgmBtn.textContent = Bgm.isMuted() ? '🔇' : '🔊';
    bgmBtn.addEventListener('click', function () {
      bgmBtn.textContent = Bgm.toggleMute() ? '🔇' : '🔊';
    });

    // M58b 动效总开关：localStorage td-fx=0 → html 挂 fx-off，
    // art.css 文件尾的总开关规则把游戏动效全停（呼吸/震屏/顿帧等）。
    // 默认开 —— 不跟随系统 prefers-reduced-motion（那台机器报 reduce，
    // 跟着走 = 玩家什么都看不见，2026-10-15 实测）。P1 设置面板接 UI。
    try {
      document.documentElement.classList.toggle(
        'fx-off', window.localStorage.getItem('td-fx') === '0');
    } catch (e) { /* 存储不可用 = 动效照常 */ }

    // P1-4 设置面板（M58）：菜单第三页。三个开关 + 重置进度。
    this.initSettings();

    // 调试卡池栏（P0-2）：默认藏起来 —— 正式界面不露工程痕迹。
    // URL 带 ?dev=1 时才显示，供调卡池 / 喂手牌 / 定深度用。
    // 探针是程序化 .click()，元素 hidden 不影响，测试不受牵连。
    document.querySelector('.poolbar').hidden = !/[?&]dev=1/.test(location.search);
    // M89：「重打本节点」是调试工具（同种子重开，等于无限撤销），正式界面默认藏。
    document.getElementById('restart').hidden = !/[?&]dev=1/.test(location.search);
    // M87/V4：顶栏的主干/走法/种子同口径 —— html.dev-on 时 .rp-dev 才显示。
    document.documentElement.classList.toggle('dev-on', /[?&]dev=1/.test(location.search));

    // 明确要重开：清掉这个角色进行中的存档再开
    // M89：有进行中的局时先确认 —— 这个按钮紧挨着音乐开关，误触一次就是 30 分钟。
    document.getElementById('new-run').addEventListener('click', function () {
      const snap = Progress.loadRun(App._charId);
      if (snap) {
        const node = snap.map && snap.map.nodes ? snap.map.nodes[snap.currentId] : null;
        const at = node ? 'D' + node.depth + '，剩 ' + snap.hp + '/' + snap.maxHp + ' 血' : '进行中';
        if (!window.confirm('放弃当前这一局？\n' + at + ' —— 重开会从 D1 开始，无法恢复。')) return;
      }
      App.boot({ fresh: true });
    });

    // 换角色：各角色各存一局，所以这里**不带 fresh** —— 切过去能接着打
    document.getElementById('char-select').addEventListener('change', function (e) {
      App._charId = e.target.value;
      App.boot();
    });

    // 地图节点：委托在容器上，整体重绘也不丢监听
    document.getElementById('map-nodes').addEventListener('click', function (e) {
      const el = e.target.closest('.mnode');
      if (!el) return;
      if (el.classList.contains('is-locked') ||
          el.classList.contains('is-done') ||
          el.classList.contains('is-cur')) return;
      App.enterNode(el.dataset.id);
    });

    // 键盘操作（M81 / R6）：PC 端直接收益。
    // 1–9 出牌 ｜ E / 空格 结束回合 ｜ ← / → 换目标。
    // 输入框聚焦时全部让路（顶栏深度输入、卡池筛选等）。
    document.addEventListener('keydown', function (e) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const vc = document.getElementById('view-combat');
      if (!vc || vc.hidden) return;
      const s = Combat.state;
      if (!s) return;
      if (e.key === 'e' || e.key === 'E' || e.key === ' ') {
        e.preventDefault();
        if (s.phase === 'player') { Combat.endTurn(); Render.draw(); }
        return;
      }
      if (e.key >= '1' && e.key <= '9') {
        if (s.phase !== 'player') return;
        const card = s.hand[Number(e.key) - 1];
        if (card && Combat.canPlay(card)) { Combat.playCard(card.uid); Render.draw(); }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (s.phase !== 'player' || s.enemies.length < 2) return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        for (let step = 1; step <= s.enemies.length; step++) {
          const idx = (s.targetIdx + dir * step + s.enemies.length * 4) % s.enemies.length;
          if (Combat.setTarget(idx)) break;
        }
        Render.draw();
      }
    });

    // 攀绳（M78 · §13）：两段确认防误触 —— 第一击进入待发（按钮变红），
    // 第二击执行；3.5 秒不点就自己缩回去
    document.getElementById('rope-btn').addEventListener('click', function () {
      if (!Run.canClimb()) return;
      const btn = this;
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.classList.add('is-armed');
        btn.textContent = '确认攀绳？最大生命 −10，本局不可撤销';
        clearTimeout(App._ropeTimer);
        App._ropeTimer = setTimeout(function () {
          btn.dataset.armed = '';
          btn.classList.remove('is-armed');
          RenderMap.render(); // 回到普通态（含剩余次数）
        }, 3500);
        return;
      }
      clearTimeout(App._ropeTimer);
      btn.dataset.armed = '';
      btn.classList.remove('is-armed');
      if (Run.climbUp()) {
        App.updateTopbar();
        App.audioStinger('encounter');
        RenderMap.render();
      }
    });

    // 浮层里的按钮每次重建，所以委托在容器上。
    // data-act 全部转给 NodePanel；ph-newrun 是收尾面板的「再来一局」。
    document.getElementById('placeholder').addEventListener('click', function (e) {
      const el = e.target.closest('[data-act]');
      if (el) {
        NodePanel.act(el.dataset.act, el.dataset.arg);
        return;
      }
      if (e.target.id === 'ph-newrun') App.boot({ fresh: true });
    });

    // 战斗结果面板同理
    document.getElementById('result').addEventListener('click', function (e) {
      if (e.target.id === 'result-next') App.afterBattle();
    });

    // 云存档面板（M52）：按钮开关 + 面板内动态按钮的事件委托
    document.getElementById('cloud-btn').addEventListener('click', function () {
      App.toggleCloudPanel();
    });
    document.getElementById('cloud-panel').addEventListener('click', function (e) {
      const el = e.target.closest('[data-cloud-act]');
      if (!el) return;
      App.cloudAct(el.dataset.cloudAct);
    });
  },

  // ==================== 云存档（M52）====================

  // 启动：恢复会话 → 渲染面板 → 已登录就与云端合并。全程异步，不阻塞首屏。
  cloudBoot() {
    const self = this;
    if (typeof Cloud === 'undefined' || !Cloud.available()) {
      this.renderCloudUi();
      return;
    }
    Cloud.restoreSession().then(function (session) {
      self.renderCloudUi();
      if (session) return self.syncFromCloud();
    });
  },

  // 云端 ↔ 本地合并（登录后调用）。新者胜：updatedAt（云端）vs 本地 save-ts。
  // 只在地图视图执行「云端覆盖本地」—— 战斗中途换存档等于把对面换了，
  // 那种情况下只把本地推上云，覆盖留到下一次进游戏（boot 会重新拉）。
  syncFromCloud() {
    if (!Cloud.loggedIn()) return Promise.resolve();
    const self = this;
    const local = this._rawStorage();
    return Cloud.pullSave().then(function (remote) {
      if (!remote) {
        // 云端还没有档：把本地推上去（首次上云，老玩家进度无缝带走）
        const raw = local.getItem(SAVE_KEY);
        if (raw) Cloud.pushSave(raw);
        self.renderCloudUi();
        return;
      }
      const remoteTs = Date.parse(remote.updatedAt) || 0;
      const localTs = Cloud.readLocalTs(local);
      if (remoteTs > localTs) {
        const inCombat = !document.getElementById('view-combat').hidden;
        if (inCombat) {
          self.cloudNote('云端有更新的存档 —— 下次进入游戏时取回');
          return;
        }
        // R1（M76）：图鉴与战绩是单调累加的计数器 —— 取「两边较大值」合并进本地，
        // 其余字段照旧被云端覆盖。两台设备各打过几局时，谁也不会抹掉谁的图鉴。
        try { Progress.mergeCounters(JSON.parse(remote.payload)); } catch (e) { /* 坏 payload：照旧覆盖 */ }
        try { local.setItem(SAVE_KEY, JSON.stringify(Progress.data)); } catch (e) { return; }
        Cloud.writeLocalTs(local);
        Progress.init(self._storage());
        self.boot(); // 幂等重入：按云端档重建地图 / 续上那局
        self.cloudNote('已从云端取回存档');
      } else {
        // 本地更新（或持平）：把本地推上去
        const raw = local.getItem(SAVE_KEY);
        if (raw) Cloud.pushSave(raw);
        self.renderCloudUi();
      }
    });
  },

  // 面板交互转发（data-cloud-act）
  cloudAct(act) {
    const self = this;
    if (act === 'close') return this.toggleCloudPanel(false);
    if (act === 'signout') {
      return Cloud.signOut().then(function () {
        self.renderCloudUi();
        self.cloudNote('已退出登录 —— 存档继续保存在本机');
      });
    }
    if (act === 'send') {
      const phone = document.getElementById('cloud-phone').value.trim();
      Cloud.sendOtp(phone).then(function (r) {
        self.renderCloudUi();
        self.cloudNote(r.ok ? '验证码已发送，注意查收短信' : (Cloud.lastError || '发送失败'));
      });
      return;
    }
    if (act === 'verify') {
      const code = document.getElementById('cloud-code').value.trim();
      const pw = document.getElementById('cloud-pw') ? document.getElementById('cloud-pw').value : '';
      if (Cloud._pending && !Cloud._pending.data.isExistingUser && pw.length < 6) {
        this.cloudNote('首次注册需要设置至少 6 位的密码');
        return;
      }
      Cloud.verifyOtp(code, pw).then(function (r) {
        if (r.ok) {
          self.renderCloudUi();
          self.cloudNote('登录成功，正在同步存档…');
          self.syncFromCloud();
        } else {
          self.renderCloudUi();
          self.cloudNote(Cloud.lastError || '登录失败');
        }
      });
      return;
    }
  },

  toggleCloudPanel(force) {
    const panel = document.getElementById('cloud-panel');
    const show = force !== undefined ? force : panel.hidden;
    panel.hidden = !show;
    if (show) this.renderCloudUi();
  },

  // 渲染顶栏按钮 + 面板内容（状态机：off / out / busy / in）
  renderCloudUi() {
    const btn = document.getElementById('cloud-btn');
    const body = document.getElementById('cloud-panel-body');
    if (!btn || !body) return;
    if (typeof Cloud === 'undefined' || !Cloud.available()) {
      btn.textContent = '☁ —';
      btn.title = '云服务未就绪';
      body.innerHTML = '<div class="cloud-line">云服务不可用 —— 存档保存在本机，功能不受影响。</div>';
      return;
    }
    if (Cloud.mode === 'in') {
      btn.textContent = '☁ 已同步';
      btn.title = '云存档：已登录';
      const sync = Cloud.lastSyncAt
        ? '上次推送到云端：' + Cloud.lastSyncAt.toLocaleTimeString()
        : '本机改动会在存档点自动推送到云端';
      body.innerHTML =
        '<div class="cloud-line">已登录：<b>' + (Cloud.phone || '用户') + '</b></div>' +
        '<div class="cloud-line cloud-dim">' + (Cloud.lastError || sync) + '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-cloud-act="signout">退出登录</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-cloud-act="close">关闭</button>';
      return;
    }
    btn.textContent = '☁ 未同步';
    btn.title = '登录后存档上云，换设备不丢进度';
    const isNew = !!(Cloud._pending && Cloud._pending.data && !Cloud._pending.data.isExistingUser);
    body.innerHTML =
      '<div class="cloud-line">登录后存档自动上云 —— 换设备、清浏览器数据都不丢。</div>' +
      (Cloud._pending
        ? '<div class="cloud-row"><input id="cloud-code" class="cloud-input" inputmode="numeric" maxlength="6" placeholder="6 位验证码">' +
          '<button type="button" class="btn btn-primary btn-sm" data-cloud-act="verify">登录</button></div>' +
          (isNew
            ? '<div class="cloud-row"><input id="cloud-pw" class="cloud-input" type="password" maxlength="32" placeholder="设置密码（新用户，≥6 位）"></div>'
            : '') +
          '<div class="cloud-line cloud-dim">没有收到？重新点击「发验证码」即可</div>'
        : '<div class="cloud-row"><input id="cloud-phone" class="cloud-input" inputmode="numeric" maxlength="11" placeholder="手机号">' +
          '<button type="button" class="btn btn-primary btn-sm" data-cloud-act="send">发验证码</button></div>') +
      '<button type="button" class="btn btn-ghost btn-sm" data-cloud-act="close">关闭</button>';
  },

  // 面板底部状态行（不弹窗、不打断）
  cloudNote(msg) {
    const body = document.getElementById('cloud-panel-body');
    if (!body || !msg) return;
    let note = body.querySelector('.cloud-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'cloud-line cloud-note';
      body.appendChild(note);
    }
    note.textContent = msg;
  },

  // ==================== 主菜单（M55）====================

  // P1-4 设置面板（M58）：读当前状态 → 同步三个开关；change 事件即时生效。
  // 重置进度带 confirm —— Progress.reset() 抹角色解锁 / 刻痕 / 进行中存档，不可恢复。
  renderSettings() {
    document.getElementById('set-bgm').checked = !Bgm.isMuted();
    document.getElementById('set-sfx').checked = !Sfx.isMuted();
    let fxOn = true;
    try { fxOn = window.localStorage.getItem('td-fx') !== '0'; } catch (e) {}
    document.getElementById('set-fx').checked = fxOn;
  },

  // 动效开关的唯一写入口：存 td-fx + 挂 html.fx-off（boot 里那行的运行时版）
  applyFx(on) {
    try { window.localStorage.setItem('td-fx', on ? '1' : '0'); } catch (e) {}
    document.documentElement.classList.toggle('fx-off', !on);
  },

  initSettings() {
    const self = this;
    document.getElementById('menu-settings-btn').addEventListener('click', function () {
      self.renderSettings();
      self.menuPage('settings');
    });
    document.getElementById('set-back').addEventListener('click', function () {
      self.menuPage('main');
    });
    document.getElementById('set-bgm').addEventListener('change', function () {
      if (this.checked === !Bgm.isMuted()) return; // 状态一致就不动（防御重复触发）
      Bgm.toggleMute();
      var btn = document.getElementById('bgm-toggle');
      if (btn) btn.textContent = Bgm.isMuted() ? '🔇' : '🔊';
    });
    document.getElementById('set-sfx').addEventListener('change', function () {
      Sfx.setMuted(!this.checked);
    });
    document.getElementById('set-fx').addEventListener('change', function () {
      self.applyFx(this.checked);
    });
    document.getElementById('set-reset').addEventListener('click', function () {
      if (!window.confirm('确定重置全部进度？角色解锁、刻痕记录与进行中的存档都会被抹掉，无法恢复。')) return;
      Progress.reset();
      self.renderMenuMain();
      self.fillCharSelect();
      window.alert('进度已重置。');
    });
  },

  // 菜单页的暂存选择：选中的角色 + 这次要下潜的难度刻痕
  _menuSel: { charId: DEFAULT_CHAR, dl: 0 },

  // 菜单页切换：'main' 主页（开始/继续）｜ 'select' 角色与 DL 选择页 ｜
  // 'settings' 设置 ｜ 'codex' 图鉴·战绩·成就（R1 / M76）
  menuPage(page) {
    document.getElementById('menu-main').hidden = page !== 'main';
    document.getElementById('menu-select').hidden = page !== 'select';
    document.getElementById('menu-settings').hidden = page !== 'settings';
    document.getElementById('menu-codex').hidden = page !== 'codex';
  },

  // 首页：清空继续列表、按「有没有进行中的存档」置灰继续按钮
  renderMenuMain() {
    document.getElementById('menu-continue-list').innerHTML = '';
    const ids = CHAR_ORDER.filter(function (id) { return Progress.loadRun(id); });
    const btn = document.getElementById('menu-continue');
    btn.disabled = ids.length === 0;
    btn.title = ids.length ? '' : '三个角色都没有进行中的存档';
    // M60 每日挑战：显示今日修饰 + 完成状态。desc 由 Run.dailyFor（确定性）给出。
    const dbtn = document.getElementById('menu-daily');
    if (dbtn) {
      const today = App.todayKey();
      const d = dailyFor(today);
      const mod = DAILY_MODS[d.modKey];
      const won = Progress.dailyWon(today);
      document.getElementById('menu-daily-desc').textContent =
        '今日 · ' + mod.name + '（' + mod.desc + ' · DL3）' + (won ? ' · ✓ 已通关' : '');
      dbtn.disabled = false;
      dbtn.title = won ? '今日已通关，仍可再打' : '今天全世界同一张卷子';
    }
  },

  // 本地日期键 'YYYY-MM-DD'。每日挑战的卷子按它派生 —— 用本地时间，
  // 用户半夜打的算「今天」，与直觉一致。
  todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  },

  // 每日挑战开局：固定 DL3 + 今日种子 + 今日修饰。用当前顶栏角色
  //（新手第一次点 = 掘者）。同一天可反复打 —— 卷子相同，成败自负。
  menuDaily() {
    const charId = this._menuSel.charId || DEFAULT_CHAR;
    const d = dailyFor(this.todayKey());
    Progress.clearRun(charId);
    this._charId = charId;
    Run.start('act1', d.seed, charId, d.dl, d);
    this.logRunStart(); // M75 开局统计（每日挑战）
    this.applyCharTheme(charId);
    document.getElementById('view-menu').hidden = true;
    document.querySelector('.topbar').hidden = false;
    Render.fillPoolSelect();
    this.hidePanels();
    this.showMap();
  },

  showMenu(page) {
    document.querySelector('.topbar').hidden = true; // 菜单态不露游戏顶栏（HP/种子在菜单里没意义）
    document.getElementById('view-menu').hidden = false;
    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = true;
    document.getElementById('turn-box').hidden = true;
    this.hidePanels();
    this.renderMenuMain();
    this.menuPage(page || 'main');
  },

  // 「开始游戏」→ 角色选择页。预选当前顶栏角色（未解锁则退回掘者）
  menuShowSelect() {
    this._menuSel = {
      charId: Progress.isUnlocked(this._charId) ? this._charId : DEFAULT_CHAR,
      dl: 0,
    };
    this.renderMenuChars();
    this.menuPage('select');
  },

  // 三张角色卡：未解锁的置灰 + 锁标 + 解锁条件，点不动（选择链不认它）
  renderMenuChars() {
    const self = this;
    document.getElementById('menu-chars').innerHTML = CHAR_ORDER.map(function (id) {
      const ch = CHARACTERS[id];
      const ok = Progress.isUnlocked(id);
      const sel = ok && self._menuSel.charId === id;
      return '<div class="mchar' + (ok ? '' : ' is-locked') + (sel ? ' is-sel' : '') +
        '" data-mchar="' + id + '">' +
        '<div class="mchar-portrait"><img src="preview-assets-v3/' + id + '-cut.png" alt="' + ch.name + '">' +
        (ok ? '' : '<div class="mchar-lock"><span class="mchar-lock-icon">🔒</span><span>' + ch.unlock + '</span></div>') +
        '</div>' +
        '<div class="mchar-name">' + ch.name + '</div>' +
        '<div class="mchar-role">' + ch.role + '</div>' +
        '<div class="mchar-dl">刻痕 DL' + Progress.dl(id) + '</div>' +
        '<div class="mchar-blurb">' + ch.blurb + '</div>' +
        '</div>';
    }).join('');
    this.renderMenuDls();
  },

  // DL1–DL10 选择排：只能选 ≤ 该角色当前刻痕的那几档（默认落在最高档）
  renderMenuDls() {
    const max = Progress.dl(this._menuSel.charId);
    if (!this._menuSel.dl || this._menuSel.dl > max) this._menuSel.dl = max;
    const dl = this._menuSel.dl;
    let row = '';
    for (let n = 1; n <= 10; n++) {
      row += '<button type="button" class="mdl-btn' + (n === dl ? ' is-sel' : '') + '"' +
        (n <= max ? ' data-mdl="' + n + '"' : ' disabled') + '>DL' + n + '</button>';
    }
    document.getElementById('menu-dls').innerHTML = row;
    document.getElementById('menu-dl-desc').textContent =
      '难度系数 ×' + (1 + 0.15 * (dl - 1)).toFixed(2) +
      '（敌人血量与伤害都乘它；打通当前档才涨刻痕）';
    document.getElementById('menu-go').disabled = false;
  },

  // 「开始下潜」：新局顶掉该角色进行中的存档（与「新的一局」同语义），
  // 用选定的 DL 开局 —— Run.start 会把 dl 冻进本局。
  menuGo() {
    const charId = this._menuSel.charId;
    const dl = this._menuSel.dl || Progress.dl(charId);
    Progress.clearRun(charId);
    this._charId = charId;
    Run.start('act1', Date.now() % 1000000, charId, dl);
    this.logRunStart(); // M75 开局统计（开始下潜）
    this.applyCharTheme(charId);
    document.getElementById('view-menu').hidden = true;
    document.querySelector('.topbar').hidden = false;
    Render.fillPoolSelect();
    this.hidePanels();
    this.showMap();
    // 开场序幕（M79 / R4）：只在新档第一次开始下潜时播，可跳过
    this.maybePrologue();
  },

  // ---- 序幕（M79）：3 屏文字，挂在地图上层的 placeholder 面板里 ----
  maybePrologue() {
    if (typeof Progress === 'undefined' || !Progress.data) return;
    if (Progress.tutSeen('prologue')) return;
    Progress.tutMark('prologue');
    this._prologuePage = 0;
    this.prologuePaint();
  },

  prologuePaint() {
    const el = document.getElementById('placeholder');
    const pg = PROLOGUE[this._prologuePage];
    const last = this._prologuePage >= PROLOGUE.length - 1;
    el.innerHTML =
      '<div class="ph-icon">井</div>' +
      '<div class="ph-title">' + pg.title + '</div>' +
      '<div class="ph-desc ph-story">' + pg.text + '</div>' +
      '<div class="ph-actions">' +
      (last
        ? '<button class="btn btn-primary" data-act="prologue-end">开始下潜</button>'
        : '<button class="btn btn-primary" data-act="prologue-next">继续</button>') +
      '<button class="btn btn-ghost" data-act="prologue-skip">跳过</button>' +
      '</div>';
    el.hidden = false;
  },

  prologueNext() {
    if (this._prologuePage < PROLOGUE.length - 1) {
      this._prologuePage++;
      this.prologuePaint();
    } else {
      this.prologueEnd();
    }
  },

  prologueEnd() {
    this._prologuePage = 0;
    document.getElementById('placeholder').hidden = true; // 回到地图
  },

  // 「继续游戏」：只有一个角色有存档 → 直接续；多个 → 列出各角色的档让玩家挑
  menuContinue() {
    const ids = CHAR_ORDER.filter(function (id) { return Progress.loadRun(id); });
    if (!ids.length) return;
    if (ids.length === 1) return this.continueRun(ids[0]);
    document.getElementById('menu-continue-list').innerHTML = ids.map(function (id) {
      const snap = Progress.loadRun(id);
      const node = snap && snap.map && snap.map.nodes ? snap.map.nodes[snap.currentId] : null;
      return '<button type="button" class="btn btn-ghost btn-sm" data-mc="' + id + '">' +
        CHARACTERS[id].name + ' · D' + (node ? node.depth : '?') +
        ' · 剩 ' + snap.hp + '/' + snap.maxHp + ' 血</button>';
    }).join('');
  },

  continueRun(charId) {
    this._charId = charId;
    document.getElementById('view-menu').hidden = true;
    this.boot(); // 幂等重入：走既有「续档优先」路径
  },

  // 菜单内的一次性绑定（boot 首轮里随 bindOnce 一起挂）
  bindMenuOnce() {
    document.getElementById('menu-start').addEventListener('click', function () {
      App.menuShowSelect();
    });
    document.getElementById('menu-continue').addEventListener('click', function () {
      App.menuContinue();
    });
    document.getElementById('menu-daily').addEventListener('click', function () {
      App.menuDaily();
    });
    document.getElementById('menu-back').addEventListener('click', function () {
      App.renderMenuMain();
      App.menuPage('main');
    });
    document.getElementById('menu-go').addEventListener('click', function () {
      App.menuGo();
    });
    document.getElementById('menu-chars').addEventListener('click', function (e) {
      const el = e.target.closest('[data-mchar]');
      if (!el || !Progress.isUnlocked(el.dataset.mchar)) return; // 未解锁：点不动
      App._menuSel.charId = el.dataset.mchar;
      App._menuSel.dl = 0; // 换角色后重新落在该角色的最高档
      App.renderMenuChars();
    });
    document.getElementById('menu-dls').addEventListener('click', function (e) {
      const el = e.target.closest('[data-mdl]');
      if (!el) return;
      App._menuSel.dl = el.dataset.mdl | 0;
      App.renderMenuDls();
    });
    document.getElementById('menu-continue-list').addEventListener('click', function (e) {
      const el = e.target.closest('[data-mc]');
      if (el) App.continueRun(el.dataset.mc);
    });
    // 图鉴·战绩·成就（R1 / M76）：入口、返回、页签、角色芯片
    document.getElementById('menu-codex-btn').addEventListener('click', function () {
      App.menuCodex();
    });
    document.getElementById('menu-codex-back').addEventListener('click', function () {
      App.renderMenuMain();
      App.menuPage('main');
    });
    document.getElementById('codex-tabs').addEventListener('click', function (e) {
      const el = e.target.closest('[data-ct]');
      if (!el || el.dataset.ct === App._codexTab) return;
      App._codexTab = el.dataset.ct;
      App.renderCodex();
    });
    // 角色芯片委托在内容区上（图鉴页每次整体重绘）
    document.getElementById('codex-body').addEventListener('click', function (e) {
      const el = e.target.closest('[data-cxc]');
      if (!el || el.dataset.cxc === App._codexChar) return;
      App._codexChar = el.dataset.cxc;
      App.renderCodex();
    });
    // ---- R2（M77）新手引导：浮条「知道了」+ 术语释义委托 ----
    document.getElementById('tipbar-ok').addEventListener('click', function () {
      App.tipNext();
    });
    // 术语标记是渲染时批量生成的，点击统一委托在 document 上：
    // 点标记 → 弹释义；点浮层外任意处 → 收起。
    document.addEventListener('click', function (e) {
      const term = e.target.closest('.term');
      const pop = document.getElementById('term-pop');
      if (term) {
        e.stopPropagation();
        const t = term.dataset.term;
        pop.innerHTML = '<b class="tp-term">' + t + '</b>' + (GLOSSARY[t] || '');
        pop.hidden = false;
        const r = term.getBoundingClientRect();
        const pw = Math.min(300, window.innerWidth - 24);
        let x = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
        let y = r.bottom + 8;
        if (y + 90 > window.innerHeight) y = Math.max(8, r.top - 8 - 80); // 底部放不下就翻到上方
        pop.style.left = x + 'px';
        pop.style.top = y + 'px';
        return;
      }
      if (!pop.hidden && !e.target.closest('#term-pop')) pop.hidden = true;
    });
  },

  // ==================== 图鉴 · 战绩 · 成就（R1 / M76）====================

  // 页签状态：codex 图鉴 ｜ stats 战绩 ｜ ach 成就；图鉴内当前角色。
  _codexTab: 'codex',
  _codexChar: DEFAULT_CHAR,

  menuCodex() {
    this.renderCodex();
    this.menuPage('codex');
  },

  // ==================== R2 新手引导（M77）====================

  // 提示队列：同一时刻只显示一条，「知道了」后自动播下一条。
  // Progress.tut 记「已展示」—— 展示即算看过，避免每次进战斗都被教育一遍。
  _tips: [],

  // App.tut(id, text)：id 没弹过才入队。各系统在合适的时机调用即可。
  tut(id, text) {
    if (typeof Progress === 'undefined' || !Progress.data) return; // 未初始化（测试环境）不炸
    if (Progress.tutSeen(id)) return;
    Progress.tutMark(id);
    this._tips.push(text);
    this.tipShow();
  },

  tipShow() {
    const bar = document.getElementById('tipbar');
    if (!bar || bar.hidden === false) return; // 没这元素（异常）或正在显示：排队等着
    const text = this._tips.shift();
    if (text === undefined) return;
    document.getElementById('tipbar-text').textContent = text;
    bar.hidden = false;
    this._tipArm(15); // 兜底自动消失：玩家找不到「知道了」也不会被教育一整局
  },

  _tipArm(sec) {
    clearTimeout(this._tipTimer);
    const self = this;
    this._tipTimer = setTimeout(function () { self.tipNext(); }, sec * 1000);
  },

  // 临时闪现（不进 tut 队列、不计「已看过」）：战报复制成功等即时反馈。
  // 结束时走 tipNext 链回队列 —— tut 提示若在闪现期间入队，不会滞留。
  tipFlash(text, sec) {
    const bar = document.getElementById('tipbar');
    if (!bar) return;
    document.getElementById('tipbar-text').textContent = text;
    bar.hidden = false;
    this._tipArm(sec || 6);
  },

  tipNext() {
    clearTimeout(this._tipTimer);
    const bar = document.getElementById('tipbar');
    if (bar) bar.hidden = true;
    // 下一帧再开下一条，避免「隐藏→立刻显示」被浏览器合并成一次重绘
    const self = this;
    setTimeout(function () { self.tipShow(); }, 50);
  },

  // 页签点亮态 + 内容区整体重绘。三个页签的 DOM 都在 codex-body 里重建，
  // 所以事件一律委托在 codex-tabs / codex-body 容器上（bindMenuOnce）。
  renderCodex() {
    const self = this;
    document.querySelectorAll('#codex-tabs .codex-tab').forEach(function (t) {
      t.classList.toggle('is-on', t.dataset.ct === self._codexTab);
    });
    document.getElementById('codex-body').innerHTML =
      this._codexTab === 'codex' ? this.renderCodexTab() :
      this._codexTab === 'stats' ? this.renderStatsTab() :
      this.renderAchTab();
  },

  // ---- 图鉴页：卡牌（按角色）/ 遗物 / 敌人 ----
  renderCodexTab() {
    const self = this;
    const cd = Progress.data.codex;
    const best = Progress.bestDl(); // 入池看「任一角色」的最高 DL，与解锁链同口径

    const chips = '<div class="codex-chips">' + CHAR_ORDER.map(function (id) {
      return '<button type="button" class="codex-chip' + (id === self._codexChar ? ' is-on' : '') +
        '" data-cxc="' + id + '">' + CHARACTERS[id].name + '</button>';
    }).join('') + '</div>';

    // ---- 卡牌：入池可见文字、打出过才点亮（金描边）；未入池只有剪影 ----
    const cardIds = Object.keys(CARDS).filter(function (k) { return CARDS[k].char === self._codexChar; });
    let lit = 0;
    // M87/V6：未入池的剪影卡不再整片铺屏 —— 按 DL 分桶，收进 <details> 折叠组。
    const lockedByDl = {};
    const cardTiles = cardIds.map(function (k) {
      const d = CARDS[k];
      const seen = (cd.cards[k] || 0) > 0;
      if (seen) lit++;
      if ((d.dl || 0) > best) {
        const tile = '<div class="ccard is-dim"><div class="ctop"><span class="cname">？？？</span></div>' +
          '<div class="ctext">DL' + (d.dl || 0) + ' 解锁后入池</div><div class="clock">🔒</div></div>';
        (lockedByDl[d.dl || 0] = lockedByDl[d.dl || 0] || []).push(tile);
        return '';
      }
      let text = '';
      try { text = d.text(d.v) || ''; } catch (e) { text = ''; }
      const rn = RARITY_NAMES[d.rarity] || d.rarity;
      return '<div class="ccard' + (seen ? ' is-lit' : '') + '" title="' + rn + '">' +
        '<div class="ctop"><span class="cname">' + d.name + '</span>' +
        '<span class="crar rar-' + (d.rarity || 'common') + '"></span>' +
        (d.cost != null ? '<span class="ccost">' + d.cost + '</span>' : '') + '</div>' +
        '<div class="ctext">' + (typeof glossify === 'function' ? glossify(text) : text) + '</div></div>';
    }).join('');
    // 折叠组：原生 <details>，无需 JS；默认闭合，玩家想看再展开。
    const folds = Object.keys(lockedByDl).sort(function (a, b) { return a - b; }).map(function (dl) {
      return '<details class="codex-fold"><summary>DL' + dl + ' 未解锁 · ' +
        lockedByDl[dl].length + ' 张（点击展开剪影）</summary>' +
        '<div class="codex-cards">' + lockedByDl[dl].join('') + '</div></details>';
    }).join('');
    let html = chips +
      '<div class="codex-sec">卡牌 · ' + CHARACTERS[this._codexChar].name +
      '<span class="codex-cnt">已点亮 ' + lit + ' / ' + cardIds.length + ' · 入池可见，打出过才点亮' +
      // M87/V6：微型进度条，收集进度一眼可扫
      '<span class="codex-litbar"><i style="width:' + (cardIds.length ? (lit / cardIds.length) * 100 : 0) + '%"></i></span></span></div>' +
      '<div class="codex-tip">小贴士：范围（AoE）牌在普通战斗里通常只有一个目标 —— 它们真正发挥是在对付召唤流的战场（军阀、菌母）。</div>' +
      '<div class="codex-cards">' + cardTiles + '</div>' + folds;

    // ---- 遗物：拾取过才见效果文案；ready:false 的两件标封印 ----
    let rlit = 0;
    const relicTiles = Object.keys(RELICS).map(function (k) {
      const r = RELICS[k];
      const seen = (cd.relics[k] || 0) > 0;
      if (seen) rlit++;
      if (!r.ready) {
        return '<div class="rcard rc-' + (r.rarity || 'common') + ' is-dim"><div class="rnm">' + r.name + '</div>' +
          '<div class="rtext">🔒 封印中 —— ' + (r.pending || '待后续机制解锁') + '</div></div>';
      }
      return '<div class="rcard rc-' + (r.rarity || 'common') + (seen ? '' : ' is-dim') + '">' +
        '<div class="rnm">' + r.name + '</div>' +
        '<div class="rtext">' + (seen ? r.text : '？？？') + '</div></div>';
    }).join('');
    html += '<div class="codex-sec">遗物<span class="codex-cnt">已收集 ' + rlit + ' / ' +
      Object.keys(RELICS).length + '（可拾取 ' + relicPool().length + '）</span></div>' +
      '<div class="codex-relics">' + relicTiles + '</div>';

    // ---- 敌人：遭遇即点亮，重复遭遇累计 ----
    let elit = 0;
    const enemyTiles = Object.keys(ENEMIES).map(function (k) {
      const e = ENEMIES[k];
      const n = cd.enemies[k] || 0;
      if (n) elit++;
      const tag = e.kind === 'boss' ? '王' : e.kind === 'elite' ? '精' : '敌';
      return '<div class="ecard' + (n ? '' : ' is-dim') + '">' +
        '<span class="ek ek-' + (e.kind || 'normal') + '">' + (n ? tag : '?') + '</span>' +
        '<span class="enm">' + e.name + '</span>' +
        (n ? '<span class="ecn">×' + n + '</span>' : '') + '</div>';
    }).join('');
    html += '<div class="codex-sec">敌人<span class="codex-cnt">已遭遇 ' + elit + ' / ' +
      Object.keys(ENEMIES).length + '</span></div>' +
      '<div class="codex-enemies">' + enemyTiles + '</div>';

    // ---- 药水（M85 / G1）：配方公开，全量当百科展示；获得过的记次数 ----
    let plit = 0;
    const potionTiles = Object.keys(POTIONS).map(function (k) {
      const p = POTIONS[k];
      const n = cd.potions[k] || 0;
      if (n) plit++;
      return '<div class="rcard' + (n ? '' : ' is-dim') + '">' +
        '<div class="rnm">' + (p.icon || '🧪') + ' ' + p.name + '</div>' +
        '<div class="rtext">' + p.desc + '</div>' +
        (n ? '<div class="ecn">已获得 ×' + n + '</div>' : '') + '</div>';
    }).join('');
    html += '<div class="codex-sec">药水<span class="codex-cnt">已获得 ' + plit + ' / ' +
      Object.keys(POTIONS).length + '（商店有售 · 宝箱可掉）</span></div>' +
      '<div class="codex-relics">' + potionTiles + '</div>';
    return html;
  },

  // ---- 战绩页：每角色一卡（局数/通关/最深/战斗 + DL 通关分布）+ 每日挑战 ----
  renderStatsTab() {
    const st = Progress.data.stats;
    let html = '<div class="stat-chars">' + CHAR_ORDER.map(function (id) {
      const c = Progress._statsSlot(id) || {};
      const dlw = c.dlWins || {};
      let maxw = 1;
      Object.keys(dlw).forEach(function (k) { if (dlw[k] > maxw) maxw = dlw[k]; });
      let bars = '';
      for (let n = 1; n <= 10; n++) {
        const w = dlw[n] || 0;
        // M87/V5：无记录的轨道虚线化，与「有通关」一眼区分
        bars += '<div class="dlbar"><span class="lb">DL' + n + '</span>' +
          '<span class="tr' + (w ? '' : ' is-empty') + '"><i style="width:' + (maxw ? (w / maxw) * 100 : 0) + '%"></i></span>' +
          '<span class="n">' + (w || '') + '</span></div>';
      }
      const none = !c.runs;
      const pct = none ? '—' : ((c.wins / c.runs) * 100).toFixed(1) + '%';
      return '<div class="scard">' +
        '<div class="h"><span class="nm">' + CHARACTERS[id].name + '</span>' +
        '<span class="dl">' + (Progress.isUnlocked(id) ? 'DL ' + Progress.dl(id) : '未解锁') + '</span></div>' +
        '<div class="srow"><span class="k">下潜局数</span><span class="v">' + (c.runs || 0) + '</span></div>' +
        '<div class="srow"><span class="k">通关次数</span><span class="v">' + (c.wins || 0) +
        ' <small>(' + pct + ')</small></span></div>' +
        '<div class="srow"><span class="k">最深抵达</span><span class="v">' +
        (c.bestDepth ? c.bestDepth + ' 层' : '—') + '</span></div>' +
        '<div class="srow"><span class="k">累计战斗</span><span class="v">' + (c.battles || 0) + '</span></div>' +
        '<div class="dlbars">' + bars + '</div></div>';
    }).join('') + '</div>';

    // M87/V5：全新档案整页都是 0 与空条 —— 顶部一句引导代替「空白即答案」
    const totalRuns = CHAR_ORDER.reduce(function (a, id) {
      const c = Progress._statsSlot(id) || {};
      return a + (c.runs || 0);
    }, 0);
    if (!totalRuns) {
      html = '<div class="stat-guide">还没有下潜记录 —— 回主菜单点「开始游戏」，' +
        '第一次掘进就会写进这页。</div>' + html;
    }

    const dw = Progress.data.daily && Progress.data.daily.wins
      ? Object.keys(Progress.data.daily.wins).length : 0;
    html += '<div class="codex-sec">每日挑战</div>' +
      '<div class="stat-line">累计通关 <b>' + dw + '</b> 天</div>' +
      '<div class="stat-line">最近通关 <b>' + (st.lastDaily || '—') + '</b></div>' +
      '<div class="stat-note">口径：本机存档累计（每局结算时写入）；弃局不计。登录后的云端日志只做运营核对，不进此页。</div>';

    // ---- 事件见闻（M85 / G2）：链进度回看 —— 井里的故事走到哪了 ----
    const chains = (typeof EVENT_CHAINS !== 'undefined' && EVENT_CHAINS) || {};
    const chainNames = { duty_log: '值班日志', seepage: '渗水层' };
    const ckeys = Object.keys(chains);
    if (ckeys.length) {
      html += '<div class="codex-sec">事件见闻</div>';
      html += ckeys.map(function (k) {
        const n = Progress.eventSeen(k) || 0;
        const state = n >= 2 ? '后续已解锁' : n === 1 ? '已遭遇一次' : '尚未遇见';
        return '<div class="stat-line">' + (chainNames[k] || k) +
          ' · <b>' + state + '</b>' + (n ? ' <small>（×' + n + '）</small>' : '') + '</div>';
      }).join('') +
      '<div class="stat-note">同一事件的第二次遭遇会翻开新的一页 —— 多下潜几次，井会回答你。</div>';
    }
    return html;
  },

  // ---- 成就页：18 条运行时派生，进度条 + 进度值 ----
  renderAchTab() {
    const list = Achievements.list({
      data: Progress.data,
      totals: {
        cards: Object.keys(CARDS).length,
        relics: relicPool().length,
        chars: CHAR_ORDER.length,
        potions: Object.keys(POTIONS).length,
        chains: (typeof EVENT_CHAINS !== 'undefined' && EVENT_CHAINS) ? Object.keys(EVENT_CHAINS).length : 0,
      },
    });
    const got = list.filter(function (a) { return a.got; }).length;
    let html = '<div class="ach-sum">已解锁 <b>' + got + '</b> / ' + list.length +
      ' · 成就由本机数据实时派生，无独立存储</div><div class="ach-grid">';
    html += list.map(function (a) {
      const pct = Math.max(0, Math.min(1, a.cur / a.max));
      return '<div class="ach' + (a.got ? '' : ' is-locked') + '">' +
        '<div class="amedal">' + (a.got ? '★' : '☆') + '</div>' +
        '<div class="amain"><div class="anm">' + a.name + '</div>' +
        '<div class="acdesc">' + a.desc + '</div>' +
        '<div class="abar"><i style="width:' + (pct * 100) + '%"></i></div>' +
        '<div class="apv">' + Math.min(a.cur, a.max) + ' / ' + a.max + '</div></div></div>';
    }).join('');
    return html + '</div>';
  },

  hidePanels() {
    NodePanel.hide();
  },

  // ---------- 地图 ----------

  // 只切视图，不碰浮层 —— 战斗奖励面板要盖在地图上，用 showMap 会被清掉
  showMapBase() {
    document.getElementById('view-combat').hidden = true;
    document.getElementById('view-map').hidden = false;
    document.getElementById('turn-box').hidden = true;
    // 大地图 BGM（M35）：这里是「战斗视图已隐藏」的唯一收口 —— 战斗结束、boot、
    // 节点退格都走它，所以切地图曲放这一处最稳（afterBattle 先停战斗曲再到这里，
    // 顺序上正好是战斗曲停 → 地图曲起）。
    Bgm.mapStart();
    // 混响区（M39）：大地图＝旷野，短前延时、短衰减、几乎不湿 —— 空间感立刻「出去」了
    this.audioScene('open');
  },

  // 音频场景切换的统一收口（M39）。混响区决定「这是哪儿」，深度决定「有多深」；
  // 两者都不影响状态机（无声环境照样记账），所以探针能只断言参数、不依赖真出声。
  audioScene(zone, depth) {
    if (typeof TDAudio === 'undefined' || !TDAudio) return null;
    try {
      return TDAudio.setScene(zone, depth == null ? {} : { depth: depth });
    } catch (e) { return null; }
  },

  showMap() {
    this.showMapBase();
    NodePanel.hide();

    if (Run.state.finished) {
      this.settleRunEnd(); // 幂等：收尾面板会被反复 showMap，不设标记会重复升 DL
      if (Run.state.hp > 0) this.showFinish();
      else this.showDefeat();
      // 收尾面板上还要同步顶栏 —— 刻痕刚 +1、下拉里的等级标签也跟着变，
      // 停在旧值会跟收尾面板自相矛盾
      this.fillCharSelect();
      this.updateTopbar();
      return;
    }

    this.saveRun(); // 回到地图 = 一个节点结束了，这就是存档点
    RenderMap.render();
    this.updateTopbar();
    // M87/V7 地图图例（一次性）：V1 三态连线落地后，第一次见地图就教读法。
    // tut 内部按存档去重，只播一次；排在队列里先于首战提示。
    this.tut('map-legend',
      '看地图：金色虚线 = 当前可走，深色线 = 已走过。悬停（长按）节点能看到名称 —— 图标从左到右是小怪、中 Boss、事件、商店、休息、宝箱、大 Boss。');
  },

  // ---------- 存档与刻痕（M7）----------

  // 开局上报（M75）：挂在每个 Run.start 调用点之后，续档不记（续的是同一局）。
  // 与局末行用 seed 配对，弃局率 = 只有 start 没有 end 的局占比。
  logRunStart() {
    const s = Run.state;
    if (!s || typeof Cloud === 'undefined' || !Cloud.logRunStart) return;
    try {
      const cur = Run.current();
      Cloud.logRunStart({
        charId: s.charId,
        dl: Run.curDl(),
        battles: 0,
        depth: cur ? cur.depth : 1,
        daily: !!s.daily,
        seed: typeof s.seed === 'number' ? s.seed : null,
      });
    } catch (e) { /* 统计失败不影响开局 */ }
  },

  // 每次回到地图就存一次。战斗中途不存（§17 第 4 条的粒度是「节点结束」），
  // 所以中途退出 = 该节点重来 —— 这样也堵住了"读到不利随机数再重来"的刷档。
  saveRun() {
    const s = Run.state;
    if (!s || s.finished) return false;
    return Progress.saveRun(s.charId, Run.toSnapshot());
  },

  // 一局收尾：通关给该角色 +1 道刻痕，失败不给；两种情况都清掉「进行中的那一局」。
  // ⚠️ 必须幂等 —— showMap 在收尾面板上会被反复调用，不设标记就会一级一级往上涨。
  settleRunEnd() {
    const s = Run.state;
    if (!s || s._ended) return this._lastResult;
    s._ended = true;

    const won = s.hp > 0;
    const before = Progress.dl(s.charId);
    // M55：只有「按自己当前刻痕这一档打」的通关才 +1 ——
    // 自选低难度也能涨刻痕的话，在 DL1 反复通关就能把 DL 刷满。
    const up = won && Run.curDl() >= before ? Progress.gainDl(s.charId) : false;
    Progress.clearRun(s.charId);

    // 游玩统计上报（M74）：fire-and-forget，失败静默，绝不影响结算链路。
    // 挂在 _ended 标记之后 = 每局恰好一行，收尾面板反复 showMap 也不会重复。
    if (typeof Cloud !== 'undefined' && Cloud.logRunEnd) {
      try {
        const cur = Run.current();
        Cloud.logRunEnd({
          charId: s.charId,
          dl: Run.curDl(),
          won: won,
          battles: s.battles || 0,
          depth: cur ? cur.depth : (s.map && s.map.depth) || 0,
          daily: !!s.daily,
          seed: typeof s.seed === 'number' ? s.seed : null,
        });
      } catch (e) { /* 统计失败不影响结算 */ }
    }

    // 本机战绩（R1 / M76）：与云统计同口径（打完的局才记），挂在同一幂等点。
    try {
      const cur2 = Run.current();
      Progress.recordRunEnd(s.charId, {
        won: won,
        dl: Run.curDl(),
        battles: s.battles || 0,
        depth: cur2 ? cur2.depth : (s.map && s.map.depth) || 0,
      });
    } catch (e) { /* 战绩失败不影响结算 */ }

    this._lastResult = {
      won: won,
      before: before,
      after: Progress.dl(s.charId),
      up: up,
    };
    return this._lastResult;
  },

  updateTopbar() {
    const s = Run.state;
    const n = Run.current();
    document.getElementById('act-name').textContent = s.map.actName;
    document.getElementById('loc-depth').textContent = 'D' + n.depth;
    document.getElementById('loc-type').textContent = NODE_TYPES[n.type].label;
    document.getElementById('run-hp').textContent = s.hp;
    document.getElementById('run-maxhp').textContent = s.maxHp;
    document.getElementById('run-gold').textContent = s.gold;
    document.getElementById('run-lanes').textContent = s.map.lanes;
    document.getElementById('run-paths').textContent = s.map.pathCount;
    document.getElementById('seed-val').textContent = s.seed;
    // 顶栏刻痕：进行中的局显示本局冻结的 DL（M55 自选难度时 ≠ 角色刻痕）；
    // 局已收尾则显示角色当前刻痕 —— 结算刚 +1 过，停在旧档的 DL 上会跟收尾面板自相矛盾
    document.getElementById('run-dl').textContent =
      'DL' + (s.finished ? Progress.dl(s.charId) : Run.curDl());

    // P0-3 遗物托盘：顶栏常驻已获遗物，hover 出原生 title（名称 + 说明）。
    // M58 P1 起用真图形 —— Art.relic() 的物品造型 SVG，稀有度上色，
    // 托盘就是面板图形的缩小版（同一份 SVG，viewBox 缩放）。
    // 面板购买 / 宝箱 / 奖励拿遗物后都会 paint() → updateTopbar()，
    // 这里只管跟着画。
    const tray = document.getElementById('relic-tray');
    if (tray) {
      const ids = s.relics || [];
      document.getElementById('relic-tray-box').hidden = !ids.length;
      tray.innerHTML = ids.map(function (id) {
        const r = RELICS[id];
        if (!r) return '';
        const tip = (r.name + '：' + r.text).replace(/"/g, '');
        return '<span class="relic-chip rar-' + (r.rarity || 'common') +
          '" title="' + tip + '">' + Art.relic(id) + '</span>';
      }).join('');
    }
  },

  // 自适应参数的写入收口（M39）。参数是「局势」而不是「画面」，
  // 所以进战斗时由这里置 combat=true，结算时置回 false。
  audioParam(key, val) {
    if (typeof TDAudio === 'undefined' || !TDAudio) return null;
    try { return TDAudio.setParam(key, val); } catch (e) { return null; }
  },

  // 一次性音乐提示音（M39 的 Stinger）。全程序化合成，零素材。
  audioStinger(name) {
    if (typeof Sfx === 'undefined' || !Sfx || !Sfx.stinger) return false;
    try { return Sfx.stinger(name); } catch (e) { return false; }
  },

  enterNode(id) {
    const moved = Run.moveTo(id);
    if (!moved) return;
    this.updateTopbar();

    switch (moved.type) {
      case 'monster':
      case 'elite':
        return this.startBattle();
      case 'boss':
        // Boss 战先进预告面板 —— 这三台机器的来历是世界观的一半（§9.3）
        // M39：节点面板是「小室」混响区；Boss 预告另给一记低频轰鸣的 Stinger
        this.audioScene('room', moved.depth);
        this.audioStinger('bossReveal');
        return NodePanel.showBoss();
      case 'event':
        this.audioScene('room', moved.depth);
        return NodePanel.showEvent();
      case 'shop':
        this.audioScene('room', moved.depth);
        return NodePanel.showShop();
      case 'rest':
        this.audioScene('room', moved.depth);
        return NodePanel.showRest();
      case 'chest':
        this.audioScene('room', moved.depth);
        return NodePanel.showChest();
      default:
        return this.showMap();
    }
  },

  // ---------- 战斗 ----------

  startBattle() {
    const node = Run.current();
    const s = Run.state;
    // M50：本节点是一支**编队**（1–3 只，可能带变体 / 词缀）。
    // encounterOf 对 M50 之前存下的节点退化成「单只、无强化」，不会崩。
    const enc = Run.encounterOf(node);
    const enemies = enc.enemyIds.map(function (id, i) {
      return {
        id: id,
        hpMul: (enc.enemyHpMul && enc.enemyHpMul[i]) || 1,
        variant: (enc.enemyVariant && enc.enemyVariant[i]) || null,
        affixes: (enc.enemyAffixes && enc.enemyAffixes[i]) || [],
      };
    });
    const names = enc.enemyIds.map(function (id) {
      return (ENEMIES[id] || {}).name || '未知';
    });
    // M76 图鉴：遭遇即点亮（整支编队都记）。只改内存，随下一个存档点落盘。
    if (typeof Progress !== 'undefined' && Progress.recordEnemy) {
      try { enc.enemyIds.forEach(function (id) { Progress.recordEnemy(id); }); } catch (e) {}
    }
    // 地点标签列出整支编队 —— 「小怪 · 腐蚀鼠群 + 井壁爬虫」。
    // 大 Boss 不加类型前缀（它就是这一层本身）；M62 起 Boss 恒单只，
    // 标签永远只有一个名字。
    const tag = node.type === 'boss'
      ? names.join(' + ')
      : NODE_TYPES[node.type].label + ' · ' + names.join(' + ');

    Combat.start(Run.battleSeed(node.id), {
      charId: s.charId,                      // 角色：决定玩家面板与卡面框色
      hp: s.hp,
      maxHp: s.maxHp,
      depth: node.depth,
      locTag: s.map.actName + ' · D' + node.depth + ' · ' + tag,
      deck: s.deck,                          // 本局卡组；战斗自己拿副本进场
      relics: s.relics,                      // 遗物效果（§12）
      potions: s.potions || [],              // §11（M78）：传引用，喝掉即从本局消失
      enemyId: node.enemyId,
      enemies: enemies,                      // 编队（M50）；enemyId 仍作主敌兜底
      enemyHpPct: Run.modSum('enemyHpPct'),  // 事件给的临时修正（§10 值班日志）
      dlScale: 1 + 0.15 * (Run.curDl() - 1), // 本局冻结的 DL 难度系数（§3.1 / M55）
    });

    document.getElementById('view-map').hidden = true;
    document.getElementById('view-combat').hidden = false;
    document.getElementById('turn-box').hidden = false;
    // 战斗 BGM（M35）：普通战与 Boss 战两首曲子。startBattle 都在点击链路里
    // （地图节点 / Boss 确认 / 重打），正好满足自动播放策略的「用户手势」要求
    Bgm.battleStart(node.type === 'boss');
    // 音频场景（M39）：战斗＝竖井井筒（长混响），深度决定井筒有多长多闷；
    // 同时把「战斗中」交给自适应参数（进战斗才让 tension 驱动音乐处理与节奏层）
    this.audioScene('shaft', node.depth);
    this.audioParam('depth', node.depth);
    this.audioParam('combat', 1);
    this.audioStinger('encounter');
    // 受击反馈是拿「上一次绘制的血量」做 diff 的，跨战斗必须清掉，
    // 否则会在新战斗开局飘出上一场的伤害数字
    Render.resetFeedback();
    Render.draw();

    // ---- R2（M77）新手 coach marks：首战讲意图/能量/结束回合；
    // 带专属资源的角色再补一条资源说明（样本/余烬的机制差异大）。
    this.tut('combat', '敌人头顶的胶囊是它的意图——预告它下回合的行动，攻击会标出伤害。' +
      '左侧能量是出牌费用，选牌打出，出完点「结束回合」。');
    if (typeof CHARACTERS !== 'undefined' && CHARACTERS[s.charId] && CHARACTERS[s.charId].resource) {
      const rn = CHARACTERS[s.charId].resource.name;
      this.tut('resource', rn + '是你的专属资源：' + (GLOSSARY[rn] || '') +
        ' 打牌前留意牌面上的' + rn + '费用。');
    }
  },

  // 调试用：同节点同种子重打，血量回到进入该节点时的值
  restartBattle() {
    this.startBattle();
  },

  afterBattle() {
    const cs = Combat.state;
    // afterBattle 是战斗视图的唯一出口（赢→奖励面板 / 输→地图），在这里停战斗曲最稳。
    // 紧接着下面的 showMapBase/showMap 会调 Bgm.mapStart() 起地图曲 ——
    // 「停战斗 → 起地图」这个顺序是刻意的，别把 mapStart 提前到停歌之前。
    Bgm.stop();
    // 战斗结束：自适应参数退场（tension 归零 → 音乐处理与节奏层一起松开）
    this.audioParam('combat', 0);
    this.audioParam('tension', 0);

    if (cs.phase === 'win') {
      // 血量先写回本局（奖励面板要显示正确的血量与金币），
      // 节点本身等奖励领完再 settle —— 否则奖励面板会被 showMap 顶掉
      Run.state.hp = cs.player.hp;
      // M76 战绩：Boss 击杀（当前节点还是 Boss 节点 —— settle 要等奖励领完）。
      // 低频事件，recordBossKill 内部直接落盘。
      if (Run.current() && Run.current().type === 'boss') {
        try { Progress.recordBossKill(Run.state.charId); } catch (e) {}
      }
      this.showMapBase();
      this.updateTopbar();
      NodePanel.showReward(Run.current());
      return;
    }

    Run.settle('lose', cs.player.hp);
    this.showMap();
  },

  // ---------- 收尾 ----------

  showFinish() {
    const s = Run.state;
    const el = document.getElementById('placeholder');
    const r = this._lastResult || { before: Progress.dl(s.charId), up: false };
    const dlNow = Progress.dl(s.charId);
    const name = CHARACTERS[s.charId].name;

    const markLine = r.up
      ? '井壁刻痕 +1 —— ' + name + ' DL' + r.before + ' → <b>DL' + dlNow + '</b>，' +
        '下一级难度系数 ×' + Progress.difficulty(s.charId).toFixed(2) + '。'
      : '刻痕已满（' + name + ' DL' + dlNow + '）—— 这条竖井不会再更深了。';

    // M64：升档新卡公告 —— 卡定义带 announce 标记的，第一次升到它的 dl 时在这里点名。
    // 只认「本角色 + 恰好等于新档位」的卡，别档位的卡不掺和；没升档（自选低难度 / 刻痕已满）就没有公告。
    const unlocked = r.up
      ? cardsByDl(dlNow, s.charId).filter(function (k) { return CARDS[k].announce; })
      : [];
    const unlockLine = unlocked.length
      ? '<br>新卡入池：' + unlocked.map(function (k) { return '<b>' + CARDS[k].name + '</b>'; }).join('、') +
        ' —— 已加入' + name + '的掉落池。'
      : '';

    el.innerHTML =
      '<div class="ph-icon ph-win">底</div>' +
      '<div class="ph-title">' + s.map.actName + ' · 已到底</div>' +
      '<div class="ph-depth">D' + s.map.depth + ' · 三台防卫体全部停机</div>' +
      // 通关结局（M79 / R4）：火种室是空的，三角色各有一双看它的眼睛
      (typeof ENDINGS !== 'undefined' && ENDINGS[s.charId]
        ? '<div class="ph-ending"><div class="ph-ending-t">' + ENDINGS[s.charId].title + '</div>' +
          ENDINGS[s.charId].text + '</div>'
        : '') +
      '<div class="ph-desc">你走完了整条竖井。' +
      '打过的战斗 ' + s.battles + ' 场，剩 ' + s.hp + ' / ' + s.maxHp + ' 血，' + s.gold + ' 金。' +
      '<br>' + markLine + unlockLine + '</div>' +
      '<div class="ph-actions">' +
      '<button class="btn btn-primary" id="ph-newrun">再来一局</button>' +
      '<button class="btn btn-ghost" data-act="copyresult">复制战报</button>' +
      '</div>';
    el.hidden = false;
  },

  showDefeat() {
    const s = Run.state;
    const el = document.getElementById('placeholder');
    el.innerHTML =
      '<div class="ph-icon ph-lose">✕</div>' +
      '<div class="ph-title">下潜失败</div>' +
      '<div class="ph-depth">停在 D' + Run.current().depth + '</div>' +
      '<div class="ph-desc">打过的战斗 ' + s.battles + ' 场，留下 ' + s.gold + ' 金。' +
      '<br>这一局到此为止（存档已清），' + CHARACTERS[s.charId].name +
      ' 的刻痕停在 DL' + Progress.dl(s.charId) + '。</div>' +
      '<button class="btn btn-primary" id="ph-newrun">再来一局</button>' +
      '<button class="btn btn-ghost" data-act="copyresult">复制战报</button>';
    el.hidden = false;
  },

  // ---- 战报分享（M81 / R6）：内容在 Run.resultText()（纯函数，可测），
  // 这里只负责把文本送进剪贴板（带 execCommand 兜底）----
  copyResult() {
    if (!Run.state) return;
    const text = Run.resultText();
    // 反馈用 tipFlash（屏幕底部浮条，收尾面板上可见）——
    // 原来用 cloudNote 写进设置页的隐藏面板，玩家根本看不到（M84 修复）
    const done = function () { App.tipFlash('战报已复制，去粘贴给并肩下潜的人吧'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { App._copyFallback(text, done); });
    } else {
      App._copyFallback(text, done);
    }
  },

  _copyFallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* 复制失败静默 */ }
    document.body.removeChild(ta);
  },
};
