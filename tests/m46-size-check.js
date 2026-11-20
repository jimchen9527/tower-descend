// M46 · 敌人显示大小复核：中 Boss（精英）的个头必须高过玩家。
//
// 背景：M44 把立绘基准整体缩到 小怪 73 / 中 Boss 91 / 玩家 111 / 大 Boss 130 ——
// 中 Boss 比玩家矮 20px，玩家站着比「小关主」还高，气势倒挂。
// M46 只把中 Boss 提到 122（大 Boss 130 不动）。
//
// 两段验证：
//   ① 真机读数：把游戏起起来，逐个敌人开战，读 .unit-bm 的 computed height，
//      断言 小怪 < 玩家 < 中 Boss < 大 Boss。
//   ② 尺标图：把四档立绘摆在同一地平线上、叠一条「玩家头顶」参考线，
//      存 tests/m46-ladder.png —— 一眼看出中 Boss 是否高过玩家。
//
// 运行：node tests/m46-size-check.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_m46-size-probe.html');
const LADDER_FILE = path.join(BASE, '_m46-ladder.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// ---------- 通用：跑一次 headless Edge ----------
function runEdge(file, extraArgs, size, budget) {
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-m46',
    '--allow-file-access-from-files',
    '--virtual-time-budget=' + (budget || 8000),
    '--window-size=' + (size || '1200,900'),
  ].concat(extraArgs || []).concat(['file:///' + file.replace(/\\/g, '/')]);
  return execFileSync(EDGE, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ============================================================
// ① 真机读数
// ============================================================
const PROBE_SCRIPT = '<pre id="m46-out"></pre>\n<script>\n' + [
  'window.onerror = function (m) { window.__err = String(m); };',
  '(function () {',
  '  var out = [];',
  '  function log(k, v) { out.push(k + " = " + v); }',
  '  function h(sel) {',
  '    var el = document.querySelector(sel);',
  '    return el ? getComputedStyle(el).height : "none";',
  '  }',
  '  function w(sel) {',
  '    var el = document.querySelector(sel);',
  '    return el ? String(Math.round(el.getBoundingClientRect().width)) : "none";',
  '  }',
  '  try {',
  '    Progress.reset();',
  '    App.boot({ fresh: true });',
  '    var ids = ["rats", "warlord", "hound", "rust_crown"];',
  '    var labels = { rats: "normal", warlord: "elite", hound: "eliteHound", rust_crown: "boss" };',
  '    var heights = {};',
  '    var idx = 0;',
  // 位图是异步加载的：不等 img.complete 就量宽度会量到 0（--dump-dom 不看渲染时序）。
  // 高度是 CSS 真值（calc 写死在样式里）不受影响，但宽度必须等图到位。
  '    function waitImgs(cb) {',
  '      var t = 0;',
  '      (function tick() {',
  '        var imgs = [].slice.call(document.querySelectorAll(".unit-bm"));',
  '        var done = imgs.length > 0 && imgs.every(function (i) {',
  '          return i.complete && i.naturalWidth > 0;',
  '        });',
  '        if (done || t > 60) return cb();',
  '        t++; setTimeout(tick, 50);',
  '      })();',
  '    }',
  '    function step() {',
  '      if (idx >= ids.length) return finish();',
  '      var id = ids[idx]; idx++;',
  '      Combat.start(20261009, {',
  '        charId: "digger", hp: 70, maxHp: 75, depth: 3, locTag: "M46",',
  '        deck: Run.state.deck, enemyId: id,',
  '      });',
  '      Render.resetFeedback();',
  '      document.getElementById("view-map").hidden = true;',
  '      document.getElementById("view-combat").hidden = false;',
  '      Render.draw();',
  '      waitImgs(function () {',
  '        var eh = h("#enemy-panel .eunit .unit-art .unit-bm");',
  '        var ew = w("#enemy-panel .eunit .unit-art .unit-bm");',
  '        var cls = (document.querySelector("#enemy-panel .eunit .unit-art") || {}).className || "";',
  '        heights[labels[id]] = parseFloat(eh);',
  '        log("h_" + labels[id], eh);',
  '        log("w_" + labels[id], ew);',
  '        log("cls_" + labels[id], cls);',
  '        step();',
  '      });',
  '    }',
  '    function finish() {',
  '      var ph = parseFloat(h(".unit-art-player .unit-bm"));',
  '      log("h_player", String(ph) + "px");',
  '      log("w_player", w(".unit-art-player .unit-bm"));',
  '      log("imgPlayer", (document.querySelector(".unit-art-player .unit-bm") || {}).src ? "1" : "0");',
  '      log("ladderOk", heights.normal < ph && ph < heights.elite && heights.elite < heights.boss);',
  '      log("eliteOverPlayerPx", (heights.elite - ph).toFixed(1));',
  '      log("eliteOverPlayerPct", ((heights.elite / ph - 1) * 100).toFixed(1));',
  '      log("bossOverElitePx", (heights.boss - heights.elite).toFixed(1));',
  '      log("crowdVar", String(getComputedStyle(document.getElementById("enemy-panel")).getPropertyValue("--crowd")).trim() || "1");',
  '      log("bmScaleVar", String(getComputedStyle(document.documentElement).getPropertyValue("--bm-scale")).trim() || "1");',
  // 溢出守卫：立绘放大 34% 后最宽的一幕是「铁颚督军 + 双头犬」（都是精英、都吃 122 档，
  // 双头犬宽 165）。舞台 overflow:hidden，越界就是直接裁掉 —— 必须量一次右缘余量。
  '      Combat.start(20261009, {',
  '        charId: "digger", hp: 70, maxHp: 75, depth: 15, locTag: "M46 · 中 Boss",',
  '        deck: Run.state.deck, enemyId: "warlord",',
  '      });',
  '      Render.resetFeedback();',
  '      document.getElementById("view-map").hidden = true;',
  '      document.getElementById("view-combat").hidden = false;',
  '      Combat.addEnemy("hound");',
  '      Render.draw();',
  '      waitImgs(function () {',
  '        var st = document.querySelector(".battle-stage").getBoundingClientRect();',
  '        var eus = [].slice.call(document.querySelectorAll("#enemy-panel .eunit"));',
  '        var lastR = eus.length ? eus[eus.length - 1].getBoundingClientRect().right : 0;',
  '        var pl = document.querySelector("#player-panel .unit").getBoundingClientRect();',
  '        log("elitePairCount", eus.length);',
  '        log("eliteFitsStage", eus.length === 2 && lastR <= st.right + 0.5);',
  '        log("enemyFreeRight", Math.round(st.right - lastR));',
  '        log("playerFreeLeft", Math.round(pl.left - st.left));',
  '        log("jsError", window.__err || "none");',
  '        document.getElementById("m46-out").textContent = out.join("\\n");',
  '      });',
  '    }',
  '    step();',
  '  } catch (e) {',
  '    log("thrown", String(e && e.message || e));',
  '    document.getElementById("m46-out").textContent = out.join("\\n");',
  '  }',
  '})();',
  '</script>',
].join('\n');

const probeHtml = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (probeHtml.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
fs.writeFileSync(PROBE_FILE, probeHtml.replace('</body>', PROBE_SCRIPT + '\n</body>'));

const got = {};
try {
  const dom = runEdge(PROBE_FILE, ['--dump-dom']);
  const m = dom.match(/<pre id="m46-out">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('未找到探针输出 —— 页面脚本在探针执行前就挂了。DOM 长度：' + dom.length);
    process.exit(1);
  }
  m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .split('\n').forEach(function (line) {
      const i = line.indexOf(' = ');
      if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
    });
} finally {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
}

console.log('\n【真机立绘尺寸（1200×900，1 敌）】');
console.log('  档位         高        宽（实测）');
[['小怪', 'normal'], ['玩家', 'player'], ['中 Boss', 'elite'], ['大 Boss', 'boss']].forEach(function (r) {
  console.log('  ' + r[0].padEnd(11) + String(got['h_' + r[1]] || '?').padEnd(10) + String(got['w_' + r[1]] || '?'));
});
console.log('  敌人 class：normal=' + got.cls_normal + ' | elite=' + got.cls_elite + ' | boss=' + got.cls_boss);
console.log('  中 Boss 比玩家高：' + got.eliteOverPlayerPx + 'px（+' + got.eliteOverPlayerPct + '%）');
console.log('  大 Boss 比中 Boss 高：' + got.bossOverElitePx + 'px');
console.log('  中 Boss 双敌（督军+双头犬）右缘余量：' + got.enemyFreeRight + 'px（玩家左侧余量 ' + got.playerFreeLeft + 'px）');

const CASES = [
  ['ladderOk', 'true', '阶梯成立：小怪 < 玩家 < 中 Boss < 大 Boss'],
  ['h_normal', '73px', '小怪 73px（M44 基准，未动）'],
  ['h_player', '111px', '玩家 111px（未动）'],
  ['h_elite', '122px', '中 Boss 122px（M46：原 91px）'],
  ['h_eliteHound', '122px', '双头犬（最宽的精英）也吃满 122px —— 宽度上限没把它压回去'],
  ['w_eliteHound', '165', '双头犬渲染宽 165px（900×665，w/h 1.353 × 122）'],
  ['h_boss', '130px', '大 Boss 130px（未动，仍是最大）'],
  ['cls_elite', 'unit-art art-kind-elite', '中 Boss 走 art-kind-elite 规则（class 没拼错）'],
  ['elitePairCount', '2', '溢出守卫用的是真实双敌编队（铁颚督军 + 双头犬）'],
  ['eliteFitsStage', 'true', '中 Boss 双敌编队不越出舞台右缘（122 档放大后的宽度守卫）'],
  ['imgPlayer', '1', '玩家确实用的是位图立绘（不是 SVG 兜底）'],
  ['jsError', 'none', '页面无 JS 运行时错误'],
];

console.log('');
let fail = 0;
CASES.forEach(function (c) {
  const actual = got[c[0]];
  const ok = actual === c[1];
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] +
    (ok ? '' : '（期望 ' + c[1] + '，实际 ' + actual + '）'));
});
console.log('\n立绘尺寸：' + (fail ? '有失败：' : '全部通过：') + CASES.length + ' 通过 / ' + fail + ' 失败');

// ============================================================
// ② 尺标图
// ============================================================
const CAP_H = 36;   // 说明文字区固定高 —— 地平线画在 caption 之上，五行才对齐
const CELLS = [
  { k: 'normal', key: '小怪', sub: 'rats · 73', cls: 'unit-art', src: 'preview-assets-v3/rats-cut.png', ov: '', tag: '' },
  { k: 'player', key: '玩家', sub: 'digger · 111', cls: 'unit-art unit-art-player', src: 'preview-assets-v3/digger-cut.png', ov: '', tag: '' },
  { k: 'eliteOld', key: '中 Boss · 改前', sub: 'warlord · 91', cls: 'unit-art art-kind-elite', src: 'preview-assets-v3/warlord-cut.png', ov: 'height:91px;max-width:127px;', tag: 'lose' },
  { k: 'eliteNew', key: '中 Boss · M46', sub: 'warlord · 122', cls: 'unit-art art-kind-elite', src: 'preview-assets-v3/warlord-cut.png', ov: '', tag: 'win' },
  { k: 'boss', key: '大 Boss', sub: 'rust_crown · 130', cls: 'unit-art art-kind-boss', src: 'preview-assets-v3/rust_crown-cut.png', ov: '', tag: '' },
];

const ladderCss = [
  'html, body { margin: 0; background: #F7F6F1; }',
  '.wrap { padding: 24px 26px 6px; font-family: "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }',
  '.title { font-size: 15px; font-weight: 700; color: #2C2C2A; }',
  '.note { font-size: 12px; color: #888780; margin: 4px 0 16px; }',
  '.row { position: relative; display: flex; align-items: flex-end; gap: 28px; min-height: 186px; }',
  /* 地平线做成真元素（不用 ::after）—— 只有真元素才量得到 rect，
     才敢断言「线就压在脚下」。2px 粗，顶边落在脚底。 */
  '#ground { position: absolute; left: 0; right: 0; bottom: ' + (CAP_H + 6 - 2) + 'px;',
  '          height: 2px; background: #B4B2A9; }',
  '.col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }',
  '.col .art-slot { display: flex; align-items: flex-end; }',
  '.cap { height: ' + CAP_H + 'px; margin-top: 6px; font-size: 11px; color: #5F5E5A;',
  '       line-height: 1.5; text-align: center; white-space: nowrap; }',
  '.cap b { display: block; font-size: 12px; color: #2C2C2A; }',
  '.col.win .cap b { color: #A32D2D; }',
  '.col.lose .cap b { color: #185FA5; }',
  /* border-top 画在盒子的上边 —— 想让它落在第 N 像素，bottom 要写 N−1。
     这里写 (脚底高度 − 1)，参考线的上边才正好压在玩家头顶。 */
  '#ref { position: absolute; left: 0; right: 0;',
  '       bottom: ' + (CAP_H + 6 + 111 - 1) + 'px;',
  '       border-top: 1px dashed #A32D2D; z-index: 3; }',
  '#ref span { position: absolute; right: 0; top: -16px; font-size: 11px; color: #A32D2D;',
  '            background: #F7F6F1; padding: 0 4px; }',
  /* 静态验收图：关掉待机呼吸，否则截图落在压缩相位、量出来的高度不是标称值 */
  '.unit-art > img, .unit-art > svg, .unit-art > .art { animation: none !important; transform: none !important; }',
].join('\n');

const cellHtml = CELLS.map(function (c) {
  return '<div class="col ' + c.tag + '" data-k="' + c.k + '">' +
    '<div class="art-slot"><div class="' + c.cls + '">' +
    '<img class="unit-bm" src="' + c.src + '" alt=""' + (c.ov ? ' style="' + c.ov + '"' : '') + '>' +
    '</div></div>' +
    '<div class="cap"><b>' + c.key + '</b>' + c.sub + '</div>' +
    '</div>';
}).join('');

// 尺标图自己报几何：参考线要正好压在玩家头顶、地平线要正好压在所有立绘脚下。
// 输出写进 display:none 的 <pre>，既不进截图，又能被 --dump-dom 读回来。
const LADDER_MEASURE = [
  'window.onerror = function (m) { window.__m46ladErr = String(m); };',
  '(function () {',
  '  var out = [];',
  '  function log(k, v) { out.push(k + " = " + v); }',
  '  function tick(t) {',
  '    var imgs = [].slice.call(document.querySelectorAll(".unit-bm"));',
  '    if (!(imgs.length && imgs.every(function (i) { return i.complete && i.naturalWidth > 0; })) && t < 60) {',
  '      return setTimeout(function () { tick(t + 1); }, 50);',
  '    }',
  '    var refY = document.getElementById("ref").getBoundingClientRect().top;',
  '    var groundY = document.getElementById("ground").getBoundingClientRect().top;',
  '    var tops = {}, bots = [];',
  '    [].slice.call(document.querySelectorAll(".col")).forEach(function (col) {',
  '      var r = col.querySelector(".unit-art").getBoundingClientRect();',
  '      tops[col.getAttribute("data-k")] = r.top;',
  '      bots.push(r.bottom);',
  '    });',
  '    var gMax = Math.max.apply(null, bots), gMin = Math.min.apply(null, bots);',
  '    log("groundSpread", (gMax - gMin).toFixed(2));',
  '    log("groundAtFeet", (groundY - gMax).toFixed(2));',
  '    log("refAboveFeet", (gMax - refY).toFixed(2));',
  '    [["normal", "normalTop"], ["player", "playerTop"], ["eliteOld", "eliteOldTop"],',
  '     ["eliteNew", "eliteNewTop"], ["boss", "bossTop"]].forEach(function (p) {',
  '      log(p[1], (tops[p[0]] - refY).toFixed(2));',
  '    });',
  '    log("artH_normal", (bots[0] - tops.normal).toFixed(2));',
  '    log("artH_player", (bots[1] - tops.player).toFixed(2));',
  '    log("artH_eliteOld", (bots[2] - tops.eliteOld).toFixed(2));',
  '    log("artH_eliteNew", (bots[3] - tops.eliteNew).toFixed(2));',
  '    log("artH_boss", (bots[4] - tops.boss).toFixed(2));',
  '    log("jsError", window.__m46ladErr || "none");',
  '    document.getElementById("lad-out").textContent = out.join("\\n");',
  '  }',
  '  tick(0);',
  '})();',
].join('\n');

const ladderHtml = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>M46 立绘档位尺标</title>' +
  '<link rel="stylesheet" href="css/style.css">' +
  '<link rel="stylesheet" href="css/art.css">' +
  '<style>' + ladderCss + '</style></head><body>' +
  '<pre id="lad-out" style="display:none"></pre>' +
  '<div class="wrap">' +
  '<div class="title">M46 · 立绘档位尺标（地平线对齐，尺寸取自 css/art.css 真实规则）</div>' +
  '<div class="note">红色虚线 = 玩家头顶（111px）。改前的中 Boss（91px）压在虚线之下，M46 的 122px 升到线之上；大 Boss 130px 仍是全场最大。</div>' +
  '<div class="row">' +
  '<div id="ground"></div>' +
  '<div id="ref"><span>玩家头顶 111px</span></div>' +
  cellHtml +
  '</div></div>' +
  '<script>' + LADDER_MEASURE + '</script>' +
  '</body></html>';

fs.writeFileSync(LADDER_FILE, ladderHtml);
const LADDER_PNG = path.join(BASE, 'tests', 'm46-ladder.png');
let lad = {};
let ladFail = 0;
try {
  const ladDom = runEdge(LADDER_FILE, ['--dump-dom'], '1020,520');
  const lm = ladDom.match(/<pre id="lad-out"[^>]*>([\s\S]*?)<\/pre>/);
  if (!lm) {
    console.log('\n尺标图几何：读不到 #lad-out —— 页面脚本没跑完');
    ladFail++;
  } else {
    lm[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .split('\n').forEach(function (line) {
        const i = line.indexOf(' = ');
        if (i > 0) lad[line.slice(0, i).trim()] = line.slice(i + 3).trim();
      });
  }
  runEdge(LADDER_FILE, ['--screenshot=' + LADDER_PNG, '--hide-scrollbars'], '1020,330', 6000);
} finally {
  if (fs.existsSync(LADDER_FILE)) fs.unlinkSync(LADDER_FILE);
}
const ladderOk = fs.existsSync(LADDER_PNG) && fs.statSync(LADDER_PNG).size > 5000;
if (!ladderOk) ladFail++;

// 尺标图几何：参考线必须正好压在玩家头顶，地平线必须正好压在所有立绘脚下。
// 这几条不成立的话，图再好看也是假的 —— 尺标图的价值全在「线的位置是真的」。
console.log('\n【尺标图几何】');
const LAD = [
  ['groundSpread', '0.00', '五档立绘踩在同一条地平线上（脚底 y 无差）'],
  ['groundAtFeet', '0.00', '地平线的上边正好落在脚底（线不在空中、也不悬在脚下）'],
  ['refAboveFeet', '111.00', '参考线到脚底 111px —— 就是玩家身高的那一条'],
  ['playerTop', '0.00', '玩家头顶正好压在参考线上'],
  ['eliteOldTop', '20.00', '改前的中 Boss（91）头顶在参考线**下方** 20px —— 倒挂就长这样'],
  ['eliteNewTop', '-11.00', 'M46 的中 Boss（122）头顶升到参考线**上方** 11px'],
  ['bossTop', '-19.00', '大 Boss（130）仍在最高处（线上 19px）'],
  ['jsError', 'none', '尺标页无 JS 运行时错误'],
];
LAD.forEach(function (c) {
  const actual = lad[c[0]];
  const ok = actual === c[1];
  if (!ok) ladFail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + c[2] +
    (ok ? '' : '（期望 ' + c[1] + '，实际 ' + actual + '）'));
});
const totalFail = fail + ladFail;
console.log('\n尺标图：' + (ladderOk
  ? 'tests/m46-ladder.png（' + fs.statSync(LADDER_PNG).size + ' 字节）'
  : '生成失败（文件缺失或过小）'));
console.log('合计：' + (totalFail ? '有失败' : '全部通过') + '（真机 ' + CASES.length + ' 项 + 尺标 ' + LAD.length + ' 项）');

// ============================================================
// ③ 实战截图：中 Boss 战（铁颚督军 + 召唤的双头犬）
// 尺标图证明「档位对不对」，这张证明「真打起来是什么样」—— 两张一起看才敢定稿。
// ============================================================
const SHOT_FILE = path.join(BASE, '_m46-shot.html');
const SHOT_PNG = path.join(BASE, 'tests', 'm46-elite-battle.png');
const SHOT_SCRIPT = '<script>\n' + [
  '(function () {',
  '  Progress.reset();',
  '  App.boot({ fresh: true });',
  '  Combat.start(20261009, {',
  '    charId: "digger", hp: 70, maxHp: 75, depth: 15, locTag: "D15 · 铁颚督军",',
  '    deck: Run.state.deck, enemyId: "warlord",',
  '  });',
  '  Render.resetFeedback();',
  '  document.getElementById("view-map").hidden = true;',
  '  document.getElementById("view-combat").hidden = false;',
  '  Combat.addEnemy("hound");',
  '  Render.draw();',
  '})();',
  '</script>',
].join('\n');

fs.writeFileSync(SHOT_FILE, fs.readFileSync(path.join(BASE, 'index.html'), 'utf8')
  .replace('</body>', SHOT_SCRIPT + '\n</body>'));
try {
  runEdge(SHOT_FILE, ['--screenshot=' + SHOT_PNG, '--hide-scrollbars'], '1280,800', 9000);
} finally {
  if (fs.existsSync(SHOT_FILE)) fs.unlinkSync(SHOT_FILE);
}
const shotOk = fs.existsSync(SHOT_PNG) && fs.statSync(SHOT_PNG).size > 20000;
console.log('实战截图：' + (shotOk
  ? 'tests/m46-elite-battle.png（' + fs.statSync(SHOT_PNG).size + ' 字节）'
  : '生成失败'));

process.exit(totalFail ? 1 : 0);

