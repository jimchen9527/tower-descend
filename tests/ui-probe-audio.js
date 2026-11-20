// 自适应空间音频专用探针（M39）—— **同一套断言跑两条通道**。
//
// 为什么要跑两遍：
//   竖井的音频是双通道的（audio-mw.js 文件头）——Path A（Web Audio 空间化）跑在
//   PC / iOS17+ / Android；Path B（<audio> 元素池）是 iOS 老环境的保底。
//   只在 Path A 上全绿是没有意义的：**iOS 15/16 的玩家走的根本不是那条路**。
//   所以这里用 `index.html#audio=flat` 把页面强制切到 Path B，把保底通道也钉死。
//
// 覆盖点：
//   ① 通道判定本身（caps.path / caps.forced）—— 判定悄悄退回 flat 会被抓
//   ② 舞台几何映射（Sfx.stagePos）—— 两种通道必须完全一致（纯函数，与通道无关）
//   ③ Path A：零元素池、空间化派发、语音预算、混响区/IR、音乐接入保护
//   ④ Path B：3 元素轮换池、首触解锁 24 个 blob 元素（9 材质 × 3 池 − 已建的 blunt）
//   ⑤ 混响区记账在两种通道下都要正确（Path B 不出声，但参数不能丢）
//
// 运行：node tests/ui-probe-audio.js

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }

  function countBlobs() {
    var n = 0;
    var l = document.querySelectorAll('audio');
    for (var i = 0; i < l.length; i++) {
      if (/^blob:/.test(l[i].getAttribute('src') || '')) n++;
    }
    return n;
  }

  try {
    Progress.reset();
    App.boot();

    // ---- ① 通道判定 ----
    log('capsPath', TDAudio.caps.path);
    log('capsForced', String(TDAudio.caps.forced));
    log('capsSession', TDAudio.caps.sessionType);
    log('capsReason', TDAudio.caps.reason);
    log('tier', TDAudio.diag().tier);
    // 注意：这个读数在「离线渲染回调完成前」采，是**竞态值**（1 或 2），只作诊断用，
    // 不作断言。真正用来卡「回退曲元素数」的是 finish() 里的 blobBeforeUnlock。
    log('blobAtBootRaw', String(countBlobs()));

    // ---- ② 舞台几何：纯映射，与通道无关，两边必须逐位一致 ----
    var p = Sfx.stagePos({ side: 'left', index: 0, count: 1 });
    log('posPlayer', p.x.toFixed(2) + '/' + p.dist.toFixed(2) + '/' + p.occl.toFixed(2));
    var r0 = Sfx.stagePos({ side: 'right', index: 0, count: 3 });
    var r1 = Sfx.stagePos({ side: 'right', index: 1, count: 3 });
    var r2 = Sfx.stagePos({ side: 'right', index: 2, count: 3 });
    log('posRow0', r0.x.toFixed(2) + '/' + r0.dist.toFixed(2) + '/' + r0.occl.toFixed(2));
    log('posRow1', r1.x.toFixed(2) + '/' + r1.dist.toFixed(2) + '/' + r1.occl.toFixed(2));
    log('posRow2', r2.x.toFixed(2) + '/' + r2.dist.toFixed(2) + '/' + r2.occl.toFixed(2));
    log('posSolo', Sfx.stagePos({ side: 'right', index: 0, count: 1 }).x.toFixed(2));
    // 显式遮挡覆盖（格挡 / 未来可能的隐身）：必须盖过队列遮挡
    var blk = Sfx.stagePos({ side: 'right', index: 0, count: 3, blocked: true });
    log('posBlocked', blk.occl.toFixed(2));

    // ---- ②b 自适应音乐的纯映射：与通道无关，两趟必须逐位一致 ----
    // 这四个读数是「紧张度 → 音色」这条设计决策的**合同**：改动映射公式必然打破它们。
    var mc = TDAudio.musicCurve;
    log('curveExplore', Math.round(mc(0, 1).cutoff) + '/' + mc(0, 1).shelf.toFixed(1));
    log('curveMid', Math.round(mc(0.5, 1).cutoff) + '/' + mc(0.5, 1).shelf.toFixed(1));
    log('curveCombat', Math.round(mc(1, 1).cutoff) + '/' + mc(1, 1).shelf.toFixed(1));
    log('curveDeep', String(Math.round(mc(1, 33).cutoff)));

    // ---- ②c 自适应节奏层：叠上去的合成打击必须与曲目 BPM 对齐 ----
    // 三首曲的 BPM 各不相同（104 / 118 / 62）——对不上就是「多了台鼓机在乱跑」，
    // 而不是「同一首歌变紧张」。这里测的是**对齐基准**本身。
    Bgm.play('battle', true);
    log('pulseBpmBattle', String(TDAudio.diag().pulseBpm));
    log('pulseOn', TDAudio.diag().pulse ? 'yes' : 'no');
    Bgm.play('boss', true);
    log('pulseBpmBoss', String(TDAudio.diag().pulseBpm));
    Bgm.play('map', true);
    log('pulseBpmMap', String(TDAudio.diag().pulseBpm));
    log('bgmBpmApi', String(Bgm.bpm('map')));
    Bgm.stop();
    log('pulseOffAfterStop', TDAudio.diag().pulse ? 'yes' : 'no');

    // ---- ③ 进战斗：场景 / 深度 / tension 三件事都要被写进去 ----
    var edges = Run.current().edges;
    var bn = null;
    for (var i = 0; i < edges.length; i++) {
      var t = Run.state.map.nodes[edges[i]].type;
      if (t === 'monster' || t === 'elite') { bn = edges[i]; break; }
    }
    App.enterNode(bn);
    log('inCombat', document.getElementById('view-combat').hidden === false);
    log('sceneZone', TDAudio.scene().zone);
    log('depthParamSet', TDAudio.params().depth > 0 ? 'yes' : 'no');

    document.getElementById('pool-select').value = 'strike';
    document.getElementById('pool-add').click();
    var cards = document.querySelectorAll('#hand .card');
    cards[cards.length - 1].click();
    log('tensionAfterPlay', TDAudio.params().tensionTgt > 0 ? 'set' : 'zero');

    // ---- ④ 一次 play 在两条通道下的**不同足迹** ----
    // 用 drill 而不是 blunt：blunt 是「打击」卡的材质，上面那次出牌已经触发过它，
    // Path B 的元素池是懒建的 —— 拿已建过的材质量，delta 恒为 0，断言会假通过。
    var nBefore = document.querySelectorAll('audio').length;
    Sfx.play('drill', Sfx.stagePos({ side: 'right', index: 1, count: 3 }));
    log('elemDeltaByPlay', String(document.querySelectorAll('audio').length - nBefore));
    log('hasPan', (TDAudio.diag().lastVoice && TDAudio.diag().lastVoice.x != null) ? 'yes' : 'no');

    // ---- ④b M40 分层：材质之外还有「力度」与「语义层」----
    // 这一组全是**纯计算**（Sfx.plan 不出声、不碰 DOM），所以三趟通道读数必须逐位一致
    // —— 它们进了前面的 GEOM 一致性校验。
    // 「真的多派发了一个声部」是另一回事，放在渲染就绪后单独量（见 ⑥）。
    var pLegacy = Sfx.plan('blunt', {});
    log('planLegacyShots', String(pLegacy.shots.length) + ':' + (pLegacy.shots[0].rate === null ? 'no-rate' : 'rate'));
    log('planWeightRate', Sfx.plan('blunt', { weight: 0 }).rate.toFixed(2) + '>' +
      Sfx.plan('blunt', { weight: 1 }).rate.toFixed(2));
    var pMulti = Sfx.plan('pick', { traits: ['multi'], weight: 0.4, times: 3 });
    log('planMulti', pMulti.shots.length + ':' + pMulti.shots[2].key);
    log('planTraitLayer', Sfx.plan('flame', { traits: ['bleed'] }).shots[1].key);
    log('planWide', Sfx.plan('flame', { traits: ['wide'] }).shots[1].mirror === true ? 'mirror' : 'none');
    log('planOrder', SfxProfile.merge(['swift', 'multi', 'ember']).join(','));
    log('planEventPath', Sfx.eventPath('trait:bleed'));
    log('synthKeys', String(Sfx.synthKeys().length));
  } catch (e) {
    log('EXCEPTION', e.message);
  }

  // 离线渲染是异步的 —— 等 9 种材质齐了再断言「派发 / 元素池」这类同步可见的事实
  setTimeout(function () {
    function finish() {
      // 渲染已就绪，此时读数才是确定的（boot 那一刻采样会撞上异步回调，是竞态）。
      // Path A 期望 2 = 合成回退曲 battle/map 各 1 个元素；
      // 若 startRendering 的 Promise 与 oncomplete 没设一次性闸门，这里会是 4（每个多一个孤儿）。
      log('blobBeforeUnlock', String(countBlobs()));

      // ---- 首触解锁：两条通道的行为完全不同 ----
      try {
        var b0 = countBlobs();
        document.dispatchEvent(new Event('pointerdown'));
        log('blobDeltaAfterUnlock', String(countBlobs() - b0));
        log('blobTotalAfterUnlock', String(countBlobs()));
      } catch (e) { log('blobDeltaAfterUnlock', 'ERR'); }

      try {
        var d = TDAudio.diag();
        log('playedAny', d.played > 0 ? 'yes' : 'no');
        log('voicesLeqCap', d.voices <= d.maxVoices ? 'ok' : ('over:' + d.voices));
        log('musicAttach', d.musicAttach);
        log('musicNodes', String(d.musicNodes));
        // 不变量：诊断里的「音乐链目标值」必须等于「当前参数代入纯函数」的结果。
        // 这一步钉住的是「调度器真的在用那条公式」——而不是只信公式本身算得对。
        var c2 = TDAudio.musicCurve(TDAudio.params().tension, TDAudio.params().depth);
        log('musicChainFollowsCurve',
          (Math.round(c2.cutoff) === d.musicCutoffTgt &&
           Math.round(c2.shelf * 10) / 10 === d.musicShelfTgt) ? 'yes' : 'no');
        log('stingerApi', String(TDAudio.stingers().length));
        log('stingerDispatch', String(TDAudio.stinger('kill')));
      } catch (e) { log('playedAny', 'ERR'); }

      // ---- ⑤ 混响区：三个场地 + 深度分档 ----
      try {
        TDAudio.setScene('room', { depth: 14 });
        log('zoneRoom', TDAudio.diag().zone + ':' + TDAudio.diag().band + ':' + TDAudio.diag().wet);
        TDAudio.setScene('shaft', { depth: 30 });
        log('zoneShaftD30', TDAudio.diag().zone + ':' + TDAudio.diag().band + ':' + TDAudio.diag().wet);
        TDAudio.setScene('open', { depth: 2 });
        log('zoneOpenD2', TDAudio.diag().zone + ':' + TDAudio.diag().band + ':' + TDAudio.diag().wet);
        log('irCount', String(TDAudio.diag().irCached));
      } catch (e) { log('zoneRoom', 'ERR'); }

      // ---- 语音预算：灌爆也不许无限增长 ----
      try {
        var cap = TDAudio.diag().maxVoices;
        for (var i = 0; i < cap + 10; i++) Sfx.play('pick', { dist: 0.6 });
        var dd = TDAudio.diag();
        log('voiceCap', dd.voices <= dd.maxVoices ? 'capped' : ('over:' + dd.voices));
      } catch (e) { log('voiceCap', 'ERR'); }

      // ---- ⑥ M40：分层**真的**多派发了声部（不只是算了个计划）----
      // 纯计算那组（④b）只能证明「计划排对了」；这一组量的是**派发足迹**。
      // 两条通道的足迹天然不同，所以期望值分开写：
      //   Path A —— played（空间化声部数）变化；元素数必须纹丝不动
      //   Path B —— played 恒 0（本来就不走空间化）；语义层要多建一个元素池
      try {
        var dl1 = TDAudio.diag().played;
        Sfx.play('blunt', {});
        var dl2 = TDAudio.diag().played;
        Sfx.play('blunt', { traits: ['bleed'], weight: 0.5 });
        var dl3 = TDAudio.diag().played;
        log('dispatchLegacy', String(dl2 - dl1));
        log('dispatchLayered', String(dl3 - dl2));
        var e0 = document.querySelectorAll('audio').length;
        Sfx.play('blunt', { traits: ['ember'], weight: 0.5 });
        log('elemDeltaTrait', String(document.querySelectorAll('audio').length - e0));
      } catch (e) { log('dispatchLegacy', 'ERR'); }

      log('jsError', window.__err || 'none');
      var pre = document.createElement('pre');
      pre.id = 'probe-out';
      pre.textContent = out.join('\\n');
      document.body.appendChild(pre);
    }

    (function wait(n) {
      var r;
      try { r = Sfx.ready(); } catch (e) { r = { rendered: 14, total: 14 }; }
      if (r.rendered >= r.total || n <= 0) return finish();
      setTimeout(function () { wait(n - 1); }, 120);
    })(25);
  }, 60);
})();
</script>
`;

// ---- 跑一趟探针页，回传解析好的键值对 ----
// urlBase 为 null ⇒ 走 file://（默认）；给了 http 前缀 ⇒ 走本地服务器。
function runPass(label, hash, tmpName, urlBase) {
  const file = path.join(BASE, tmpName);
  let html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
  if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
  html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
  fs.writeFileSync(file, html);

  const url = urlBase
    ? urlBase + tmpName
    : 'file:///' + file.replace(/\\/g, '/');

  let dom;
  try {
    dom = execFileSync(
      EDGE,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-audio',
        '--virtual-time-budget=8000',
        '--window-size=1200,900',
        '--dump-dom',
        url + (hash || ''),
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('[' + label + '] 未找到探针输出 —— 页面脚本在探针执行前就挂了。DOM 长度：' + dom.length);
    process.exit(1);
  }
  const text = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  console.log('\n=== ' + label + ' ===');
  console.log(text);

  const got = {};
  text.split('\n').forEach(function (line) {
    const i = line.indexOf(' = ');
    if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
  });
  return got;
}

// ---- 第三趟：本地 http 服务 ----
// 为什么非要这一趟：attachMusic 在 file:// 下是**故意不接**的（本地文件对页面是跨源，
// 接进 Web Audio 会「成功但静音」）。于是「mp3 真的被接进了 Web Audio 图」这件事，
// 在 file:// 上根本测不到 —— 只有真跑一遍 http（部署环境的协议）才算验过。
//
// 服务器跑在**子进程**里：父进程用 execFileSync 等 Edge，会阻塞自己的事件循环，
// 同进程的 http 服务在那一刻是哑的，所以必须让服务活在另一个进程里。
function runHttpPass() {
  const runner = path.join(BASE, '_ui-probe-audio-http-runner.js');

  const code = `
const http = require('http'), fs = require('fs'), path = require('path');
const { execFile } = require('child_process');
// 结果文件名由自身路径派生 —— 父进程知道 runner 的路径，无需再传参
const RESULT = __filename + '.out';
const D = ${JSON.stringify(BASE)};
const EDGE = ${JSON.stringify(EDGE)};
const TMP = '_ui-probe-audio-http.html';
const PROBE = ${JSON.stringify(PROBE_SCRIPT)};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
               '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg' };

let html = fs.readFileSync(path.join(D, 'index.html'), 'utf8')
             .replace('</body>', PROBE + '\\n</body>');
const file = path.join(D, TMP);
fs.writeFileSync(file, html);

const srv = http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(D, p);
  if (f.indexOf(D) !== 0) { res.writeHead(403); return res.end('nope'); }
  fs.stat(f, function (err, st) {
    if (err) { res.writeHead(404); return res.end('404'); }
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    // 支持 Range：<audio preload=auto> 会发 Range 请求，不回 206 有时会拖慢/卡住加载
    const rng = req.headers.range;
    if (rng) {
      const m2 = /bytes=(\\d+)-(\\d*)/.exec(rng);
      const s = m2 ? Number(m2[1]) : 0;
      const e = (m2 && m2[2]) ? Number(m2[2]) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes ' + s + '-' + e + '/' + st.size, 'Content-Length': e - s + 1 });
      return fs.createReadStream(f, { start: s, end: e }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(res);
  });
});

srv.listen(0, '127.0.0.1', function () {
  const port = srv.address().port;
  execFile(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-audio-http',
    '--virtual-time-budget=8000', '--window-size=1200,900', '--dump-dom',
    'http://127.0.0.1:' + port + '/' + TMP],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    function (err, stdout) {
      try { fs.unlinkSync(file); } catch (e) {}
      const m2 = (stdout || '').match(/<pre id="probe-out">([\\s\\S]*?)<\\/pre>/);
      // 结果写文件而不是 stdout：父进程在轮询期间是**阻塞**的，管道上的 data 回调
      // 在那段时间根本不会触发，写 stdout 等于把结果丢进黑洞。
      fs.writeFileSync(RESULT, '<<<PROBE>>>' + (m2 ? m2[1] : 'NO_OUTPUT') + '<<<END>>>');
      try { srv.close(); } catch (e) {}
      process.exit(0);
    });
});

process.on('uncaughtException', function (e) {
  try { fs.writeFileSync(RESULT, '<<<PROBE>>>CRASH:' + (e && e.message) + '<<<END>>>'); } catch (e2) {}
  process.exit(3);
});

setTimeout(function () {
  try { fs.writeFileSync(RESULT, '<<<PROBE>>>TIMEOUT<<<END>>>'); } catch (e) {}
  process.exit(2);
}, 50000);
`;
  const resultFile = runner + '.out';
  try { fs.unlinkSync(resultFile); } catch (e) {}
  fs.writeFileSync(runner, code);

  // ⚠️ 本沙箱里**同步** spawn node.exe 会 EBUSY（msedge.exe 却能 execFileSync），
  // 所以子进程用异步 spawn 起，父进程用 Atomics.wait 做同步小睡轮询。
  // 子进程是独立进程，父进程阻塞不影响它跑；结果经文件回传（见上）。
  let errInfo = '';
  try {
    const child = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuf = '';
    child.stderr.on('data', function (d) { errBuf += d.toString(); });
    child.on('error', function (e) { errInfo = '\n  子进程 spawn 失败：' + (e && e.code); });
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    let saw = false;
    for (let i = 0; i < 450; i++) {              // 最多等 90s
      if (fs.existsSync(resultFile)) { saw = true; break; }
      Atomics.wait(sleeper, 0, 0, 200);
    }
    if (!saw) errInfo += '\n  子进程未产出结果（超时）' + (errBuf ? '\n  stderr: ' + errBuf.slice(0, 1200) : '');
    try { child.kill(); } catch (e) {}
  } catch (e) {
    errInfo = '\n  启动子进程异常：' + String(e && e.message);
  }

  let out = '';
  try { out = fs.readFileSync(resultFile, 'utf8'); } catch (e) {}
  if (!process.env.KEEP_AUDIO_PROBE) {
    try { fs.unlinkSync(runner); } catch (e) {}
    try { fs.unlinkSync(resultFile); } catch (e) {}
  } else {
    errInfo += '\n  runner 保留在：' + runner;
  }

  const m = out.match(/<<<PROBE>>>([\s\S]*?)<<<END>>>/);
  const label = 'Path A over http:// · 音乐接入（部署协议）';
  if (!m || m[1] === 'NO_OUTPUT') {
    console.log('\n=== ' + label + ' ===\n（未取到输出 —— 本地服务器或 Edge 启动失败）' + errInfo +
      '\n  产物片段：' + String(out).slice(0, 600));
    return {};
  }
  const text = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  console.log('\n=== ' + label + ' ===');
  console.log(text);

  const got = {};
  text.split('\n').forEach(function (line) {
    const i = line.indexOf(' = ');
    if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
  });
  return got;
}

// ---- 三趟：Path A（file://）/ Path B（#audio=flat）/ Path A over http:// ----
const A = runPass('Path A · 空间化通道（默认）', '', '_ui-probe-audio-spatial.html', null);
const B = runPass('Path B · 平铺保底通道（#audio=flat）', '#audio=flat', '_ui-probe-audio-flat.html', null);
const H = runHttpPass();

// 舞台几何是**纯映射**，两条通道必须逐位一致 —— 先校验这一点，再校验通道差异。
// 舞台几何与音乐映射都是**纯映射**：三趟的读数必须逐位一致（与通道、协议无关）。
const GEOM = ['posPlayer', 'posRow0', 'posRow1', 'posRow2', 'posSolo', 'posBlocked', 'tier',
              'curveExplore', 'curveMid', 'curveCombat', 'curveDeep',
              // M40：打击画像的编译结果也是纯映射（与通道、协议无关）——
              // 「材质层 + 语义层」怎么排，不该因为跑在哪条通道而变。
              'planLegacyShots', 'planWeightRate', 'planMulti', 'planTraitLayer',
              'planWide', 'planOrder', 'planEventPath', 'synthKeys'];
const BAGS = { A: A, B: B, H: H };

const checks = [
  // ---- ① 通道判定 ----
  ['A', 'capsPath', 'spatial', 'M39：默认判定为 Path A（Web Audio 空间化）'],
  ['B', 'capsPath', 'flat', 'M39：#audio=flat 强制切到 Path B（探针能真的把保底通道跑起来）'],
  ['B', 'capsForced', 'flat', 'M39：强制值被如实记录（不是「静默忽略」）'],
  ['B', 'capsReason', '非 iOS，无需会话声明', 'M39：降级理由如实反映「能力具备、被强制降级」——强制值单独在 capsForced'],

  // ---- ② 舞台几何（两通道一致）----
  ['A', 'posPlayer', '-0.55/0.00/0.00', 'M39：玩家恒在左（pan −0.55），无距离、无遮挡'],
  ['A', 'posRow0', '0.22/0.10/0.00', 'M39：3 只怪时前排贴右（pan 0.22）'],
  ['A', 'posRow1', '0.61/0.27/0.25', 'M39：中排更远（dist 0.27）、被前排挡 0.25'],
  ['A', 'posRow2', '1.00/0.44/0.50', 'M39：队尾最远最闷（dist 0.44、遮挡 0.50）'],
  ['A', 'posSolo', '0.55', 'M39：单只怪时落位 0.55（不是 0.22 —— 队列分摊只在多怪时成立）'],
  ['A', 'posBlocked', '0.45', 'M39：显式遮挡覆盖队列遮挡（格挡 = 被墙挡）'],

  // ---- ③ 场景 / 参数 ----
  ['A', 'inCombat', 'true', 'M39：进战斗链路正常'],
  ['A', 'sceneZone', 'shaft', 'M39：进战斗 → 混响区切到竖井井筒'],
  ['A', 'depthParamSet', 'yes', 'M39：深度写进自适应参数（竖井越深越闷）'],
  ['A', 'tensionAfterPlay', 'set', 'M39：出一张牌后 tension 被渲染层写进来（局势 → 音频参数这条链通了）'],

  // ---- ④ 一次 play 的通道足迹 ----
  ['A', 'elemDeltaByPlay', '0', 'M39：Path A 不建任何 <audio> 元素（走 AudioBuffer）'],
  ['A', 'playedAny', 'yes', 'M39：Path A 真的派发了空间化声部'],
  ['A', 'hasPan', 'yes', 'M39：Path A 的声部带声像参数（不是干声直出）'],
  ['A', 'blobBeforeUnlock', '2', 'M39：合成回退曲只建 1 元素/曲（修掉 startRendering 双回调的孤儿元素）'],
  ['B', 'blobBeforeUnlock', '8', 'M39：Path B 解锁前 = 2 回退曲 + 2 材质×3 池（blunt 由出牌建、drill 由足迹测量建）'],
  ['A', 'blobDeltaAfterUnlock', '0', 'M39：Path A 首触解锁不多建元素（本来就无需元素解锁）'],
  ['A', 'voiceCap', 'capped', 'M39：语音预算生效，灌爆也不超上限'],

  ['B', 'elemDeltaByPlay', '3', 'M39：Path B 一次 play 建 3 元素轮换池（M36b 的契约保住了）'],
  ['B', 'blobDeltaAfterUnlock', '21', 'M39：Path B 首触解锁补齐剩下 7 材质 × 3 池（blunt/drill 已建）—— M36c 的解锁契约保住了'],
  ['B', 'blobTotalAfterUnlock', '29', 'M39：Path B 元素总量 = 2 回退曲 + 9 材质 × 3 池'],
  ['B', 'playedAny', 'no', 'M39：Path B 不经过空间化声部（确实走了另一条路）'],
  ['B', 'hasPan', 'no', 'M39：Path B 没有声像（<audio> 本来就做不了空间化 —— 这才是要保留 Path A 的理由）'],
  ['B', 'voiceCap', 'capped', 'M39：Path B 声部数恒为 0，不超上限'],

  // ---- ⑤ 混响区（两通道都要正确记账）----
  ['A', 'zoneRoom', 'room:1:0.38', 'M39：小室 · 中深 D14 → band1 / wet0.38'],
  ['A', 'zoneShaftD30', 'shaft:2:0.55', 'M39：竖井 · 深 D30 → band2 / wet0.55'],
  ['A', 'zoneOpenD2', 'open:0:0.16', 'M39：旷野 · 浅 D2 → band0 / wet0.16'],
  ['B', 'zoneShaftD30', 'shaft:2:0.55', 'M39：Path B 照样记账（不出声也不许丢参数）'],
  ['B', 'zoneOpenD2', 'open:0:0.16', 'M39：Path B 的旷野参数与 Path A 一致'],
  // 4 张 = boot 的 open:0 + 首战的 shaft:<浅带> + room:1 + shaft:2
  ['A', 'irCount', '4', 'M39：IR 按（场地 × 深度带）懒算并缓存，零素材'],
  ['B', 'irCount', '0', 'M39：Path B 不建 IR（没有 Web Audio 图，不为不存在的通道花内存）'],

  // ---- ⑥ 音乐接入保护 ----
  ['A', 'musicAttach', 'skipped(file:// 跨源会被静音)',
   'M39：file:// 下音乐不接 Web Audio（跨源会静音 —— 保护不是缺陷）'],
  ['A', 'stingerApi', '4', 'M39：4 个 Stinger 事件就位'],
  ['A', 'stingerDispatch', 'true', 'M39：Path A 能派发 Stinger'],
  ['B', 'stingerDispatch', 'false', 'M39：Path B 无合成层，Stinger 静默返回（不抛错）'],

  // ---- ②b 自适应音乐映射（纯函数，精确值）----
  ['A', 'curveExplore', '5200/-3.5', 'M39：紧张度 0（探索态）→ 低通 5200Hz、高频 −3.5dB'],
  ['A', 'curveMid', '12100/0.5', 'M39：紧张度 0.5 → 低通 12100Hz、高频 +0.5dB（线性插值）'],
  ['A', 'curveCombat', '19000/4.5', 'M39：紧张度 1（决战态）→ 低通 19000Hz、高频 +4.5dB'],
  ['A', 'curveDeep', '8550', 'M39：深度 D33 再压暗 55% —— 同一首曲在深井里是另一个音色'],

  // ---- ②c 自适应节奏层的 BPM 对齐 ----
  ['A', 'pulseBpmBattle', '104', 'M39：普通战节奏层对齐 104 BPM（与该曲一致，不是随便打的拍）'],
  ['A', 'pulseBpmBoss', '118', 'M39：Boss 战对齐 118 BPM（换曲即换拍）'],
  ['A', 'pulseBpmMap', '62', 'M39：大地图对齐 62 BPM'],
  ['A', 'pulseOn', 'yes', 'M39：Play A 下节奏层节点已就位'],
  ['A', 'pulseOffAfterStop', 'no', 'M39：停曲即停节奏层（不留下一台孤独的鼓机）'],
  ['B', 'pulseBpmBattle', '104', 'M39：节奏层的 BPM 数据在平铺通道下也一致'],

  // ---- ⑧ Path A over http://：部署协议下音乐真的接进了 Web Audio ----
  ['H', 'capsPath', 'spatial', 'M39：http 下同样是 Path A'],
  ['H', 'musicAttach', 'attached', 'M39：http 下 mp3 成功接入 Web Audio（file:// 会跳过 —— 这是环境差异，不是缺陷）'],
  ['H', 'musicNodes', '3', 'M39：三首曲全部挂进音乐处理链（低通 + 高频架 + 混响送出）'],
  ['H', 'musicChainFollowsCurve', 'yes', 'M39：诊断里的音乐链目标值 = 当前参数代入纯函数 —— 调度器确实在用那条公式'],
  ['H', 'jsError', 'none', 'M39：http 下页面无 JS 运行时错误'],

  // ---- M40 分层打击音效：计划（纯计算）+ 派发足迹（真出声的那一步）----
  ['A', 'planLegacyShots', '1:no-rate',
   'M40：不传画像 ⇒ 只有 1 个材质声部，且不传速率/音量（旧调用方行为逐字节不变）'],
  ['A', 'planWeightRate', '1.06>0.93',
   'M40：力度 0 的速率 > 力度 1（轻重是听出来的，不能只标在数据里）'],
  ['A', 'planMulti', '3:pick',
   'M40：连击排 3 个材质声部（连环凿 5×3 现在真的响三下，不再被去重吃掉）'],
  ['A', 'planTraitLayer', 'trait:bleed',
   'M40：卖血牌多一层语义声部（材质层负责「是什么」、语义层负责「在做什么」）'],
  ['A', 'planWide', 'mirror',
   'M40：群体牌多一个镜像声部（横扫，而不是同一个音重复几遍）'],
  ['A', 'planOrder', 'multi,ember,swift', 'M40：特质顺序固定（断言与诊断才可预期）'],
  ['A', 'planEventPath', 'event:/SFX/Card/Trait_Bleed', 'M40：语义层也有 FMOD 风格事件路径'],
  ['A', 'synthKeys', '14', 'M40：合成体总数 = 9 材质 + 5 语义层'],
  ['A', 'dispatchLegacy', '1', 'M40：旧调用派发 1 个声部'],
  ['A', 'dispatchLayered', '2', 'M40：带画像的一击派发 2 个声部 —— 分层真的上线了，不只是算了个计划'],
  ['A', 'elemDeltaTrait', '0', 'M40：Path A 的语义层不建任何 <audio> 元素'],
  ['B', 'dispatchLegacy', '0', 'M40：Path B 不进空间化声部计数（本来就不走那条路）'],
  ['B', 'dispatchLayered', '0', 'M40：Path B 的分层走元素池，不体现在 played 上'],
  ['B', 'elemDeltaTrait', '3', 'M40：Path B 的语义层懒建 3 元素轮换池（保底通道也有特质）'],

  // ---- ⑦ 无运行时错误 ----
  ['A', 'jsError', 'none', 'M39：Path A 页面无 JS 运行时错误'],
  ['B', 'jsError', 'none', 'M39：Path B 页面无 JS 运行时错误'],
];

// 纯映射一致性：三趟的读数必须完全相同。
// stagePos 与 musicCurve 都是纯函数 —— 通道和协议都不该影响它们的输出。
// H 起不来时降级用 A 的值做一致性比对（H 自己的断言仍会红，不会被这里掩盖）。
const HX = Object.keys(H).length ? H : A;

let fail = 0;
console.log('\n=== 断言 ===');
GEOM.forEach(function (k) {
  const same = A[k] === B[k] && A[k] === HX[k];
  if (!same) fail++;
  console.log('  ' + (same ? '[ok]  ' : '[FAIL]') +
    ' 纯映射三趟一致 · ' + k + '（A ' + A[k] + ' / B ' + B[k] + ' / H ' + HX[k] + '）');
});

checks.forEach(function (c) {
  const bag = BAGS[c[0]] || {};
  const ok = bag[c[1]] === c[2];
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' [' + c[0] + '] ' + c[3] +
    '（期望 ' + c[2] + '，实际 ' + bag[c[1]] + '）');
});

const total = checks.length + GEOM.length;
console.log('\n' + (fail === 0 ? '双通道音频链路全部通过' : '双通道音频链路存在失败项') +
  '：' + (total - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
