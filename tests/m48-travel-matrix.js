// M48b 断点 × 满编档 的实际行程矩阵 —— 改幅度之前先确认补偿没有漏洞。
// 若某一档的实际行程远低于标定目标，那不是「标定保守」，是漏补。
// ⚠️ 两处与 css/art.css 的待机周期硬绑定：travelOf 的采样窗口 `dur`
//   与下面的「半周期秒数」。改周期（M49：1.6s → 2.0s）必须同步改这两处，
//   否则算出的每帧位移是错的 —— 而错的方向恰好是「偏乐观」。
const path = require('path');
const { chromium } = require('playwright');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const arg = process.argv[2] || 'https://tower-descend-game-60674.app.workbuddy.host/';
// 传 'local' 或一个 file:// 路径，就量本地工程 —— 改完先本地量，别直接上线再验
const URL = arg === 'local'
  ? 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/')
  : arg;
console.log('目标：' + URL + '\n');
const WIDTHS = [1280, 1000, 900, 760, 640, 500, 390];

(async () => {
  const b = await chromium.launch({
    executablePath: EDGE, headless: false,
    args: ['--no-first-run', '--allow-file-access-from-files'],
  });
  const rows = [];
  for (const w of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const AppG = typeof App !== 'undefined' ? App : window.App;
      const CombatG = typeof Combat !== 'undefined' ? Combat : window.Combat;
      const ProgG = typeof Progress !== 'undefined' ? Progress : window.Progress;
      const RenderG = typeof Render !== 'undefined' ? Render : window.Render;
      const RunG = typeof Run !== 'undefined' ? Run : window.Run;
      if (!AppG || !CombatG || !RenderG) return { err: 'globals missing' };
      if (ProgG && ProgG.reset) ProgG.reset();
      AppG.boot({ fresh: true });
      CombatG.start(20261009, {
        charId: 'digger', hp: 70, maxHp: 75, depth: 3, locTag: 'M48',
        deck: RunG.state.deck, enemyId: 'warlord',
      });
      RenderG.resetFeedback();
      document.getElementById('view-map').hidden = true;
      document.getElementById('view-combat').hidden = false;
      RenderG.draw();
      await sleep(300);

      const el = document.querySelector('#enemy-panel .unit-art > img');
      const pel = document.querySelector('.unit-art-player > img');
      const stage = document.querySelector('.battle-stage');
      const cs = el ? getComputedStyle(el) : null;
      const root = getComputedStyle(document.documentElement);
      const artCS = el ? getComputedStyle(el.parentElement) : null;

      // 实测行程：覆盖整个 2.0s 周期（M49）。采样窗口必须 ≥ 周期，
      // 否则只截到相位的一段，量出来的「行程」会偏小 —— 那是测量误差，
      // 不是幅度小（这个坑和「周期残留」那次一样，都是读数骗人）。
      async function travelOf(target) {
        if (!target) return null;
        const N = 100, dur = 2000;   // ← 必须与 css/art.css 的 idle-ground 周期一致
        let mn = 1e9, mx = -1e9;
        for (let i = 0; i < N; i++) {
          const rc = target.getBoundingClientRect();
          mn = Math.min(mn, rc.top); mx = Math.max(mx, rc.top);
          await sleep(dur / N);
        }
        return +(mx - mn).toFixed(2);
      }
      return {
        bmScale: (root.getPropertyValue('--bm-scale') || '1').trim(),
        crowd: stage ? (getComputedStyle(stage).getPropertyValue('--crowd') || '1').trim() : '1',
        stageAttr: stage ? stage.getAttribute('data-crowd') : '?',
        idleSx: artCS ? (artCS.getPropertyValue('--idle-sx') || '').trim() : '',
        idleSy: artCS ? (artCS.getPropertyValue('--idle-sy') || '').trim() : '',
        enemyH: el ? +getComputedStyle(el).height.replace('px', '') : 0,
        playerH: pel ? +getComputedStyle(pel).height.replace('px', '') : 0,
        enemyAnim: cs ? cs.animationName : '',
        enemyTravel: await travelOf(el),
        playerTravel: await travelOf(pel),
      };
    });
    rows.push({ w, ...r });
    await p.close();
  }
  await b.close();

  console.log('宽度  bmScale  --crowd  idleSy   敌高   敌起伏  玩家高  玩家起伏  敌动画');
  console.log('─'.repeat(96));
  for (const r of rows) {
    if (r.err) { console.log(String(r.w).padEnd(6) + 'ERR ' + r.err); continue; }
    console.log(
      String(r.w).padEnd(6) +
      String(r.bmScale).padEnd(9) +
      String(r.crowd).padEnd(9) +
      String(r.idleSy).padEnd(8) +
      String(r.enemyH + 'px').padEnd(7) +
      String(r.enemyTravel + 'px').padEnd(8) +
      String(r.playerH + 'px').padEnd(8) +
      String(r.playerTravel + 'px').padEnd(10) +
      r.enemyAnim
    );
  }
  console.log('\n== 可见性判据：每帧位移（M48 真正的失效指标）==');
  console.log('   阈值 ≥ 0.10px/帧。低于此值动画「在跑」但逐帧几乎无差，人眼读不出。');
  let fail = 0, measured = 0;
  for (const r of rows) {
    if (r.err || !r.enemyTravel) continue;
    measured++;
    const perFrame = (r.enemyTravel * 1.5) / (1.0 * 60);   // 半周期 2.0s / 2 = 1.0s（M49）
    const ok = perFrame >= 0.10;
    if (!ok) fail++;
    console.log(`  ${String(r.w).padEnd(6)} 行程 ${String(r.enemyTravel + 'px').padEnd(8)} 每帧 ${perFrame.toFixed(3)}px  ${ok ? 'PASS' : 'FAIL ← 亚像素'}`);
  }
  // 全称断言前必须先断言集合非空（空集会让 forEach 一次不跑，退出码仍是 0）
  if (measured === 0) {
    console.log('\nFAIL: 一个断点都没量到 —— 采集本身失败，不是有 0 个不达标');
    process.exit(1);
  }
  console.log(`\n合计：${measured} 个断点采样，${fail} 个跌破可见阈值`);
  process.exit(fail ? 1 : 0);
})();
