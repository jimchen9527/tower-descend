// M47 · 角色待机呼吸微动：可见化验收件（循环 GIF）
//
// ── 为什么需要这个文件 ────────────────────────────────────────
// 用户反馈「角色微动 / 呼吸感没有了」。查下来的结论分两半：
//
//   ① 本地代码没坏。M45 已把 idle-ground 从写死的 scale(1.008,.988)
//      改成按绝对行程反推的 scale(var(--idle-sx), var(--idle-sy))，
//      小怪行程 2.19px（可见阈值）。真机 headed 探针实测：
//      脚底位移 0.00px、身体位移 2.19px（小怪）/ 3.66px（中 Boss）。
//
//   ② 线上没更新。线上跑的还是 M43 的旧比例 —— 立绘已被 M44 压到 73px，
//      同一个 1.2% 只剩 0.88px，亚像素级、重采样一糊就平 = 肉眼「不动」。
//      （M44/M45 从未上线，见 WORKLOG「线上」行。）
//
// 但**静态截图证明不了呼吸**：截图环境（headless Edge）恒报
// prefers-reduced-motion: reduce，`.unit-art > img` 那条 animation 规则
// 整条落在 @media (prefers-reduced-motion: no-preference) 里不生效 ——
// 拍出来必然是静止的，代码对不对都一样。所以这里换成**相位定格连拍**：
// 一个周期切 12 帧拼成循环 GIF，呼吸感是直接看得见的，不靠我报数字。
//
// ── 怎么在恒 reduce 的环境里让动画真的生效 ──────────────────
// 不去跟浏览器的 reduce 偏好对抗（试过 --force-prefers-reduced-motion=0、
// --disable-features=PrefersReducedMotion，都无效，见 art.css 注释）。
// 改走正路：**从 art.css 源文本里把 no-preference 媒体块的规则原样抽出来**，
// 以普通 <style> 注入 —— 于是浏览器执行的是**产品 CSS 里那套真实的
// keyframes 与真实的时间函数**，只有「要不要播」这一个开关被打开了。
// 幅度、轴心、时长全是原值，不是我在 JS 里另算的一套。
//
// 相位定格：animation-delay 设负值 + animation-play-state: paused
// → 停在周期内第 p 帧。定完再量 DOMMatrix 与 rect，自报数据。
//
// 物理约束（M26 定稿，用户当年一眼否掉过translateY 版本）：
//   接地单位 transform-origin 钉脚底、translate 分量恒 0
//   → 脚部像素立定，只有身体微起伏。站着的不能飘。
//
// 运行：node tests/m47-breath-gif.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const STAGE = path.join(BASE, '_m47-breath.html');
const FRAME_DIR = path.join(__dirname, '_m47-frames');
const GIF = path.join(__dirname, 'm47-breathing.gif');

const FRAMES = 12;   // 2.8s 周期切 12 帧 → 每帧 233ms，接近真实播放节奏
const FPS = 15;
const DW = 980, DH = 300;

const CELLS = [
  { key: '小怪', sub: 'rats · 73px', cls: 'unit-art', src: 'preview-assets-v3/rats-cut.png' },
  { key: '玩家', sub: 'digger · 111px', cls: 'unit-art unit-art-player', src: 'preview-assets-v3/digger-cut.png' },
  { key: '中 Boss', sub: 'warlord · 122px', cls: 'unit-art art-kind-elite', src: 'preview-assets-v3/warlord-cut.png' },
  { key: '大 Boss', sub: 'rust_crown · 130px', cls: 'unit-art art-kind-boss', src: 'preview-assets-v3/rust_crown-cut.png' },
];

// ---------- 从 art.css 抽出 no-preference 媒体块的规则 ----------
// 用括号配平扫描，不用正则（规则里有嵌套的 {} 和媒体查询）。
function extractNoPreferenceRules(cssText) {
  const at = cssText.indexOf('@media (prefers-reduced-motion: no-preference)');
  if (at < 0) return '';
  const open = cssText.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < cssText.length; i++) {
    if (cssText[i] === '{') depth++;
    else if (cssText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return end < 0 ? '' : cssText.slice(open + 1, end);
}

const ART_CSS = fs.readFileSync(path.join(BASE, 'css', 'art.css'), 'utf8');
const UNWRAPPED = extractNoPreferenceRules(ART_CSS);

const stageHtml = [
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<title>M47 待机呼吸 · 相位定格</title>',
  '<link rel="stylesheet" href="css/style.css">',
  '<link rel="stylesheet" href="css/art.css">',
  // 解包后的规则：只有「要不要播」被打开，keyframes / 时长 / 时间函数全是产品原值
  '<style>' + UNWRAPPED + '</style>',
  '<style>',
  'html, body { margin: 0; background: #F7F6F1; }',
  '.wrap { padding: 16px 24px 6px; font-family: "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }',
  '.title { font-size: 15px; font-weight: 700; color: #2C2C2A; }',
  '.note { font-size: 11px; color: #888780; margin: 3px 0 10px; }',
  '.row { position: relative; display: flex; align-items: flex-end; gap: 30px; min-height: 158px; }',
  // 地平线 = 脚底。验收「脚不动」就看四档的脚有没有离开这条线
  '.row::after { content: ""; position: absolute; left: 0; right: 0; bottom: 34px; border-top: 2px solid #B4B2A9; }',
  '.col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }',
  '.slot { display: flex; align-items: flex-end; height: 134px; }',
  '.cap { height: 34px; margin-top: 6px; font-size: 11px; color: #5F5E5A; line-height: 1.5; text-align: center; white-space: nowrap; }',
  '.cap b { display: block; font-size: 12px; color: #2C2C2A; }',
  // ⚠️ 这里刻意**不加** animation:none —— 那会把待机动效整条关掉，
  //    拍出来必然静止，等于白测（M46 尺标图踩过这个坑）。
  '</style></head><body><div class="wrap">',
  '<div class="title">M47 · 待机呼吸（脚立定 · 身体微起伏）</div>',
  '<div class="note">2.8s 周期切 12 帧循环；灰线是脚底地平线，四档的脚都不该离开它。</div>',
  '<div class="row">',
  CELLS.map(function (c) {
    return '<div class="col"><div class="slot"><div class="' + c.cls + '">' +
      '<img class="unit-bm" src="' + c.src + '" alt="" draggable="false">' +
      '</div></div><div class="cap"><b>' + c.key + '</b>' + c.sub + '</div></div>';
  }).join(''),
  '</div></div></body></html>',
].join('\n');

const span = function (a) { return Math.max.apply(null, a) - Math.min.apply(null, a); };

(async function () {
  if (!fs.existsSync(EDGE)) { console.error('找不到 Edge：' + EDGE); process.exit(2); }
  if (!UNWRAPPED.trim()) { console.error('art.css 里没找到 no-preference 媒体块'); process.exit(2); }
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.writeFileSync(STAGE, stageHtml);

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: DW, height: DH }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e)); });

  const url = 'file:///' + STAGE.split(path.sep).join('/');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(function () {
    return [].slice.call(document.images).every(function (i) { return i.complete && i.naturalWidth > 0; });
  }, { timeout: 20000 });

  const reduce = await page.evaluate(function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const live = await page.evaluate(function () {
    var el = document.querySelector('.unit-art > img');
    return el ? getComputedStyle(el).animationName : 'no-img';
  });
  console.log('环境 reduce=' + reduce + '（恒真，靠解包媒体块绕过）· 动画解包后实得：' + live);
  if (live === 'none') { console.error('解包失败 —— 动画规则仍未生效，中止'); await browser.close(); process.exit(2); }

  const rows = [];
  for (let i = 0; i < FRAMES; i++) {
    const p = i / FRAMES;
    const info = await page.evaluate(function (p) {
      var els = document.querySelectorAll('.unit-art > img');
      var out = [];
      els.forEach(function (el) {
        // 大 Boss 周期 4.2s（art.css 里 animation-duration），其余 2.8s
        var dur = el.closest('.art-kind-boss') ? 4.2 : 2.8;
        el.style.animationPlayState = 'paused';
        el.style.animationDelay = (-p * dur).toFixed(3) + 's';
      });
      // 读一次强制回流，让 paused 的新 delay 立刻落到矩阵上
      void document.body.offsetHeight;
      els.forEach(function (el) {
        var m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        var r = el.getBoundingClientRect();
        out.push({
          sx: +m.a.toFixed(4), sy: +m.d.toFixed(4),
          top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2),
          left: +r.left.toFixed(2), right: +r.right.toFixed(2),
        });
      });
      return out;
    }, p);
    rows.push({ p: p, info: info });
    const file = path.join(FRAME_DIR, 'f' + String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: DW, height: DH } });
  }
  await browser.close();

  // ---- 数字核对：脚立定 + 身体起伏够不够可见 ----
  console.log('\n相位扫描（12 帧 / 一整个周期）：');
  const keys = ['小怪', '玩家', '中 Boss', '大 Boss'];
  let footBad = false, bodyBad = false;
  keys.forEach(function (k, ci) {
    const tops = rows.map(function (r) { return r.info[ci].top; });
    const bots = rows.map(function (r) { return r.info[ci].bottom; });
    const sxs = rows.map(function (r) { return r.info[ci].sx; });
    const foot = span(bots), body = span(tops);
    if (foot > 0.5) footBad = true;
    if (body < 1.5) bodyBad = true;
    console.log('  ' + k.padEnd(7) +
      ' 身体起伏 ' + body.toFixed(2).padStart(5) + 'px' +
      '   脚底位移 ' + foot.toFixed(2) + 'px' +
      '   横向呼吸 ' + (Math.max.apply(null, sxs) - Math.min.apply(null, sxs)).toFixed(4));
  });
  console.log('\n脚立定：' + (footBad ? '✗ 有单位在飘' : '✓ 四档全部立定') +
    '     身体在动：' + (bodyBad ? '✗ 有档位幅度不足 1.5px（亚像素＝看不见）' : '✓ 四档均超可见阈值'));
  if (errs.length) console.log('页面错误：' + errs.join(' | '));

  // ---- 拼 GIF ----
  const pyLines = [
    'from PIL import Image',
    'import glob, os',
    'fs = sorted(glob.glob(r"' + FRAME_DIR.split(path.sep).join('/') + '/f*.png"))',
    'ims = [Image.open(f).convert("P", palette=Image.ADAPTIVE) for f in fs]',
    'ims[0].save(r"' + GIF.split(path.sep).join('/') + '", save_all=True, append_images=ims[1:], duration=' +
      Math.round(1000 / FPS) + ', loop=0, optimize=True, disposal=2)',
    'print("帧数", len(ims), "字节", os.path.getsize(r"' + GIF.split(path.sep).join('/') + '"))',
  ];
  const pyFile = path.join(BASE, '_m47_gif.py');
  fs.writeFileSync(pyFile, pyLines.join('\n'));
  // 优先用隔离 venv（pillow 装在那里）；系统/托管 python 没有 PIL
  const venvPy = path.join(path.dirname(process.execPath), '..', '..', 'python', 'envs', 'default', 'Scripts', 'python.exe');
  const cands = [venvPy, process.execPath,
    'C:/Users/Jimchen/.workbuddy/binaries/python/envs/default/Scripts/python.exe'];
  let pyDone = false;
  for (const exe of cands) {
    if (!fs.existsSync(exe)) continue;
    try {
      console.log('GIF：' + execFileSync(exe, [pyFile], { encoding: 'utf8' }).trim());
      pyDone = true;
      break;
    } catch (e) {
      console.log('  ' + exe.split(path.sep).pop() + ' 用不了：' + String(e.stderr || e.stdout || e).split('\n').filter(Boolean).pop());
    }
  }
  if (!pyDone) console.log('GIF 拼接失败：找不到可用的 python + Pillow');
  fs.unlinkSync(pyFile);
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.rmSync(STAGE, { force: true });

  const ok = !footBad && !bodyBad && fs.existsSync(GIF) && fs.statSync(GIF).size > 20000;
  console.log('产物：tests/m47-breathing.gif' +
    (fs.existsSync(GIF) ? '（' + fs.statSync(GIF).size + ' 字节）' : '（缺失）'));
  process.exit(ok ? 0 : 1);
})();