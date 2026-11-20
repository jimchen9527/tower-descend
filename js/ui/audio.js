// 音频事件层（M39 重写）—— 从「各播各的」改成一套挂在 TD-AAS 中间件上的**内容层**。
//
// 分工：
//   audio-mw.js（TDAudio）= 引擎 —— 总线 / 空间化 / 混响区 / 参数 / 语音预算 / 双通道
//   本文件               = 内容 —— 曲目表、9 种打击材质、舞台几何映射、对外门面
//
// 对外契约**一行没变**（Bgm.play/stop/battleStart/mapStart/toggleMute/isMuted/state、
// Sfx.play/setMuted/isMuted）：渲染层与既有探针不用改。新增的只有 Sfx.play 的第二个
// 参数（空间位置，可选）与 Sfx.stagePos / Sfx.stinger。
//
// ───────────────────────────────────────────────────────────────────────────
// 为什么打击音效仍然「合成」而不是「下 mp3」
// ───────────────────────────────────────────────────────────────────────────
// 几十种材质用几十个 mp3，既难下载（CDN / 中转截断，见用户笔记里的实测坑）又难同步；
// OfflineAudioContext 离线渲染 WAV 是零素材、零下载、音色差异可精确控制的路线，还
// 天然拿到了 AudioBuffer —— Path A（Web Audio）可以**绕过 blob 直接播 buffer**，
// 省掉解码与元素池。Path B 才退回 blob + <audio> 元素池（iOS 老环境保底）。
//
// ───────────────────────────────────────────────────────────────────────────
// 曲目表（Beatra / Suno 生成，三首都是「适合循环」的编排）
// ───────────────────────────────────────────────────────────────────────────
//   bgm-battle.mp3  普通战斗（1:54，柔和版 take 2；**104 BPM**，无军鼓）
//   bgm-boss.mp3    Boss 战（2:00，柔和版 take 2；**118 BPM**，无军鼓）
//   bgm-map.mp3     大地图（3:10，神秘悠扬版；**62 BPM**，无词弓弦主音）
// BPM 这三个数是**自适应节奏层的对齐基准**：紧张度叠加上去的合成打击必须与之一致，
// 否则就是「多了一台鼓机在跑」而不是「同一首歌变紧张」。
//
// 播放通道：HTML5 <audio>（loop）—— iOS 上 Web Audio 曾被静音键掐掉，<audio> 走媒体
// 通道不受影响（M34c 实测）。M39 起 iOS 17+ 可以用 audioSession 把 Web Audio 通道
// 夺回来（见 audio-mw.js 文件头），于是 <audio> 仍是**音源**，但输出可被接进 Web Audio
// 做自适应处理（低通 / 高频架 / 混响送出）。接不上就退回直出媒体通道 —— 永不因加效果而没声。
//
// 移动端解锁：iOS / 微信内置浏览器要求音频在该页面的**真实触摸**里启动过一次，
// 之后程序化 play() 才放行 —— 首次触摸时无声播一下再停，把通道解锁。
//
// 状态机刻意与「真的出不出声」解耦：任何环境都会推进 track/playing，
// 探针断言只看状态机，不依赖真出声。
// 跨曲切换用一小段淡入淡出，避免硬切「啪」一下。

const Bgm = (function () {
  var STORE_KEY = 'td-bgm-muted';

  // 曲目表。bpm 供自适应节奏层对齐；src 缺失时该曲自动走合成回退。
  var TRACKS = {
    battle: { file: 'preview-assets-audio/bgm-battle.mp3', fallback: 'battle', bpm: 104 },
    boss:   { file: 'preview-assets-audio/bgm-boss.mp3',   fallback: 'battle', bpm: 118 },
    map:    { file: 'preview-assets-audio/bgm-map.mp3',    fallback: 'map',    bpm: 62 },
  };
  var FADE = 0.35;   // 交叉淡入淡出秒数

  // ---- 合成回退用的音序（无音频环境）----
  var STEP = 0.2;     // 八分音符（s）= 150 BPM
  var SR = 32000;
  var LOOKAHEAD = 0.15;
  var MELODY = [      // 战斗主题：Am-Am-F-G / Am-Am-F-E
    69, 72, 76, 72, 69, null, 64, null,
    69, 72, 76, 79, 81, null, 79, 76,
    65, 69, 72, 69, 77, null, 76, 72,
    67, 71, 74, 71, 79, null, 77, 74,
    69, 72, 76, 72, 69, null, 64, null,
    69, 72, 76, 79, 81, null, 83, 84,
    84, null, 81, 77, 76, null, 72, 69,
    71, 76, 80, 76, 83, null, 76, null,
  ];
  var BASS_ROOT = [45, 45, 41, 43, 45, 45, 41, 40];
  // 地图主题（合成回退）：同一套音阶放慢一倍、音区压低、去掉军鼓感 —— 舒缓耐听
  var MAP_MELODY = [
    57, null, 64, null, 60, null, 62, null,
    57, null, 64, null, 67, null, 64, null,
    53, null, 60, null, 57, null, 60, null,
    55, null, 62, null, 59, null, 62, null,
    57, null, 64, null, 60, null, 62, null,
    53, null, 60, null, 57, null, 55, null,
    52, null, 59, null, 57, null, 60, null,
    55, null, 62, null, 59, null, 57, null,
  ];
  var MAP_BASS = [33, 33, 29, 31, 33, 33, 29, 31];

  var muted = false;
  try { muted = window.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* 无存储就当不静音 */ }

  var track = null;      // 当前曲目名：'battle' / 'boss' / 'map' / null
  var playing = false;

  // TD-AAS 缺席时（例如只引了 audio.js 的独立试听页）一律按平铺通道走，绝不抛错
  function mw() { return (typeof TDAudio !== 'undefined' && TDAudio) ? TDAudio : null; }
  function pathOf() { var m = mw(); return (m && m.caps) ? m.caps.path : 'flat'; }

  // ---- 通道一：HTML5 <audio>（mp3 真音频，兼任两种通道的音源）----
  var els = {};          // 曲目名 -> mp3 元素（懒建）
  var ready = {};        // 曲目名 -> mp3 是否真的能播（loadedmetadata 成功）
  var dead = {};         // 曲目名 -> mp3 已确认取不到（404 / 解码失败）⇒ 走合成回退
  var fbEls = {};        // 回退名 -> 合成渲染出来的 WAV 元素
  var fadeTimer = null;

  // ---- 通道二：实时 Web Audio 合成（回退）----
  var ctx = null, master = null, timer = null, step = 0, nextTime = 0;
  var fbLoop = null;    // 回退通道当前在放哪套音序（'battle' / 'map' / null）
  var fbPrep = {};     // 回退名 -> 渲染 Promise（**必须是对象**，按 key 缓存）

  function noop() {}
  function seqFor(name) {
    return name === 'map'
      ? { melody: MAP_MELODY, bass: MAP_BASS, step: STEP * 2 }
      : { melody: MELODY, bass: BASS_ROOT, step: STEP };
  }
  function seqLen(name) { return name === 'map' ? 64 : 64; }

  function freq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // 一个音符 = 振荡器 + 增益包络（两个通道共用同一套音色参数）
  function tone(ac, out, midi, t, type, vol, decay) {
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type;
    o.frequency.value = freq(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  function renderLoop(ac, out, name) {
    var s = seqFor(name);
    var n = seqLen(name);
    for (var i = 0; i < n; i++) {
      var t = i * s.step;
      var m = s.melody[i % s.melody.length];
      if (m !== null) tone(ac, out, m, t, 'triangle', name === 'map' ? 0.13 : 0.16, s.step * 1.7);
      tone(ac, out, s.bass[Math.floor((i % n) / 8)], t, 'sine', name === 'map' ? 0.18 : 0.22, s.step * 0.9);
    }
  }

  // 16-bit 单声道 PCM 的 WAV 封装（44 字节头 + 采样）
  function encodeWav(samples, sr) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function tag(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    tag(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    tag(36, 'data');
    v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var s = samples[i];
      s = s > 1 ? 1 : (s < -1 ? -1 : s);
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // 离线渲染整段循环 → WAV Blob。**不需要用户手势**，页面一加载就能备好。
  function prepFallback(name) {
    if (fbPrep[name]) return fbPrep[name];
    fbPrep[name] = new Promise(function (resolve) {
      try {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC || !window.Blob || !window.URL || !URL.createObjectURL) return resolve(null);
        var s = seqFor(name);
        var oac = new OAC(1, Math.ceil((seqLen(name) * s.step + 0.6) * SR), SR);
        var out = oac.createGain();
        out.gain.value = 0.5;
        out.connect(oac.destination);
        renderLoop(oac, out, name);

        // ⚠️ 现代 Chrome / Edge 里 startRendering() **既返回 Promise、又触发 oncomplete**，
        // 两条路都会调 done —— 不设一次性闸门就会建出两个 <audio>：第二个成了孤儿常驻
        // DOM（fbEls 只记得第一个），白占一份 WAV 内存。实测：不设闸门时页面多出 2 个
        // 孤儿元素。这是 M34 就埋下、直到 M39 统计 blob 元素才被照出来的隐患。
        var settled = false;
        var done = function (buf) {
          if (settled) return;
          settled = true;
          try {
            var a = document.createElement('audio');
            a.loop = true;
            a.preload = 'auto';
            a.setAttribute('playsinline', '');   // iOS 内联播放，别抢全屏播放器
            a.volume = muted ? 0 : 1;
            a.src = URL.createObjectURL(encodeWav(buf.getChannelData(0), SR));
            document.body.appendChild(a);
            fbEls[name] = a;
            resolve(a);
          } catch (e) { resolve(null); }
        };
        // 老 Safari 的 startRendering 是 oncomplete 回调式，新版返回 Promise —— 两条都挂
        oac.oncomplete = function (e) { done(e.renderedBuffer); };
        var p = oac.startRendering();
        if (p && p.then) p.then(done, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
    return fbPrep[name];
  }

  // 建 mp3 元素。**建了不等于能用** —— 文件缺失（404）或解码失败时要自动落到合成回退，
  // 所以额外挂 loadedmetadata / error 两个信号，由 ready[] / dead[] 记录真实可用性。
  function ensureEl(name) {
    if (els[name]) return els[name];
    if (dead[name]) return null;          // 已确认取不到，不再重建
    var t = TRACKS[name];
    if (!t || !t.file) { dead[name] = true; return null; }
    try {
      var a = document.createElement('audio');
      a.loop = true;
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.volume = 0;                        // 淡入从 0 起，避免硬切爆音
      a.addEventListener('loadedmetadata', function () { ready[name] = true; });
      a.addEventListener('error', function () {
        dead[name] = true;
        // 正在放这首却取不到 → 立刻改播合成回退，别让玩家听一片安静
        if (track === name && playing) fallbackTo(name);
      });
      a.src = t.file;
      document.body.appendChild(a);
      els[name] = a;
      // M39：Path A 下把 mp3 接进 Web Audio 做自适应处理（低通 / 高频架 / 混响送出）。
      // 接不上（file:// 的 SecurityError、老环境）就原地放弃 —— 元素继续走媒体通道直出，
      // **绝不会因为「加不上效果」把 BGM 弄没**。
      var m = mw();
      if (m && m.attachMusic) { try { m.attachMusic(a); } catch (e) {} }
      return a;
    } catch (e) { dead[name] = true; return null; }
  }

  // 某曲目当前实际该播的元素：mp3 优先，取不到用合成回退
  function elFor(name) {
    var a = els[name];
    if (a && !dead[name]) return a;
    var fb = TRACKS[name] && TRACKS[name].fallback;
    return (fb && fbEls[fb]) || null;
  }

  function playEl(a) {
    if (!a) return;
    try {
      var p = a.play();
      if (p && p['catch']) p['catch'](noop);
    } catch (e) { /* 播不了就静默，绝不能把战斗页面带崩 */ }
  }

  // ---- 实时 Web Audio 回退通道 ----
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; master = null; }
    return ctx;
  }

  function tick() {
    if (!ctx || !playing || !fbLoop) return;
    try {
      var s = seqFor(fbLoop);
      var n = seqLen(fbLoop);
      while (nextTime < ctx.currentTime + LOOKAHEAD) {
        var m = s.melody[step % s.melody.length];
        if (m !== null) {
          tone(ctx, master, m, nextTime, 'triangle', fbLoop === 'map' ? 0.13 : 0.16, s.step * 1.7);
        }
        tone(ctx, master, s.bass[Math.floor((step % n) / 8)], nextTime, 'sine',
          fbLoop === 'map' ? 0.18 : 0.22, s.step * 0.9);
        step++;
        nextTime += s.step;
      }
    } catch (e) { /* 排程失败就静默 */ }
  }

  function startCtx(name) {
    var c = ensureCtx();
    if (!c) return;
    try {
      // ⚠️ resume() 的返回值在部分手机浏览器/webview 里是 undefined（不是 Promise）——
      // 直接 .resume()['catch'] 会抛 TypeError 把下面的排程器启动一并吞掉，
      // 症状是「状态在播、永远无声」（M34b 修复的移动端静音 bug）。
      if (c.state !== 'running' && c.resume) {
        var p = c.resume();
        if (p && p['catch']) p['catch'](noop);
      }
      fbLoop = name;
      nextTime = c.currentTime + 0.05;
      step = 0;
      if (!timer) timer = setInterval(tick, 50);
    } catch (e) { /* 同上，静默 */ }
  }

  function stopCtx() {
    if (timer) { clearInterval(timer); timer = null; }
    fbLoop = null;
  }

  // ---- 对外行为 ----

  // 淡出旧曲、淡入新曲。fromScene=null 表示没有旧曲（首次播放 / 纯起新），
  // toScene=null 表示只停旧曲（战斗结束用 stop()，不经过这里）。
  function crossfade(fromScene, toScene) {
    // ⚠️ 曲目名（'battle'/'boss'/'map'）→ 元素统一走 elFor 解析（回退曲目的元素在 fbEls 里）。
    // from 必须显式用「旧曲目」传入 —— 不能用全局 track：play() 在调 crossfade 之前
    // 已把 track 改成新场景，读 track 会把 from 误解析成新曲目，旧曲（如大地图曲）
    // 就永远淡不掉、停不掉，两首曲子叠着响（M35 切场景串音 bug）。
    //
    // M39：淡入淡出仍然写在 **元素 volume** 上（而不是 Web Audio 的 gain）——
    // 因为 Path A / Path B 的音源都是同一个 <audio>，把交叉淡化留在元素上，
    // 两条通道的切换语义就完全一致，也保住了既有探针对 volume 的断言。
    var from = fromScene ? elFor(fromScene) : null;
    var to = toScene ? elFor(toScene) : null;
    var dur = FADE * 1000;
    var steps = 14;

    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }

    if (!from || from === to) {         // 没有旧曲，或新旧是同一元素（合成回退同源）：直接起新的
      if (to) {
        to.volume = muted ? 0 : 1;
        playEl(to);
      }
      return;
    }

    // 淡入开始前先把新曲 play 起来（音量先压到 0）。原来的写法是淡入期间只改 volume、
    // 最后一步才 playEl(to) —— 新曲在 0.35s 过渡期内根本没在播，造成「旧曲渐小 →
    // 一片静音 → 新曲突然响起」；而且一旦淡入被中断（快速切场景 / 标签页切走），
    // 最后一步永不执行，新曲就起不来、旧曲也停不干净，两首曲子错乱（M37 修复）。
    if (to) {
      to.volume = 0;
      playEl(to);
      // M55b 看门狗：淡化 timer 若被并发切曲打断、或后台标签页把 setInterval
      // 节流到不跑，新曲会永远停在 0 音量（元素在播 = 无声）。400ms 后还没
      // 起来就直拉满 —— 正常淡化 25ms/步，400ms 早到顶了，不会误伤。
      (function (toEl, toName) {
        setTimeout(function () {
          if (playing && track === toName && !muted && toEl.volume === 0) {
            try { toEl.volume = 1; } catch (e) {}
          }
        }, 400);
      })(to, toScene);
    }

    var vol0 = from.volume;
    var i = 0;
    fadeTimer = setInterval(function () {
      i++;
      var k = i / steps;
      try {
        from.volume = Math.max(0, vol0 * (1 - k));
        if (to) to.volume = (muted ? 0 : 1) * k;
      } catch (e) {}
      if (i >= steps) {
        clearInterval(fadeTimer); fadeTimer = null;
        try { from.pause(); } catch (e) {}
        if (to) {
          try { to.volume = muted ? 0 : 1; } catch (e) {}
          // 新曲已在上面 play 起来，这里只需收尾音量，不再重复 play
        }
      }
    }, dur / steps);
  }

  // mp3 取不到时改播合成回退（先让能出声的环境立刻有声，WAV 渲染好再接上）
  function fallbackTo(name) {
    var fbName = (TRACKS[name] && TRACKS[name].fallback) || 'battle';
    startCtx(fbName);
    prepFallback(fbName).then(function (a) {
      if (!a || !playing || track !== name) return;
      stopCtx();
      crossfade(null, name);   // 实时合成已停，只剩 WAV 元素要起，没有旧曲要淡出
    });
  }

  // 切到某首曲子（scene: 'battle' / 'boss' / 'map'）。fromStart=true 时强制从头播，
  // 用于「每次进战斗都重头」——否则 mp3 元素是复用的，currentTime 会停在上一场停的位置。
  function play(scene, fromStart) {
    if (track === scene && playing && !fromStart) return;   // 同曲重打不打断（除非要求重头）
    var prev = track;
    track = scene;
    playing = true;

    // M55b 防哑炮：unlock 只在首次手势跑一次，那一次 resume 若偶发失败，
    // 上下文会永久 suspended —— 元素照常「在播」，但声音被吞（真机上就是
    // 「状态机全绿却一片安静」）。play 通常在点击手势链里被调，这里再拉一次
    // 几乎必然成功；不在手势里时也只是被吞掉的拒绝，零副作用。
    var c0 = ensureCtx();
    if (c0 && c0.state !== 'running' && c0.resume) {
      var rp = c0.resume(); if (rp && rp['catch']) rp['catch'](noop);
    }
    var m0 = mw();
    if (m0 && m0.resume) { try { m0.resume(); } catch (e) {} }

    // M39：把曲目交给自适应节奏层，让它按该曲的 BPM 对齐（104 / 118 / 62）
    var m = mw();
    if (m && m.setTrack) { try { m.setTrack(scene); } catch (e) {} }

    var el = ensureEl(scene);
    if (el && !dead[scene]) {
      // 有 mp3：走 HTML5 通道（iOS 唯一不受静音键影响的路）
      stopCtx();
      if (fromStart) { try { el.currentTime = 0; } catch (e) {} }   // 战斗曲每次从头
      crossfade(prev, scene);   // 淡出的是「旧曲」prev，不是全局 track（此时已是 scene）
      return;
    }
    // 没 mp3（文件缺失 / 解码失败）：回落合成
    if (prev) { try { var p0 = elFor(prev); if (p0) p0.pause(); } catch (e) {} }
    fallbackTo(scene);
  }

  function stop() {
    playing = false;
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    var m = mw();
    if (m && m.setTrack) { try { m.setTrack(null); } catch (e) {} }   // 停曲即停节奏层
    var cur = track;
    if (cur) {
      var el = elFor(cur);
      if (el) { try { el.pause(); } catch (e) {} }
    }
    stopCtx();
  }

  function battleStart(isBoss) { play(isBoss ? 'boss' : 'battle', true); }   // 每次进战斗从头播
  function mapStart() { play('map'); }

  // 返回切换后的静音态
  function toggleMute() {
    muted = !muted;
    try { window.localStorage.setItem(STORE_KEY, muted ? '1' : '0'); } catch (e) {}
    var vol = muted ? 0 : 1;
    [els, fbEls].forEach(function (bag) {
      Object.keys(bag).forEach(function (k) { try { bag[k].volume = vol; } catch (e) {} });
    });
    if (master) {
      try { master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02); } catch (e) {}
    }
    var m = mw();
    if (m && m.setMuted) { try { m.setMuted(muted); } catch (e) {} }
    // M58 P1：音乐静音不再连坐音效 —— Sfx 有独立开关（td-sfx-muted），
    // 设置面板里两行分开勾。
    return muted;
  }

  // ---- 移动端首触解锁 ----
  // iOS / 微信内置浏览器：音频必须在该页面的真实触摸里启动过一次，之后程序化
  // play() 才放行。这里先无声播一下再停（听不见），把 <audio> 通道解锁。
  function primeEl(a) {
    if (!a) return;
    try {
      a.volume = 0;
      var back = function () {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
        if (track && elFor(track) === a) a.volume = muted ? 0 : 1;
      };
      var p = a.play();
      if (p && p.then) p.then(back, function () { if (track && elFor(track) === a) a.volume = muted ? 0 : 1; });
      else setTimeout(back, 60);
    } catch (e) {}
  }

  function unlock() {
    // M55b：监听**常驻**（原版首触即摘 —— 首次 resume 偶发失败就永远哑）。
    // 幂等：上下文已 running 时 resume() 是无害 no-op；正响着的元素绝不动
    // （只在「当前曲没在正常发声」时才做无声解锁），健康状态下零副作用。
    var c = ensureCtx();
    if (c && c.state !== 'running' && c.resume) {
      var p = c.resume();
      if (p && p['catch']) p['catch'](noop);
    }
    // M39：同时也解锁中间件那套（AudioContext + 混响区 + 节奏层）
    var m = mw();
    if (m && m.resume) { try { m.resume(); } catch (e) {} }
    // 当前正在放的那首：没在正常发声才无声解锁它；还没建元素就先建
    if (track && !muted) {
      var a = elFor(track) || ensureEl(track);
      if (a && (a.paused || a.volume === 0)) primeEl(a);
    }
    // 战斗 / Boss / 地图三首都预建，触摸时不必等建元素
    ['battle', 'boss', 'map'].forEach(function (n) { ensureEl(n); });
  }

  try {
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('touchend', unlock); // 老 iOS 没有 pointerdown，touchend 兜底
  } catch (e) { /* 极老浏览器：退回 play 内自行处理 */ }

  // 预建元素 + 预渲染合成回退（都不需要手势，页面一加载就备好）
  ['battle', 'boss', 'map'].forEach(function (n) { ensureEl(n); });
  prepFallback('battle');
  prepFallback('map');

  return {
    play: play,
    stop: stop,
    battleStart: battleStart,
    mapStart: mapStart,
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    // 探针用：{ track, playing, muted } —— 刻意不含音频环境，断言不依赖真出声
    state: function () { return { track: track, theme: track, playing: playing, muted: muted }; },
    bpm: function (n) { return (TRACKS[n || track] || {}).bpm || 0; },
  };
})();

// 打击音效 —— 按卡牌/敌人招式的「材质」区分音色，并按舞台位置做空间化。
//
// 通道策略（M39 更新）：
//   Path A（spatial，PC / iOS17+ / Android）→ 离线渲染出 AudioBuffer，直接喂给
//     TDAudio.playBuffer，走「声像 → 距离低通 → 遮挡 → 总线 → 混响送出」全链路。
//     零 blob、零 <audio> 元素池，延迟更低。
//   Path B（flat，iOS 老环境 / 无 OfflineAudioContext）→ 沿用 M36 的元素池方案：
//     离线渲染 WAV → blob → <audio> × 3 轮换池。没有空间化，但一定是「能响」的保底。
//
// 材质 → 音色（都靠振荡器 + 白噪声 + 包络，差异在频率/谐波/衰减）。
// 打击类 = 「高频瞬态 click（接触瞬间）+ 低频 body（重量感）」两层；持续类（钻探/火焰）
// = 持续噪声 + 机械脉冲 / 随机起伏。M38 重写：给打击类补了瞬态、body 分层更清晰，
// 让每种材质一听就能分辨。
//   blunt  钝击/拳   —— 中高频瞬态「啪」+ 低频闷响「砰」（铁拳、打击）
//   hammer 重锤      —— 更低更长的低频下滑 + 低频轰体感（震地锤、基岩锤）
//   metal  金属敲击  —— 高频瞬态「叮」+ 4 个非谐波泛音（撬棍、火钳）
//   pick   凿/石     —— 极高频脆响「叮」+ 高频下滑（凿击、碎石）
//   drill  钻探      —— 持续钻动噪声 + 密集机械脉冲（凿岩机）
//   blast  爆破/震荡 —— 起爆高频「啪」+ 宽带冲击波 + 低频 boom（炸药包）
//   blade  刀刃      —— 高频划击「嘶」+ 金属摩擦下滑（解剖刀）
//   flame  火焰      —— 低频「轰」底 + 带通噪声随机起伏（灼烧、焚身）
//   claw   爪击/撕咬 —— 中高频撕裂「嘶啦」+ 中频快速衰减
//
// 事件路径（FMOD 风格，M39）：见 Sfx.eventPath。
// 静音独立键 td-sfx-muted（M58 P1 设置面板分控；原来跟 BGM 共用键、被连坐）。
const Sfx = (function () {
  var muted = false;
  try { muted = window.localStorage.getItem('td-sfx-muted') === '1'; } catch (e) {}

  var SR = 32000;   // WAV 采样率（与 Bgm 合成一致）
  var DUR = 0.7;    // 每个音效渲染时长（覆盖最长 blast 0.5s + 余量）
  var POOL = 3;     // 每材质元素池大小（仅 Path B 用）

  // 事件路径表 —— 代码里不出现裸材质名
  var EVENT_PATH = {
    blunt: 'event:/SFX/Card/Strike_Blunt',
    hammer: 'event:/SFX/Card/Strike_Hammer',
    metal: 'event:/SFX/Card/Strike_Metal',
    pick: 'event:/SFX/Card/Strike_Pick',
    drill: 'event:/SFX/Card/Strike_Drill',
    blast: 'event:/SFX/Card/Strike_Blast',
    blade: 'event:/SFX/Card/Strike_Blade',
    flame: 'event:/SFX/Card/Strike_Flame',
    claw: 'event:/SFX/Enemy/Claw',
    // 语义层（M40）：一次打击的第二层，叠在材质之上
    'trait:multi': 'event:/SFX/Card/Trait_Multi',
    'trait:bleed': 'event:/SFX/Card/Trait_Bleed',
    'trait:toxin': 'event:/SFX/Card/Trait_Toxin',
    'trait:ember': 'event:/SFX/Card/Trait_Ember',
    'trait:guard': 'event:/SFX/Card/Trait_Guard',
    'trait:swift': 'event:/SFX/Card/Trait_Swift',
    'trait:wide': 'event:/SFX/Card/Trait_Wide',
  };

  var els = {};     // 材质名 -> [audio x POOL]（Path B）
  var ptr = {};     // 材质名 -> 当前轮换索引
  var prep = {};    // 材质名 -> Promise<{ buffer, url }>
  var urlCache = {}; // 材质名 -> 已渲染好的 blob URL（Path B 首触解锁要同步拿到 src）

  function mw() { return (typeof TDAudio !== 'undefined' && TDAudio) ? TDAudio : null; }
  function pathOf() { var m = mw(); return (m && m.caps) ? m.caps.path : 'flat'; }
  function OCCL() { var m = mw(); return (m && m.OCCL) || { NONE: 0, BLOCKED: 0.45, HIDDEN: 0.75 }; }

  // ---- 16-bit 单声道 PCM WAV 封装（Path B 用）----
  function encodeWav(samples, sr) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function tag(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    tag(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    tag(36, 'data');
    v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var s = samples[i];
      s = s > 1 ? 1 : (s < -1 ? -1 : s);
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // M41 · 克制的打击合成原语
  // ════════════════════════════════════════════════════════════════════════
  // M38 的做法是「高频瞬态 click（vol 0.5~0.9）+ 重低频 body（vol 0.95~1.0）」两层
  // 硬碰硬。听感问题不是「难听」而是**死板 + 吵**：
  //   · 瞬态 2ms 起振、Q 值高、频率冲到 5~6kHz —— 那是金属划玻璃的频段，
  //     现实里拳头/凿子/骨头都不这么亮，一秒几十次全刺着耳廓；
  //   · body 的 vol 顶到 1.0，瞬态层又叠 0.5~0.9，同一采样点上两路相加直接
  //     越过 0dBFS 被 OfflineAudioContext 削平 —— 波形顶部一削，听感就是「发硬、
  //     发糊、脏」，这才是「死板」的真正来源（不是响度大，是削波失真）；
  //   · 2~4ms 起振没有任何「接触」过程，所以像机器敲，像不着手。
  //
  // M41 的三条铁律（下面每个材质函数都遵守）：
  //   ① **峰值预算**：任何一路的 vol ≤ VOL_CAP，同一时刻所有层相加 ≤ 0.86，
  //      从根上杜绝削波 —— 这是「朴实」的技术前提，不是玄学。
  //   ② **三段包络**：contact（几 ms 的钝起振，给「碰到了」）→ body（主体能量）
  //      → tail（短余韵）。真实材质的余韵各不相同，这一段是材质的听感来源。
  //   ③ **亮度天花板**：瞬态层的带通中心 ≤ 3.2kHz、高通 ≤ 4kHz（除金属刻意保留一点
  //      金属性）。把 5~6kHz 那把刀收回来，声音立刻从「刺耳」变「闷实」。
  //
  // 参数字段（oscHit / noiseBurst 共用）：
  //   vol 峰值 · atk 起振秒 · dur 总长 · contact 接触段秒（>0 时启用三段包络）
  //   body 主体到达比例（contact 段走完时 gain 到 vol 的多少，default 1）
  //   tail 余韵占比（默认 (dur-atk)/dur，即指数衰减自然收）
  var VOL_CAP = 0.42;      // 单路峰值上限：M40 的 1.0 → 0.42
  var SUM_CAP = 0.86;      // 多层同时叠加的总预算，留 1.4dB 余量给后续总线路由

  // 白噪声爆发：source -> biquad filter -> gain envelope -> out
  // M41：加 contact 段（钝起振）与 vol 封顶。
  function noiseBurst(ac, out, t, o) {
    var len = Math.floor(ac.sampleRate * 0.2);
    var b = ac.createBuffer(1, len, ac.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ac.createBufferSource();
    src.buffer = b;
    src.loop = true;
    var f = ac.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.value = o.freq || 1000;
    if (o.q != null) f.Q.value = o.q;
    var vol = Math.min(o.vol == null ? 0.3 : o.vol, VOL_CAP);
    var dur = o.dur || 0.2;
    var atk = o.atk == null ? 0.008 : o.atk;
    var contact = o.contact || 0;              // >0 → 三段包络
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (contact > 0) {
      // 接触段：只走到 body 比例 —— 这一小段就是「碰到」的实感来源
      var knee = Math.max(0.06, vol * (o.body == null ? 0.45 : o.body));
      g.gain.linearRampToValueAtTime(knee, t + contact);
      g.gain.exponentialRampToValueAtTime(vol, t + contact + atk);
    } else {
      g.gain.exponentialRampToValueAtTime(vol, t + atk);
    }
    if (o.wobble) {
      // 火焰的随机起伏：分段随机目标值（都 > 0，exponentialRamp 不能到 0）
      var steps = 6, seg = dur / steps;
      for (var i = 0; i < steps; i++) {
        g.gain.exponentialRampToValueAtTime(
          vol * (0.55 + Math.random() * 0.6), t + atk + seg * (i + 1));
      }
    }
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.05);
    return vol;   // 返回实际峰值，供调用方做叠加预算核算
  }

  // 单振荡器：频率下滑 + 起振衰减包络（M41 加 contact 段）
  function oscHit(ac, out, t, o) {
    var os = ac.createOscillator();
    os.type = o.wave || 'sine';
    os.frequency.setValueAtTime(o.from, t);
    os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || 0.1));
    var vol = Math.min(o.vol == null ? 0.4 : o.vol, VOL_CAP);
    var dur = o.dur || 0.2;
    var atk = o.atk == null ? 0.008 : o.atk;
    var contact = o.contact || 0;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (contact > 0) {
      var knee = Math.max(0.06, vol * (o.body == null ? 0.45 : o.body));
      g.gain.linearRampToValueAtTime(knee, t + contact);
      g.gain.exponentialRampToValueAtTime(vol, t + contact + atk);
    } else {
      g.gain.exponentialRampToValueAtTime(vol, t + atk);
    }
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    os.connect(g); g.connect(out);
    os.start(t); os.stop(t + dur + 0.05);
    return vol;
  }

  // ---- 九种材质（M41 克制的重写）----
  // 改写原则（逐条对应上面的三条铁律）：
  //   ① 瞬态从「亮 click」改成「钝接触」：带通中心一律 ≤ 3.2kHz、Q 值压到 0.7~1.2、
  //      起振走 contact 段（4~9ms 的线性爬升）。原来 6.2kHz / Q=2 那种是金属划玻璃，
  //      打一下耳廓就紧一下 —— 频率一收，声音立刻变「闷实」。
  //   ② 层数从 3~4 层收敛到 2 层为主：瞬态 + 主体。原来的 blast 是 4 层同叠
  //      （瞬态 + 宽带 + 低频 + boom），现在只留「宽带主体 + 低频余韵」两层。
  //   ③ 峰值预算：每路 vol ≤ VOL_CAP(0.42)，两路相加 ≤ 0.86。这条是靠参数写死的，
  //      不是靠调音量的直觉 —— 保证任何一张卡、任何力度都不会削波。
  //
  // 「朴实」的关键不是把声音做小，而是**去掉没用的东西**：多余的高频、多余的层、
  // 多余的余韵。剩下的中低频 + 一点材质感的余韵，就是听起来「实实在在」的打击。
  // 每个材质的辨识度改由**余韵 + 主体频段**承担，不再靠「更亮更尖」区分 ——
  // 9 种材质依然一听能分辨，但都不刺耳了。
  function blunt(ac, out, t) {
    // 钝击/拳：闷实的「噗」。接触段给一点点木质中频，主体是低频，
    // 余韵短促干脆 —— 不像 M38 那样中频「啪」+ 低频「砰」两层硬撞。
    oscHit(ac, out, t, { from: 200, to: 72, glide: 0.08, vol: 0.42, atk: 0.006,
      dur: 0.13, contact: 0.005, body: 0.5 });
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 900, q: 0.7, vol: 0.26,
      atk: 0.004, dur: 0.07, contact: 0.004, body: 0.5 });
  }
  function hammer(ac, out, t) {
    // 重锤：比钝击更低、更长，但**收得更快**。M38 的 dur 0.36 会让连续挥锤糊成
    // 一片低频轰鸣；这里压到 0.24，加上 0.012 的 contact 让「铁落下」的实感出来。
    oscHit(ac, out, t, { from: 150, to: 44, glide: 0.16, vol: 0.42, atk: 0.01,
      dur: 0.24, contact: 0.012, body: 0.55 });
    noiseBurst(ac, out, t, { type: 'lowpass', freq: 420, vol: 0.22, atk: 0.005,
      dur: 0.12, contact: 0.008, body: 0.5 });
  }
  function metal(ac, out, t) {
    // 金属敲击：**唯一**保留一点金属性的材质，但亮度从 6kHz 收回到 2.8~3.2kHz，
    // 泛音从 4 个减到 3 个、幅度从 0.5 降到 0.16 —— 金属感靠「音高不谐和」，
    // 不靠「够亮」。够亮只会变成刺耳的铃。
    var fs = [2350, 3420, 5170];
    var vols = [0.16, 0.11, 0.07];
    fs.forEach(function (f, i) {
      var os = ac.createOscillator();
      os.type = 'sine';
      os.frequency.value = f;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vols[i] * 0.4, t + 0.004);
      g.gain.exponentialRampToValueAtTime(vols[i], t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2 - i * 0.05);
      os.connect(g); g.connect(out);
      os.start(t); os.stop(t + 0.24);
    });
    // 主体是钝接触（中频一点金属撞击感），不是高频 click
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 1600, q: 1.1, vol: 0.24,
      atk: 0.004, dur: 0.06, contact: 0.004, body: 0.5 });
  }
  function pick(ac, out, t) {
    // 凿/石：整组里最响的原来是 pick（瞬态 vol 0.9 @6.2kHz），是「刺耳」的主要来源。
    // 现在主体是**清脆但收敛**的中高频 —— 凿石的颗粒感来自 2.6kHz 的窄带，
    // 瞬态改成 0.006 的钝接触，音量回落到 0.34。
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 2600, q: 1.4, vol: 0.34,
      atk: 0.003, dur: 0.045, contact: 0.006, body: 0.5 });
    oscHit(ac, out, t, { wave: 'triangle', from: 1900, to: 760, glide: 0.035,
      vol: 0.2, atk: 0.004, dur: 0.055, contact: 0.004, body: 0.5 });
  }
  function drill(ac, out, t) {
    // 钻探：持续感保留（这是材质辨识的核心），但脉冲密度与音量都收一收，
    // 免得像在耳边开电钻。10 下 → 7 下，脉冲 vol 0.22 → 0.14。
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 820, q: 0.6, vol: 0.3,
      atk: 0.006, dur: 0.36 });
    for (var i = 0; i < 7; i++) {
      var tt = t + i * 0.052;
      oscHit(ac, out, tt, { wave: 'square', from: 125, to: 125, glide: 0.05,
        vol: 0.14, atk: 0.005, dur: 0.03 });
    }
  }
  function blast(ac, out, t) {
    // 爆破：M38 是 4 层同叠（瞬态 0.7 + 宽带 0.9 + 低频 boom 1.0）—— 必然削波。
    // 现在合并成 **宽带主体 + 低频余韵** 两层。低频从 1.0/0.55s 降到 0.4/0.34s，
    // 不再盖住整场；爆裂感靠主体的高频滚降，不再靠一记「啪」。
    noiseBurst(ac, out, t, { type: 'lowpass', freq: 1800, vol: 0.42, atk: 0.006,
      dur: 0.28, contact: 0.008, body: 0.6 });
    oscHit(ac, out, t, { from: 110, to: 38, glide: 0.24, vol: 0.4, atk: 0.012,
      dur: 0.34, contact: 0.014, body: 0.55 });
  }
  function blade(ac, out, t) {
    // 刀刃：破空感保留，但「嘶」收进中频。原 sawtooth 6800→2300 是最亮的
    // 一路（连爪击在内，属于刺耳来源）；现在改为 2.6→1.1kHz 的中频摩擦，
    // 音量 0.75 → 0.28，听感从「划玻璃」变「切开」。
    noiseBurst(ac, out, t, { type: 'highpass', freq: 2200, vol: 0.24, atk: 0.005,
      dur: 0.1, contact: 0.006, body: 0.5 });
    oscHit(ac, out, t, { wave: 'sawtooth', from: 2600, to: 1100, glide: 0.07,
      vol: 0.18, atk: 0.005, dur: 0.1, contact: 0.005, body: 0.5 });
  }
  function flame(ac, out, t) {
    // 火焰：两层「轰」保留（这是辨识度），但都收低、随机起伏幅度收窄
    // （原来 ±0.6 太「躁」，现在 ±0.35 更平和）。
    noiseBurst(ac, out, t, { type: 'lowpass', freq: 620, vol: 0.26, atk: 0.006,
      dur: 0.3 });
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 1050, q: 0.5, vol: 0.3,
      atk: 0.008, dur: 0.28, wobble: true });
  }
  function claw(ac, out, t) {
    // 爪击/撕咬：撕裂感来自中频的粗糙，不是高频。原瞬态 2.4kHz/0.75 收到
    // 1.6kHz/0.3，主体 1.4kHz/0.6 收到 1.1kHz/0.26 —— 听着像抓挠而非刮擦。
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 1600, q: 0.9, vol: 0.3,
      atk: 0.004, dur: 0.05, contact: 0.005, body: 0.5 });
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 1100, q: 0.7, vol: 0.26,
      atk: 0.005, dur: 0.11, contact: 0.005, body: 0.5 });
  }

  var IMPACTS = {
    blunt: blunt, hammer: hammer, metal: metal, pick: pick, drill: drill,
    blast: blast, blade: blade, flame: flame, claw: claw,
  };

  // ---- 语义层（M40）：6 种「卡片特质」的叠加声部 ----
  // 分工要划清：**材质层负责「打的是什么」**（瞬态辨识度，玩家靠它认牌），
  // **语义层负责「这张卡在做什么」**（加的是信息量，不是音量）。
  // 所以语义层一律：短、轻（vol ≤ 0.3 量级）、比材质晚 15~30ms 起 ——
  // 先让材质的瞬态立住，再让语义层交代机制。反过来的话，两层会糊成一团，
  // 玩家只听到「响了」但认不出是哪张牌。
  //
  // 另外两个特质**不是音色层**，别在这儿找：
  //   multi（连击）—— 把材质层按 times 重复 N 次、逐次升调（见 plan 的 reps）
  //   wide （横扫）—— 声像扫地，是空间参数（见 plan 的 wide 附加声部）
  function traitBleed(ac, out, t) {
    // 卖血 / 献祭：两声低沉心跳 + 一点湿润的中频。语义是「付出代价」，所以往低频走、不发亮。
    // M41：全部对齐新的 VOL_CAP 与接触段包络 —— 语义层是叠在材质之上的，
    // 必须比材质更轻、更钝，否则又变回「两层糊在一起」。
    oscHit(ac, out, t, { from: 92, to: 48, glide: 0.06, vol: 0.30, atk: 0.007, dur: 0.13, contact: 0.008, body: 0.5 });
    oscHit(ac, out, t + 0.12, { from: 76, to: 40, glide: 0.07, vol: 0.22, atk: 0.009, dur: 0.15, contact: 0.01, body: 0.5 });
    noiseBurst(ac, out, t + 0.01, { type: 'bandpass', freq: 320, q: 1.2, vol: 0.14, atk: 0.005, dur: 0.055, contact: 0.006, body: 0.5 });
  }
  function traitToxin(ac, out, t) {
    // 生化 / 毒：上滑正弦（气泡）+ 低速起伏的带通噪声（黏稠）。起伏是关键 —— 毒不是一击，是持续。
    oscHit(ac, out, t, { wave: 'sine', from: 210, to: 480, glide: 0.09, vol: 0.18, atk: 0.02, dur: 0.12, contact: 0.014, body: 0.5 });
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 660, q: 2.2, vol: 0.19, atk: 0.03, dur: 0.26, wobble: true });
  }
  function traitEmber(ac, out, t) {
    // 燃烧：噼啪是一**串**随机短脉冲，不是一声。随机时刻是刻意的 —— 固定间隔会听成机械音。
    // M41：脉冲数 6 → 5、vol 0.26 → 0.16、中心频 3.2~5.4k → 2.0~3.2k（收进中频，不再刺）。
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 1500, q: 0.8, vol: 0.18, atk: 0.006, dur: 0.17 });
    for (var i = 0; i < 5; i++) {
      noiseBurst(ac, out, t + 0.02 + Math.random() * 0.22, {
        type: 'bandpass', freq: 2000 + Math.random() * 1200, q: 2.6,
        vol: 0.16, atk: 0.002, dur: 0.014, contact: 0.003, body: 0.5,
      });
    }
  }
  function traitGuard(ac, out, t) {
    // 攻防一体：余韵上滑（「护住」的听感）。上滑 = 收束，下滑 = 释放 ——
    // 这是格挡与打击的分界，两者用同一个材质时全靠它区分。
    oscHit(ac, out, t, { wave: 'triangle', from: 760, to: 1240, glide: 0.12, vol: 0.17, atk: 0.012, dur: 0.26, contact: 0.01, body: 0.5 });
    noiseBurst(ac, out, t, { type: 'bandpass', freq: 2000, q: 1.5, vol: 0.16, atk: 0.007, dur: 0.1, contact: 0.006, body: 0.5 });
  }
  function traitSwift(ac, out, t) {
    // 轻快 / 抽牌：清脆点缀，收得极快（顺手的牌不该占着耳朵）。
    // M41：3.2kHz → 2.4kHz，高通 7.2k → 4.4k，音量再收一点 —— 抽牌声是最常反复触发的，
    // 一点点刺耳都会被感知成「吵」。
    oscHit(ac, out, t, { wave: 'sine', from: 2400, to: 1800, glide: 0.05, vol: 0.15, atk: 0.004, dur: 0.075, contact: 0.004, body: 0.5 });
    noiseBurst(ac, out, t, { type: 'highpass', freq: 4400, vol: 0.13, atk: 0.003, dur: 0.04, contact: 0.004, body: 0.5 });
  }

  var TRAITS = {
    bleed: traitBleed, toxin: traitToxin, ember: traitEmber,
    guard: traitGuard, swift: traitSwift,
  };

  // 合成体总表：材质层与语义层共用**同一套**渲染 / 缓存 / 元素池机制，差别只在键名。
  // 语义层加 'trait:' 前缀 —— 一是避免与材质重名，二是在诊断/元素池里一眼看得出这是哪一层。
  var SYNTH = {};
  Object.keys(IMPACTS).forEach(function (k) { SYNTH[k] = IMPACTS[k]; });
  Object.keys(TRAITS).forEach(function (k) { SYNTH['trait:' + k] = TRAITS[k]; });

  // 渲染时长按层给：材质最长 0.7s（blast 的轰鸣 0.5s + 余量），
  // 语义层最长 0.3s 就够 —— 少占 40% 的 WAV 体积（Path B 每个键要编码成 blob，别浪费）。
  function durOf(key) { return key.indexOf('trait:') === 0 ? 0.45 : DUR; }

  // 是否具备「离线渲染 + HTML5 播放」条件（Path B 的保底通道）
  function canWav() {
    return !!(window.OfflineAudioContext || window.webkitOfflineAudioContext) &&
           !!(window.Blob) && !!(window.URL && window.URL.createObjectURL);
  }

  // ---- 总线软限幅（M41 · 让 SUM_CAP 真正生效）----
  // 光给每一路封顶（VOL_CAP）**不够**：两层在同一采样点相加就会冲破单路上限
  // —— 实测 blast 两层各 0.42/0.40，合成后峰值 0.5196；blunt 0.42+0.26 → 0.4688。
  // 「每路都合法」≠「总和合法」，这正是 M38 削波的真正机制，也是我第一版 M41
  // 犯的同一个错（把 SUM_CAP 写在注释里却没有代码执行它）。
  //
  // 正解是在渲染出口挂一个**软限幅**：tanh 型传递函数在 SUM_CAP 以内完全线性
  // （不影响音色），超过后平滑饱和而不是像硬削波那样把波顶削平。硬削波 = 削波失真
  // = 「死板发硬」；软限幅 = 顶到天花板后自然收住，听感上是「闷住」而不是「炸」。
  //
  // ⚠️ drive 必须 = 1.0：tanh(x*k)/tanh(k) 在小信号区的斜率是 k/tanh(k)，k>1 时
  // **恒大于 1** —— 也就是说限幅器会把阈值以内的信号**放大**。实测踩过这个坑：
  // drive=ceiling*1.6(=1.38) 时 blunt 峰值从 0.469 升到 0.612、blast 从 0.520 升到
  // 0.696 —— 越「克制」越响，正好搞反。drive=1 时斜率恰为 1，SUM_CAP 以内
  // 逐样本不变，超出才平滑收肩，「克制」才是可测量的而不是靠耳朵猜。
  function limiter(ac, dest, ceiling) {
    var ws = ac.createWaveShaper();
    var n = 2048;
    var curve = new Float32Array(n);
    var k = 1.0;                     // 阈值前严格线性
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1; // -1..1
      // 输入先按 ceiling 归一化到 ±1 的「满刻度」域，输出再映射回 ceiling。
      // 这样 ceiling 就是**真实的天花板**（不是靠 k 猜出来的软 knee）。
      var y = x * ceiling;
      curve[i] = Math.tanh(y * k) / Math.tanh(ceiling * k);
    }
    ws.curve = curve;
    ws.oversample = '4x';           // 4x 过采样：软限幅本身不制造新的高频失真
    ws.connect(dest);
    return ws;
  }

  // 离线渲染某个合成体（材质层 / 语义层共用）→ { buffer, url }
  //   buffer 供 Path A 直接播（零解码、零元素）
  //   url    供 Path B 挂 <audio>（只在平铺通道生成，省掉一次 WAV 编码与内存）
  // 键既可以是材质（blunt…）也可以是语义层（trait:bleed…），都从 SYNTH 取合成函数。
  function renderImpact(impact) {
    if (prep[impact]) return prep[impact];
    prep[impact] = new Promise(function (resolve) {
      try {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return resolve(null);
        var dur = durOf(impact);
        var oac = new OAC(1, Math.ceil(dur * SR), SR);
        // out → 软限幅 → destination：任何材质内部的多层叠加都在这里被兜住，
        // 渲染出的 buffer 峰值恒 ≤ SUM_CAP。M40 及以前没有这一级，
        // 所以 blast / hammer 这类多层材质会真的削波。
        var out = limiter(oac, oac.destination, SUM_CAP);
        (SYNTH[impact] || blunt)(oac, out, 0.02);
        // 同 prepFallback：startRendering 的 Promise 与 oncomplete 会各回调一次。
        // 这里不设闸门更贵 —— 会 createObjectURL 两次，前一个 blob URL 永远没人 revoke，
        // 每个材质漏一份 ~90KB 的 WAV（9 个材质 × 2 次渲染路径）。
        var settled = false;
        var done = function (buf) {
          if (settled) return;
          settled = true;
          var res = { buffer: buf, url: null };
          try {
            if (pathOf() !== 'spatial' && window.Blob && window.URL && URL.createObjectURL) {
              res.url = URL.createObjectURL(encodeWav(buf.getChannelData(0), SR));
              urlCache[impact] = res.url;   // 缓存：ensureEl / 首触解锁要同步拿到 src
            }
          } catch (e) {}
          resolve(res);
        };
        oac.oncomplete = function (e) { done(e.renderedBuffer); };
        var p = oac.startRendering();
        if (p && p.then) p.then(done, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
    return prep[impact];
  }
  function renderWav(impact) {   // 兼容旧名（探针 / 外部引用）
    return renderImpact(impact).then(function (r) { return r && r.url; });
  }

  // 建某材质的元素池（Path B 懒建；src 优先用已渲染好的 urlCache 同步挂上）
  function ensureEl(impact) {
    if (els[impact]) return els[impact];
    var pool = [];
    for (var i = 0; i < POOL; i++) {
      var a = document.createElement('audio');
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.volume = muted ? 0 : 1;
      if (urlCache[impact]) a.src = urlCache[impact];   // 已渲染好：同步挂 src
      document.body.appendChild(a);
      pool.push(a);
    }
    els[impact] = pool;
    ptr[impact] = 0;
    if (!urlCache[impact]) {
      renderImpact(impact).then(function (r) {
        if (r && r.url) pool.forEach(function (a) { a.src = r.url; });
      });
    }
    return pool;
  }

  // ---- 舞台几何 → 声源坐标（2D → 空间化的**唯一**映射点）----
  // 玩家恒在左（−0.55），敌人按队列摊到右侧；后排更远、更闷。
  // ⚠️ 竖井的「深度」不在这里 —— 它是全局参数（混响时长 / 音色明暗），不是单个声源的
  // 位置。把深度塞进每条声音的距离里，只会让整场都闷且分不出前后。
  //
  // 遮挡用**前排挡后排**（2D 里唯一有物理意义的遮挡模型）：n 只怪排成一列时，
  // 最前面那只无遮挡，往后逐级加低通。它和距离衰减是互补的 —— 距离管「空气吃掉多少」，
  // 遮挡管「视线被挡住多少」，两个都做才不会「后排只是小声了、但还是亮得刺耳」。
  function stagePos(o) {
    o = o || {};
    var O = OCCL();
    var n = Math.max(1, o.count || 1);
    var i = Math.min(Math.max(o.index || 0, 0), n - 1);
    var x, dist, occl = 0;
    if (o.side === 'left') { x = -0.55; dist = 0.0; }
    else if (n === 1) { x = 0.55; dist = 0.12; }
    else {
      var k = i / (n - 1);
      x = 0.22 + k * 0.78;
      dist = 0.10 + k * 0.34;
      occl = k * 0.5;                 // 被前排挡住：最多一半遮挡
    }
    // 显式状态可以覆盖（格挡 = 被墙挡 / 隐身 = 隔得更远更闷）——
    // 目前没有隐身机制，但参数留在这儿，将来加迷雾类 debuff 不用改音频层。
    if (o.blocked) occl = Math.max(occl, O.BLOCKED);
    if (o.hidden) occl = Math.max(occl, O.HIDDEN);
    return { x: x, dist: dist, occl: occl, side: o.side === 'left' ? 'left' : 'right', index: i, count: n };
  }

  // ---- 播放计划（M40）：把「材质 + 特质 + 力度」编译成一串**要响的东西** ----
  // 纯计算、不出声 —— 所以可断言（tests/ui-probe-audio.js 的 plan* 一组断言就打在它上面）。
  function lerp(a, b, k) { return a + (b - a) * k; }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  var JIT = 0.06;   // 每次播放的速率抖动幅度（±3%）
  // 「不能每次都一模一样」是打击感的命根子：同一张牌连打五次、音高完全一致，
  // 会听成采样器卡带。抖动**只加在 rate 上、不加在 vol 上** —— 音量参与空间衰减计算，
  // 一动就把诊断读数变成随机数（探针的 sfxGainBackRow 正是这么被钉住的）。
  function jitter() { return 1 + (Math.random() - 0.5) * JIT; }

  // 力度 → 速率：越重越慢越低（重击 0.93 / 轻击 1.06）。
  // 用**速率**而不是音量表达轻重，是因为速率同时改变音高与时长 ——
  // 一次拿下「更沉」和「更长」两个听感维度；只调音量只会让人以为是「远处的同一拳」。
  function rateOf(w) { return lerp(1.06, 0.93, w); }

  function plan(mat, o) {
    var legacy = !(o.traits || o.weight != null);
    var w = clamp01(o.weight == null ? 0 : o.weight);
    var traits = (typeof SfxProfile !== 'undefined' && SfxProfile)
      ? SfxProfile.merge(o.traits)
      : (o.traits || []);
    // 连击上限 4 下：卡池实测最多 3 段（连环凿 / 凿岩机 / 火碎雨 / 抗体风暴），
    // 留 1 下余量；再多就成噪音墙，也会白撞语音预算。
    var reps = (traits.indexOf('multi') >= 0) ? Math.max(2, Math.min(o.times || 3, 4)) : 1;
    var rate = rateOf(w);
    var shots = [];

    // ① 材质层：「打的是什么」。没有画像时它是**唯一**的一层，参数全为 null ——
    //    这样旧调用方的行为逐字节不变（rate / vol / delay 一个都不往 mw 里传）。
    for (var i = 0; i < reps; i++) {
      shots.push({
        key: mat, role: i === 0 ? mat : 'mat',
        delay: legacy ? null : i * 0.055,
        rate: legacy ? null : rate * (1 + i * 0.06),        // 逐下升调：三下才听得出是三下
        vol: legacy ? null : lerp(0.86, 1, w) * (i ? 0.82 : 1),  // 后续几下轻一点（自然）
        send: null, prio: 0,
      });
    }

    // ② 语义层：「这张卡在做什么」。晚 15~30ms 起 —— 先让材质瞬态立住，再交代机制。
    traits.forEach(function (t) {
      if (t === 'multi' || t === 'wide') return;   // 这两个不是音色层
      shots.push({
        key: 'trait:' + t, role: t,
        delay: t === 'bleed' ? 0.015 : 0.03,
        // M41：0.72 → 0.5。材质层峰值已从 1.0 收敛到 0.42，语义层若还按 0.72 的
        // 相对增益走，就会**盖过材质**——而材质才是「打的是什么」的身份信息。
        // 语义层是点缀：晚起、更轻、更短退场，让玩家先听见材质、再听见机制。
        rate: 1, vol: 0.5,
        send: t === 'guard' ? 1.6 : 1,   // 攻防一体更「包」：多送一点混响
        prio: 0.5,                        // 先被抢占 —— 材质是身份，语义是点缀
      });
    });

    // ③ 横扫（群体）：补一声**镜像**的材质层。声像从一侧跳到另一侧，
    //    听起来是「一下扫过整排」，而不是「同一个音打了一堆怪」。
    if (traits.indexOf('wide') >= 0) {
      shots.push({ key: mat, role: 'wide', delay: 0.055, rate: rate * 0.98,
        vol: 0.7, send: null, prio: 0.5, mirror: true });
    }

    return { mat: mat, legacy: legacy, weight: w, traits: traits,
      // M41：把真实伤害透出到诊断层。weight 是从 dmg 推出来的**结果**，
      // 单看 weight 分不清「6 伤的轻击」和「估算出来的轻击」——带上 dmg 才
      // 能判断这个力度是真值（act.dmg）还是 SfxProfile 的估算值。
      dmg: (typeof o.dmg === 'number' && isFinite(o.dmg)) ? o.dmg : null,
      estimated: !(typeof o.dmg === 'number' && isFinite(o.dmg)),
      reps: reps, rate: rate, wide: traits.indexOf('wide') >= 0, shots: shots };
  }

  var lastPlan = null;   // 诊断用：最近一次派发计划（探针与试听台读它）

  // 一个声部的空间化派发（Path A）。shot 里为 null 的参数一律**不传**，走 mw 默认 ——
  // 这是「旧调用方行为不变」的技术保证。
  function spatialOpts(shot, base) {
    var o = { x: base.x, dist: base.dist, occl: base.occl, prio: base.prio, bus: base.bus, name: base.name };
    if (shot.rate != null) o.rate = shot.rate * jitter();
    if (shot.vol != null) o.vol = shot.vol;
    if (shot.delay != null) o.delay = 0.005 + shot.delay;
    if (shot.send != null) o.send = shot.send;
    if (shot.prio) o.prio = (base.prio == null ? 2 : base.prio) + shot.prio;
    if (shot.mirror && base.x != null) o.x = -base.x * 0.9;
    return o;
  }

  function fireSpatial(m, shot, base) {
    var hit = prep[shot.key] && prep[shot.key].__res;
    if (!(hit && hit.buffer)) {
      // 还没渲染好（首帧常见）：异步补一次，补完直接播 —— 不丢这一声
      renderImpact(shot.key).then(function (r) {
        if (!r || muted) return;
        prep[shot.key].__res = r;
        try { m.playBuffer(r.buffer, spatialOpts(shot, base)); } catch (e) {}
      });
      return false;
    }
    return m.playBuffer(hit.buffer, spatialOpts(shot, base));
  }

  // 一个声部的元素池派发（Path B）。playbackRate 是这条通道唯一的「力度 / 音高」手段。
  function fireElement(shot, base) {
    if (!canWav()) return;
    var pool = ensureEl(shot.key);
    var a = pool[ptr[shot.key]++ % POOL];
    var d = (shot.delay || 0) * 1000;
    var go = function () {
      if (muted) return;
      try {
        a.muted = false;   // 清掉首触解锁可能残留的 muted，确保真出声
        a.currentTime = 0;
        if (shot.rate != null && 'playbackRate' in a) a.playbackRate = shot.rate * jitter();
        var p = a.play();
        if (p && p['catch']) p['catch'](function () {});
      } catch (e) { /* 播不了静默，绝不能让战斗页面崩 */ }
    };
    if (!a.src) {
      renderImpact(shot.key).then(function (r) {
        if (!r || !r.url) return;
        a.src = r.url;
        if (d > 0) setTimeout(go, d); else go();
      });
      return;
    }
    if (d > 0) setTimeout(go, d); else go();
  }

  // opts: { x, dist, occl, prio, vol, rate, bus }  —— 不传就是「正前方干声」
  // M40 追加：{ traits, weight, times } —— 卡片特质 / 力度 / 本次命中几个目标。
  // **三个都不传 = 旧行为**（单层干声、无抖动），既有调用方与断言一个数字都不变。
  function play(impact, opts) {
    opts = opts || {};
    var name = IMPACTS[impact] ? impact : 'blunt';
    if (muted) return false;
    var p = plan(name, opts);
    lastPlan = p;

    if (pathOf() === 'spatial') {
      // Path A：直接播 AudioBuffer，走声像 / 距离 / 遮挡 / 混响全链路
      var m = mw();
      if (!m) return false;
      var any = false;
      for (var i = 0; i < p.shots.length; i++) {
        if (fireSpatial(m, p.shots[i], opts)) any = true;
      }
      return any;
    }

    // Path B：<audio> 元素池（无空间化，iOS 老环境保底）
    if (canWav()) {
      for (var j = 0; j < p.shots.length; j++) fireElement(p.shots[j], opts);
      return true;
    }

    // 兜底：老浏览器无 OfflineAudioContext → 退实时 Web Audio 合成
    var ac = ensureCtx();
    if (!ac || !master) return false;
    resume(ac);
    try {
      p.shots.forEach(function (s) {
        var fn = SYNTH[s.key] || SYNTH[name];
        if (!fn) return;
        var d = (s.delay || 0) * 1000;
        if (d > 0) setTimeout(function () { try { fn(ac, master, ac.currentTime); } catch (e) {} }, d);
        else fn(ac, master, ac.currentTime);
      });
    } catch (e) { return false; }
    return true;
  }

  // ---- 音乐提示音（转发给中间件的合成 Stinger）----
  function stinger(name) {
    var m = mw();
    if (!m || !m.stinger) return false;
    try { return m.stinger(name); } catch (e) { return false; }
  }

  function setMuted(m2) {
    muted = !!m2;
    // M58 P1：自己的开关自己持久化（td-sfx-muted），与音乐分控互不牵连
    try { window.localStorage.setItem('td-sfx-muted', muted ? '1' : '0'); } catch (e) {}
    var vol = muted ? 0 : 1;
    Object.keys(els).forEach(function (k) {
      els[k].forEach(function (a) { try { a.volume = vol; } catch (e) {} });
    });
    if (master) {
      try { master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.02); } catch (e) {}
    }
    // M58 P1：不再转发 TDAudio.setMuted —— 那是音乐总线的开关，
    // 音效静音管不到音乐（分控边界）。
  }

  // ---- 实时 Web Audio 兜底通道（仅老浏览器走这里）----
  var ctx = null, master = null;
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; master = null; }
    return ctx;
  }
  function resume(ac) {
    if (!ac || ac.state === 'running') return;
    if (ac.resume) {
      var p = ac.resume();
      if (p && p['catch']) p['catch'](function () {});
    }
  }

  // 预渲染全部合成体（9 材质 + 5 语义层 = 14 个键），页面加载即备好，首次出牌无需等渲染。
  // ⚠️ 预渲染**不影响** Path B 的元素计数：renderImpact 只在平铺通道里编码 blob URL，
  // 元素（<audio>）仍由 ensureEl 懒建 —— 所以这里多渲染几个键，不会动到
  // 探针的 blob/elem 计数断言。
  if (window.OfflineAudioContext || window.webkitOfflineAudioContext) {
    Object.keys(SYNTH).forEach(function (k) {
      renderImpact(k).then(function (r) { if (r) prep[k].__res = r; });
    });
  }

  // ---- 移动端首触解锁（M36c）----
  // iOS 的媒体自动播放限制是「元素级」的：每个 <audio> 的首次 play() 都必须发生在
  // 用户手势里。Bgm 的 unlock 只解锁了它自己的三首 BGM 元素，管不到 Sfx 的材质池。
  // ⚠️ 只有 Path B 才有元素池要解锁 —— Path A 播的是 AudioBuffer，不受元素级限制。
  function prime(a) {
    if (!a || !a.src) return;
    try {
      // 用 muted 硬静音，不用 volume=0：volume 只是音量计算，`pause()` 与音量恢复
      // 之间的异步竞态会让真实音效漏出声（M36c「一开始一股脑」的根源）；muted 是
      // 硬件级静音，竞态再乱也发不出声。
      a.muted = true;
      var back = function () {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
        a.muted = false;
      };
      var p = a.play();
      if (p && p.then) p.then(back, back);
      else setTimeout(back, 60);
    } catch (e) {}
  }

  function unlock() {
    try {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchend', unlock);
    } catch (e) {}
    if (pathOf() === 'spatial') return;   // Path A 无需元素解锁
    // ⚠️ 只解锁**材质层**，语义层（trait:*）刻意不在这里解锁：那会把移动端的
    // 元素池从 9×3 涨到 14×3，为一个「点缀层」多押 15 个元素不划算（内存预算）。
    // 语义层在首次真正用到时懒建 + 懒解锁 —— 那时也早过了用户手势。
    Object.keys(IMPACTS).forEach(function (k) {
      var pool = ensureEl(k);
      if (pool[0].src) {
        pool.forEach(prime);
      } else {
        renderImpact(k).then(function () { pool.forEach(prime); });
      }
    });
  }

  try {
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('touchend', unlock);   // 老 iOS 没有 pointerdown，touchend 兜底
  } catch (e) {}

  return {
    play: play,
    stagePos: stagePos,
    stinger: stinger,
    eventPath: function (impact) { return EVENT_PATH[impact] || EVENT_PATH.blunt; },
    eventPaths: function () { return EVENT_PATH; },
    path: pathOf,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    // M40：把「分层逻辑」本身暴露出来 —— 它是纯计算，探针可以直接断言
    // 「连击是不是真的排了 3 个材质声部」「卖血牌是不是真的多了一层」，
    // 而不必去猜音频有没有响对（声音听不见，结构看得见）。
    plan: plan,
    last: function () { return lastPlan; },
    synthKeys: function () { return Object.keys(SYNTH); },
    traitNames: function () { return Object.keys(TRAITS); },
    // M41：合成函数表只读导出，供 tests/sfx-audit.js 在真浏览器里渲染同一批音色
    // 实测峰值 / 削波 / 亮度。这是**只读句柄**，游戏逻辑不依赖它；
    // 不导出就没法离线量波形（Node 里没有 WebAudio），而「有没有削波」恰恰是
    // 「克制」能不能落地唯一可验证的标准。
    __synth: function () { return SYNTH; },
    // M41：体检专用 —— 走**真实渲染路径**（含软限幅）导出一个可测的 Float32 通道。
    // sfx-audit.js 用它量峰值/削波；直调 __synth() 会绕过限幅器，量出来的数不对。
    __renderRaw: function (key) {
      return renderImpact(key).then(function (r) {
        return (r && r.buffer) ? r.buffer.getChannelData(0) : null;
      });
    },
    // 探针用：合成体是否都已渲染好（Path A 的语音就绪度）
    ready: function () {
      var n = 0;
      var ks = Object.keys(SYNTH);
      ks.forEach(function (k) { if (prep[k] && prep[k].__res) n++; });
      return { rendered: n, total: ks.length };
    },
  };
})();
