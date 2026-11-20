// 竖井 · 自适应空间音频中间件（TD-AAS，M39）
// ===========================================================================
// 把「音效 / 音乐各自播各自的」升级成一套带**混音总线 + 空间化 + 程序化混响 +
// 自适应参数 + 语音预算**的游戏音频中间件 —— 相当于在浏览器里手搓一套 FMOD。
//
// 为什么值得手搓：竖井是纯前端（无打包、无 node_modules、要跑 iOS 浏览器），
// 引不进 FMOD / Wwise 这类原生中间件；浏览器原生只有两个原语 —— 裸 AudioContext
// 和 HTML5 <audio> —— 事件表、总线、参数、空间化、预算全都得自己搭。
//
// ---------------------------------------------------------------------------
// 【关键突破】把 iOS 的 Web Audio 通道夺回来
// ---------------------------------------------------------------------------
// M34c 实测的结论是：iOS 上 Web Audio 会被**硬件静音键**掐掉，只有 HTML5 <audio>
// （媒体通道）不受影响。于是整个项目退到 <audio> 主路径，代价是**做不了空间音频**
// —— <audio> 元素没有声像/距离控制。
//
// 2026 年这个结已经解开：Safari 16.4+ / iOS 17+ 实现了 W3C Audio Session API：
//     navigator.audioSession.type = 'playback'
// 把本页音频显式声明成「媒体播放」，Web Audio 就与 <audio> 同级，不再受静音键影响。
// 所以本文件按能力探针走**双通道**：
//   Path A（spatial）：Web Audio 全链路 —— 总线 / 声像 / 距离 / 混响 / 参数化音乐
//   Path B（flat）   ：HTML5 <audio> 元素池 —— 无空间化，但一定是「能响」的保底
//
// ⚠️ iOS 且拿不到 audioSession 时必须留在 Path B：那种环境下把音频塞进 Web Audio
// 会把「本来能响」的通道一起拖成静音，是纯粹的倒退。判定见 caps.reason。
//
// ---------------------------------------------------------------------------
// 【2D 游戏怎么做「空间音频」】—— 不装，把映射关系说清楚
// ---------------------------------------------------------------------------
// 竖井是 2D DOM 卡牌游戏，没有 3D 世界坐标，「空间」是**由舞台语义映射**出来的：
//   横向 x（屏幕左→右）        → 声像 pan（玩家在左 −，敌人在右 +）
//   纵深 z（队列前后 + 竖井深度）→ 距离衰减 + 高频滚降（越远、越深越闷）
//   遮挡 occlusion            → **语义遮挡**：声源处于「被格挡 / 隐身」时给该声源
//                                加低通，不是几何射线遮挡（2D 没有可投射的几何体）
//   竖井深度 D1→D33           → 全局「井筒共鸣」参数：越深，混响越长、低频越厚
// 这套映射的价值在于：**玩家能听出谁在打谁、打的是哪一只、以及「现在有多深」**，
// 而不是假装这个游戏有 3D 声场。
//
// ---------------------------------------------------------------------------
// 事件命名规范（FMOD 风格）—— 见 EVENT_PATH，代码里不许出现裸资源路径
// ---------------------------------------------------------------------------
//   event:/SFX/Card/{Strike|Crowbar|...}   卡牌打击（9 种材质）
//   event:/Music/Combat/{Battle|Boss}      战斗 / Boss 曲
//   event:/Music/Map/Explore               大地图曲
//   event:/Stinger/{Encounter|LowHP|Kill|BossReveal}
//   event:/UI/Button_Click
// ===========================================================================

var TDAudio = (function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // 平滑阶跃：用来把「参数越线」变成「渐入」，避免参数一过阈值就硬切
  function sstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  // 调试/探针用的一次性通道开关：index.html#audio=flat 强制走平铺通道，
  // 这样 Path B（iOS 老环境保底）也能被自动化测试覆盖到。
  var FORCED = (function () {
    var m = /(?:^|[#&?])audio=(flat|spatial)\b/.exec((location.hash || '') + '&' + (location.search || ''));
    return m ? m[1] : null;
  })();

  // =========================================================================
  // 1. 能力探针（通道判定的唯一来源）
  // =========================================================================
  var caps = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 夺回静音键：声明成「媒体播放」会话。不做兼容判定的属性赋值本身就是安全的
    // （不支持的浏览器上 navigator.audioSession 是 undefined，直接跳过）。
    var session = null;
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
        session = navigator.audioSession.type || 'playback';
      }
    } catch (e) { session = null; }

    var spatialCapable = !!AC && !!OAC;
    if (isIOS && !session) spatialCapable = false;   // ← 见文件头「关键突破」的警告

    var path = FORCED === 'flat' ? 'flat'
             : FORCED === 'spatial' ? (spatialCapable ? 'spatial' : 'flat')
             : (spatialCapable ? 'spatial' : 'flat');

    return {
      audioContext: !!AC,
      offline: !!OAC,
      audioSession: !!session,
      sessionType: session || 'unavailable',
      isIOS: isIOS,
      blob: !!(window.Blob && window.URL && URL.createObjectURL),
      spatialCapable: spatialCapable,
      forced: FORCED,
      path: path,
      reason: !spatialCapable
        ? (isIOS ? 'iOS 无 AudioSession —— 静音键会掐掉 Web Audio，留在 <audio> 通道'
                 : '无 AudioContext / OfflineAudioContext')
        : (session ? 'audioSession=playback（静音键免疫）' : '非 iOS，无需会话声明'),
    };
  })();

  // =========================================================================
  // 2. 性能档位 —— 语音预算的载体
  // =========================================================================
  var TIER = {
    desktop: { voices: 32, irScale: 1.00, pulse: true, label: '桌面' },
    mobile:  { voices: 18, irScale: 0.75, pulse: true, label: '移动' },
    low:     { voices: 10, irScale: 0.60, pulse: false, label: '低端' },
  };
  var tierName = (function () {
    var cores = navigator.hardwareConcurrency || 4;
    if (caps.isIOS) return 'mobile';
    if (cores <= 2) return 'low';
    if (cores <= 4 || /Android/i.test(navigator.userAgent || '')) return 'mobile';
    return 'desktop';
  })();
  function tier() { return TIER[tierName]; }

  // =========================================================================
  // 3. 音频图：master → 限幅 → 输出；四条子总线；混响送出/返回
  // =========================================================================
  var BUS_GAIN = { music: 0.62, sfx: 0.85, ui: 0.70, amb: 0.50 };

  var ctx = null, master = null, limiter = null;
  var bus = {};
  var reverbBus = null, convolver = null, reverbReturn = null;
  var muted = false;
  try { muted = window.localStorage.getItem('td-bgm-muted') === '1'; } catch (e) {}

  function ensureCtx() {
    if (caps.path !== 'spatial') return null;
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();

      // master 上一道限幅：多声部叠加（AOE + 连击 + 节奏层 + 混响尾）最容易削波，
      // 与其事后到处压音量，不如在总线上放一只「兜底的手」。
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.12;

      master = ctx.createGain();
      // M58 P1：master 恒开。原来这里跟着 td-bgm-muted 归零 —— 音乐静音会把
      // 音效 / UI 总线一起抬走，设置面板的分控就名存实亡。音乐自己的开关
      // 压 music 总线（见 setMuted）。
      master.gain.value = 1;
      master.connect(limiter);
      limiter.connect(ctx.destination);

      Object.keys(BUS_GAIN).forEach(function (k) {
        var g = ctx.createGain();
        g.gain.value = BUS_GAIN[k];
        g.connect(master);
        bus[k] = g;
      });

      // 混响：送出总线 → 卷积器（IR 换区）→ 返回增益（= wet 量）→ master
      reverbBus = ctx.createGain();
      reverbBus.gain.value = 1;
      convolver = ctx.createConvolver();
      convolver.normalize = false;          // 归一化自己做（见 makeIR），保证各区长尾响度一致
      reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0;
      reverbBus.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(master);
    } catch (e) { ctx = null; }
    return ctx;
  }

  function resume() {
    if (!ctx || ctx.state === 'running') return;
    try {
      var p = ctx.resume && ctx.resume();
      if (p && p['catch']) p['catch'](function () {});
    } catch (e) { /* 部分手机 webview 的 resume() 不是 Promise，吞掉别把调用方带崩 */ }
  }

  // =========================================================================
  // 4. 程序化混响区（零素材 —— 这是项目一路被「素材下载被中转截断」逼出来的路线）
  // =========================================================================
  // IR 不用下载：指数衰减噪声（井筒的长尾）+ 早期反射簇（左右错开 → 立体声宽度），
  // 在内存里现算。深井与旷野的区别全在（前延时 / 衰减时间 / 高频阻尼）三个数上。
  var ZONES = {
    shaft: { pre: 0.045, decay: 3.20, wet: 0.55, damp: 0.62, label: '竖井 · 井筒' },
    room:  { pre: 0.030, decay: 1.60, wet: 0.38, damp: 0.45, label: '节点 · 小室' },
    open:  { pre: 0.020, decay: 0.80, wet: 0.16, damp: 0.20, label: '地表 · 旷野' },
  };
  // 深度分档：竖井越深，井筒共鸣越长、高频被井壁吃得越多
  var BANDS = [
    { max: 11, decayK: 0.82, damp: 0.00, label: '浅 D1–11' },
    { max: 22, decayK: 1.00, damp: 0.10, label: '中 D12–22' },
    { max: 99, decayK: 1.22, damp: 0.20, label: '深 D23+' },
  ];
  function bandOf(depth) {
    var d = depth || 1;
    for (var i = 0; i < BANDS.length; i++) if (d <= BANDS[i].max) return i;
    return BANDS.length - 1;
  }

  var irCache = {};
  function makeIR(zone, band) {
    var Z = ZONES[zone] || ZONES.open;
    var B = BANDS[band] || BANDS[0];
    var sr = ctx.sampleRate;
    var decay = Z.decay * B.decayK * tier().irScale;
    var damp = clamp(Z.damp + B.damp, 0, 0.95);
    var len = Math.max(64, Math.round(decay * sr));
    var pre = Math.round(Z.pre * sr);
    var ir = ctx.createBuffer(2, len, sr);
    var a = 1 - damp;          // 一阶低通系数：越大越亮，越小越闷
    var energy = 0;

    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      var lp = 0;
      for (var i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        var t = (i - pre) / sr;
        var env = Math.exp(-3.2 * t / decay);
        var n = Math.random() * 2 - 1;
        lp += a * (n - lp);
        d[i] = lp * env;
      }
      // 早期反射簇：封闭场地（井筒）反射更强，左右错开 2.8ms 撑出宽度
      var er = [0.007, 0.015, 0.026, 0.041];
      var erGain = 0.45 + damp * 0.55;
      for (var e = 0; e < er.length; e++) {
        var idx = pre + Math.round((er[e] + (ch ? 0.0028 : 0)) * sr);
        if (idx < len) {
          d[idx] += (ch ? 1 : -1) * erGain * (0.85 - e * 0.16) * (0.6 + Math.random() * 0.4);
        }
      }
      for (var q = 0; q < len; q++) energy += d[q] * d[q];
    }
    // 能量归一化（不是峰值归一化）：不同衰减长度的 IR 长尾响度才一致，
    // 否则「浅井切深井」会突然响一大截。
    if (energy > 0) {
      var k = 1 / Math.sqrt(energy);
      for (var c2 = 0; c2 < 2; c2++) {
        var dc = ir.getChannelData(c2);
        for (var j = 0; j < len; j++) dc[j] *= k;
      }
    }
    return ir;
  }
  function irFor(zone, band) {
    var key = zone + ':' + band;
    if (!irCache[key]) irCache[key] = makeIR(zone, band);
    return irCache[key];
  }

  var scene = { zone: 'open', depth: 1, band: 0, key: null, wet: ZONES.open.wet };

  // 换混响区：直接换 IR 会「啪」一下截断尾音 —— 把湿声拉掉、换 buffer、再拉回来。
  function setScene(zone, opts) {
    opts = opts || {};
    if (zone && ZONES[zone]) scene.zone = zone;
    if (opts.depth != null) scene.depth = opts.depth;
    scene.band = bandOf(scene.depth);
    scene.wet = ZONES[scene.zone].wet;

    var key = scene.zone + ':' + scene.band;
    if (key === scene.key && convolver && convolver.buffer) return scene;
    scene.key = key;

    if (!ensureCtx()) return scene;   // 平铺通道：混响区只记账，不发声
    try {
      var t0 = ctx.currentTime;
      reverbReturn.gain.cancelScheduledValues(t0);
      reverbReturn.gain.setValueAtTime(reverbReturn.gain.value, t0);
      reverbReturn.gain.linearRampToValueAtTime(0, t0 + 0.08);
      var buf = irFor(scene.zone, scene.band);
      setTimeout(function () {
        if (!ctx || !convolver) return;
        try {
          convolver.buffer = buf;
          var t1 = ctx.currentTime;
          reverbReturn.gain.cancelScheduledValues(t1);
          reverbReturn.gain.setValueAtTime(0, t1);
          reverbReturn.gain.linearRampToValueAtTime(scene.wet, t1 + 0.30);
        } catch (e) {}
      }, 90);
    } catch (e) {}
    return scene;
  }

  // =========================================================================
  // 5. 自适应参数（事件的「紧张度」+ 竖井的「深度」）
  // =========================================================================
  // Tension 0–1 的四路来源与权重（见 render.js 的 audioUpdate）：
  //   敌人剩余血量占比 0.40 / 玩家失血 0.30 / 回合数 0.15 / Boss 在场 0.15
  // 更新率 120ms，指数平滑 —— 参数永远不硬切，玩家只会「感觉」到，不会「听出」跳变。
  var P = { tension: 0, tensionTgt: 0, depth: 1, health: 1, inCombat: false };

  function setParam(name, v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    if (name === 'tension') P.tensionTgt = clamp(v, 0, 1);
    else if (name === 'depth') { P.depth = Math.max(1, v); setScene(null, { depth: P.depth }); }
    else if (name === 'health') P.health = clamp(v, 0, 1);
    else if (name === 'combat') P.inCombat = !!v;
    return P[name];
  }

  // 参数 → 音乐 DSP。紧张度↑：低通打开（更亮更锋利）+ 高频架抬起；
  // 深度↑：整体再压暗一层（越深越闷）。这两条让**同一首 mp3** 在不同局势下
  // 听感不同 —— 单层预录曲目做不了「横向重排」，但做「纵向处理」是够的。
  var musicNodes = [];   // { lp, shelf } —— 已接入 Web Audio 的 mp3 元素
  var musicTgt = { cutoff: 20000, shelf: 0 };

  // 参数 → 音乐处理的**纯映射**（可单测、可复现）。
  // 放在这里而不是埋在调度器里：「紧张度对应多亮的音色」是设计决策，
  // 应该是一个能一眼看完的公式，而不是某段副作用的副产品。
  //   tension 0 → 5200Hz 低通 + 高频 −3.5dB（闷、退在后面 —— 探索态）
  //   tension 1 → 19kHz  低通 + 高频 +4.5dB（亮、顶到前面 —— 决战态）
  //   竖井深度再整体压暗一档，D33 时只剩 45%（越深越闷）
  function musicCurve(tension, depth) {
    var t = clamp(tension == null ? 0 : tension, 0, 1);
    var d = depth == null ? 1 : depth;
    var depthMuffle = 0.55 * clamp((d - 1) / 32, 0, 1);
    return {
      cutoff: clamp(lerp(5200, 19000, t) * (1 - depthMuffle), 700, 20000),
      shelf: lerp(-3.5, 4.5, t),
      muffle: depthMuffle,
    };
  }

  function applyMusicParams() {
    var c = musicCurve(P.tension, P.depth);
    // 目标值先记账 —— 即使 Path B 没有 Web Audio 图，诊断里也看得到「引擎想要什么」，
    // 测试也就不用去读 AudioParam 的实时值（setTargetAtTime 的当前值不随参数变）。
    musicTgt.cutoff = Math.round(c.cutoff);
    musicTgt.shelf = Math.round(c.shelf * 10) / 10;
    if (!ctx || !musicNodes.length) return;
    var now = ctx.currentTime;
    for (var i = 0; i < musicNodes.length; i++) {
      try {
        musicNodes[i].lp.frequency.setTargetAtTime(c.cutoff, now, 0.35);
        musicNodes[i].shelf.gain.setTargetAtTime(c.shelf, now, 0.35);
      } catch (e) {}
    }
  }

  // ---- 程序化节奏层：真正的「自适应音乐层」----
  // 单首 mp3 是预录的，做不到横向重排（换段落）；但可以**叠一层合成打击**，
  // 并且与 mp3 的 BPM 对齐 —— battle 104 / boss 118 / map 62（见 Bgm 的曲目表），
  // 所以叠上去是「同一首歌变紧张」，不是「多了一台鼓机在跑」。
  var BPM = { battle: 104, boss: 118, map: 62 };
  var pulse = { track: null, gain: null, timer: null, step: 0, next: 0 };

  function pulseNode() {
    if (!ensureCtx()) return null;
    if (!pulse.gain) {
      pulse.gain = ctx.createGain();
      pulse.gain.gain.value = 0;
      pulse.gain.connect(bus.music);
      var send = ctx.createGain();
      send.gain.value = 0.5;
      pulse.gain.connect(send);
      send.connect(reverbBus);
    }
    return pulse.gain;
  }

  function kick(at, vol) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, at + 0.16);
    o.connect(g); g.connect(pulse.gain);
    o.start(at); o.stop(at + 0.2);
  }
  function hat(at, vol) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
    var b = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(); s.buffer = b;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0006, at + 0.04);
    s.connect(f); f.connect(g); g.connect(pulse.gain);
    s.start(at); s.stop(at + 0.06);
  }

  function pulseTick() {
    if (!ctx || !pulse.track || !pulse.gain) return;
    var bpm = BPM[pulse.track] || 100;
    var eighth = 30 / bpm;                       // 八分音符时长（s）
    var lvl = sstep(0.34, 0.86, P.tension);      // 紧张度越线才渐入
    var hot = P.tension > 0.78;
    try { pulse.gain.gain.setTargetAtTime(lvl * 0.9, ctx.currentTime, 0.4); } catch (e) {}
    if (lvl <= 0.001) { pulse.next = ctx.currentTime + 0.2; return; }
    while (pulse.next < ctx.currentTime + 0.35) {
      var s = pulse.step % 8;
      if (s === 0 || s === 4) kick(pulse.next, 0.55 * lvl);
      if (s % 2 === 1) hat(pulse.next, 0.16 * lvl);
      if (hot && s % 2 === 0) hat(pulse.next, 0.07);
      pulse.next += eighth;
      pulse.step++;
    }
  }

  function setTrack(name) {
    pulse.track = name && BPM[name] ? name : null;
    if (!ensureCtx()) return;
    if (pulse.track && tier().pulse) {
      pulseNode();
      if (!pulse.timer) pulse.timer = setInterval(pulseTick, 120);
      pulse.step = 0;
      pulse.next = ctx.currentTime + 0.15;
    } else {
      if (pulse.timer) { clearInterval(pulse.timer); pulse.timer = null; }
      if (pulse.gain) { try { pulse.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25); } catch (e) {} }
    }
  }

  // 参数平滑 + 音乐参数下发（一个 120ms 的节拍器，不是 rAF —— 音频参数不需要 60fps）
  var smoothTimer = setInterval(function () {
    P.tension = lerp(P.tension, P.tensionTgt, 0.18);
    applyMusicParams();
  }, 120);

  // =========================================================================
  // 6. 空间化声部（2D 舞台 → 声像 / 距离 / 遮挡 → 总线 + 混响送出）
  // =========================================================================
  var voices = [];
  var playedTotal = 0;      // 累计派发过的声部数（探针/诊断用，不受「声部已结束」影响）
  var lastVoice = null;     // 最后一个声部的实际参数（声像 / 距离 / 低通 / 增益）

  // 遮挡的语义取值：格挡挡住 = 被墙挡；隐身/迷雾 = 隔得更远更闷
  var OCCL = { NONE: 0, BLOCKED: 0.45, HIDDEN: 0.75 };

  function stopVoice(v) {
    try { v.src.stop(); } catch (e) {}
    var i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
  }

  // 语音预算：满了先抢。抢的顺序 = 优先级低 → 距离远 → 最老（FMOD 的 steal 规则同构）
  function stealOne() {
    var worst = 0;
    for (var i = 1; i < voices.length; i++) {
      var a = voices[i], b = voices[worst];
      var worse = a.prio > b.prio ||
        (a.prio === b.prio && a.dist > b.dist) ||
        (a.prio === b.prio && a.dist === b.dist && a.t0 > b.t0);
      if (worse) worst = i;
    }
    stopVoice(voices[worst]);
  }

  function playBuffer(buffer, o) {
    o = o || {};
    if (!buffer) return false;
    var c = ensureCtx();
    if (!c) return false;
    var cap = tier().voices;
    while (voices.length >= cap) stealOne();

    var dist = clamp(o.dist == null ? 0 : o.dist, 0, 1);
    var occl = clamp(o.occl == null ? 0 : o.occl, 0, 1);

    var src = c.createBufferSource();
    src.buffer = buffer;
    if (o.rate) src.playbackRate.value = clamp(o.rate, 0.25, 4);

    // 距离 + 遮挡 → 高频滚降（越远越闷；被挡住再压一层）
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(20000 * lerp(1, 0.35, dist) * lerp(1, 0.28, occl), 400, 20000);

    var g = c.createGain();
    g.gain.value = clamp(lerp(1, 0.28, dist) * lerp(1, 0.5, occl) * (o.vol == null ? 1 : o.vol), 0, 1.2);

    var panVal = null;
    var tail = lp;
    if (c.createStereoPanner) {
      var pan = c.createStereoPanner();
      pan.pan.value = clamp(o.x == null ? 0 : o.x, -1, 1);
      panVal = pan.pan.value;
      lp.connect(pan); tail = pan;
    }
    src.connect(lp);
    tail.connect(g);
    g.connect(bus[o.bus || 'sfx']);
    if (reverbBus) {
      var send = c.createGain();
      send.gain.value = o.send == null ? 0.7 : o.send;
      g.connect(send); send.connect(reverbBus);
    }

    var t = c.currentTime + (o.delay == null ? 0.005 : o.delay);
    try { src.start(t); } catch (e) { return false; }

    var v = {
      src: src, gain: g, lp: lp,
      prio: o.prio == null ? 2 : o.prio,
      dist: dist, t0: t,
      name: o.name || 'sfx',
    };
    voices.push(v);
    // 记账放在 start 之后：只有真的起来了才算「派发过一声」
    playedTotal++;
    lastVoice = {
      x: panVal, dist: dist, occl: occl,
      lp: Math.round(lp.frequency.value),
      gain: Math.round(g.gain.value * 100) / 100,
      prio: v.prio, name: v.name, at: Math.round(t * 1000) / 1000,
    };
    src.onended = function () {
      var i = voices.indexOf(v);
      if (i >= 0) voices.splice(i, 1);
    };
    return true;
  }

  // =========================================================================
  // 7. 音乐接入（mp3 元素 → Web Audio 处理链，仅 Path A）
  // =========================================================================
  // ⚠️ createMediaElementSource 是**不可逆**的：一个元素接进 Web Audio 后，
  // 它的输出就永远走 AudioContext。所以：
  //   ① 只在 Path A 接（iOS 老环境一旦接进去＝把能响的曲拖成静音）；
  //   ② 接失败（file:// 的 SecurityError 等）就地放弃，元素继续走媒体通道，
  //      绝不因为「加不上 DSP」把 BGM 弄没。
  var musicAttachNote = 'not-attempted';
  function attachMusic(el) {
    if (caps.path !== 'spatial') { musicAttachNote = 'skipped(平铺通道)'; return null; }
    if (!el || el.__tdMusic) return el && el.__tdMusic;
    // ⚠️ file:// 下**不能接**：本地文件对本页来说是跨源（opaque origin），
    // createMediaElementSource 会「成功但输出静音」—— 接上去等于把本来能响的 BGM
    // 换成一片安静，是纯粹的倒退。部署环境（https）同源，正常接。
    if (location.protocol === 'file:') {
      musicAttachNote = 'skipped(file:// 跨源会被静音)';
      return null;
    }
    if (!ensureCtx()) { musicAttachNote = 'skipped(无 AudioContext)'; return null; }
    try {
      var src = ctx.createMediaElementSource(el);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
      var shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 3200; shelf.gain.value = 0;
      var g = ctx.createGain(); g.gain.value = 1;
      src.connect(lp); lp.connect(shelf); shelf.connect(g); g.connect(bus.music);
      var send = ctx.createGain(); send.gain.value = 0.35;
      g.connect(send); send.connect(reverbBus);
      el.__tdMusic = { src: src, lp: lp, shelf: shelf, gain: g };
      musicNodes.push(el.__tdMusic);
      musicAttachNote = 'attached';
      return el.__tdMusic;
    } catch (e) {
      musicAttachNote = 'failed(' + (e && e.name ? e.name : 'error') + ')';
      return null;
    }
  }

  // =========================================================================
  // 8. Stinger（事件驱动的音乐提示音）—— 全程序化合成，零素材
  // =========================================================================
  // 合成原语：振荡器下滑 + 白噪声爆发（与 audio.js 的打击材质同一套思路）
  function burst(t, o) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * (o.len || 0.2)));
    var b = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass'; f.frequency.value = o.freq || 1000;
    if (o.q != null) f.Q.value = o.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.4, t + (o.atk || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.dur || 0.3));
    s.connect(f); f.connect(g); g.connect(bus.ui);
    s.start(t); s.stop(t + (o.dur || 0.3) + 0.05);
  }
  function tone(t, o) {
    var os = ctx.createOscillator();
    os.type = o.wave || 'sine';
    os.frequency.setValueAtTime(o.from, t);
    if (o.to && o.to !== o.from) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || 0.2));
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.atk || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.dur || 0.4));
    os.connect(g); g.connect(bus.ui);
    os.start(t); os.stop(t + (o.dur || 0.4) + 0.05);
  }

  var STINGERS = {
    // 遇敌：上行小三度 + 中频噪声冲击，短促不抢戏
    encounter: function (t) {
      tone(t, { from: 311, dur: 0.26, vol: 0.22, wave: 'triangle' });
      tone(t + 0.09, { from: 370, dur: 0.42, vol: 0.20, wave: 'triangle' });
      burst(t, { freq: 900, type: 'bandpass', q: 0.8, vol: 0.22, dur: 0.16 });
    },
    // 濒死：低频心跳（55Hz），压迫感全靠低频体感
    lowhp: function (t) {
      tone(t, { from: 66, to: 52, glide: 0.16, dur: 0.26, vol: 0.42 });
      tone(t + 0.34, { from: 62, to: 48, glide: 0.18, dur: 0.30, vol: 0.34 });
    },
    // 击杀：金属下坠 + 高频瞬态（「解决掉一个」的爽感）
    kill: function (t) {
      burst(t, { freq: 6200, type: 'highpass', vol: 0.3, atk: 0.002, dur: 0.03 });
      tone(t, { from: 880, to: 220, glide: 0.14, dur: 0.20, vol: 0.26, wave: 'triangle' });
      burst(t, { freq: 2400, type: 'bandpass', q: 1.2, vol: 0.22, dur: 0.12 });
    },
    // Boss 现身：低频轰鸣上扬 + 不谐和音簇（灾难感来自「不解决」的和声）
    bossReveal: function (t) {
      burst(t, { freq: 260, type: 'lowpass', vol: 0.5, dur: 1.2 });
      tone(t, { from: 41, to: 58, glide: 0.9, dur: 1.1, vol: 0.42 });
      tone(t + 0.05, { from: 87, to: 116, glide: 0.9, dur: 0.9, vol: 0.20, wave: 'sawtooth' });
      tone(t + 0.08, { from: 92, to: 124, glide: 0.9, dur: 0.8, vol: 0.16, wave: 'sawtooth' });
    },
  };
  var EVENT_STINGER = {
    encounter: 'event:/Stinger/Encounter',
    lowhp: 'event:/Stinger/LowHP',
    kill: 'event:/Stinger/Kill',
    bossReveal: 'event:/Stinger/BossReveal',
  };

  var lastStinger = null;
  function stinger(name) {
    if (!STINGERS[name]) return false;
    if (!ensureCtx()) return false;     // 平铺通道没有合成层，静默即可（不是错误）
    resume();
    try { STINGERS[name](ctx.currentTime + 0.02); lastStinger = EVENT_STINGER[name]; } catch (e) { return false; }
    return true;
  }

  // =========================================================================
  // 9. 诊断 HUD（F3 / 反引号切换）—— 「看不见就调不准」
  // =========================================================================
  var hudEl = null, hudTimer = null;
  function diag() {
    var m = musicNodes.length ? musicNodes[0] : null;
    return {
      path: caps.path,
      session: caps.sessionType,
      reason: caps.reason,
      forced: caps.forced,
      tier: tierName,
      maxVoices: tier().voices,
      voices: voices.length,
      played: playedTotal,
      lastVoice: lastVoice,
      musicAttach: musicAttachNote,
      musicNodes: musicNodes.length,
      zone: scene.zone,
      zoneLabel: (ZONES[scene.zone] || {}).label,
      band: scene.band,
      bandLabel: (BANDS[scene.band] || {}).label,
      depth: scene.depth,
      tension: Math.round(P.tension * 100) / 100,
      tensionTgt: Math.round(P.tensionTgt * 100) / 100,
      wet: scene.wet,
      irCached: Object.keys(irCache).length,
      musicCutoff: m ? Math.round(m.lp.frequency.value) : 0,
      musicShelf: m ? Math.round(m.shelf.gain.value * 10) / 10 : 0,
      musicCutoffTgt: musicTgt.cutoff,
      musicShelfTgt: musicTgt.shelf,
      pulse: !!(pulse.track && pulse.gain),
      pulseTrack: pulse.track,
      pulseBpm: pulse.track ? (BPM[pulse.track] || 0) : 0,
      lastStinger: lastStinger,
      ctxState: ctx ? ctx.state : 'none',
    };
  }

  function hudLine(k, v, tone) {
    return '<div style="display:flex;gap:10px;justify-content:space-between">' +
      '<span style="opacity:.62">' + k + '</span>' +
      '<b style="color:' + (tone || '#e8e8f2') + '">' + v + '</b></div>';
  }
  function hudUpdate() {
    if (!hudEl) return;
    var d = diag();
    var bar = function (v, hue) {
      var w = Math.round(clamp(v, 0, 1) * 100);
      return '<div style="height:5px;background:#2a2a3c;border-radius:3px;overflow:hidden;margin-top:4px">' +
        '<div style="height:100%;width:' + w + '%;background:' + hue + ';transition:width .2s"></div></div>';
    };
    hudEl.innerHTML =
      '<div style="font-weight:700;margin-bottom:8px;letter-spacing:.06em">TD-AAS · 空间音频诊断</div>' +
      hudLine('通道 path', d.path === 'spatial' ? 'spatial（Web Audio）' : 'flat（<audio>保底）',
              d.path === 'spatial' ? '#5ad18a' : '#e0a34a') +
      hudLine('静音键会话', d.session) +
      hudLine('判定依据', '') +
      '<div style="opacity:.5;font-size:11px;line-height:1.45;margin:-2px 0 8px">' + d.reason + '</div>' +
      hudLine('性能档 / 上限', d.tier + ' · ' + d.maxVoices + ' 声部') +
      hudLine('活跃声部', d.voices + ' / ' + d.maxVoices) +
      hudLine('混响区', d.zoneLabel + ' · ' + d.bandLabel + '（wet ' + d.wet + '）') +
      hudLine('竖井深度', 'D' + d.depth) +
      hudLine('紧张度 tension', d.tension.toFixed(2) + ' → ' + d.tensionTgt.toFixed(2)) +
      bar(d.tension, 'linear-gradient(90deg,#4a7fd4,#e0553f)') +
      hudLine('音乐低通', d.musicCutoff ? d.musicCutoff + ' Hz' : '未接入') +
      hudLine('音乐高频架', d.musicShelf ? d.musicShelf + ' dB' : '—') +
      hudLine('节奏层', d.pulse ? ('on · ' + (BPM[d.pulseTrack] || '?') + ' BPM') : 'off') +
      hudLine('IR 缓存', d.irCached + ' 张') +
      hudLine('最近 Stinger', d.lastStinger || '—') +
      hudLine('AudioContext', d.ctxState);
    hudEl.setAttribute('data-path', d.path);
    hudEl.setAttribute('data-voices', String(d.voices));
    hudEl.setAttribute('data-tension', d.tension.toFixed(2));
    hudEl.setAttribute('data-zone', d.zone + ':' + d.band);
  }
  function hudToggle() {
    if (hudEl) {
      hudEl.parentNode.removeChild(hudEl);
      hudEl = null;
      if (hudTimer) { clearInterval(hudTimer); hudTimer = null; }
      return false;
    }
    hudEl = document.createElement('div');
    hudEl.id = 'td-aas-hud';
    hudEl.style.cssText =
      'position:fixed;right:10px;top:64px;z-index:99999;width:236px;padding:12px 14px;' +
      'font:12px/1.6 ui-monospace,Consolas,"Microsoft YaHei",monospace;color:#e8e8f2;' +
      'background:rgba(22,22,31,.94);border:1px solid #3a3a52;border-radius:10px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.45);pointer-events:none';
    document.body.appendChild(hudEl);
    hudUpdate();
    hudTimer = setInterval(hudUpdate, 250);
    return true;
  }
  try {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'F3' || e.key === '`') { e.preventDefault(); hudToggle(); }
    });
  } catch (e) {}

  // =========================================================================
  // 10. 首触解锁（沿用 M34c/M36c 的结论：iOS 的媒体限制是「元素级」的）
  // =========================================================================
  function unlock() {
    try {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchend', unlock);
    } catch (e) {}
    resume();
    if (ensureCtx()) {
      try { setScene(scene.zone, { depth: scene.depth }); } catch (e) {}
      if (pulse.track && tier().pulse) pulseNode();
    }
  }
  try {
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('touchend', unlock);
  } catch (e) {}

  function setMuted(m) {
    muted = !!m;
    // M58 P1：语义收窄为「音乐静音」—— 只压 music 总线，不再动 master
    //（原来 master 归零会连坐 sfx / ui，设置面板没法分控）。
    // 合成打击音效的开关在 Sfx.setMuted（td-sfx-muted），两者互不牵连。
    if (bus.music) {
      try {
        bus.music.gain.setTargetAtTime(muted ? 0 : BUS_GAIN.music, ctx.currentTime, 0.02);
      } catch (e) {}
    }
  }

  // =========================================================================
  // 对外接口
  // =========================================================================
  return {
    caps: caps,
    tier: function () { return tierName; },
    buses: function () { return Object.keys(BUS_GAIN); },
    OCCL: OCCL,
    ZONES: ZONES,

    ensure: ensureCtx,
    resume: resume,
    context: function () { return ctx; },
    bus: function (name) { return bus[name] || null; },

    playBuffer: playBuffer,
    voices: function () { return voices.length; },

    attachMusic: attachMusic,
    setTrack: setTrack,

    setScene: setScene,
    scene: function () { return { zone: scene.zone, band: scene.band, depth: scene.depth, wet: scene.wet }; },

    setParam: setParam,
    params: function () { return { tension: P.tension, tensionTgt: P.tensionTgt, depth: P.depth }; },
    // 纯映射：可单测、可复现（自适应的「度」是一个公式，不是散落的副作用）
    musicCurve: musicCurve,

    stinger: stinger,
    stingers: function () { return Object.keys(STINGERS); },

    setMuted: setMuted,
    isMuted: function () { return muted; },

    diag: diag,
    hud: { toggle: hudToggle, update: hudUpdate, isOpen: function () { return !!hudEl; } },
  };
})();
