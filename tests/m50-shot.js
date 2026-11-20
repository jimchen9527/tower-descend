// M50 目检脚本：把三关的新敌人 / 复数编队 / 强化标记摆出来截图。
//
// 为什么要有它：断言能证明「类名在、徽章在、尺寸没变」，但证明不了
// 「这东西看着像不像一只新怪」。新剪影是手画的 SVG，22~122px 下糊不糊
// 只能看图。所以每个新形象至少留一张实拍。
//
// 运行：node tests/m50-shot.js
// 产出：tests/m50-{seg2,seg3,bossmap}.png

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TMP = path.join(BASE, '_m50-shot.html');

// 每个场景：一段进场脚本（在 index.html 末尾执行）+ 输出文件名 + 视口
const SCENES = [
  {
    file: 'm50-seg2.png',
    size: '1440,900',
    // 第二关：一只壮大的鼠群（带「暴戾」）+ 一只电弧焊工（带「铁甲」）
    boot: `
      Progress.reset();
      App.boot({ fresh: true });
      Combat.start(20261011, {
        charId: 'digger', hp: 58, maxHp: 75, depth: 18,
        locTag: '废墟层 · D18 · 小怪 · 锈牙鼠王 + 电弧焊工',
        deck: Run.state.deck, enemyId: 'rats',
        enemies: [
          { id: 'rat_king', affixes: ['atk_up'] },
          { id: 'arc_welder', affixes: ['armored'] }
        ]
      });
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      document.getElementById('turn-box').hidden = false;
      Render.resetFeedback(); Render.draw();`,
  },
  {
    file: 'm50-seg3.png',
    size: '1440,900',
    // 第三关：三只编队 —— 第三关专属的两只 + 一只有词缀的桩击机
    boot: `
      Progress.reset();
      App.boot({ fresh: true });
      Combat.start(20261012, {
        charId: 'medic', hp: 61, maxHp: 75, depth: 29,
        locTag: '废墟层 · D29 · 小怪 · 菌壳矛兵 + 菌索爬行体 + 破桩者',
        deck: Run.state.deck, enemyId: 'husk_lancer',
        enemies: [
          { id: 'husk_lancer' },
          { id: 'cord_creeper', affixes: ['regen'] },
          { id: 'piledriver_breach', affixes: ['thorned'] }
        ]
      });
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      document.getElementById('turn-box').hidden = false;
      Render.resetFeedback(); Render.draw();`,
  },
  {
    file: 'm50-boss.png',
    size: '1440,900',
    // 强化版大 Boss + 「之前 Boss 的强化版」僚机（锈冠缩水回归）
    boot: `
      Progress.reset();
      App.boot({ fresh: true });
      Combat.start(20261013, {
        charId: 'keeper', hp: 66, maxHp: 75, depth: 33,
        locTag: '废墟层 · D33 · 强化的无首执械者 + 强化的锈冠',
        deck: Run.state.deck, enemyId: 'headless_executor',
        enemies: [
          { id: 'headless_executor', variant: 'empowered', affixes: ['hp_up', 'atk_up'] },
          { id: 'rust_crown', variant: 'empowered', affixes: ['thorned'], hpMul: 0.26 }
        ]
      });
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      document.getElementById('turn-box').hidden = false;
      Render.resetFeedback(); Render.draw();`,
  },
  {
    file: 'm50-elite-icons.png',
    size: '1440,900',
    // 地图上三关的中 Boss 图标：把三段各一层的精英节点摆在同一屏
    boot: `
      Progress.reset();
      App.boot({ fresh: true });
      var s = Run.state;
      // 把三层精英节点全部标成「当前可选」，并分别落在 D5 / D16 / D27
      s.map.layers.forEach(function (l) {
        l.forEach(function (n) { s.visited[n.id] = true; s.cleared[n.id] = true; });
      });
      var cur = s.map.layers[4][0];
      s.currentId = cur.id;
      cur.type = 'elite';
      s.cleared[cur.id] = false;
      var mid = null, deep = null;
      s.map.layers.forEach(function (l) {
        l.forEach(function (n) {
          if (n.depth === 16 && !mid) mid = n;
          if (n.depth === 27 && !deep) deep = n;
        });
      });
      [mid, deep].forEach(function (n) {
        if (!n) return;
        n.type = 'elite';
        n.edges.forEach(function (e) { s.cleared[e] = true; });
        s.cleared[n.id] = false;
      });
      App.showMap();
      var sc = document.querySelector('.mapscroll');
      if (sc) sc.scrollTop = Math.max(0, document.querySelector('.mnode.is-cur').offsetTop - 220);`,
  },
];

// 图鉴页：不走游戏流程，直接把六只新敌人的剪影与三枚分关中 Boss 图标
// 并排画出来 —— 游戏内截图有背景与光晕干扰，认轮廓还是这种干净。
// art.js 是「零素材、随 CSS 换色」的纯函数库，单独引它就能跑。
const ROSTER_FILE = path.join(BASE, '_m50-roster.html');
const ROSTER_OUT = path.join(__dirname, 'm50-roster.png');
const rosterHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="css/art.css"><style>
  body { margin: 24px; background: #F1EFE8; color: #3E3C36;
         font: 14px/1.6 "Microsoft YaHei", sans-serif; }
  h2 { margin: 18px 0 8px; font-size: 15px; }
  .grid { display: flex; flex-wrap: wrap; gap: 26px; }
  .cell { width: 132px; text-align: center; }
  .cell .box { height: 132px; display: grid; place-items: center; }
  .cell .box svg { width: 108px; height: 108px; }
  .cell b { font-weight: 600; }
  .cell i { font-style: normal; color: #8A8578; font-size: 12px; }
  .node .box svg { width: 44px; height: 44px; }
  .k1 { color: #4A4A48; } .k2 { color: #7A5417; }
</style></head><body>
<h2>M50 新敌人剪影（游戏内没有位图时就是它们）</h2>
<div class="grid" id="enemies"></div>
<h2>中 Boss 节点图标 —— 按关段分三种</h2>
<div class="grid node" id="nodes"></div>
<script src="js/ui/art.js"></script>
<script>
var E = [['arc_welder','电弧焊工','第二关'],['pile_driver','桩击机','第二关'],
         ['husk_lancer','菌壳矛兵','第三关'],['cord_creeper','菌索爬行体','第三关'],
         ['centurion','锈蚀百夫长','第二关中Boss'],['stitch_tyrant','缝合暴君','第三关中Boss']];
document.getElementById('enemies').innerHTML = E.map(function (p) {
  return '<div class="cell ' + (p[2].indexOf('中') >= 0 ? 'k2' : 'k1') + '">' +
    '<div class="box">' + Art.enemy(p[0]) + '</div><b>' + p[1] + '</b><br><i>' + p[2] + '</i></div>';
}).join('');
var N = [[3,'第一关 · 尖刺头盔'],[16,'第二关 · 双盾方阵'],[28,'第三关 · 菌盖冠']];
document.getElementById('nodes').innerHTML = N.map(function (p) {
  return '<div class="cell k2"><div class="box">' + Art.node('elite', p[0]) +
    '</div><b>' + p[1].split(' · ')[1] + '</b><br><i>D' + p[0] + ' 一带</i></div>';
}).join('');
</script></body></html>`;
fs.writeFileSync(ROSTER_FILE, rosterHtml);

const html = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');

const made = [];
for (const sc of SCENES) {
  fs.writeFileSync(
    TMP,
    html.replace('</body>', '<script>' + sc.boot + '</script>\n</body>')
  );
  const out = path.join(__dirname, sc.file);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-m50-shot',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--virtual-time-budget=6000',
    '--window-size=' + sc.size,
    '--screenshot=' + out,
    'file:///' + TMP.replace(/\\/g, '/'),
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  const ok = fs.existsSync(out) && fs.statSync(out).size > 20000;
  made.push((ok ? '  [ok]   ' : '  [FAIL] ') + sc.file +
    (ok ? '（' + Math.round(fs.statSync(out).size / 1024) + ' KB）' : '（没产出）'));
}

// ---- 图鉴页截图 ----
fs.writeFileSync(ROSTER_OUT, '');
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-m50-shot',
  '--hide-scrollbars',
  '--virtual-time-budget=4000',
  '--window-size=1040,760',
  '--screenshot=' + ROSTER_OUT,
  'file:///' + ROSTER_FILE.replace(/\\/g, '/'),
], { stdio: ['ignore', 'ignore', 'ignore'] });
if (fs.existsSync(ROSTER_FILE)) fs.unlinkSync(ROSTER_FILE);
const rosterOk = fs.existsSync(ROSTER_OUT) && fs.statSync(ROSTER_OUT).size > 20000;

if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
console.log('\nM50 目检截图：');
made.forEach((m) => console.log(m));
console.log((rosterOk ? '  [ok]   ' : '  [FAIL] ') + 'm50-roster.png（新敌人 + 中 Boss 图标图鉴）');
process.exit(made.some((m) => m.indexOf('[FAIL]') >= 0) || !rosterOk ? 1 : 0);
