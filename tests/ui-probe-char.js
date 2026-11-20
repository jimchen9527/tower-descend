// M6 UI 探针：角色切换 + 两套资源系统的渲染链路。
//
// 手法与其它探针一致：复制 index.html、注入操作脚本、Edge headless 跑、读回 DOM。
// 分工：资源**数值规则**在 m6-characters.test.js 里测（那里能直接调引擎），
// 这里只管"点下去之后界面对不对"—— 资源条渲染、卡面框色、灰态、卡池隔离。
//
// 运行：node tests/ui-probe-char.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-char.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function theme() {
    return getComputedStyle(document.documentElement).getPropertyValue('--char').trim();
  }
  // 进到"当前节点第一条可打的战斗边"——节点位置随机，所以要现找
  function enterBattle() {
    var edges = Run.current().edges;
    for (var i = 0; i < edges.length; i++) {
      var t = Run.state.map.nodes[edges[i]].type;
      if (t === 'monster' || t === 'elite') {
        App.enterNode(edges[i]);
        // 垫高敌人血量：小怪血量随种子在十几点浮动，不垫高的话
        // 「造成 14 点伤害」会被 clamp 成「怪剩多少就掉多少」，
        // 断言红起来像是伤害算错，其实只是怪太脆。
        // M50：玩家血量也垫高 —— 复数编队是同一次改动的产物，不垫的话可能
        // 还没点到卡就被几只怪打死了（phase 变 lose → playCard 直接不执行）。
        if (Combat.state && Combat.state.enemy) {
          Combat.state.enemy.hp = 300;
          Combat.state.enemy.maxHp = 300;
          Combat.state.player.hp = 300;
          Combat.state.player.maxHp = 300;
          Render.draw();
        }
        return true;
      }
    }
    return false;
  }
  // 按卡 id 找手牌元素（手牌顺序不定，不能靠下标）
  function cardEl(id) {
    var cs = qa('#hand .card');
    for (var i = 0; i < cs.length; i++) {
      var uid = Number(cs[i].dataset.uid);
      var c = Combat.state.hand.filter(function (x) { return x.uid === uid; })[0];
      if (c && c.def.id === id) return cs[i];
    }
    return null;
  }
  function addToHand(id) {
    q('#pool-select').value = id;
    q('#pool-add').click();
  }
  function resText() {
    var el = q('.stat-res');
    return el ? el.textContent : 'MISSING';
  }
  function switchTo(cid) {
    var sel = q('#char-select');
    sel.value = cid;
    sel.dispatchEvent(new Event('change'));
    // 顶栏下拉必须跟对局角色一致 —— 曾经它只在首次 boot 时同步过一次，
    // 而页面加载时 index.html 末尾已经 boot 过了，于是切完角色还显示旧值
    log('selectShows_' + cid, sel.value);
    // change 事件里 App.boot() 用的是 Date.now() 当种子 —— 每次跑地图、敌人
    // 都不一样，断言就不稳定。这里紧接着用固定种子重起一局，让探针可复现。
    Run.start('act1', 20260925, cid);
    App.showMap();
  }

  try {
    // ---- M7：探针必须先清干净跨页面加载的存档 ----
    // 存档与等级存在 localStorage 里，而每个探针复用的是同一个 --user-data-dir，
    // 所以上一轮跑出来的 DL / 进行中的局会渗进这一轮。不 reset，断言会时红时绿。
    Progress.reset();

    // ==================== 全新玩家：只该有掘者可选（§3.1 解锁链）====================
    App.boot();
    log('lockedCharsText', qa('#char-select option').map(function (o) {
      return o.textContent + (o.disabled ? '[禁用]' : '');
    }).join('/'));
    log('lockedMedicDisabled', qa('#char-select option')[1].disabled);
    log('lockedKeeperDisabled', qa('#char-select option')[2].disabled);

    // ---- 把掘者推到 DL4（引火者要求 DL4），三个角色才都解锁 ----
    // 解锁链看的是「任一角色」的最高 DL，所以推掘者一个人就够。
    Progress.setDl('digger', 4);
    App.boot();

    // ==================== 角色切换器 ====================
    log('charOptions', qa('#char-select option').length);
    log('charOptionText', qa('#char-select option').map(function (o) { return o.textContent; }).join('/'));
    log('charDefault', Run.state.charId);
    log('themeDefault', theme());

    // ==================== 拾荒医师 ====================
    switchTo('medic');
    log('charAfterSwitchMedic', Run.state.charId);
    log('themeMedic', theme());
    log('deckIsMedic', Run.state.deck.every(function (c) { return c.def.char === 'medic'; }));
    log('poolOptionsMedic', qa('#pool-select option').length);

    var battle = enterBattle();
    log('medicInBattle', battle !== null && q('#view-combat').hidden === false);
    log('medicName', q('#player-panel .unit-name').textContent);
    log('medicResText', resText());
    log('medicResFull', q('.stat-res').classList.contains('is-full'));
    log('medicCardBorder', getComputedStyle(q('#hand .card')).borderTopColor);

    // 回合推进 → 样本 +1 → 资源条要跟着变
    var resBefore = Combat.state.player.resource.value;
    q('#end-turn').click();
    log('resAfterEndTurn', Combat.state.player.resource.value - resBefore);
    log('medicResTextAfterTurn', resText());

    // 样本不足时「血清三号」应当是灰的（need 钩子走的是 canPlay 这条路）
    // 先清零 —— 开局第 1 回合的自动累积已经给了 1 点，不清零就验不出灰态
    Combat.state.player.resource.value = 0;
    Render.draw();
    addToHand('serum3');
    var el0 = cardEl('serum3');
    log('serumFound', el0 !== null);
    log('serumDisabledWhenEmpty', el0 !== null && el0.classList.contains('disabled'));

    // 给够样本 → 同一张卡变可点 → 点下去真的扣资源、真的掉血
    Combat.state.player.resource.value = 2;
    Combat.state.player.energy = 99;
    // 量伤害前把这只怪**清成一张白纸**：进节点抽到谁是随机的，而拾荒者残影的
    // 「模仿」会在它自己的回合给自己叠 8 点格挡（那时玩家还没出过攻击牌）——
    // 不清的话血清三号只掉 6，看起来像伤害算错，其实是格挡吃掉 8。
    // 清零必须放在这里（在敌人回合之前清是没用的：它的回合会再加回来），
    // 且必须写在 Render.draw() **之前** —— draw 会重建手牌 DOM，
    // 之后再清就不算「重绘一次」而是留下一堆悬空的元素引用。
    Combat.state.enemy.block = 0;
    Combat.state.enemy.buffs = {};
    Render.draw();
    var el1 = cardEl('serum3');
    log('serumEnabledWhenEnough', el1 !== null && !el1.classList.contains('disabled'));
    var ehp = Combat.state.enemy.hp;
    var handIds = Combat.state.hand.map(function (c) { return c.def.id; }).join(',');
    el1.click();
    log('serumPlayedCard', handIds);
    log('serumEnemyHpBefore', ehp);
    log('serumEnemyHpAfter', Combat.state.enemy.hp);
    log('serumEnemyDelta', ehp - Combat.state.enemy.hp);
    log('serumResAfter', Combat.state.player.resource.value);
    log('medicResTextAfterPlay', resText());

    // 上限：灌满后应当是「样本 5 / 5」且带 is-full
    Combat.state.player.resource.value = 5;
    Render.draw();
    log('medicResAtCap', resText());
    log('medicCapIsFull', q('.stat-res').classList.contains('is-full'));

    // ==================== 引火者 ====================
    switchTo('keeper');
    log('charAfterSwitchKeeper', Run.state.charId);
    log('themeKeeper', theme());
    log('poolOptionsKeeper', qa('#pool-select option').length);

    enterBattle();
    log('keeperName', q('#player-panel .unit-name').textContent);
    log('keeperResText', resText());
    // 余烬没有上限，标签里不该出现 "/ n"
    log('keeperHasCap', resText().indexOf('/') >= 0);

    // 「擦火」：卖 2 血换 2 余烬 —— 一次点击同时改两条数值
    addToHand('spark');
    var spark = cardEl('spark');
    var php = Combat.state.player.hp;
    var ehp2 = Combat.state.player.resource.value;
    spark.click();
    log('sparkHpLoss', php - Combat.state.player.hp);
    log('sparkEmberGain', Combat.state.player.resource.value - ehp2);
    log('keeperResTextAfterSpark', resText());

    // 被敌人打掉血 → 余烬自动 +1，资源条跟着涨
    var before2 = Combat.state.player.resource.value;
    Combat.state.player.block = 0;
    Combat.dealDamage(Combat.state.enemy, Combat.state.player, 4);
    Render.draw();
    log('emberAfterHit', Combat.state.player.resource.value - before2);
    log('keeperResTextAfterHit', resText());

    // ==================== 掘者：没有资源就不该有资源标签 ====================
    switchTo('digger');
    log('charAfterSwitchDigger', Run.state.charId);
    log('themeDigger', theme());
    log('poolOptionsDigger', qa('#pool-select option').length);
    enterBattle();
    log('diggerName', q('#player-panel .unit-name').textContent);
    log('diggerResTagCount', qa('.stat-res').length);

    // 三个角色的卡池互不重叠 —— 医师身上不该出现掘者的「撬棍」
    switchTo('medic');
    var ids = qa('#pool-select option').map(function (o) { return o.value; });
    log('medicPoolHasCrowbar', ids.indexOf('crowbar') >= 0);
    log('medicPoolHasScalpel', ids.indexOf('scalpel') >= 0);

    // ==================== M64：DL1 通关升 DL2，收尾面板要点名两张新卡 ====================
    // 回到掘者、刻痕拨回 DL1，重开一局后直接判「通关」收尾 ——
    // settleRunEnd 只认 curDl() >= before，DL1 局赢 = 刻痕 +1 → DL2，announce 卡该点名
    switchTo('digger');
    Progress.setDl('digger', 1);
    Run.start('act1', 20260917, 'digger', 1);
    Run.state.finished = true;
    Run.state.hp = 30;
    Run.state.battles = 5;
    App.settleRunEnd();
    App.showFinish();
    var finDesc = q('#placeholder .ph-desc').textContent;
    log('finishDlUp', finDesc.indexOf('DL1') >= 0 && finDesc.indexOf('DL2') >= 0);
    log('finishAnnounces', finDesc.indexOf('承重墙') >= 0 && finDesc.indexOf('带伤作业') >= 0);

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }

  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);
})();
</script>
`;

let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
fs.writeFileSync(PROBE_FILE, html);

let dom;
try {
  dom = execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-char',
      '--virtual-time-budget=5000',
      '--window-size=1200,900',
      '--dump-dom',
      'file:///' + PROBE_FILE.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
} finally {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
}

const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('未找到探针输出 —— 说明页面脚本在探针执行前就挂了。');
  console.log('DOM 长度：' + dom.length);
  process.exit(1);
}

const text = m[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .trim();

console.log('\n=== 角色探针结果 ===');
console.log(text);

const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

const checks = [
  // M7 解锁链（§3.1）：全新玩家只有掘者可选，另两个在下拉里是禁用的
  ['lockedCharsText',
    '掘者（DL1）/拾荒医师（未解锁 · 任一角色达到 DL2）[禁用]/引火者（未解锁 · 任一角色达到 DL4）[禁用]',
    '全新玩家：医师 / 引火者在下拉里禁用并写明解锁条件'],
  ['lockedMedicDisabled', 'true', 'DL1 时医师不可选'],
  ['lockedKeeperDisabled', 'true', 'DL1 时引火者不可选'],

  ['charOptions', '3', '顶栏角色下拉有三个角色'],
  // 解锁后每个角色显示自己的 DL —— 等级各存各的，医师 / 引火者还没打过就仍是 DL1
  ['charOptionText', '掘者（DL4）/拾荒医师（DL1）/引火者（DL1）',
    '顺序与 CHAR_ORDER 一致，各自带自己的 DL'],
  ['charDefault', 'digger', '默认角色是掘者（老局不受影响）'],
  ['themeDefault', '#5F5E5A', '默认卡面框色 = 掘者铁灰'],

  ['charAfterSwitchMedic', 'medic', '切到医师后本局角色跟着换'],
  ['themeMedic', '#1D9E75', '医师卡面框色 = 病绿（§8）'],
  ['deckIsMedic', 'true', '医师的起始卡组全是医师的卡'],
  ['poolOptionsMedic', '44', '卡池验证栏只列医师的 43 张 + 1 张诅咒卡'],

  ['medicInBattle', 'true', '切完角色能正常进战斗'],
  ['medicName', '拾荒医师', '玩家面板显示角色名'],
  // 开局时 startPlayerTurn 已经跑过一轮，所以起始就是 1 而不是 0 ——
  // 「每回合开始 +1」对第 1 回合同样成立
  ['medicResText', '样本 1 / 5', '开局资源条 = 样本 1 / 5（第 1 回合也算一回合）'],
  ['medicResFull', 'false', '未满时没有 is-full 标记'],
  ['resAfterEndTurn', '1', '点「结束回合」后样本 +1'],
  ['medicResTextAfterTurn', '样本 2 / 5', '资源条跟着回合更新'],

  ['serumDisabledWhenEmpty', 'true', '样本不足时「血清三号」渲染成灰色不可点'],
  ['serumEnabledWhenEnough', 'true', '样本够了立刻变可点（不用重开页面）'],
  ['serumEnemyDelta', '12', '点击「血清三号」→ 敌人掉 12 血（M82 平衡：14→12）'],
  ['serumResAfter', '0', '打完后样本被扣掉 2'],
  ['medicResTextAfterPlay', '样本 0 / 5', '资源条同步回 0'],

  ['medicResAtCap', '样本 5 / 5', '满样本显示上限'],
  ['medicCapIsFull', 'true', '满样本时带 is-full 标记（提示自动累积会白费）'],

  ['charAfterSwitchKeeper', 'keeper', '切到引火者'],
  ['themeKeeper', '#D85A30', '引火者卡面框色 = 燃橙（§8）'],
  ['poolOptionsKeeper', '44', '卡池验证栏只列引火者的 43 张 + 1 张诅咒卡'],
  ['keeperName', '引火者', '玩家面板换成引火者'],
  ['keeperResText', '余烬 0', '开局资源条 = 余烬 0'],
  ['keeperHasCap', 'false', '余烬不显示上限（无上限）'],
  ['sparkHpLoss', '2', '点击「擦火」→ 自己失去 2 点生命'],
  ['sparkEmberGain', '2', '同一次点击换到 2 点余烬'],
  ['keeperResTextAfterSpark', '余烬 2', '资源条更新为余烬 2'],
  ['emberAfterHit', '1', '被敌人打掉血 → 余烬自动 +1（界面侧确认）'],

  ['charAfterSwitchDigger', 'digger', '切回掘者'],
  ['themeDigger', '#5F5E5A', '卡面框色跟着回到铁灰'],
  ['poolOptionsDigger', '51', '掘者 50 张 + 1 张诅咒卡（M64 重防轴 +2 / M65 夯击 +1）'],
  ['diggerName', '掘者', '掘者局一切照旧'],
  ['diggerResTagCount', '0', '掘者没有资源 —— 不能凭空多出资源标签'],

  ['medicPoolHasCrowbar', 'false', '医师的卡池里没有掘者的「撬棍」（§8.4 卡池隔离）'],
  ['medicPoolHasScalpel', 'true', '医师的卡池里有自己的「解剖刀」'],

  // M64：DL1 通关升 DL2 —— 收尾面板除了刻痕 +1，还要点名 DL2 新解锁的两张卡
  ['finishDlUp', 'true', 'DL1 通关 → 收尾面板显示 DL1 → DL2 刻痕 +1'],
  ['finishAnnounces', 'true', '收尾面板点名 DL2 新卡：承重墙 / 带伤作业'],

  // 顶栏下拉与对局角色的一致性。这一条是回归防护：
  // 原来 fillCharSelect 被写在 `if (!this._booted)` 块里，而 index.html 末尾
  // 已经 boot 过一次，所以切角色后**对局是对的、顶栏在说谎**。
  ['selectShows_medic', 'medic', '切到医师后顶栏下拉同步显示'],
  ['selectShows_keeper', 'keeper', '切到引火者后顶栏下拉同步显示'],
  ['selectShows_digger', 'digger', '切回掘者后顶栏下拉同步显示'],

  ['jsError', 'none', '页面无 JS 运行时错误'],
];

let fail = 0;
console.log('\n=== 断言 ===');
checks.forEach(function (c) {
  const ok = got[c[0]] === c[1];
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] + '（期望 ' + c[1] + '，实际 ' + got[c[0]] + '）');
});

console.log('\n' + (fail === 0 ? 'UI 链路全部通过' : 'UI 链路存在失败项') + '：' + (checks.length - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
