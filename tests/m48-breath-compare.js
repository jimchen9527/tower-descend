// M48 待机动态：改前(M45 3% / 2.8s) vs 改后(M48 6% / 1.6s) 并排实时对比 GIF。
//
// 为什么重做而不是复用 M47 那个：
//   ① M47 那个只放改后，读者没有参照物，看不出「问题修好了」；
//   ② 更要紧的是它**只截图**——GIF 帧是定格的，看不出「实时动不出」。
//      本次两栏用**各自真实周期**切帧，帧间隔按真实播放节奏给
//      （每栏 14 帧 / 其周期），所以左栏会明显「慢到看不出在动」，
//      右栏的起伏一眼可辨 —— 这正是线上会呈现的差异。
//
// 环境说明：无头浏览器恒报 prefers-reduced-motion: reduce，
// 所以从 css/art.css 源文本里把 no-preference 媒体块原样解包注入
// —— 执行的是产品 CSS 里的真实 keyframes 与时间函数，只打开「要不要播」。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const STAGE = path.join(BASE, '_m48-breath.html');
const FRAME_DIR = path.join(__dirname, '_m48-frames');
const GIF = path.join(__dirname, 'm48-breath-compare.gif');
const PY = 'C:/Users/Jimchen/.workbuddy/binaries/python/envs/default/Scripts/python.exe';

const FRAMES = 14;
const DW = 1120, DH = 500;
const OLD_DUR = 2.8;   // M45 旧周期
const NEW_DUR = 1.6;   // M48 新周期

// 两栏同一套立绘，只换动画参数 —— 变量只有「幅度 + 周期」
const ROWS = [
  { key: '小怪', src: 'rats-cut.png' },
  { key: '玩家', src: 'digger-cut.png', player: true },
  { key: '中 Boss', src: 'warlord-cut.png', elite: true },
  { key: '大 Boss', src: 'rust_crown-cut.png', boss: true },
];

// 旧参数：M45 的 .unit-art 基准（3%）+ 2.8s
const OLD_VARS = { sx: '1.0200', sy: '.9700' };
const NEW_VARS = { sx: '1.0400', sy: '.9400' };

function cellHtml(row, side) {
  const cls = 'unit-art' + (row.elite ? ' art-kind-elite' : '') +
    (row.boss ? ' art-kind-boss' : '') + (row.player ? ' unit-art-player' : '');
  const v = side === 'old' ? OLD_VARS : NEW_VARS;
  return '<div class="col">' +
    '<div class="art-slot"><div class="' + cls + '" style="--idle-sx:' + v.sx + ';--idle-sy:' + v.sy + '">' +
    '<img class="unit-bm" src="preview-assets-v3/' + row.src + '" alt="">' +
    '</div></div></div>';
}

const css = [
  'html,body{margin:0;background:#F7F6F1;}',
  '.wrap{padding:16px 20px 4px;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;}',
  // 标题与面板同属一个 .side 容器，标题永远贴着自己那栏
  // （初版把标题抽成平行的 .hd 行，两栏高度不一致时右栏标题压到了左栏立绘上）。
  '.side{margin-bottom:12px;}',
  '.htitle{font-size:14px;font-weight:700;line-height:1.3;}',
  '.hsub{font-size:10.5px;color:#888780;line-height:1.35;margin:1px 0 7px;}',
  '.side-old .htitle{color:#185FA5;}',
  '.side-new .htitle{color:#A32D2D;}',
  '.panel{display:flex;gap:16px;padding:6px 10px 8px;position:relative;' +
    'border:1px solid #E4E2DA;border-radius:4px;}',
  '.panel::after{content:"";position:absolute;left:10px;right:10px;bottom:32px;border-top:2px solid #B4B2A9;}',
  '.col{flex:1;display:flex;flex-direction:column;align-items:center;}',
  '.art-slot{display:flex;align-items:flex-end;height:190px;}',
  '.cap{height:24px;font-size:11px;color:#5F5E5A;line-height:1.35;text-align:center;}',
  '.cap b{display:block;font-size:12px;color:#2C2C2A;}',
].join('\n');

const stageHtml = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>M48 待机动态改前/改后对比</title>' +
  '<link rel="stylesheet" href="css/style.css">' +
  '<link rel="stylesheet" href="css/art.css">' +
  '<style>' + css + '</style></head><body><div class="wrap">' +
  // 标题与面板同属一个 side 容器，标题永远贴着自己那栏 ——
  // 分成两个平行的 .hd/.panel 行时，两者高度一旦不一致就会错位。
  '<div class="side side-old">' +
  '<div class="htitle">改前 · M45</div>' +
  '<div class="hsub">幅度 3%（起伏 3.66px）／周期 2.8s → 每帧位移 0.065px（亚像素，肉眼读不出）</div>' +
  '<div class="panel">' + ROWS.map((r) => cellHtml(r, 'old')).join('') + '</div>' +
  '</div>' +
  '<div class="side side-new">' +
  '<div class="htitle">改后 · M48</div>' +
  '<div class="hsub">幅度 6%（起伏 7.32px）／周期 1.6s → 每帧位移 0.229px（明确可见）</div>' +
  '<div class="panel">' + ROWS.map((r) => cellHtml(r, 'new')).join('') + '</div>' +
  '</div>' +
  '</div></body></html>';

fs.writeFileSync(STAGE, stageHtml);

(async function () {
  if (!fs.existsSync(EDGE)) { console.error('找不到 Edge'); process.exit(2); }
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--disable-gpu', '--no-first-run', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: DW, height: DH }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto('file:///' + STAGE.split(path.sep).join('/'), { waitUntil: 'load' });
  await page.waitForFunction(function () {
    return [].slice.call(document.images).every((i) => i.complete && i.naturalWidth > 0);
  }, { timeout: 20000 });

  const live = await page.evaluate(function () {
    const el = document.querySelector('.unit-art > img');
    return el ? getComputedStyle(el).animationName : 'no-img';
  });
  console.log('解包后实得动画：' + live);
  if (live === 'none') { console.error('解包失败，中止'); await browser.close(); process.exit(2); }

  const geo = [];
  for (let i = 0; i < FRAMES; i++) {
    // 每栏按各自真实周期切帧：左栏 2.8s 切 14 帧、右栏 1.6s 切 14 帧
    geo.push(await page.evaluate(function (a) {
      var i = a.i, n = a.n, od = a.od, nd = a.nd;
      var ps = i / n;
      [].slice.call(document.querySelectorAll('.side-old .unit-art > img')).forEach(function (el) {
        el.style.animationPlayState = 'paused';
        el.style.animationDelay = (-ps * od).toFixed(3) + 's';
      });
      [].slice.call(document.querySelectorAll('.side-new .unit-art > img')).forEach(function (el) {
        var dur = el.closest('.art-kind-boss') ? 2.6 : nd;
        el.style.animationPlayState = 'paused';
        el.style.animationDelay = (-ps * dur).toFixed(3) + 's';
      });
      void document.body.offsetHeight;
      return null;
    }, { i: i, n: FRAMES, od: OLD_DUR, nd: NEW_DUR }));
    await page.screenshot({ path: path.join(FRAME_DIR, 'f' + String(i).padStart(2, '0') + '.png') });
  }
  await browser.close();
  if (errs.length) console.log('页面错误：' + errs.slice(0, 3).join(' | '));

  const pyFile = path.join(__dirname, '_m48_gif.py');
  fs.writeFileSync(pyFile, [
    'from PIL import Image',
    'import os',
    'd = r"' + FRAME_DIR + '"',
    'fs = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".png")]',
    'fs.sort()',
    'ims = [Image.open(f).convert("RGB") for f in fs]',
    'ims[0].save(r"' + GIF + '", save_all=True, append_images=ims[1:],',
    '              duration=' + Math.round((NEW_DUR / FRAMES) * 1000) + ', loop=0)',
    'print(len(ims), "frames ->", os.path.getsize(r"' + GIF + '"), "bytes")',
  ].join('\n'));
  try {
    console.log('GIF：' + execFileSync(PY, [pyFile], { encoding: 'utf8' }).trim());
  } catch (e) {
    console.log('GIF 失败：');
    console.log('  stdout: ' + String(e.stdout || '(空)'));
    console.log('  stderr: ' + String(e.stderr || '(空)'));
    console.log('  msg:    ' + String(e.message || '').slice(0, 200));
    if (!fs.existsSync(GIF)) {
      console.log('  帧目录保留供检查：' + FRAME_DIR);
      console.log('  实际帧数：' + fs.readdirSync(FRAME_DIR).length);
      return;
    }
  } finally {
    // ⚠️ 这里**不能**删 tests/_m48_gif.py —— 它是独立可复跑的 GIF 拼接脚本，
    // 由 Bash 顺序调用（node 内 spawn python 会 EBUSY：venv 的 python.exe
    // 句柄在 Windows 上未及时释放）。初版在 finally 里删掉它，
    // 结果每轮都要重建，害我连丢两次。
    // 帧目录也保留 —— PIL 报错时还要靠它重拼。
    // 清理：rm -rf tests/_m48-frames
    fs.rmSync(STAGE, { force: true });
  }
})();
