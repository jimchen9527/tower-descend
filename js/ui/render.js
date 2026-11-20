// 渲染层 —— 读 Combat.state，全量重绘。不做增量更新，节点数量小，够用。
//
// M5：敌人面板从「一只怪」改成「单位的列表」，每个单位各自有自己的意图、
// 血条、状态；点击某个敌人把它设为当前目标（§7 目标单选）。
//
// M8（图形化）：单位加了形象，意图加了图标，受击有抖动与伤害飘字。
// 三条维护约定：
//   1. 形象走「左图右信息」的横排 —— 竖排会让面板高一截，多敌人时挤不下。
//   2. 意图的文字前缀「意图 · 」一个字都不能少：ui-probe-boss 断言
//      textContent.indexOf('意图') === 0。图标只能加在它前面。
//   3. 受击反馈靠渲染层自己 diff 前后血量 —— 见 feedback()。
//      M24 起「谁出手了」改由引擎的动作日志提供（Combat.acts）：
//      血量 diff 能看出谁挨打了，但看不出是谁打的。

const Render = {
  // 上一次绘制的血量快照，feedback() 用。键：'p' / 'e0' / 'e1' …
  _lastHp: {},
  // M57：力量快照（buffs.str + buffs.strTurn），同帧 diff —— 增量 > 0 触发红色气场
  _lastStr: {},
  // M73：格挡快照，同帧 diff —— 增量 > 0 触发玩家防御动作（扎稳 + 盾光环）
  _lastBlk: {},
  // M58 P1：回合横幅相位 / 死亡表现名单 / 活着名单（死亡收录依据）
  _lastPhase: null,
  _dying: [],
  _seenAlive: [],

  // M64b：玩家信息浮层的「钉住」状态。点自己 → 钉住（浮层常驻，悬停图标
  // 可看 title 注释）；点其他任何内容 → 解除。整页重绘会丢 DOM 类，
  // 所以状态挂在 Render 上、由 playerHtml 按它挂 is-pinned。
  pinnedPlayer: false,

  boot() {
    document.getElementById('end-turn').addEventListener('click', function () {
      Combat.endTurn();
      Render.draw();
    });

    // 同节点同种子重打，方便连着调试
    document.getElementById('restart').addEventListener('click', function () {
      App.restartBattle();
    });

    // 事件委托：手牌整体重绘也不会丢监听
    // ⚠️ 拖拽落空、松手正好落在原卡上时，浏览器仍会补发一次 click ——
    //   用 _justDragged 拦住，否则弹回的那张牌会被当作点按直接打出去。
    document.getElementById('hand').addEventListener('click', function (e) {
      // M87/V9-C（手机）：手牌半露态 —— 第一次点只展开，不出牌（防误触）。
      // 展开态在下次 draw() 重绘时收回半露，无需收起按钮。
      // ⚠️ 断言必须跟 CSS 的 (max-width: 720px) 一致：is-folded 类桌面也挂着
      //   （重绘统一挂，媒体查询外无样式），不查视口会把桌面点按出牌整个吃掉。
      if (this.classList.contains('is-folded') &&
          window.matchMedia('(max-width: 720px)').matches) {
        this.classList.remove('is-folded');
        return;
      }
      const el = e.target.closest('.card');
      if (!el || el.classList.contains('disabled')) return;
      if (Render._justDragged) { Render._justDragged = false; return; }
      Combat.playCard(Number(el.dataset.uid));
      Render.draw();
    });

    // 切换攻击目标。整块重绘，所以委托在容器上。
    document.getElementById('enemy-panel').addEventListener('click', function (e) {
      const el = e.target.closest('.unit');
      // 死亡单位已不进 DOM（M21），不必再挡 .is-dead
      if (!el) return;
      if (Combat.setTarget(Number(el.dataset.eidx))) Render.draw();
    });

    // 药水腰带（M78）：点槽即喝。非玩家回合的槽没有 data-pi（is-locked 不带），
    // 这里再挡一层 phase，双保险。
    document.getElementById('potion-belt').addEventListener('click', function (e) {
      const el = e.target.closest('.pslot.is-full');
      if (!el || Combat.state.phase !== 'player') return;
      if (Combat.usePotion(Number(el.dataset.pi)) != null) Render.draw();
    });

    // M64b：点自己的角色 → 钉住信息浮层（常驻展开，悬停图标可看注释）；
    // 再点一次取消钉住。点其他任何内容 → 解除（document 级委托收口）。
    // 与敌人换目标同款手法：委托在容器上，整页重绘不丢监听。
    document.getElementById('player-panel').addEventListener('click', function (e) {
      if (!e.target.closest('.unit')) return;
      Render.pinnedPlayer = !Render.pinnedPlayer;
      // ⚠️ 必须就地终止冒泡：下面的 draw() 会整页重绘，事件继续冒到 document
      // 级监听时 e.target 已是脱离 DOM 的旧节点，contains() 判 false，
      // 刚钉上的状态会被同一次点击立刻解除（探针与真机都会踩）。
      e.stopPropagation();
      Render.draw();
    });
    document.addEventListener('click', function (e) {
      if (!Render.pinnedPlayer) return;
      const punit = document.querySelector('#player-panel .unit');
      // 点在玩家单位（含浮层本体）里不算「其他内容」
      if (punit && punit.contains(e.target)) return;
      Render.pinnedPlayer = false;
      if (punit) punit.classList.remove('is-pinned');
      // 战斗视图可见才整帧重绘；不在战斗里时摘类已够，draw 空状态反而危险
      const vc = document.getElementById('view-combat');
      if (vc && !vc.hidden) Render.draw();
    });

    // M53：卡拖到敌人身上出牌（与点按 / 点敌人换目标并存，见 bindCardDrag）
    this.bindCardDrag();

    // M66：旋转屏幕 / 改窗口大小后手牌重新适配
    window.addEventListener('resize', function () { Render.fitHand(); });

    this.fillPoolSelect();
    this.bindPoolPanel();
  },

  // ---------- M53 拖拽出牌 ----------
  //
  // 拿起手牌 → 指到谁高亮谁 → 松手投放：setTarget(idx) + playCard(uid)。
  // 复用既有的两个入口（点卡出牌 / 点敌人换目标都没动）—— 拖拽只是把
  // 「选目标」和「出牌」两步并成一次手势，引擎层零改动。
  // Pointer Events 一套通吃鼠标与触屏；阈值 5px 区分「拖」与「点」，
  // 点按走 click 委托，这里只处理拖动。
  bindCardDrag() {
    const hand = document.getElementById('hand');
    const stage = document.querySelector('.battle-stage');
    const panel = document.getElementById('enemy-panel');
    const THRESHOLD = 5;   // px，位移超过才算「拖」
    const TILT_MAX = 7;    // 幽灵卡最大倾角（随横向速度）
    let drag = null;       // {card, uid, x0, y0, lastX, moved, hover, ghost, tilt}

    const units = () => [].slice.call(panel.querySelectorAll('.eunit'));

    // 指到哪只：认立绘的包围盒，外扩 10px 手感余量（死亡单位不在 DOM，天然排除）
    const unitAt = (x, y) => {
      let hit = null;
      units().forEach((u) => {
        const r = u.querySelector('.unit-art').getBoundingClientRect();
        if (x >= r.left - 10 && x <= r.right + 10 &&
            y >= r.top - 10 && y <= r.bottom + 10) hit = u;
      });
      return hit;
    };

    const setAim = (u) => {
      units().forEach((x) => x.classList.toggle('is-aim', x === u));
    };

    const clearAim = () => {
      stage.classList.remove('is-aiming');
      units().forEach((x) => x.classList.remove('is-aim'));
    };

    const placeGhost = (g, x, y, tilt) => {
      // ⚠️ -94%：幽灵卡悬在指针**上方** —— 首版 -58% 会把整个目标盖住，
      //   高亮等于没做（设计稿探针踩过）。投放飞行段才收进敌人体内。
      g.style.transform =
        'translate(' + x + 'px,' + y + 'px) translate(-50%,-94%)' +
        ' rotate(' + (tilt || 0) + 'deg) scale(1.05)';
    };

    const flyGhost = (g, x, y, mode, done) => {
      g.classList.add(mode);
      g.style.transform =
        'translate(' + x + 'px,' + y + 'px)' +
        ' translate(-50%,' + (mode === 'flying' ? '-55%' : '-94%') + ')' +
        ' rotate(0deg) scale(' + (mode === 'flying' ? .4 : 1) + ')';
      setTimeout(function () { g.remove(); if (done) done(); }, 240);
    };

    // 落空回弹：幽灵卡回到卡槽原位，摘掉占位态
    const springBack = (d) => {
      const r = d.card.getBoundingClientRect();
      flyGhost(d.ghost, r.left + r.width / 2, r.bottom - 12, 'back', function () {
        d.card.classList.remove('is-lift');
      });
    };

    hand.addEventListener('pointerdown', function (e) {
      const card = e.target.closest('.card');
      if (!card || card.classList.contains('disabled')) return;
      drag = {
        card: card, uid: Number(card.dataset.uid),
        x0: e.clientX, y0: e.clientY, lastX: e.clientX,
        moved: false, hover: null, ghost: null, tilt: 0
      };
    });

    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < THRESHOLD) return;
        drag.moved = true;
        // 幽灵卡挂 body —— 手牌每帧全量重建，挂在里面会被立刻清掉
        drag.ghost = drag.card.cloneNode(true);
        drag.ghost.classList.remove('is-lift');
        drag.ghost.classList.add('play-ghost');
        document.body.appendChild(drag.ghost);
        drag.card.classList.add('is-lift');
        stage.classList.add('is-aiming');
      }
      // 倾角随横向速度，带平滑
      const vx = e.clientX - drag.lastX;
      drag.lastX = e.clientX;
      drag.tilt = drag.tilt * .8 + Math.max(-TILT_MAX, Math.min(TILT_MAX, vx * .55)) * .2;
      placeGhost(drag.ghost, e.clientX, e.clientY, drag.tilt);
      const u = unitAt(e.clientX, e.clientY);
      if (u !== drag.hover) {
        setAim(u);
        drag.hover = u;
      }
    });

    const endDrag = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;

      // —— 点按（没拖动）：交给 click 委托，这里不插手 ——
      if (!d.moved) return;

      clearAim();
      Render._justDragged = true;
      setTimeout(function () { Render._justDragged = false; }, 350);

      // 卡的定义决定投放语义（M53b）：attack 用目标；skill/power 作用自己
      // （cards.js 里自我牌的 play 全走 ctx.gainBlock / 抽牌等，不读目标）
      const hc = Combat.state.hand.find((c) => c.uid === d.uid);
      if (!hc || !Combat.canPlay(hc)) {
        // 手牌中途被重建 / 牌已不可用 → 按落空处理，别把幽灵卡飞进空气
        springBack(d);
        return;
      }
      const isAttack = hc.def.type === 'attack';

      // —— 投放到敌人身上：attack 指定它为目标；skill/power **不动目标** ——
      //   （作用给自己的牌不该偷偷改走攻击目标）
      if (d.hover) {
        const r = d.hover.querySelector('.unit-art').getBoundingClientRect();
        flyGhost(d.ghost, r.left + r.width / 2, r.top + r.height / 2, 'flying');
        if (isAttack) Combat.setTarget(Number(d.hover.dataset.eidx));
        Combat.playCard(d.uid);
        Render.draw();
        return;
      }

      // —— 落空：attack 弹回（攻击必须有明确目标）；
      //     skill/power 作用自己，**落到哪都出牌** —— 与点按同效
      //     （走当前目标，而自我牌本就不读目标）。幽灵卡飞向掘者，
      //     示意「作用在自己身上」。该规则是 M53b 加的：防御 / 能力牌
      //     拖出去松手不落在敌人上，此前会被当成落空弹回，牌打不出去。
      if (!isAttack) {
        const pr = document.querySelector('#player-panel .unit-art').getBoundingClientRect();
        flyGhost(d.ghost, pr.left + pr.width / 2, pr.top + pr.height / 2, 'flying');
        Combat.playCard(d.uid);
        Render.draw();
        return;
      }

      springBack(d);
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  },

  // 卡池验证面板：手动把任意一张卡塞进手牌，验证机制。
  // 只列**当前角色**的卡 —— 把掘者的「撬棍」塞给医师没有意义。
  fillPoolSelect() {
    const sel = document.getElementById('pool-select');
    // boot 阶段 Run.state 还没建，先按默认角色列；App.boot 里 Run.start 后会再刷一次
    const charId = (typeof Run !== 'undefined' && Run.state) ? Run.state.charId : DEFAULT_CHAR;
    let html = '';

    for (let dl = 0; dl <= 10; dl++) {
      // 诅咒卡也是 dl:0，但它不属于卡池，单独列在最后
      const group = cardsByDl(dl, charId).filter((id) => CARDS[id].rarity !== 'curse');
      if (!group.length) continue;
      html += '<optgroup label="' + (dl === 0 ? '基础池（10 张）' : 'DL' + dl + ' 解锁') + '">';
      group.forEach(function (id) {
        const d = CARDS[id];
        html +=
          '<option value="' + id + '">' +
          d.name + '（' + d.cost + ' 费 · ' + (CARD_TYPE_NAMES[d.type] || d.type) + '）' +
          '</option>';
      });
      html += '</optgroup>';
    }

    // 诅咒卡：塞进手牌能看到它打不出去、回合末扣血
    const curses = Object.keys(CARDS).filter((id) => CARDS[id].rarity === 'curse');
    if (curses.length) {
      html += '<optgroup label="诅咒卡（不属于卡池）">';
      curses.forEach(function (id) {
        html += '<option value="' + id + '">' + CARDS[id].name + '（不可打出）</option>';
      });
      html += '</optgroup>';
    }

    sel.innerHTML = html;
  },

  bindPoolPanel() {
    document.getElementById('pool-add').addEventListener('click', function () {
      const s = Combat.state;
      if (!s || s.phase === 'win' || s.phase === 'lose') return;
      const id = document.getElementById('pool-select').value;
      if (!id) return;
      s.hand.push(mkCard(id));
      Render.draw();
    });

    document.getElementById('pool-energy').addEventListener('click', function () {
      if (!Combat.state) return;
      Combat.state.player.energy = 99;
      Render.draw();
    });

    document.getElementById('depth-input').addEventListener('input', function (e) {
      if (!Combat.state) return;
      // 上限跟着当前地图的实际深度走。写死数字的话，大关一改层数这个调试控件
      // 就够不到深层，深压倍率根本测不了（Act 1 已从 21 层改到 33 层）。
      const maxD = (typeof Run !== 'undefined' && Run.state && Run.state.map)
        ? Run.state.map.depth : 33;
      Combat.state.depth = Math.max(1, Math.min(maxD, Number(e.target.value) || 1));
      Render.draw();
    });
  },

  draw() {
    const s = Combat.state;

    document.getElementById('turn-num').textContent = s.turn;
    document.getElementById('seed-val').textContent = s.seed;
    const ePanel = document.getElementById('enemy-panel');
    ePanel.innerHTML = this.enemiesHtml(s);
    // 存活数写进属性（M21）：CSS 按它决定立绘档位、间距 —— 菌母一局
    // 最多同屏 4 个敌人（本体 + 3 只孢囊行者），满编时整体降档才放得下。
    const aliveCount = s.enemies.filter(function (e) { return e.hp > 0; }).length;
    ePanel.setAttribute('data-alive', String(aliveCount));
    // 舞台自己也拿一份（M23）：敌我之间的对峙间距要随人数收放，
    // 而间距是舞台的属性、不是敌人面板的属性 —— 没有 :has() 就够不着。
    // 与 data-alive 同源同帧写入，不会各说各话。
    const stage = document.querySelector('.battle-stage');
    if (stage) stage.setAttribute('data-crowd', String(aliveCount));
    // Boss 战标记（M30）：舞台级暗角氛围的开关。alive 归零（Boss 死透）
    // 自动熄灭 —— 终局画面从暗处亮回来，也算给这场仗一个收势。
    const hasBoss = s.enemies.some(function (e) {
      return e.hp > 0 && e.def.kind === 'boss';
    });
    if (stage) stage.setAttribute('data-boss', hasBoss ? '1' : '0');
    // 舞台 HUD（M25）：能量条与地点标签贴舞台左上角，与敌人面板分开渲染 ——
    // 面板自带 position: relative 且只占内容宽，HUD 挂在里面会跟着漂。
    const hud = document.getElementById('stage-hud');
    if (hud) hud.innerHTML = this.hudHtml(s);
    document.getElementById('player-panel').innerHTML = this.playerHtml(s);
    // 药水腰带（M78 · §11）
    const belt = document.getElementById('potion-belt');
    if (belt) belt.innerHTML = this.potionBeltHtml(s);
    // M87/V9-C（手机）：每次重绘收回半露态 —— 保留展开只在同一次点击内有效，
    // 桌面端媒体查询外这条类无样式，挂着无害。空手牌不折叠（没牌可展开）。
    const handEl = document.getElementById('hand');
    handEl.innerHTML = this.handHtml(s);
    handEl.classList.toggle('is-folded', s.hand.length > 0);
    document.getElementById('end-turn').disabled = s.phase !== 'player';

    // 地形背景（M12）：按深度带换图。改类不换节点，浏览器只在图片真的变了时才重绘。
    const bg = document.getElementById('battle-bg');
    if (bg) {
      bg.hidden = false;
      bg.className = 'battle-bg ' + Art.battleBgClass(s.depth);
    }

    // 必须在重建 DOM 之后：feedback 要拿到新的元素来挂动画
    this.feedback(s);
    // M66：手牌横向溢出自适应（手机端「卡牌大小不一」的根因）
    this.fitHand();
    this.turnBanner(s);   // M58 P1：回合切换横幅（phase diff）
    this.bossPhase(s);    // M60 P2：Boss 阶段变化提示（血量阈值 diff）

    // 自适应音频参数（M39）：局势 → tension。放在最后 —— 它只写参数、不碰 DOM，
    // 晚一步不影响画面，却保证用的是本帧最新的血量与回合数。
    this.audioUpdate(s);

    this.drawLog(s);
    this.drawResult(s);
  },

  // ---------- 受击反馈（M8）----------
  //
  // 不靠引擎抛事件：那样得改 combat.js，而这是纯表现问题。
  // 渲染层自己存一份上次的血量，这次比上次低就抖一下、飘个数字。
  // 副作用：重打本节点这类「血量凭空变多」的跳变不会有动画（只处理掉血），
  // 这正是想要的 —— 只在真被打到时给反馈。
  // 开新的一场时调用（App.startBattle）。必须丢掉上一场的快照与残留飘字：
  // 否则「上一场敌人 160 血、这一场 40 血」会在开局瞬间飘一个假的 −120 ——
  // 换成更弱的怪、或中途离场再进下一场都会踩到。
  resetFeedback() {
    this._lastHp = {};
    this._lastStr = {};   // M57：力量快照同款清法（新一场不许飘上一场的力量增量）
    this._lastBlk = {};   // M73：格挡快照同款清法（新一场不许播上一场的防御动作）
    this._lastPhase = null; // M58 P1：回合横幅的相位快照（新一场首帧不横幅）
    this._lastBossPct = null; // M60 P2：Boss 血量百分比快照（新一场首帧不报阶段）
    this._dying = [];       // M58 P1：死亡表现名单清空（上一场的尸体不带来）
    this._seenAlive = [];   // M58 P1：上一帧活着的敌人（死亡收录的依据）
    this.pinnedPlayer = false; // M64b：钉住不跨场 —— 新一场浮层回默认悬停展开
    // M39：音频的跨场状态也要清 —— 上一场的存活数留着，会让新战斗的第一帧
    // 误报一次「击杀」提示音；濒死标记留着，则新一场真到濒死时反而不会响。
    this._lowHpWarned = false;
    this._enemyAlive = null;
    const host = document.getElementById('view-combat');
    const stage = document.querySelector('.battle-stage');
    if (!host) return;
    // M26 起连特效层（.fxlayer）与出手残影（.ghost）一起清 ——
    // 开新的一场时上一场的特效不许留到新画面上。
    Array.prototype.forEach.call(
      host.querySelectorAll('.dmg-float, .str-float, .fxlayer, .unit-art .ghost'),
      function (n) { n.remove(); }
    );
    // M30 Boss 登场：新一场、场上有活着的 Boss、用户没关动效 ——
    // 给舞台挂 boss-entering 类 0.95s，Boss 立绘播一次「从暗处压下来」的
    // 入场（scale 1.18 → 1 + 亮起）。类挂在舞台（静态 DOM，不随 draw 重建），
    // 动画挂立绘 img 上；类一移除就落回待机 keyframes，无缝衔接。
    // clearTimeout 防重入：连开两场时旧定时器不许把新一场的入场提前掐灭。
    if (stage) {
      stage.classList.remove('boss-entering');
      clearTimeout(this._bossEnterT);
      const isBossFight = Combat.state && Combat.state.enemies.some(
        function (e) { return e.hp > 0 && e.def.kind === 'boss'; }
      );
      if (isBossFight && this.fxAllowed()) {
        stage.classList.add('boss-entering');
        const self = stage;
        this._bossEnterT = setTimeout(function () {
          self.classList.remove('boss-entering');
        }, 950);
      }
    }
  },

  // ---------- 音频（M39）----------
  //
  // 渲染层是**唯一**同时知道「谁在哪、谁在打谁、局势多紧张」的地方，所以它是
  // 音频参数的产出点。音频引擎（TDAudio）不认识 Combat，也不碰 DOM —— 它只收
  // 三个数（声源坐标）和几个 0–1 参数，这条边界必须守住，否则音频层会长出
  // 一份战斗逻辑的副本，两边迟早说不一样的话。
  _lowHpWarned: false,
  _enemyAlive: null,

  // 单位 → 声源坐标。舞台几何是表现层的知识（玩家恒在左、敌人恒在右、队列顺序
  // 就是前后排），所以映射放这里；引擎那边只收 { x, dist, occl }。
  stageAudio(unit, s) {
    if (typeof Sfx === 'undefined' || !Sfx.stagePos) return null;
    if (unit === s.player) return Sfx.stagePos({ side: 'left', index: 0, count: 1 });
    // 空间位置按**存活顺序**算：死掉的不占位（M21 死后不进 DOM），
    // 用引擎下标会得到「前排死了以后后排还在前排位置」的错位声场。
    const alive = s.enemies.filter(function (e) { return e.hp > 0; });
    let i = alive.indexOf(unit);
    if (i < 0) i = s.enemies.indexOf(unit);
    if (i < 0) i = 0;
    return Sfx.stagePos({ side: 'right', index: i, count: alive.length || 1 });
  },

  // 局势 → 自适应音频参数。四路权重刻意集中在这一处 ——
  // 想调「紧张感什么时候上来」，只改这一行，不用翻遍音频层。
  audioUpdate(s) {
    if (typeof TDAudio === 'undefined' || !TDAudio) return;
    const alive = s.enemies.filter(function (e) { return e.hp > 0; });
    let hpSum = 0, maxSum = 0, boss = 0;
    alive.forEach(function (e) {
      hpSum += e.hp; maxSum += e.maxHp;
      if (e.def && e.def.kind === 'boss') boss = 1;
    });

    const enemyPressure = maxSum > 0 ? hpSum / maxSum : 0;              // 敌人还越满血越紧张
    const healthRatio = s.player.maxHp ? s.player.hp / s.player.maxHp : 1;
    const healthPressure = 1 - healthRatio;                             // 自己越残越紧张
    const turnPressure = Math.min(1, (s.turn - 1) / 8);                 // 拖得越久越紧张
    const tension = 0.40 * enemyPressure + 0.30 * healthPressure +
                    0.15 * turnPressure + 0.15 * boss;

    try {
      TDAudio.setParam('tension', tension);
      TDAudio.setParam('health', healthRatio);
      TDAudio.setParam('depth', s.depth);
    } catch (e) { /* 音频参数永远不该把渲染带崩 */ }

    if (typeof Sfx === 'undefined' || !Sfx.stinger) return;
    // 击杀提示音：存活数掉了才响（不是每帧刷）
    if (this._enemyAlive != null && alive.length < this._enemyAlive) {
      try { Sfx.stinger('kill'); } catch (e) {}
    }
    this._enemyAlive = alive.length;
    // 濒死提示音：跌破 22% 只响一次，回到 40% 以上才重新武装
    if (healthRatio <= 0.22 && !this._lowHpWarned) {
      this._lowHpWarned = true;
      try { Sfx.stinger('lowhp'); } catch (e) {}
    } else if (healthRatio >= 0.40) {
      this._lowHpWarned = false;
    }
  },

  // 一帧里要播两类反馈，来源不同（M24）：
  //   ① 出手 —— 读引擎的动作日志（Combat.acts）。渲染层推不出来：伤害的来源
  //      有玩家的牌、敌人意图、荆棘反伤、中毒，纯靠 UI 猜会说谎。
  //   ② 受击 —— 前后血量 diff，外加「被打了但被格挡全吸收」（血量一点没掉）。
  // 两者必须分开：掉血不等于有人出手（中毒 / 诅咒自伤 / 荆棘反伤都没有出手方），
  // 出手也不一定掉血（格挡挡下了全部）。
  feedback(s) {
    const self = this;

    // ① 出手动作。连击 / AOE 会在同一帧留下多条日志，同一单位只播一次挥击。
    const swung = {};
    const struck = {}; // 这一帧被指向过的单位，格挡全吸收时靠它补受击反应
    const acts = Combat.takeActs();
    // M40：先把这一帧的动作按出手者分组 —— 「一个出手者留下几条、打的是谁」本身就是信息：
    //   同一个目标多条 = 连击（该响几下）  不同目标多条 = 群体（该横扫）
    // 这两种在卡面数据里判不出来（群体是 play() 里 forEach 出来的），只能在运行时读。
    const bySrc = {};
    acts.forEach(function (a) {
      const k = self.unitKey(a.src, s);
      (bySrc[k] = bySrc[k] || []).push(a);
    });
    acts.forEach(function (a) {
      const sk = self.unitKey(a.src, s);
      if (!swung[sk]) {
        swung[sk] = true;
        const el = self.unitEl(a.src, s);
        // M73b：出手者是玩家 → 传 charId 走原地帧动画；敌人走突进老路径
        if (el) self.attackEffect(el, a.src === s.player ? s.player.charId : null);
        // M45：出手瞬间强制点亮出手者的意图胶囊（.intent-reveal）。
        // 敌人出手前几帧，玩家能看清「它这一下是什么招」——M43 把意图改成
        // 悬停才显形后，不悬停就完全看不到敌人要干什么；这里补一条
        // 「自己会亮」的通路，不依赖鼠标。敌人挥完 1100ms 类摘除，
        // 落回悬停控制。玩家没有意图胶囊，unitEl 取到的元素里查不到就跳过。
        if (el) self.revealIntent(el);
        // 打击音效（M36 / M39 空间化 / M40 分层）：跟挥击动画同帧、同一去重。
        // 声源位置由舞台语义给出（玩家偏左、敌人按队列打到右侧，越靠后越远越闷）；
        // 优先级：玩家自己的声音 1（多声部挤爆时先保它），敌人 2。
        if (a.impact && typeof Sfx !== 'undefined') {
          const ap = self.stageAudio(a.src, s);
          if (ap) { ap.prio = (a.src === s.player) ? 1 : 2; ap.name = a.impact; }
          // 画像（M40）：材质来自卡面（a.impact），特质来自卡面字段（a.sfx），
          // 力度来自**这一击真正打出的力道**（a.dmg，减格挡前的原始值）。
          // 同一出手者这一帧的动作条数就是 times —— 连击要真的响三下。
          const group = bySrc[sk] || [a];
          if (a.sfx && typeof SfxProfile !== 'undefined') {
            const dsts = {};
            group.forEach(function (x) { dsts[self.unitKey(x.dst, s)] = true; });
            const wide = Object.keys(dsts).length > 1;   // 打的是不同目标 ⇒ 群体
            if (ap) {
              ap.traits = wide ? SfxProfile.merge(a.sfx.traits, ['wide']) : a.sfx.traits;
              ap.weight = SfxProfile.weightOf(a.dmg);
              ap.times = group.length;
              // M41：把**真实伤害**一并传下去。ap.weight 是从 dmg 推出来的结果，
              // 单看 weight 分不清「6 伤的轻击」与「估算的轻击」；带上 dmg 后
              // 诊断层能判断这个力度是真值（act.dmg）还是 SfxProfile 的估算值。
              ap.dmg = a.dmg;
            }
          }
          Sfx.play(a.impact, ap);
        }
      }
      struck[self.unitKey(a.dst, s)] = true;
    });

    // ② 受击反应
    const list = [];
    s.enemies.forEach(function (e, i) {
      list.push({
        key: 'e' + i, hp: e.hp, sel: '.eunit[data-eidx="' + i + '"]',
        // M57：力量 = 常驻 + 回合临时。临时力量到回合开始会清零，
        // 只 diff 不展示降幅 —— 减掉时静默，不播「倒退」。
        str: (e.buffs.str || 0) + (e.buffs.strTurn || 0),
        blk: e.block || 0,
      });
    });
    list.push({
      key: 'p', hp: s.player.hp, sel: '#player-panel .unit',
      str: (s.player.buffs.str || 0) + (s.player.buffs.strTurn || 0),
      blk: s.player.block || 0,
    });

    list.forEach(function (u) {
      const prev = self._lastHp[u.key];
      const lost = (prev != null && u.hp < prev) ? prev - u.hp : 0;
      if (lost > 0 || struck[u.key]) {
        const el = document.querySelector(u.sel);
        // 被格挡全吸收时 lost 为 0：给一下受击反应，但不飘一个假的「−0」上去。
        // 死于这一击的单位已经不在 DOM 里（M21），取不到元素就没反应 ——
        // 这是「死后不占位」换来的，不是漏写。
        if (el) self.hitEffect(el, lost);
        // P0-4 打击感：掉血到阈值才震 —— 中毒 / 诅咒自伤这类小额损耗不震，
        // 只有「真挨了一下」才震。掉得越狠震得越大，重击再加一记顿帧。
        // 格挡全吸收（lost = 0）不震：盾接住了就该是稳的。
        if (lost >= 15) self.impactStage(true);
        else if (lost >= 8) self.impactStage(false);
      }
      self._lastHp[u.key] = u.hp;

      // M57 力量增强：快照 diff，增量 > 0 → 红色气场亮一下 + 「力量 +N」飘字。
      // 力量没有中央写入点（卡牌 / 事件 / 敌人招式各自直写 buffs），
      // 渲染层 diff 是唯一能全覆盖的挂钩位 —— 与血量快照同一套机制。
      const prevStr = self._lastStr[u.key];
      const gained = (prevStr != null && u.str > prevStr) ? u.str - prevStr : 0;
      if (gained > 0) {
        const el = document.querySelector(u.sel);
        if (el) self.strEffect(el, gained);
      }
      self._lastStr[u.key] = u.str;

      // M73 防御动作：格挡快照 diff（与 _lastHp / _lastStr 同一套机制）。
      // 增量 > 0 → 玩家扎稳 + 盾光环（defendEffect 内部只认玩家面板）；
      // 敌人拿格挡只 diff 不播 —— 需求只做玩家侧。
      const prevBlk = self._lastBlk[u.key];
      const gainedBlk = (prevBlk != null && u.blk > prevBlk) ? u.blk - prevBlk : 0;
      if (gainedBlk > 0) {
        const el = document.querySelector(u.sel);
        if (el) self.defendEffect(el);
      }
      self._lastBlk[u.key] = u.blk;
    });
  },

  // 单位 → DOM 元素 / 快照键。敌人按引擎数组下标定位（与 data-eidx 同源），
  // 与 M23 的 DOM 重排无关 —— 排的是显示顺序，下标始终跟着引擎走。
  unitEl(unit, s) {
    if (unit === s.player) return document.querySelector('#player-panel .unit');
    const i = s.enemies.indexOf(unit);
    if (i < 0) return null;
    return document.querySelector('#enemy-panel .eunit[data-eidx="' + i + '"]');
  },
  unitKey(unit, s) {
    return unit === s.player ? 'p' : 'e' + s.enemies.indexOf(unit);
  },

  // 出手动作（M24）：朝对面冲一步。方向不用 JS 传 —— 玩家恒在左、敌人恒在右，
  // CSS 按父容器分（#player-panel 向右冲、#enemy-panel 向左冲）。
  // M26 补一道残影：复制位图立绘垫在 .unit-art 里向后拖出淡出，
  // 与 is-attack 同生命周期（420ms 后一起删）。SVG 剪影不复制 ——
  // 形状太简单，拖尾出不了「重影」的效果。
  // M73b：玩家改「原地帧动画」（用户定稿：原地不位移、不做挤压拉伸）——
  // 有登记帧的角色走 attackFrames()（换图 + 轻微前倾，无位移无残影），
  // 没帧的（含全部敌人）保持突进 + 残影老路径。
  attackEffect(el, charId) {
    const frames = charId && this.ATK_FRAMES[charId];
    const life = frames ? 650 : 420;   // M73c：帧动画节奏 0.65s（用户定稿 0.6-0.8s）
    el.classList.remove('is-attack');
    void el.offsetWidth;
    el.classList.add('is-attack');
    setTimeout(function () { el.classList.remove('is-attack'); }, life);

    if (frames) { this.attackFrames(el, frames); return; }

    if (!Render.fxAllowed()) return;
    const bm = el.querySelector('.unit-art > img');
    if (!bm) return;
    const g = document.createElement('img');
    g.src = bm.src;
    g.className = 'unit-bm ghost';
    g.alt = '';
    // 残影向后拖：玩家向右冲，残影向左淡出；敌人相反
    g.style.setProperty('--gx', el.closest('#player-panel') ? '-14px' : '14px');
    bm.parentNode.appendChild(g);
    setTimeout(function () { g.remove(); }, 420);
  },

  // M73b 玩家原地攻击帧。帧序（M73c 定稿节奏 0.65s，规格区间 0.6-0.8s）：
  //   0ms     蓄力（atk2：医师刀至肩侧 / 守火者提灯收至胸前、火焰增大）
  //   150ms   击出（atk3：刀向前挥出 / 火焰前窜）—— 含「击出后短停顿」
  //   520ms   收势回站立（原图）
  // 躯干的轻微前倾由 CSS atk-swing-p（rotate 3.5°，0.6s）承担；帧图只管手臂与武器。
  // 帧图与立绘同画布（靴底基线对齐），换帧身体不跳；fx 关 → 不换帧，
  // 类与 CSS 动画交给 html.fx-off 总开关停播。
  ATK_FRAMES: {
    digger: ['preview-assets-v3/digger-atk2.png?v=M73c', 'preview-assets-v3/digger-atk3.png?v=M73c'],
    medic: ['preview-assets-v3/medic-atk2.png?v=M73c', 'preview-assets-v3/medic-atk3.png?v=M73c'],
    keeper: ['preview-assets-v3/keeper-atk2.png?v=M73c', 'preview-assets-v3/keeper-atk3.png?v=M73c'],
  },
  _atkPreload: null,
  attackFrames(el, frames) {
    // 预加载一次：战斗里第一击就不能等网络
    if (!this._atkPreload) {
      this._atkPreload = {};
      Object.keys(this.ATK_FRAMES).forEach(function (k) {
        this._atkPreload[k] = this.ATK_FRAMES[k].map(function (src) {
          const i = new Image(); i.src = src; return i;
        });
      }, this);
    }
    if (!Render.fxOn()) return;
    const bm = el.querySelector('.unit-art > img');
    if (!bm) return;
    const base = bm.getAttribute('src');
    bm.src = frames[0];
    setTimeout(function () { bm.src = frames[1]; }, 150);
    setTimeout(function () { bm.src = base; }, 520);
  },

  // 防御动作（M73，玩家侧）：格挡快照 diff 触发（feedback()）。
  // 扎稳下盘（is-defend，CSS 脚底为轴下压再回弹，脚部像素不动）
  // + 脚底淡蓝盾光环（.block-ring 临时节点，播完自删 —— 与残影同模式）。
  // 生命周期 620ms，与 CSS 动画 .6s 对齐。动作动画由 html.fx-off 总开关
  // 停播；光环是纯装饰，这里显式拦一道，与残影的 fxAllowed() 同款。
  // 敌人拿到格挡不播（feedback 传进来的 el 在 #enemy-panel 里，直接静默）。
  defendEffect(el) {
    if (!el.closest || !el.closest('#player-panel')) return;
    el.classList.remove('is-defend');
    void el.offsetWidth;
    el.classList.add('is-defend');
    setTimeout(function () { el.classList.remove('is-defend'); }, 620);

    if (!Render.fxOn()) return;
    const art = el.querySelector('.unit-art');
    if (!art) return;
    const ring = document.createElement('i');
    ring.className = 'block-ring';
    art.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 620);
  },

  // 意图显形（M45）：给单位的意图胶囊挂一个短命类，绕过 M43 的悬停门槛。
  // 时机：出手者挥击的同一帧挂上，1100ms 后摘除 —— 比挥击（420ms）久一截，
  // 让玩家在敌人「打完之后」还有时间看清楚它刚才是哪一招。
  // 重复触发先清后加 + 强制重排（与 attackEffect 同款），连击不会中途熄掉。
  // 玩家单位里没有 .intent，静默跳过 —— 不需要分支判断敌我。
  revealIntent(el) {
    const box = el.querySelector('.intent');
    if (!box) return;
    box.classList.remove('intent-reveal');
    void box.offsetWidth;
    box.classList.add('intent-reveal');
    setTimeout(function () { box.classList.remove('intent-reveal'); }, 1100);
  },

  // M58b：动效总开关。默认开 —— 不再跟随系统 prefers-reduced-motion
  //（实测玩家机器会向浏览器报 reduce，跟着它 = 全套动效消失，2026-10-15 用户反馈）。
  // 关闭方式：localStorage td-fx=0 —— app.js 据此给 html 挂 fx-off 类，
  // CSS 侧连待机呼吸一起全停（P1 设置面板接 UI）。存储读不到按开处理。
  fxOn() {
    try { return window.localStorage.getItem('td-fx') !== '0'; }
    catch (e) { return true; }
  },

  // 回合切换横幅（M58 P1）：不靠引擎抛事件，渲染层自己 diff phase ——
  // 与受击反馈（_lastHp）同一套「表现层自持快照」思路。
  // enemy→player「你的回合」、player→enemy「敌方回合」；首帧与胜负结算
  // 不横幅（开局横幅是噪音，结果面板已经说话了）。
  // 横幅是纯装饰 → 跟 fxOn 走；关动效时战斗日志里本来就有回合行，信息不丢。
  _lastPhase: null,
  turnBanner(s, textOverride) {
    if (this._lastPhase === s.phase) return;
    const from = this._lastPhase;
    this._lastPhase = s.phase;
    if (from == null || !this.fxOn()) return;
    const text = textOverride || (s.phase === 'player' ? '你的回合'
      : s.phase === 'enemy' ? '敌方回合' : null);
    if (!text) return;
    this.bannerEl(text);
  },

  // M60 P2：Boss 阶段变化提示。引擎里三个 Boss 各自的换招逻辑不动
  //（锈冠半血合并 / 菌母半血狂化 / 执械者三段姿态），这里只做**告知**：
  // 血量百分比首次跌破 1/2、1/3（大 Boss 的常见阶段线）时挂横幅 + 轻震。
  // 快照 diff：开局那一帧只记值不报 —— 不然一进场就喊「阶段变化」。
  bossPhase(s) {
    const boss = s.enemies.filter(function (e) {
      return e.hp > 0 && e.def.kind === 'boss';
    })[0];
    if (!boss) { this._lastBossPct = null; return; }
    const pct = boss.hp / boss.maxHp;
    const prev = this._lastBossPct;
    this._lastBossPct = pct;
    if (prev == null || !this.fxOn()) return;
    const line = prev > 0.5 && pct <= 0.5 ? '它变了 —— 半血阶段'
      : prev > 1 / 3 && pct <= 1 / 3 ? '它变了 —— 濒危阶段' : null;
    if (!line) return;
    this.bannerEl(line, true);
    this.impactStage(false);
  },

  // 横幅实体：一个 .turn-banner 节点，播完 0.9s 自摘。warn = 警示配色。
  bannerEl(text, warn) {
    const stage = document.querySelector('.battle-stage');
    if (!stage) return;
    const b = document.createElement('div');
    b.className = 'turn-banner' + (warn ? ' is-warn' : '');
    b.textContent = text;
    stage.appendChild(b);
    setTimeout(function () { b.remove(); }, 900);
  },

  // P0-4 打击感收口：震屏 + 顿帧都从这里走，阈值判定留在 feedback()。
  //   heavy=true  → 大震 + 90ms 顿帧（重击）
  //   heavy=false → 小震
  // 震屏挂 .battle-stage 自身（容器无 transform，动画不会覆盖别的定位）；
  // 顿帧只冻结**后代**的动画（待机呼吸 / 漂浮 / 残影）—— 舞台自己的震屏
  // 必须照常跑，冻住它就成了「震不动的一帧」。
  impactStage(heavy) {
    const stage = document.querySelector('.battle-stage');
    if (!stage || !this.fxOn()) return;
    const cls = heavy ? 'is-shake-l' : 'is-shake-s';
    stage.classList.remove('is-shake-l', 'is-shake-s');
    void stage.offsetWidth;
    stage.classList.add(cls);
    clearTimeout(this._shakeT);
    this._shakeT = setTimeout(function () {
      stage.classList.remove('is-shake-l', 'is-shake-s');
    }, heavy ? 320 : 240);
    if (heavy) {
      stage.classList.add('is-freeze');
      clearTimeout(this._freezeT);
      this._freezeT = setTimeout(function () {
        stage.classList.remove('is-freeze');
      }, 90);
    }
  },

  hitEffect(el, amount) {
    // 重启动画：同一个 class 连着加两次不会重播，中间要强制重排
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
    setTimeout(function () { el.classList.remove('is-hit'); }, 420);

    if (amount <= 0) return; // 被完全格挡：给动作，不给伤害数字

    // 飘字挂在 #view-combat 上而不是单位里 —— 单位面板每次都全量重建，
    // 挂在里面会被下一帧清掉。（M26 增强的是样式：白字红描边、先砸大再上飘；
    // 类名 / 宿主 / 文本格式没动 —— 探针绑死了这三样。）
    const host = document.getElementById('view-combat');
    if (!host || !host.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const t = document.createElement('span');
    // M72：伤害分层 —— 伤害越大字越大越烫（tier-0 现状 / 1 → 10+ / 2 → 20+ / 3 → 35+）
    const tier = amount >= 35 ? 3 : amount >= 20 ? 2 : amount >= 10 ? 1 : 0;
    t.className = 'dmg-float tier-' + tier;
    t.textContent = '−' + amount;
    t.style.left = (r.left - h.left + r.width / 2) + 'px';
    t.style.top = (r.top - h.top + 12) + 'px';
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 1850);   // M71：与 1.8s 动画同步（方案 B 停一拍再散）

    // 命中特效层（M26）：弧光 + 冲击环 + 碎屑。reduce 用户整段跳过，
    // 反馈只剩飘字 —— 与 M24 的降级路径一致。
    if (Render.fxAllowed()) Render.hitFx(el);
  },

  // 力量增强反馈（M57）：红色气场亮一下 + 「力量 +N」力度飘字。
  // 触发来自 feedback() 的力量快照 diff（N = 增量）；设计稿 preview-str-aura.html
  // 已审核通过，三层与设计稿一致：
  //   ① 红辉光脉冲（str-glow，挂 .unit-art）② 扩散红环（::after，大小随 --str-n）
  //   ③ 「力量 +N」飘字（挂 #view-combat，与伤害飘字同模式躲全量重建）。
  // ①② 是装饰，动画进 no-preference 媒体块；③ 是信息，动画在媒体查询外
  //（与 dmg-float 的 dmg-rise 同款约定），reduce 用户也看得到加了几个。
  strEffect(el, n) {
    const art = el.querySelector('.unit-art');
    if (art) {
      // 重启动画三步：摘类 → 强制重排 → 重挂（连增两次不会吞）
      art.classList.remove('is-strbuff');
      void art.offsetWidth;
      art.style.setProperty('--str-n', n);
      art.classList.add('is-strbuff');
      setTimeout(function () { art.classList.remove('is-strbuff'); }, 850);
    }

    const host = document.getElementById('view-combat');
    if (!host || !host.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'str-float';
    t.style.setProperty('--str-n', n);
    t.innerHTML = '<i>力量</i><b>+' + n + '</b>';
    t.style.left = (r.left - h.left + r.width / 2) + 'px';
    t.style.top = (r.top - h.top + 8) + 'px';
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 1100);
  },

  // 动效允许判定（M26 设，M58b 改判据）。
  // ⚠️ 原来读系统 prefers-reduced-motion —— 实测玩家机器会报 reduce，
  // 结果 JS 侧的命中特效 / 残影 / Boss 登场全被拦（2026-10-15 用户反馈
  // 「打击感没有体现」的第二根因，M58b 只修了 CSS 侧漏了这里）。
  // 现在与 CSS 总开关同源：td-fx（fxOn）。
  // M66 手牌横向溢出自适应：390px 屏 4 张牌就超宽（4×118-10=462），
  // 超出的牌被屏幕右缘裁掉半张 —— 观感就是「卡牌大小不一样」。
  // 修法：整排手牌等比缩到放进容器（scale 下限 0.5），缩不了的极端牌量
  //（7+ 张）回退原生横滑（≤720 媒体块已有 overflow-x: auto）。
  // ⚠️ 不用 zoom：M21 踩过「zoom 元素的 rect 与渲染位置对不上」，会破坏
  // M53 从手牌拖拽出牌的取点；transform scale 的 getBoundingClientRect
  // 自带变换后的正确值，拖拽 / 点击坐标不受影响。
  // transform 不改布局盒 —— 负 margin 把缩小的视觉高度差收回来。
  fitHand() {
    const hand = document.getElementById('hand');
    if (!hand) return;
    hand.style.transform = 'none';
    hand.style.overflowX = '';
    hand.style.marginBottom = '';
    const need = hand.scrollWidth;
    const have = hand.clientWidth;
    if (need <= have + 1) return;               // 放得下：不缩
    const s = Math.max(0.5, have / need);
    hand.style.transformOrigin = 'left bottom'; // 手牌沉底，缩完仍贴住操作区
    hand.style.transform = 'scale(' + s.toFixed(3) + ')';
    hand.style.marginBottom = -(hand.offsetHeight * (1 - s)).toFixed(1) + 'px';
    if (need * s > have + 1) {
      hand.style.overflowX = 'auto';            // 触底仍放不下（7+ 张）：横滑兜底
    } else {
      hand.style.overflowX = 'visible';         // 布局仍超宽，但画出来已缩进屏内
    }
  },

  fxAllowed() {
    return this.fxOn();
  },

  // 命中特效层：斩击弧光（SVG 双层）+ 冲击环 + 碎屑 8 片。
  // 挂 #view-combat（与飘字同模式，躲单位面板的全量重建），
  // 按受击单位当前的视口坐标定位，播完自删、不参与布局。
  hitFx(el) {
    const host = document.getElementById('view-combat');
    if (!host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const fx = document.createElement('div');
    fx.className = 'fxlayer';
    fx.style.left = (r.left - h.left + r.width / 2) + 'px';
    // 爆点略高于脚 —— 躯干位置，弧光从这儿划过去才对味
    fx.style.top = (r.top - h.top + r.height * 0.42) + 'px';
    let html =
      '<svg class="fx-slash" viewBox="0 0 100 100">' +
      '<path d="M14 80 Q 52 8 88 26" stroke="rgba(255,214,130,.55)" stroke-width="15" fill="none" stroke-linecap="round"/>' +
      '<path d="M14 80 Q 52 8 88 26" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '</svg><i class="fx-ring"></i>';
    const COLORS = ['#fff', '#ffd873', '#ff8a5c', '#ce362c'];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2) * i / 8 + Math.random() * .5;
      const d = 34 + Math.random() * 30;
      html += '<i class="fx-spark" style="--dx:' +
        (Math.cos(a) * d).toFixed(1) + 'px;--dy:' +
        (Math.sin(a) * d - 18).toFixed(1) + 'px;--c:' +
        COLORS[i % COLORS.length] + '"></i>';
    }
    fx.innerHTML = html;
    host.appendChild(fx);
    setTimeout(function () { fx.remove(); }, 900);
  },

  // ---------- 单位面板 ----------

  // 前后排（M23）：0 = 前排（小怪，靠我方），1 = 后排（Boss / 精英）。
  // 只按 kind 判断，不看血量 / 体型 —— 「谁是老大」是设计事实，不是渲染推测。
  rankOf(e) {
    const k = e.def.kind;
    return (k === 'boss' || k === 'elite') ? 1 : 0;
  },

  // 舞台 HUD（M25）：贴舞台左上角的一行 —— 能量条 + 地点标签 + 换目标提示。
  // 这一行原先叫「敌人面板头」，挂在 #enemy-panel 里；但面板在 M22 之后
  // 只占内容宽（靠右），而它自带 position: relative，于是绝对定位的 HUD
  // 被钉在面板上、跟着漂到了舞台中部 —— 名字叫着「左上角」，人却不在那儿。
  // 现在它是 .battle-stage 的直接子元素，absolute 相对舞台定位。
  // 能量条也并到这一行：玩家能量原本挂在脚下的名牌里，名牌退役后
  // 左上角是画面上唯一一块不参与「我对峙敌人」构图的空地。
  hudHtml(s) {
    const multi = s.enemies.filter(function (e) { return e.hp > 0; }).length > 1;
    return (
      Render.energyHtml(s.player) +
      '<span class="unit-role">' + s.locTag + '</span>' +
      (multi ? '<span class="target-hint">拖卡出牌 · 攻击卡拖到敌人身上</span>' : '')
    );
  },

  enemiesHtml(s) {
    // M58 P1 死亡表现：刚死的单位（≤0.55s）仍画一笔 —— 挂 is-dying 播
    // 0.45s 溶解退场，到期自动从名单掉出（M21 的「尸体不占位」铁律不变，
    // 这半秒是**过渡**：data-alive / data-crowd 仍只数真活着的，间距先收，
    // 尸体在原地溶解，不挤后来者）。
    // 只收录「上一帧见过活着」的单位：过期摘除后不会再被重新收录 ——
    // 否则尸体每帧都重新入榜，永远摘不掉（首版实现在探针里当场暴露）。
    const now = Date.now();
    this._dying = (this._dying || []).filter(function (d) {
      return d.e.hp <= 0 && now - d.t < 550;
    });
    s.enemies.forEach(function (e) {
      if (e.hp > 0) {
        if (Render._seenAlive.indexOf(e) < 0) Render._seenAlive.push(e);
      } else if (Render._seenAlive.indexOf(e) >= 0) {
        Render._seenAlive.splice(Render._seenAlive.indexOf(e), 1);
        if (!Render._dying.some(function (d) { return d.e === e; })) {
          Render._dying.push({ e: e, t: now });
        }
      }
    });
    const isDying = function (e) {
      return Render._dying.some(function (d) { return d.e === e; });
    };

    // M21：死亡单位不再进 DOM。以前保留半透明的 .is-dead 尸体，
    // 但它在 flex 流里仍占着一整格宽 —— 菌母召唤到 3 只手下时，
    // 先死的那只继续占位，后来者就被挤出舞台右缘。
    // 索引仍按 s.enemies 的原下标走，data-eidx 与引擎数组对得上。
    const alive = s.enemies.filter(function (e) { return e.hp > 0; });
    // 多敌人时点一下换目标，单敌人时不用提示（提示本身在舞台 HUD 里渲染，
    // 见 hudHtml —— M25 起它不再挂在敌人面板内）
    const multi = alive.length > 1;

    // M23 前后排：多重敌人时小怪站前排（靠近我方），Boss / 精英退到后排。
    // 引擎数组里 Boss 恒在 index 0（先上场），照原顺序排就是「老大当先」，
    // 手下反而被它挡在后面。视觉上「前排 = 离我方近」，所以按 rank 重排：
    //   normal → 0（前排，贴近玩家一侧）  boss / elite → 1（后排）
    // sort 是稳定的，同 rank 之间保持引擎里的先后（「孢囊行者 #2 #3」的编号不乱）。
    // 单敌时不重排 —— 只有一只怪，谈前后排没有意义（CSS 也不需要抬高）。
    const order = s.enemies
      .map(function (e, i) { return { e: e, i: i }; })
      .filter(function (o) { return o.e.hp > 0 || isDying(o.e); })
      .sort(function (a, b) {
        return (multi ? Render.rankOf(a.e) - Render.rankOf(b.e) : a.i - b.i);
      });

    return order
      .map(function (o, k) {
        const e = o.e;
        const i = o.i;
        const isTarget = Combat.targetUnit() === e;
        // 形象：优先位图立绘（v3 卡通全身），没有对应图退回 SVG 剪影
        const bm = Art.enemyImg(e.def.id);
        // 悬浮单位（M26）：def.hover 的敌人（拾荒者残影）走上下浮动 + 地面影；
        // 没标记的一律接地 —— 脚底为轴的呼吸挤压，脚部像素不动。
        const hover = !!e.def.hover;
        // 强化层（M50）：变体（壮大 / 强化版）与词缀。两者都只加**表现** ——
        // 立绘尺寸一律不碰：M21/M30 的逐像素宽度预算是按 3 敌 / 4 敌档量过的，
        // 给壮大版把立绘放大一档，满编场景会重新溢出（那条铁律的注释还在 art.css 里）。
        // 辨识靠三处叠加：名字前缀（引擎给）+ 描边光晕（CSS）+ 词缀徽章。
        const grown = !!e.variant;
        const tint = e.tint || '';
        // 待机相位错开：按显示序给负 delay（内联覆盖 CSS 简写里的 0），
        // 相邻单位错 0.9s，画面才不会像广播体操。
        // ⚠️ 模数必须与 css/art.css 里 idle-ground 的周期一致（M49：1.6s → 2.0s）。
        // 不一致的后果不是「看不出错开」而是**更隐蔽**：delay 为 -1.8s 超出周期
        // 会回绕到 0.2s 相位，看起来「有的单位在动、有的几乎不动」。
        const delay = bm
          ? ' style="animation-delay:-' + (((k + 1) * 0.9) % 2.0).toFixed(2) + 's"'
          : '';
        // 状态图标片（M20）。M25 起它只是悬停浮层里的一份内容 ——
        // 浮层现在总存在（名字也在里面），不再是「没状态就不生成」。
        const st = Render.statsHtml(e);
        return (
          '<div class="unit eunit' + (isTarget ? ' is-target' : '') +
          (hover ? ' is-hover' : '') +
          (grown ? ' is-variant is-' + e.variant : '') +
          (e.hp <= 0 ? ' is-dying' : '') +
          '" data-eidx="' + i + '" data-rank="' +
          (multi && Render.rankOf(e) === 1 ? 'back' : 'front') + '"' +
          (tint ? ' style="--unit-tint:' + tint + '"' : '') + '>' +
          // 意图胶囊在形象头顶（M11b 舞台版式），探针只认 .intent 在 .eunit 内即可；
          // 濒死溶解的单位没有意图（死了不再想事）
          (e.hp > 0 ? Render.intentHtml(s, e) : '') +
          '<div class="unit-art art-kind-' + (e.def.kind || 'normal') +
            ' art-id-' + e.def.id + '">' +
          (hover && bm ? '<i class="oshadow"></i>' : '') +
          (bm
            ? '<img class="unit-bm" src="' + bm + '"' + delay +
              ' alt="" draggable="false">'
            : Art.enemy(e.def.id)) +
          '</div>' +
          // 强化标记（M50）常显在血条上方 —— 见 affixHtml 里的理由
          Render.affixHtml(e) +
          // 血条贴在立绘脚下（杀戮尖塔式），不进名牌；map 回调里的 this 不是
          // Render，必须点名 Render.hpBarHtml，不能用 this。
          // Boss 加宽血条 + 脚下常驻铭牌（M30）：「关底」的身份写在明面上。
          Render.hpBarHtml(e, e.def.kind === 'boss') +
          (e.def.kind === 'boss' ? Render.bossPlateHtml(e) : '') +
          // 脚下只留 HP（M25）：名牌白框退役，名字 / 目标标记 / 状态图标
          // 全部收进悬停浮层 —— 鼠标移到敌人身上才展开。
          '<div class="stats-more">' +
          '<span class="unit-name">' + e.name + '</span>' +
          (isTarget ? '<span class="target-tag">目标</span>' : '') +
          st +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  },

  playerHtml(s) {
    const p = s.player;
    // 形象：优先位图立绘（v3 卡通全身），没有对应图退回 SVG 剪影
    const bm = Art.charImg(p.charId);
    return (
      '<div class="unit' + (this.pinnedPlayer ? ' is-pinned' : '') + '">' +
      // 与敌人同款竖排（M22）：立绘在上、血条贴脚。M25 把名牌也一起去掉了 ——
      // 脚下只剩 HP，其余信息归悬停浮层（与敌人同构，两侧继续对称）。
      '<div class="unit-art unit-art-player">' +
      (bm
        ? '<img class="unit-bm" src="' + bm + '" alt="" draggable="false">'
        : Art.char(p.charId)) +
      '</div>' +
      this.hpBarHtml(p) +
      // 悬停浮层（M22 起，M25 扩成「单位的全部信息」）：
      // 名字 / 角色 / 深度 / 资源 / 状态图标 / 牌堆 —— 默认不可见，
      // 鼠标移到角色上才淡入。**能量不在里面**：它搬去了舞台左上角的能量条。
      '<div class="stats-more">' +
      '<span class="unit-name">' + p.name + '</span>' +
      '<span class="unit-role">' + p.role + '</span>' +
      '<span class="stat stat-depth">深度 D' + s.depth + '</span>' +
      this.resourceHtml(p) +
      this.statsHtml(p) +
      // 牌堆信息片（M20）：图标 + 数字，全名进 title（探针只绑能量/资源/深度的文字）
      '<span class="bicon bicon-neutral" title="抽牌堆 ' + s.drawPile.length + '">' +
      Art.buffIcon('draw') + '<i>' + s.drawPile.length + '</i></span>' +
      '<span class="bicon bicon-neutral" title="弃牌堆 ' + s.discardPile.length + '">' +
      Art.buffIcon('discard') + '<i>' + s.discardPile.length + '</i></span>' +
      '<span class="bicon bicon-neutral" title="消化堆 ' + (s.exhaustPile ? s.exhaustPile.length : 0) + '">' +
      Art.buffIcon('exhaust') + '<i>' + (s.exhaustPile ? s.exhaustPile.length : 0) + '</i></span>' +
      '</div>' +
      '</div>'
    );
  },

  // 角色资源（M6）。掘者没有资源，返回空串 —— 不会多出一个空标签。
  resourceHtml(p) {
    const r = p.resource;
    if (!r) return '';
    const cap = r.max == null ? '' : ' / ' + r.max;
    // 满了加个标记：医师到 5 点后每回合的自动累积全白费，值得提醒
    const full = r.max != null && r.value >= r.max ? ' is-full' : '';
    return '<span class="stat stat-res' + full + '">' +
      r.name + ' ' + r.value + cap + '</span>';
  },

  // 能量条（M25）：从角色脚下的名牌搬到舞台左上角（HUD 行最左一块）。
  // 条身沿用血条的形制（深底 + 填充 + 白字压条居中）—— 一眼能认出
  // 「和 HP 是同一族的资源」，也不需要在舞台里另造一套视觉语言。
  // 文本仍是「能量 N / M」（探针绑的是这句），补满能量到 99 时按 100% 封顶。
  energyHtml(p) {
    const pct = p.maxEnergy > 0
      ? Math.max(0, Math.min(100, (p.energy / p.maxEnergy) * 100)) : 0;
    const cap = '能量 ' + p.energy + ' / ' + p.maxEnergy;
    return (
      '<span class="energybar" title="' + cap + '">' +
      '<span class="fill" style="width:' + pct + '%"></span>' +
      '<span class="stat-energy">' + cap + '</span>' +
      '</span>'
    );
  },

  // 强化标记（M50）：变体名 + 词缀，常显在血条上方。
  //
  // 为什么常显而不进悬停浮层：它们是「这一场该怎么打」的前置信息
  // （挂荆棘就别用多段攻击去磨、挂铁甲就先破甲），和 M45 把意图从浮层里
  // 摘出来是同一条理由 —— 要拿鼠标一个个扫才知道的战术信息等于没有。
  // 铭牌 / 状态图标仍归浮层：那是身份与数值，不是打法。
  //
  // 没有任何标记时返回空串（连容器都不生成）—— 血条与立绘之间的间距
  // 不该为一个空容器多让出几个像素。
  affixHtml(unit) {
    const marks = [];
    if (unit.variant && typeof VARIANTS !== 'undefined' && VARIANTS[unit.variant]) {
      const v = VARIANTS[unit.variant];
      // M56b：变体的专属徽记（中 Boss「精锐」的 ★）拼在最前 ——
      // 图标形态与文字一起出现，扫一眼就知道这不是普通敌人。
      marks.push((v.glyph ? v.glyph + ' ' : '') + v.name);
    }
    (unit.affixes || []).forEach(function (id) {
      const a = (typeof AFFIXES !== 'undefined') ? AFFIXES[id] : null;
      if (a) marks.push(a.short || a.name);
    });
    if (!marks.length) return '';
    return '<div class="affix-row">' + marks.map(function (m) {
      return '<span class="affix-chip">' + m + '</span>';
    }).join('') + '</div>';
  },

  hpBarHtml(unit, boss) {
    const pct = Math.max(0, (unit.hp / unit.maxHp) * 100);
    // 中毒预告（M43）：回合开始要扣、还没扣的血（= 毒层数，无视格挡，
    // combat.js 的 tickPoison 在回合开始结算）显示成绿色，铺在红条右端。
    // 扣的是当前血量的末段：从 hp − 毒层数 到 hp 这一段；毒层数 ≥ 当前血
    // 时绿段盖满整条 —— 这一口毒致命，一眼看出。
    const poison = unit.buffs.poison || 0;
    const pend = Math.min(poison, unit.hp);
    const pendLeft = Math.max(0, ((unit.hp - pend) / unit.maxHp) * 100);
    const pendW = Math.min(100, (pend / unit.maxHp) * 100);
    return (
      '<div class="hprow' + (boss ? ' hprow-boss' : '') + '">' +
      '<div class="hpbar"><div class="fill" style="width:' + pct + '%"></div>' +
      (poison > 0
        ? '<i class="hp-pending" style="left:' + pendLeft + '%;width:' + pendW + '%"></i>'
        : '') +
      '</div>' +
      '<span class="hplabel">' + unit.hp + ' / ' + unit.maxHp + '</span>' +
      '</div>'
    );
  },

  // Boss 铭牌（M30）：名字 + 头衔常驻在血条下方 —— 小兵的名字只在悬停浮层里，
  // Boss 的名字就该挂出来给人看，这是「关底和小兵的区别」最直给的一处。
  // 文案与 NodePanel.bossHtml 的预告面板同源（tier 3 = 本周目终局）。
  // 满编（菌母召唤 3 只）时由 CSS 隐藏 —— 那是群战场景，宽度预算优先。
  bossPlateHtml(e) {
    const tier = e.def.tier || 1;
    const tag = tier >= 3 ? '本周目终局' : '第 ' + tier + ' 道闸门';
    return (
      '<div class="boss-plate"><b>' + e.name + '</b><i>· ' + tag + '</i></div>'
    );
  },

  // 状态图标片（M20）：图标 + 右下角数字角标，全名进 title（悬停可见）。
  // 战斗日志仍是全名（combat.js 的 log 不动），信息不丢只是面板更清爽。
  // 负值（锈冠的「敏捷 −1」）保留 stat-neg 类名 —— 探针 ui-probe-boss 靠它断言。
  // 「壁垒」是开关型能力，不给数字角标。
  statsHtml(unit) {
    const parts = [];
    const DEBUFF = 'weak vulnerable poison burn parasite';

    function badge(key, val) {
      const kind = DEBUFF.indexOf(key) >= 0 ? 'bicon-debuff' : 'bicon-buff';
      const label = (BUFF_NAMES[key] || key);
      return (
        '<span class="bicon ' + kind + (val < 0 ? ' stat-neg' : '') +
        '" title="' + label + ' ' + val + '">' +
        Art.buffIcon(key) +
        (key === 'barricade' ? '' : '<i>' + val + '</i>') +
        '</span>'
      );
    }

    if (unit.block > 0) {
      parts.push(
        '<span class="bicon bicon-buff bicon-block" title="格挡 ' + unit.block + '">' +
        Art.buffIcon('block') +
        '<i>' + unit.block + '</i></span>'
      );
    }
    Object.keys(unit.buffs).forEach(function (k) {
      const v = unit.buffs[k];
      if (!v) return; // 0 不显示；负值要显示（锈冠给的「敏捷 −1」）
      parts.push(badge(k, v));
    });

    return parts.join('');
  },

  // 意图：图标 + 文字前缀。
  // 「意图 · 」必须原样保留（探针断言 textContent 以它开头），图标只能加在它前面。
  intentHtml(s, unit) {
    if (unit.hp <= 0) return '<div class="intent intent-none">已击败</div>';
    if (s.phase === 'lose') return '<div class="intent intent-none">—</div>';

    const mv = unit.intent;
    if (!mv) return '<div class="intent intent-none">—</div>';

    // 招式自带 desc 就用它（动态数值 / 复合效果），否则按 kind 给个通用文案
    let text;
    if (mv.desc) text = mv.desc(unit);
    else if (mv.kind === 'attack') text = '攻击 ' + Combat.intentDamage(unit);
    else text = mv.label || mv.name;

    const cls = mv.kind === 'attack' ? 'intent-atk' : 'intent-buff';
    return '<div class="intent ' + cls + '">' +
      Art.intent(mv.kind) +
      '<span class="intent-text">意图 · ' + text + '</span>' +
      '</div>';
  },

  // ---------- 药水腰带（M78 · §11）----------

  // 3 槽：满槽 = 图标 + 悬停看说明；空槽 = 暗格。敌方回合锁定（喝了会乱序）。
  potionBeltHtml(s) {
    const list = s.potions || [];
    const myTurn = s.phase === 'player';
    let html = '';
    for (let i = 0; i < 3; i++) {
      const id = list[i];
      if (id && typeof POTIONS !== 'undefined' && POTIONS[id]) {
        const p = POTIONS[id];
        html += '<div class="pslot is-full' + (myTurn ? '' : ' is-locked') +
          '" data-pi="' + i + '" title="' + p.name + '：' + p.desc + '">' +
          '<span class="picon">' + p.icon + '</span></div>';
      } else {
        html += '<div class="pslot is-empty" title="空药水槽 —— 商店与宝箱可获得"></div>';
      }
    }
    return html;
  },

  // ---------- 手牌 ----------
  handHtml(s) {
    if (!s.hand.length) return '<div class="hand-empty">手牌已空</div>';

    return s.hand
      .map(function (c) {
        const d = c.def;
        const ok = Combat.canPlay(c);
        const img = Art.cardImg(d.id);
        return (
          '<div class="card rar-' + d.rarity + (ok ? '' : ' disabled') + '" data-uid="' + c.uid + '">' +
          // 画窗：42 张卡画覆盖全部 121 张卡（B 方案，映射在 Art.CARD_ART）；
          // 查不到就不出画窗，卡面退回纯文字版式
          (img ? '<div class="cart"><img src="' + img + '" alt="" draggable="false"></div>' : '') +
          '<div class="cost">' + cardCost(c) + '</div>' +
          '<div class="cname">' + d.name + (c.upgraded ? '<span class="cup">+</span>' : '') + '</div>' +
          '<div class="ctype ctype-' + d.type + '">' +
          (CARD_TYPE_NAMES[d.type] || d.type) + '</div>' +
          '<div class="ctext">' + (typeof glossify === 'function' ? glossify(d.text(c.v)) : d.text(c.v)) + '</div>' +
          '</div>'
        );
      })
      .join('');
  },

  // ---------- 记录与结算 ----------

  drawLog(s) {
    const el = document.getElementById('log');
    el.innerHTML = s.log
      .map(function (l) {
        return '<div class="logline">' + l + '</div>';
      })
      .join('');
    el.scrollTop = el.scrollHeight;
  },

  drawResult(s) {
    const el = document.getElementById('result');

    if (s.phase === 'win') {
      el.hidden = false;
      el.className = 'result result-win';
      el.innerHTML =
        '<span>战斗胜利 · 用时 ' + s.turn + ' 回合</span>' +
        '<button class="btn btn-primary btn-sm" id="result-next">返回地图</button>';
    } else if (s.phase === 'lose') {
      el.hidden = false;
      el.className = 'result result-lose';
      el.innerHTML =
        '<span>下潜失败</span>' +
        '<button class="btn btn-primary btn-sm" id="result-next">返回地图</button>';
    } else {
      el.hidden = true;
    }
  },
};
