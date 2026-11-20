// 节点面板 —— 随机事件 / 商店 / 休息点 / 宝箱 / 战斗奖励，五类共用地图视图上的那层浮层。
//
// 为什么共用一层：它们都是"处在地图上的某个节点，处理完继续下潜"，
// 生命周期完全一样，各造一层 DOM 只会多出五个 hidden 要同步。
//
// 所有按钮用 data-act / data-arg 标记，点击由 App 统一委托转发到 NodePanel.act()。
// 每次点击整块重绘（和 Render 的做法一致），界面状态只存在 NodePanel.state 里。

const NodePanel = {
  state: null,

  // 面板图标（NODE_TYPES 里没有的两种：战斗奖励、宝箱结果）
  ICONS: { event: '事', shop: '商', rest: '火', chest: '箱', reward: '胜', boss: '王' },

  hide() {
    this.state = null;
    const el = document.getElementById('placeholder');
    el.hidden = true;
    el.className = 'placeholder';
  },

  // ---------- 五个入口 ----------

  showEvent() {
    let ev = Run.rollEvent();
    // 事件链（M79）：跨局第二次以后遇到同一事件，且写了后续 → 换用变体文本。
    // 「同一局不重复」由 eventsUsed 保证，这里数的是跨局第几次遇见。
    if (typeof Progress !== 'undefined' && Progress.eventSeen &&
        typeof EVENT_CHAINS !== 'undefined' && EVENT_CHAINS[ev.id] &&
        Progress.eventSeen(ev.id) > 0) {
      const ch = EVENT_CHAINS[ev.id];
      ev = Object.assign({}, ev, { text: ch.text, options: ch.options, chained: true });
    }
    if (typeof Progress !== 'undefined' && Progress.recordEvent) {
      try { Progress.recordEvent(ev.id); } catch (e) { /* 计数失败不碰事件 */ }
    }
    this.state = { kind: 'event', event: ev, step: 'choose', result: '', pick: null };
    this.paint();
  },

  showShop() {
    this.state = {
      kind: 'shop',
      shop: Run.state.shop || Run.rollShop(), // 重绘不该重抽货品
      mode: 'browse',
    };
    this.paint();
  },

  showRest() {
    this.state = { kind: 'rest', mode: 'browse' };
    // R2（M77）新手引导：第一次到休息点，讲清二选一（runtime-probe：渲染层不硬依赖 App）
    if (typeof App !== 'undefined' && App.tut) {
      App.tut('rest', '休息点是长途下潜的补给站：要么回复生命，要么打磨装备（升级 1 张卡）。二选一，选完继续往下。');
    }
    this.paint();
  },

  showChest() {
    this.state = { kind: 'chest', result: Run.openChest() };
    this.paint();
  },

  // node 是本场战斗所在的节点（Run.current()）。金币区间与「中 Boss 必掉遗物」
  // 都按 node.enemyId 查敌人定义（§9.2）
  showReward(node) {
    // M68：大 Boss 奖励分两段领（稀有卡三选一 → 稀有遗物三选一），
    // bossStage 只在 reward.boss 时被 bossRewardHtml 读。
    this.state = { kind: 'reward', reward: Run.rollBattleReward(node), bossStage: 'cards' };
    this.paint();
  },

  // Boss 战预告 —— 这三台机器的来历是世界观的一半（§9.3），
  // 直接开打太浪费，给一屏交代再进战斗
  showBoss() {
    this.state = { kind: 'boss' };
    this.paint();
  },

  // ---------- 绘制 ----------

  paint() {
    const el = document.getElementById('placeholder');
    el.className = 'placeholder np np-' + this.state.kind;
    el.innerHTML = this.sceneHtml() + this.headHtml() + this.bodyHtml() + this.libHtml();
    el.hidden = false;
    el.scrollTop = 0;

    // 面板里会改血量 / 金币 / 卡组，顶栏得跟着变 ——
    // 否则同一个数字在面板里和顶栏里不一样（买完东西最明显）
    App.updateTopbar();
  },

  // 场景横幅（M12）：事件 / 商店 / 休息 / 宝箱各有场景图，Boss 预告用
  // 所在深度带的战斗背景；reward 是结算表格、不加图。查不到返回 ''，版式照旧。
  sceneHtml() {
    const k = this.state.kind;
    const depth = Run.current() ? Run.current().depth : 1;
    // M56d：事件面板带上事件 id —— 每个事件用自己的场景横幅
    const eventId = (k === 'event' && this.state.event) ? this.state.event.id : null;
    const src = Art.sceneSrc(k, depth, eventId);
    return src ? '<img class="np-scene" src="' + src + '" alt="">' : '';
  },

  headHtml() {
    const s = Run.state;
    const n = Run.current();
    const titles = {
      event: '', shop: '商店', rest: '休息点', chest: '宝箱',
      reward: '战斗胜利', boss: '大 Boss',
    };
    // 事件用事件名，Boss 用 Boss 名，其余用类型名
    const k = this.state.kind;
    const main = k === 'event' ? this.state.event.name
      : k === 'boss' ? n.bossName
      : titles[k];

    return (
      '<div class="np-head">' +
      '<span class="np-icon">' + this.ICONS[this.state.kind] + '</span>' +
      '<span class="np-title">' + main + '</span>' +
      '<span class="np-sub">D' + n.depth + '</span>' +
      '<span class="np-status">HP <b>' + s.hp + '</b>/' + s.maxHp +
      ' · 金币 <b>' + s.gold + '</b> · 卡组 <b>' + s.deck.length + '</b> 张</span>' +
      // M54：卡片库入口 —— 拿奖励 / 商店买东西前先查「这张我是不是有了」。
      // 放共用头部：奖励 / 商店都要，事件 / 休息 / 宝箱顺带也有，一条代码路径。
      '<button class="btn btn-ghost btn-sm np-lib-btn" data-act="cardlib">我的卡片库</button>' +
      '</div>'
    );
  },

  bodyHtml() {
    const k = this.state.kind;
    if (k === 'event') return this.eventHtml();
    if (k === 'shop') return this.shopHtml();
    if (k === 'rest') return this.restHtml();
    if (k === 'chest') return this.chestHtml();
    if (k === 'reward') return this.rewardHtml();
    if (k === 'boss') return this.bossHtml();
    return '';
  },

  // ---------- 事件 ----------

  eventHtml() {
    const st = this.state;

    if (st.step === 'choose') {
      return (
        '<div class="np-text">' + st.event.text + '</div>' +
        '<div class="np-opts">' +
        st.event.options
          .map(function (o, i) {
            return (
              '<button class="np-opt" data-act="option" data-arg="' + i + '">' +
              '<span class="np-opt-label">' + o.label + '</span>' +
              '<span class="np-opt-hint">' + o.hint + '</span>' +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    return (
      '<div class="np-text np-got">' + st.result + '</div>' +
      (st.pick ? this.pickHtml() : '<button class="btn btn-primary np-go" data-act="leave">继续下潜</button>')
    );
  },

  // 选卡阶段：add = 从候选里挑 1 张进卡组；upgrade = 从卡组里挑 1 张升级
  pickHtml() {
    const p = this.state.pick;

    if (p.mode === 'upgrade') {
      return this.deckPickerHtml(
        Run.upgradableCards(),
        '升级 1 张卡',
        '你的卡组里没有能再升级的卡了。',
        'upgradecard'
      ) + '<button class="btn btn-ghost np-go" data-act="picknone">算了</button>';
    }

    return (
      '<div class="np-h">选 1 张加入卡组</div>' +
      '<div class="np-cards">' +
      p.cards
        .map(function (id, i) {
          return (
            '<button class="np-pick" data-act="pickcard" data-arg="' + i + '">' +
            NodePanel.cardHtml(id) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button class="btn btn-ghost np-go" data-act="picknone">都不要</button>'
    );
  },

  // ---------- 商店 ----------

  shopHtml() {
    const st = this.state;
    const shop = st.shop;
    const gold = Run.state.gold;

    if (st.mode === 'remove') {
      return this.deckPickerHtml(
        Run.state.deck,
        '删牌 · ' + shop.removePrice + ' 金',
        '卡组是空的。',
        'removecard'
      ) + '<button class="btn btn-ghost np-go" data-act="shopbrowse">算了，不删了</button>';
    }

    let html = '';

    html += '<div class="np-h">卡牌</div><div class="np-cards">';
    shop.cards.forEach(function (it, i) {
      html +=
        '<div class="np-shopitem">' +
        NodePanel.cardHtml(it.id) +
        (it.sold
          ? '<div class="np-sold">已买下</div>'
          : '<button class="btn btn-sm np-buy" data-act="buycard" data-arg="' + i + '"' +
            (gold >= it.price ? '' : ' disabled') + '>' + it.price + ' 金</button>') +
        '</div>';
    });
    html += '</div>';

    html += '<div class="np-h">遗物</div><div class="np-cards">';
    if (!shop.relics.length) {
      html += '<div class="np-empty">遗物都被翻走了。</div>';
    }
    shop.relics.forEach(function (it, i) {
      const r = RELICS[it.id];
      html +=
        '<div class="np-shopitem">' +
        '<div class="npc npc-relic rar-' + (r.rarity || 'common') + '">' +
        '<div class="npc-relic-art">' + Art.relicArt(it.id) + '</div>' +
        '<div class="npc-name">' + r.name + '</div>' +
        '<div class="npc-type">' + (RARITY_NAMES[r.rarity] || r.rarity) + ' · 遗物</div>' +
        '<div class="npc-text">' + r.text + '</div>' +
        '</div>' +
        (it.sold
          ? '<div class="np-sold">已买下</div>'
          : '<button class="btn btn-sm np-buy" data-act="buyrelic" data-arg="' + i + '"' +
            (gold >= it.price ? '' : ' disabled') + '>' + it.price + ' 金</button>') +
        '</div>';
    });
    html += '</div>';

    // 药水（M78 · §11）：货架常备 1 瓶，50–75 金区间（吃 shopDiscount 折扣）
    html += '<div class="np-h">药水</div><div class="np-cards">';
    const potions = shop.potions || [];
    if (!potions.length) {
      html += '<div class="np-empty">今天的药水卖完了。</div>';
    }
    potions.forEach(function (it, i) {
      const p = POTIONS[it.id];
      if (!p) return;
      html +=
        '<div class="np-shopitem">' +
        '<div class="npc npc-potion">' +
        '<div class="npc-potion-art">' + p.icon + '</div>' +
        '<div class="npc-name">' + p.name + '</div>' +
        '<div class="npc-type">药水 · 3 槽</div>' +
        '<div class="npc-text">' + p.desc + '</div>' +
        '</div>' +
        (it.sold
          ? '<div class="np-sold">已买下</div>'
          : '<button class="btn btn-sm np-buy" data-act="buypotion" data-arg="' + i + '"' +
            (gold >= it.price && Run.potionSpace() > 0 ? '' : ' disabled') + '>' + it.price + ' 金</button>') +
        '</div>';
    });
    html += '</div>';

    html += '<div class="np-h">服务</div><div class="np-svc">' +
      '<button class="btn btn-ghost" data-act="removeservice"' +
      (shop.removeUsed || gold < shop.removePrice ? ' disabled' : '') + '>' +
      (shop.removeUsed ? '已删过牌' : '从卡组移除 1 张 · ' + shop.removePrice + ' 金') +
      '</button>' +
      '<button class="btn btn-primary" data-act="leave">离开商店</button>' +
      '</div>';

    return html;
  },

  // ---------- 休息点 ----------

  restHtml() {
    const st = this.state;
    const s = Run.state;

    if (st.mode === 'upgrade') {
      return this.deckPickerHtml(
        Run.upgradableCards(),
        '升级 1 张卡',
        '你的卡组里没有能再升级的卡了。',
        'upgradecard'
      ) + '<button class="btn btn-ghost np-go" data-act="restbrowse">算了</button>';
    }

    const heal = Run.restHealAmount();
    const canUp = Run.upgradableCards().length;

    return (
      '<div class="np-text">你把绳子在铆钉上绕了两圈，坐下来。井底的风一直往上吹。</div>' +
      '<div class="np-opts">' +
      '<button class="np-opt" data-act="restheal">' +
      '<span class="np-opt-label">休息</span>' +
      '<span class="np-opt-hint">回复 ' + heal + ' 点生命（' + s.hp + ' / ' + s.maxHp + '）</span>' +
      '</button>' +
      '<button class="np-opt" data-act="restupgrade"' + (canUp ? '' : ' disabled') + '>' +
      '<span class="np-opt-label">打磨装备</span>' +
      '<span class="np-opt-hint">升级 1 张卡（可升级 ' + canUp + ' 张）</span>' +
      '</button>' +
      '</div>'
    );
  },

  // ---------- 宝箱 ----------

  chestHtml() {
    const r = this.state.result;
    let text;

    if (r.kind === 'relic') {
      const rel = RELICS[r.relicId];
      text = '撬开锁扣，里面只有一样东西——「' + rel.name + '」。<br>' +
             '<span class="np-dim">' + rel.text + '</span>';
    } else if (r.kind === 'potion') {
      const p = POTIONS[r.potionId];
      text = '锁扣里藏着一瓶「' + p.name + '」。<br>' +
             '<span class="np-dim">' + p.desc + '（药水槽 ' + (Run.POTION_MAX - Run.potionSpace()) + '/' + Run.POTION_MAX + '）</span>';
    } else {
      text = '箱子是空的，箱底积着一层还能用的旧币，共 ' + r.gold + ' 金。' +
             '<br><span class="np-dim">现成的遗物你都拿过了。</span>';
    }

    return '<div class="np-text np-got">' + text + '</div>' +
           '<button class="btn btn-primary np-go" data-act="leave">继续下潜</button>';
  },

  // ---------- 战斗奖励 ----------

  rewardHtml() {
    const rw = this.state.reward;

    // M68：大 Boss 走专属两段式战利品面板
    if (rw.boss) return this.bossRewardHtml(rw);

    // 中 Boss 必掉遗物（§9.2）。遗物拿满时 Run 会折成金币补偿，
    // 「必掉」不能变成「什么都不掉」
    let relicBlock = '';
    if (rw.relicId) {
      relicBlock = this.relicBlockHtml(rw.relicId, '中 Boss 必掉 · 遗物');
    } else if (rw.bonusGold) {
      relicBlock = '<div class="np-text np-dim">现成的遗物你都拿过了，折成 ' +
        rw.bonusGold + ' 金。</div>';
    }

    return (
      '<div class="np-text np-got">敌人身上搜出 <b>' + rw.gold + ' 金</b>（已入袋）。</div>' +
      relicBlock +
      '<div class="np-h">战利品里还有 1 张卡能带走</div>' +
      '<div class="np-cards">' +
      rw.cards
        .map(function (id, i) {
          return (
            '<button class="np-pick" data-act="pickcard" data-arg="' + i + '">' +
            NodePanel.cardHtml(id) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button class="btn btn-ghost np-go" data-act="leave">都不要，继续下潜</button>'
    );
  },

  // ---------- 大 Boss 战利品（M68） ----------
  //
  // 两段式：稀有卡三选一 → 稀有遗物三选一。
  // 两段都能跳过（跳过卡直接看遗物；遗物也不要就继续下潜）；
  // 奖励在生成时已经定好（rollBattleReward），重绘不会重抽。
  bossRewardHtml(rw) {
    const st = this.state;
    const stage = st.bossStage || 'cards';
    const head =
      '<div class="np-text np-got">大 Boss 倒下了。敌人身上搜出 <b>' + rw.gold +
      ' 金</b>（已入袋）。</div>';

    if (stage === 'cards') {
      return (
        head +
        '<div class="np-h">稀有卡 · 三选一</div>' +
        '<div class="np-cards">' +
        rw.cards
          .map(function (id, i) {
            return (
              '<button class="np-pick" data-act="bossgetcard" data-arg="' + i + '">' +
              NodePanel.cardHtml(id) +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '<button class="btn btn-ghost np-go" data-act="bossskip">卡就不要了，看遗物</button>'
      );
    }

    // ---- 遗物段 ----
    if (!rw.relicChoices || !rw.relicChoices.length) {
      return (
        head +
        '<div class="np-text np-dim">遗物你都拿过了，折成 ' + rw.bonusGold + ' 金。</div>' +
        '<button class="btn btn-primary np-go" data-act="leave">继续下潜</button>'
      );
    }
    return (
      head +
      '<div class="np-h">稀有遗物 · 三选一</div>' +
      '<div class="np-cards">' +
      rw.relicChoices
        .map(function (id, i) {
          return (
            '<button class="np-pick" data-act="bossgetrelic" data-arg="' + i + '">' +
            NodePanel.relicCardHtml(id) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button class="btn btn-ghost np-go" data-act="leave">遗物也不要，继续下潜</button>'
    );
  },

  // 遗物卡（Boss 三选一用；商店货架的遗物版式是内联的，这里只给新流程用）。
  // M86：补上立绘 —— 此前是三处遗物版式里唯一没挂 npc-relic-art 的，
  // 240 定高卡只剩顶部文字、下面一大块空金底（用户截图报障）。
  relicCardHtml(id) {
    const r = RELICS[id];
    return (
      '<div class="npc npc-relic rar-' + (r.rarity || 'common') + '">' +
      '<div class="npc-relic-art">' + Art.relicArt(id) + '</div>' +
      '<div class="npc-name">' + r.name + '</div>' +
      '<div class="npc-type">' + (RARITY_NAMES[r.rarity] || r.rarity) + ' · 遗物</div>' +
      '<div class="npc-text">' + r.text + '</div>' +
      '</div>'
    );
  },

  // ---------- Boss 战预告 ----------

  bossHtml() {
    const n = Run.current();
    const def = ENEMIES[n.bossId] || {};
    const terminal = n.depth === Run.state.map.depth;
    // M89：预告按本局 DL 缩放，与实战同一口径（此前写死 hpMin / mv.value，
    // DL10 会显示 220 血 / 12 伤，实际是 517 / 28）
    const scale = 1 + 0.15 * (Run.curDl() - 1);

    // 形态词条（M80 / R5）：DL5+ 的大 Boss 带一枚 bossOnly 词条
    let affixLine = '';
    const baf = n.encounter && n.encounter.enemyAffixes && n.encounter.enemyAffixes[0];
    if (baf && baf.length && typeof AFFIXES !== 'undefined') {
      const names = baf.map(function (id) { return AFFIXES[id] ? AFFIXES[id].name : id; });
      affixLine = '<span>形态 · ' + names.join(' / ') + '</span>';
    }

    // 火种读数仪（M78 解禁）：Boss 战开始前的 3 回合意图推演
    let forecast = '';
    const previewN = Run.relicEffect ? Run.relicEffect('bossIntentPreview') : 0;
    if (previewN > 0 && typeof Combat !== 'undefined' && Combat.forecastBoss) {
      const moves = Combat.forecastBoss(n.bossId, previewN);
      if (moves.length) {
        forecast = '<div class="np-h">火种读数仪 · 开局行动推演</div>' +
          '<div class="np-forecast">' + moves.map(function (mv, i) {
            const label = mv.label ||
              (mv.kind === 'attack' ? '攻击 ' + Math.round(mv.value * scale) : '');
            return '<div class="np-fc"><span class="np-fc-t">T+' + (i + 1) + '</span>' +
              '<b>' + mv.name + '</b>' +
              (label ? '<span class="np-fc-d">' + label + '</span>' : '') +
              '</div>';
          }).join('') +
          '<div class="np-dim">以当前态势推演，战局推进后可能偏离。</div></div>';
      }
    }

    return (
      '<div class="np-text">' + (def.lore || '') + '</div>' +
      '<div class="np-bossstats">' +
      (affixLine ? affixLine : '') +
      '<span>生命 ' + Math.round(def.hpMin * scale) + '</span>' +
      '<span>难度 ' + n.bossTier + ' / 3</span>' +
      '<span>' + (terminal ? '本周目终局' : '第 ' + n.bossTier + ' 道闸门') + '</span>' +
      '</div>' +
      forecast +
      '<div class="np-text np-dim">' +
      '三条主干在这里并成一条 —— 绕不开它。' +
      '<br>它不叠深压：强度由难度档位决定，不是由深度堆出来的。' +
      '</div>' +
      '<button class="btn btn-primary np-go" data-act="fightboss">迎战</button>'
    );
  },

  // 遗物卡片（宝箱 / 奖励 / Boss 预告共用）
  relicBlockHtml(id, title) {
    const r = RELICS[id];
    return (
      '<div class="np-h">' + title + '</div>' +
      '<div class="np-cards"><div class="npc npc-relic rar-' + (r.rarity || 'common') + '">' +
      '<div class="npc-relic-art">' + Art.relicArt(id) + '</div>' +
      '<div class="npc-name">' + r.name + '</div>' +
      '<div class="npc-type">' + (RARITY_NAMES[r.rarity] || r.rarity) + ' · 遗物</div>' +
      '<div class="npc-text">' + r.text + '</div>' +
      '</div></div>'
    );
  },

  // ---------- 公用片段 ----------

  cardHtml(id, upgraded) {
    const d = CARDS[id];
    const v = upgraded && d.upV ? d.upV : d.v;
    const img = Art.cardImg(id);
    return (
      '<div class="npc npc-' + d.type + ' rar-' + d.rarity + '">' +
      (img ? '<div class="cart"><img src="' + img + '" alt="" draggable="false"></div>' : '') +
      '<div class="npc-cost">' + d.cost + '</div>' +
      '<div class="npc-name">' + d.name + (upgraded ? '<span class="cup">+</span>' : '') + '</div>' +
      '<div class="npc-type">' + (CARD_TYPE_NAMES[d.type] || d.type) +
      ' · ' + (RARITY_NAMES[d.rarity] || d.rarity) + '</div>' +
      '<div class="npc-text">' + d.text(v) + '</div>' +
      '</div>'
    );
  },

  // 卡组选择列表（商店删牌 / 休息点升级共用）
  deckPickerHtml(list, title, emptyText, act) {
    if (!list.length) return '<div class="np-h">' + title + '</div><div class="np-empty">' + emptyText + '</div>';
    return (
      '<div class="np-h">' + title + '</div>' +
      '<div class="np-cards">' +
      list
        .map(function (c) {
          return (
            '<button class="np-pick" data-act="' + act + '" data-arg="' + c.uid + '">' +
            NodePanel.cardHtml(c.def.id, c.upgraded) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  },

  // ---------- 卡片库（M54，M54b 改版） ----------
  //
  // 只读查询层：**只显示本次游戏（当前卡组）已经获得的卡** ——
  // 未获得的卡不再出现（M54 首版列全池 + 未拥有灰标，用户反馈只要已有的）。
  // 按 DL 分组（诅咒单独列），按 def.id 去重计数量（升级版标「含升级」）。
  // 不碰任何游戏状态。
  libHtml() {
    const st = this.state;
    if (!st.libOpen) return '';

    const owned = {};
    Run.state.deck.forEach(function (c) {
      if (!owned[c.def.id]) owned[c.def.id] = { n: 0, up: 0 };
      owned[c.def.id].n++;
      if (c.upgraded) owned[c.def.id].up++;
    });
    const ids = Object.keys(owned);
    let copies = 0;
    ids.forEach(function (id) { copies += owned[id].n; });

    // 按 DL 分组；DL0 再拆出诅咒卡单独列（与卡池验证面板同款处理）
    const groups = [];
    for (let dl = 0; dl <= 10; dl++) {
      const inDl = ids.filter(function (id) { return CARDS[id].dl === dl; });
      if (!inDl.length) continue;
      if (dl === 0) {
        const basic = inDl.filter(function (id) { return CARDS[id].rarity !== 'curse'; });
        const curse = inDl.filter(function (id) { return CARDS[id].rarity === 'curse'; });
        if (basic.length) groups.push([basic, '基础池（DL0）']);
        if (curse.length) groups.push([curse, '诅咒']);
      } else {
        groups.push([inDl, 'DL' + dl + ' 解锁']);
      }
    }

    const body = groups.map(function (g) {
      return (
        '<div class="np-h">' + g[1] + '</div>' +
        '<div class="np-cards">' +
        g[0]
          .map(function (id) {
            const o = owned[id];
            return (
              '<div class="np-shopitem is-owned">' +
              NodePanel.cardHtml(id) +
              '<div class="np-ownbadge">卡组 ×' + o.n + (o.up ? ' · 含升级' : '') + '</div>' +
              '</div>'
            );
          })
          .join('') +
        '</div>'
      );
    }).join('');

    return (
      '<div class="np-lib">' +
      '<div class="np-lib-bar">' +
      '<span class="np-h">我的卡片库 · ' + ids.length + ' 种 / ' + copies + ' 张</span>' +
      '<button class="btn btn-primary btn-sm" data-act="libclose">收起</button>' +
      '</div>' +
      (body || '<div class="np-empty">本次游戏还没有获得卡。</div>') +
      '</div>'
    );
  },

  // ---------- 交互 ----------

  act(act, arg) {
    // 序幕（M79）：不经过本面板的 state，直接转发给 App —— 必须放在
    // `if (!st) return` 之前，序幕播放时本面板还没有 state
    if (act === 'prologue-next') return App.prologueNext();
    if (act === 'prologue-skip' || act === 'prologue-end') return App.prologueEnd();
    // 战报分享（M81）：收尾面板的按钮，同样不依赖本面板 state
    if (act === 'copyresult') return App.copyResult();

    const st = this.state;
    if (!st) return;

    switch (act) {
      case 'leave': return this.finish(st.kind === 'reward' ? 'win' : 'done');
      case 'fightboss':
        // 浮层要收起来再进战斗，否则盖在战斗界面上
        this.hide();
        return App.startBattle();
      case 'option': return this.chooseOption(Number(arg));
      case 'pickcard': return this.pickCard(Number(arg));
      case 'picknone': return this.pickNone();
      case 'upgradecard': return this.doUpgrade(Number(arg));

      // M68：大 Boss 战利品两段式
      case 'bossgetcard':
        Run.addCard(this.state.reward.cards[Number(arg)]);
        this.state.bossStage = 'relics';
        return this.paint();
      case 'bossskip':
        this.state.bossStage = 'relics';
        return this.paint();
      case 'bossgetrelic':
        Run.addRelic(this.state.reward.relicChoices[Number(arg)]);
        return this.finish('win');

      case 'buycard': return this.buyCard(Number(arg));
      case 'buyrelic': return this.buyRelic(Number(arg));
      case 'buypotion': return this.buyPotion(Number(arg));
      case 'removeservice': return this.openRemove();
      case 'removecard': return this.doRemove(Number(arg));
      case 'shopbrowse':
        st.mode = 'browse';
        return this.paint();

      case 'restheal': return this.restHeal();
      case 'restupgrade':
        st.mode = 'upgrade';
        return this.paint();
      case 'restbrowse':
        st.mode = 'browse';
        return this.paint();

      // 卡片库（M54）：只读查询层，开 / 关，不碰任何游戏状态
      case 'cardlib':
        st.libOpen = true;
        return this.paint();
      case 'libclose':
        st.libOpen = false;
        return this.paint();
    }
  },

  chooseOption(i) {
    const st = this.state;
    const opt = st.event.options[i];
    if (!opt) return;

    const out = opt.run(Run.eventCtx());
    st.step = 'result';

    if (typeof out === 'string') {
      st.result = out;
      st.pick = null;
    } else {
      st.result = out.text;
      this.startPick(out.pick);
    }
    this.paint();
  },

  startPick(pick) {
    if (pick.mode === 'upgrade') {
      this.state.pick = { mode: 'upgrade' };
    } else {
      this.state.pick = {
        mode: 'add',
        cards: Run.rollCardIds(pick.count || 3, pick.rarity),
      };
    }
  },

  pickCard(i) {
    const st = this.state;
    // 候选卡有两个来源：事件后续选择存在 pick.cards，战斗奖励存在 reward.cards。
    // 两处的按钮共用 data-act="pickcard"，所以这里要一起认。
    const list = st.kind === 'reward' ? (st.reward && st.reward.cards) : (st.pick && st.pick.cards);
    if (!list || !list[i]) return;

    if (st.kind === 'reward') {
      Run.addCard(list[i]);
      return this.finish('win');
    }

    Run.addCard(list[i]);
    st.result += ' 你收下了「' + CARDS[list[i]].name + '」。';
    st.pick = null;
    this.paint();
  },

  pickNone() {
    this.state.pick = null;
    this.paint();
  },

  doUpgrade(uid) {
    if (!Run.upgradeCardById(uid)) return;
    if (this.state.kind === 'rest') return this.finish('done');
    this.state.pick = null;
    this.paint();
  },

  buyCard(i) {
    const it = this.state.shop.cards[i];
    if (!it || it.sold || !Run.spendGold(it.price)) return;
    Run.addCard(it.id);
    it.sold = true;
    this.paint();
  },

  buyRelic(i) {
    const it = this.state.shop.relics[i];
    if (!it || it.sold || !Run.spendGold(it.price)) return;
    Run.addRelic(it.id);
    it.sold = true;
    this.paint();
  },

  // M78：买药水。槽满时买了装不下 —— 按钮禁用兜底 + 这里再挡一层
  buyPotion(i) {
    const it = this.state.shop.potions[i];
    if (!it || it.sold || Run.potionSpace() <= 0 || !Run.spendGold(it.price)) return;
    Run.addPotion(it.id);
    it.sold = true;
    this.paint();
  },

  openRemove() {
    const shop = this.state.shop;
    if (shop.removeUsed) return;
    if (Run.state.gold < shop.removePrice) return;
    this.state.mode = 'remove';
    this.paint();
  },

  doRemove(uid) {
    const shop = this.state.shop;
    if (!Run.spendGold(shop.removePrice)) return;
    Run.removeCard(uid);
    Run.state.removedCount++; // §11：每删一次 +25
    shop.removeUsed = true;
    this.state.mode = 'browse';
    this.paint();
  },

  restHeal() {
    Run.heal(Run.restHealAmount());
    this.finish('done');
  },

  finish(result) {
    const r = result || 'done';
    this.hide();
    Run.settle(r);
    App.showMap();
  },
};
