// 战斗视图 UI 探针：把 index.html 复制一份、在末尾注入自动化操作脚本，用 Edge headless
// 跑起来，再从 DOM 里读回结果。
//
// 为什么需要它：逻辑层测试（m1/m2/m3）跑不到"点击 → 状态变化 → 重绘"这条链路。
// 这里通过真实的 DOM click 事件驱动，验证事件绑定、渲染管线、面板联动。
//
// M3 起开局先落在「地图视图」上，所以探针会先走一步进入战斗节点，
// 否则战斗面板是空的。地图本身的点击链路在 ui-probe-map.js 里测。
//
// 运行：node tests/ui-probe.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 探针脚本：注入在 index.html 的 Render.boot() 之后（注入点是 </body> 之前）。
// 不再调用 Render.boot() —— 页面自己已经调过了，重复调用会重复绑定事件。
const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }

  try {
    // 0. M3 起开局落在地图视图上，先进一个战斗节点，后面才测得到战斗链路
    // M7：index.html 加载时已经 boot 过一次，而存档 / 等级是跨页面加载留着的，
    // 探针复用的又是同一个 --user-data-dir —— 不先清干净，上一轮的状态会渗进来。
    Progress.reset();
    App.boot();
    var entryEdges = Run.current().edges;
    var battleNode = null;
    for (var i = 0; i < entryEdges.length; i++) {
      var nt = Run.state.map.nodes[entryEdges[i]].type;
      if (nt === 'monster' || nt === 'elite') { battleNode = entryEdges[i]; break; }
    }
    App.enterNode(battleNode);
    log('inBattle', document.getElementById('view-combat').hidden === false);

    // 1. 卡池下拉是否被填满（40 张卡池 + 1 张诅咒卡）
    log('poolOptions', document.querySelectorAll('#pool-select option').length);
    var groups = Array.prototype.slice.call(document.querySelectorAll('#pool-select optgroup'));
    var lastLabel = groups.length ? groups[groups.length - 1].label : '';
    log('poolHasCurseGroup', lastLabel.indexOf('诅咒') === 0);

    // 2. 点「加入手牌」
    var before = document.querySelectorAll('#hand .card').length;
    document.getElementById('pool-select').value = 'defend';
    document.getElementById('pool-add').click();
    log('handBeforeAdd', before);
    log('handAfterAdd', document.querySelectorAll('#hand .card').length);

    // 3. 点「补满能量」
    document.getElementById('pool-energy').click();
    log('energyText', (document.querySelector('.stat-energy') || {}).textContent || 'MISSING');

    // 4. 改深度输入框（派发 input 事件）
    var di = document.getElementById('depth-input');
    di.value = '5';
    di.dispatchEvent(new Event('input'));
    log('depthText', (document.querySelector('.stat-depth') || {}).textContent || 'MISSING');

    // 5. 真实点击一张手牌出牌 → 敌人掉血（M36 顺便记录打击材质）
    // M39：音频改成**双通道**。探针跑的 Edge 是 Path A（spatial）—— 打击音效走
    // AudioBuffer + 空间化链路，**不建任何 <audio> 元素池**（元素池是 Path B 的东西，
    // 由 ui-probe-audio.js 用 #audio=flat 单独覆盖）。通道判定本身也被断言，
    // 免得哪天判定悄悄退回 flat、而测试还全绿。
    log('audioPath', (typeof TDAudio !== 'undefined') ? TDAudio.caps.path : 'no-mw');
    log('audioSession', (typeof TDAudio !== 'undefined') ? TDAudio.caps.sessionType : 'no-mw');
    // blob 元素计数：BGM 的**合成回退曲**（battle/map 各一个）在任何通道下都存在，
    // 那是 Bgm 的东西、不是 Sfx 的。
    // ⚠️ 这里**不能**取基线：合成回退是离线渲染的异步产物，此刻可能只建好 1 个 ——
    // 基线取到 1、后面取到 2，就会假报「Sfx 多建了元素」（实测踩到过，间歇性红）。
    // 基线一律挪到渲染就绪之后取（见 spatialChecks 开头的 blobAtSettled）。
    var countBlobs = function () {
      var n = 0;
      var l = document.querySelectorAll('audio');
      for (var i = 0; i < l.length; i++) if (/^blob:/.test(l[i].getAttribute('src') || '')) n++;
      return n;
    };
    log('blobAtBootRaw', String(countBlobs()));
    var audioBeforeSfx = document.querySelectorAll('audio').length;
    Sfx.play('blunt');
    log('sfxAudioPool', document.querySelectorAll('audio').length - audioBeforeSfx);
    var sfxHits = [];
    var realSfxPlay = Sfx.play;   // deferred 段要真派发一次，先把原函数留一手
    Sfx.play = function (impact) { sfxHits.push(impact); };
    var hpBefore = Combat.state.enemy.hp;
    document.getElementById('pool-select').value = 'strike';
    document.getElementById('pool-add').click();
    var cards = document.querySelectorAll('#hand .card');
    cards[cards.length - 1].click();
    log('enemyHpDelta', hpBefore - Combat.state.enemy.hp);
    log('logLinesAfterPlay', Combat.state.log.length);
    log('sfxBlunt', sfxHits.length ? sfxHits[sfxHits.length - 1] : 'none');
    // M36：不同材质不同音效 —— 撬棍 = metal（与打击的 blunt 不同，证明非恒等）
    Combat.state.enemy.hp = 100;   // 抬血防 crowbar 打死，别影响后面 endTurn 的敌人行为
    Combat.state.enemy.maxHp = 100;
    document.getElementById('pool-select').value = 'crowbar';
    document.getElementById('pool-add').click();
    var cards2 = document.querySelectorAll('#hand .card');
    cards2[cards2.length - 1].click();
    log('sfxMetal', sfxHits.length ? sfxHits[sfxHits.length - 1] : 'none');

    // 6. 能力牌不进弃牌堆
    var dBefore = Combat.state.discardPile.length;
    document.getElementById('pool-select').value = 'steel_beam';
    document.getElementById('pool-add').click();
    var cs = document.querySelectorAll('#hand .card');
    cs[cs.length - 1].click();
    log('powerInDiscard', Combat.state.discardPile.length - dBefore);

    // 7. 点「结束回合」
    document.getElementById('end-turn').click();
    log('turnAfterEnd', Combat.state.turn);

    // 8. 起始卡组应为 10 张
    log('deckTotal', Combat.state.drawPile.length + Combat.state.hand.length + Combat.state.discardPile.length);

    // 9. M35 战斗 BGM：进战斗 = 对应曲目播放中（断言只看状态机，不依赖真出声）
    var bs = Bgm.state();
    log('bgmTheme', bs.theme);
    log('bgmTrack', bs.track);
    log('bgmPlaying', bs.playing);
    log('bgmBtn', document.getElementById('bgm-toggle').textContent);
    // M35：普通战 / Boss 战两首曲子必须真的分开 —— 恒等操作也能全绿，
    // 所以这里显式断言 battleStart(true) 与 battleStart(false) 的曲目不同
    Bgm.battleStart(false);
    log('bgmNormalTrack', Bgm.state().track);
    Bgm.battleStart(true);
    log('bgmBossTrack', Bgm.state().track);
    Bgm.mapStart();
    log('bgmMapTrack', Bgm.state().track);
    Bgm.play('battle');
    log('bgmBackToNormal', Bgm.state().track);
    // M35e：每次进战斗从头播 —— 手动把战斗曲拨到中间，同曲重打也必须归零 currentTime
    var btEl = null;
    (function () {
      var alist = document.querySelectorAll('audio');
      for (var ai = 0; ai < alist.length; ai++) {
        if (/bgm-battle\\.mp3/.test(alist[ai].getAttribute('src') || '')) { btEl = alist[ai]; break; }
      }
    })();
    if (btEl) {
      btEl.currentTime = 5;
      Bgm.battleStart(false);   // 同曲重打 + 重头
      log('bgmRestart', btEl.currentTime < 0.01 ? 'yes' : ('no:' + btEl.currentTime));
    } else {
      log('bgmRestart', 'no-element');
    }
    // 静音开关 + 持久化：点一下写进 localStorage，再点一下恢复
    document.getElementById('bgm-toggle').click();
    log('bgmMuted', Bgm.isMuted());
    log('bgmStored', (window.localStorage.getItem('td-bgm-muted') || 'MISSING'));
    document.getElementById('bgm-toggle').click();
    log('bgmUnmuted', Bgm.isMuted());
    // 战斗结束钩子：停歌后不再播放
    Bgm.stop();
    log('bgmStopped', Bgm.state().playing);

    log('jsError', window.__err || 'none');
  } catch (e) {
    log('EXCEPTION', e.message);
  }

  // M35 串音回归：地图 → 战斗切换后，地图曲必须淡出（音量归 0），不能继续叠着响。
  // 淡出是异步的（约 0.35s），所以把 pre 落盘延后到淡出完成之后。
  setTimeout(function () {
    try {
      Bgm.mapStart();       // 起地图曲（map 音量回到 1）
      Bgm.play('battle');   // 切战斗：应淡出地图曲
    } catch (e) {}
    setTimeout(function () {
      try {
        var mv = -1;
        var list = document.querySelectorAll('audio');
        for (var ai = 0; ai < list.length; ai++) {
          if (/bgm-map\\.mp3/.test(list[ai].getAttribute('src') || '')) mv = +list[ai].volume;
        }
        log('bgmMapVolAfterSwitch', mv.toFixed(2));
      } catch (e) { log('bgmMapVolAfterSwitch', 'ERR'); }
      // M37：切换瞬间新曲就 play —— crossfade 淡入前先 playEl(新曲)，而不是等 0.35s
      // 淡入走完才 play。patch battle 元素的 play() 记录调用：battleStart 后应立即被调
      // （旧实现只在最后一步 play，此处计数恒 0，断言能抓回归）。
      try {
        var b2El = null;
        var aList2 = document.querySelectorAll('audio');
        for (var q2 = 0; q2 < aList2.length; q2++) {
          if (/bgm-battle\\.mp3/.test(aList2[q2].getAttribute('src') || '')) b2El = aList2[q2];
        }
        var b2Count = 0;
        if (b2El) {
          var origPlay2 = b2El.play.bind(b2El);
          b2El.play = function () { b2Count++; return origPlay2(); };
        }
        Bgm.mapStart();          // 当前 track 已是 battle，先切到 map
        Bgm.battleStart(false);  // 切战斗：新曲 battle 应立即被 play
        log('bgmNewTrackPlayedImmediately', b2Count > 0 ? 'yes' : 'no');
      } catch (e) { log('bgmNewTrackPlayedImmediately', 'ERR'); }
      // ---- M39：Path A（空间化）链路断言 ----
      // 离线渲染是异步的，所以先等 9 种材质渲染齐，再跑「同步派发」的断言 ——
      // 不等就跑，Sfx.play 会走 .then 分支，派发计数还没涨，断言会假失败。
      var spatialChecks = function () {
        // 渲染已就绪 —— 到这一步基线才是确定的：合成回退曲 battle/map 各 1 个元素。
        // 若 startRendering 的 Promise 与 oncomplete 没设一次性闸门，这里会读到 4
        // （每曲各多一个孤儿元素常驻 DOM）。
        var blobBase = countBlobs();
        log('blobAtSettled', String(blobBase));

        // ① 真的派发了一记空间化声部（渲染已就绪 ⇒ 同步 dispatch）
        try {
          var p0 = TDAudio.diag().played;
          realSfxPlay('hammer', Sfx.stagePos({ side: 'right', index: 0, count: 1 }));
          log('sfxDispatch', TDAudio.diag().played > p0 ? 'dispatched' : 'pending');
        } catch (e) { log('sfxDispatch', 'ERR'); }

        // ② 声场真的分开了：玩家出手偏左、敌人队尾偏右且更闷（后排被前排挡住）
        try {
          realSfxPlay('blunt', Sfx.stagePos({ side: 'left', index: 0, count: 1 }));
          var lv = TDAudio.diag().lastVoice || {};
          log('sfxPanPlayer', lv.x == null ? 'no-pan' : lv.x.toFixed(2));
          realSfxPlay('claw', Sfx.stagePos({ side: 'right', index: 2, count: 3 }));
          var rv = TDAudio.diag().lastVoice || {};
          log('sfxPanBackRow', rv.x == null ? 'no-pan' : rv.x.toFixed(2));
          log('sfxOcclBackRow', rv.occl == null ? 'n/a' : rv.occl.toFixed(2));
          log('sfxLpBackRow', String(rv.lp));
          log('sfxGainBackRow', String(rv.gain));
        } catch (e) { log('sfxPanPlayer', 'ERR'); }

        // ③ 语音预算：灌到超过上限，活跃数必须被卡住（不是无限增长）
        try {
          var cap = TDAudio.diag().maxVoices;
          for (var vi = 0; vi < cap + 12; vi++) realSfxPlay('blunt', { dist: 0.5 });
          var d2 = TDAudio.diag();
          log('sfxVoiceCap', d2.voices <= d2.maxVoices ? 'capped' : ('over:' + d2.voices));
        } catch (e) { log('sfxVoiceCap', 'ERR'); }

        // ④ 混响区：竖井深层 = band2 + wet0.55；旷野 = band0 + wet0.16
        try {
          TDAudio.setScene('shaft', { depth: 25 });
          var s1 = TDAudio.diag();
          log('zoneShaftDeep', s1.zone + ':' + s1.band + ':' + s1.wet);
          TDAudio.setScene('open', { depth: 3 });
          var s2 = TDAudio.diag();
          log('zoneOpen', s2.zone + ':' + s2.band + ':' + s2.wet);
          log('irCached', s2.irCached >= 2 ? 'yes' : 'no');
        } catch (e) { log('zoneShaftDeep', 'ERR'); }

        // ⑤ 自适应参数：tension 的目标值必须立刻可读（平滑是引擎自己的事）
        try {
          TDAudio.setParam('tension', 0.72);
          log('tensionTgt', TDAudio.diag().tensionTgt.toFixed(2));
        } catch (e) { log('tensionTgt', 'ERR'); }

        // ⑥ file:// 保护：本地打开时音乐**不能**接进 Web Audio（跨源会被静音）
        try {
          var ma = TDAudio.diag().musicAttach;
          log('musicAttachGuard', /^skipped/.test(ma) ? 'guarded' : ma);
        } catch (e) { log('musicAttachGuard', 'ERR'); }

        // ⑦ Path A 下 Sfx 不该多出任何 blob 元素（元素池是 Path B 的专属）
        try {
          log('sfxBlobDeltaInPathA', String(countBlobs() - blobBase));
        } catch (e) { log('sfxBlobDeltaInPathA', 'ERR'); }

        var pre = document.createElement('pre');
        pre.id = 'probe-out';
        pre.textContent = out.join('\\n');
        document.body.appendChild(pre);
      };

      (function waitReady(n) {
        var r;
        try { r = Sfx.ready(); } catch (e) { r = { rendered: 99, total: 99 }; }
        if (r.rendered >= r.total || n <= 0) return spatialChecks();
        setTimeout(function () { waitReady(n - 1); }, 120);
      })(25);
    }, 500);
  }, 50);
})();
</script>
`;

// ---- 生成探针页 ----
let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
fs.writeFileSync(PROBE_FILE, html);

// ---- 跑 headless ----
let dom;
try {
  dom = execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe',
      '--virtual-time-budget=5000',
      '--window-size=1200,900',
      '--dump-dom',
      'file:///' + PROBE_FILE.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
} finally {
  // 探针页只是临时产物，跑完就删
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
}

// ---- 解析结果 ----
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

console.log('\n=== UI 探针结果 ===');
console.log(text);

// ---- 断言 ----
const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

const checks = [
  ['inBattle', 'true', 'M3：从地图点进战斗节点后，战斗视图可见'],
  ['poolOptions', '51', '卡池下拉 = 50 张卡池 + 1 张诅咒卡（单独分组）'],
  ['poolHasCurseGroup', 'true', '诅咒卡在下拉里单独成组'],
  ['handAfterAdd', String(Number(got.handBeforeAdd) + 1), '点「加入手牌」手牌 +1'],
  ['energyText', '能量 99 / 3', '点「补满能量」能量变 99'],
  ['depthText', '深度 D5', '深度输入框联动生效'],
  ['enemyHpDelta', '6', '点击手牌出「打击」→ 敌人掉 6 血'],
  ['sfxBlunt', 'blunt', 'M36：出「打击」触发 blunt 音效'],
  ['sfxMetal', 'metal', 'M36：出「撬棍」触发 metal 音效（不同卡不同音效）'],
  // ---- M39：自适应空间音频（Path A）----
  ['audioPath', 'spatial', 'M39：探针环境判定为 Path A（Web Audio 空间化通道）'],
  ['blobAtSettled', '2', 'M39：合成回退曲只建 1 元素/曲 —— 修掉 startRendering 双回调造成的孤儿元素'],
  ['sfxAudioPool', '0', 'M39：Path A 不建 <audio> 元素池（打击音效走 AudioBuffer）'],
  ['sfxBlobDeltaInPathA', '0', 'M39：Path A 的打击音效不多建任何 blob 元素（元素池是 Path B 专属）'],
  ['sfxDispatch', 'dispatched', 'M39：Sfx.play 真的派发了一记空间化声部（渲染就绪后同步派发）'],
  ['sfxPanPlayer', '-0.55', 'M39：玩家出手偏左（声像 −0.55）'],
  ['sfxPanBackRow', '1.00', 'M39：3 只怪时队尾打到最右（声像 +1.00）—— 声场真的分开了'],
  ['sfxOcclBackRow', '0.50', 'M39：后排被前排挡住 → 语义遮挡 0.50'],
  ['sfxLpBackRow', '9139', 'M39：距离+遮挡 → 低通 9139Hz（越远越闷，非恒等）'],
  ['sfxGainBackRow', '0.51', 'M39：距离衰减后该声源增益 0.51'],
  ['sfxVoiceCap', 'capped', 'M39：语音预算生效 —— 灌爆后活跃声部不超上限'],
  ['zoneShaftDeep', 'shaft:2:0.55', 'M39：竖井深层 → 混响 band2 / wet0.55'],
  ['zoneOpen', 'open:0:0.16', 'M39：旷野 → 混响 band0 / wet0.16（与竖井确实不同）'],
  ['irCached', 'yes', 'M39：两套混响 IR 按需生成并缓存（零素材）'],
  ['tensionTgt', '0.72', 'M39：自适应参数可写入（tension 目标值即刻可读）'],
  ['musicAttachGuard', 'guarded', 'M39：file:// 下音乐不接入 Web Audio（跨源会被静音，是保护不是缺陷）'],
  ['powerInDiscard', '0', '能力牌不进弃牌堆'],
  ['turnAfterEnd', '2', '点「结束回合」推进到第 2 回合'],
  ['deckTotal', '13', '卡组总数 = 起始 10 张 + 手动加的 3 张（steel_beam 进消化堆不计；出牌只换堆不增减）'],
  ['bgmTheme', 'battle', 'M35：进战斗后 BGM 切到战斗主题'],
  ['bgmTrack', 'battle', 'M35：曲目名 = battle（普通战）'],
  ['bgmNormalTrack', 'battle', 'M35：battleStart(false) → 普通战曲'],
  ['bgmBossTrack', 'boss', 'M35：battleStart(true) → Boss 战曲（与普通战是不同曲目）'],
  ['bgmMapTrack', 'map', 'M35：mapStart → 大地图曲'],
  ['bgmBackToNormal', 'battle', 'M35：能从地图曲切回普通战曲（曲目可来回切）'],
  ['bgmRestart', 'yes', 'M35e：每次进战斗从头播（同曲重打也归零 currentTime）'],
  ['bgmPlaying', 'true', 'M34：战斗 BGM 处于播放中'],
  ['bgmBtn', '🔊', 'M34：顶栏 BGM 按钮初始为开（🔊）'],
  ['bgmMuted', 'true', 'M34：点顶栏按钮切到静音'],
  ['bgmStored', '1', 'M34：静音偏好写进 localStorage（td-bgm-muted=1）'],
  ['bgmUnmuted', 'false', 'M34：再点按钮恢复发声'],
  ['bgmStopped', 'false', 'M35：stop() 之后不再播放'],
  ['bgmMapVolAfterSwitch', '0.00', 'M35：地图→战斗切换后，地图曲音量淡出到 0（旧曲不再叠响）'],
  ['bgmNewTrackPlayedImmediately', 'yes', 'M37：切换瞬间新曲就 play（crossfade 淡入前先 playEl，而非最后一步才 play）'],
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
