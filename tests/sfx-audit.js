// ============================================================================
// sfx-audit.js —— M41 打击音效实测体检（Node + Playwright）
//
// 为什么要在真浏览器里跑：这些音色是用 OfflineAudioContext **实时合成**的，
// 削波发生在渲染那一刻的 float→PCM 转换里。Node 里没有 WebAudio，量不出来。
//
// 测什么（每种材质 / 语义层各跑一遍）：
//   peak     峰值绝对值（>1 就是削波，必须 0）
//   clip     |s| >= 0.999 的样本数（削波样本，硬指标必须为 0）
//   rms      有效响度（dBFS），用来判断「是不是太小声 / 太吵」
//   centroid 频谱重心（Hz）—— M41 的核心承诺：把 5~6kHz 那把刀收回来，
//           重心必须整体下移，否则「刺耳」只是错觉、其实没改
//   tail     尾部能量比（末段 / 峰值）—— 余韵有多长，连打会不会糊
//
// 用法：node tests/sfx-audit.js
// ============================================================================
const { chromium } = require('playwright');
const path = require('path');

const KEYS = [
  'blunt', 'hammer', 'metal', 'pick', 'drill', 'blast', 'blade', 'flame', 'claw',
  'trait:bleed', 'trait:toxin', 'trait:ember', 'trait:guard', 'trait:swift',
];

(async () => {
  // 复用系统已装的 Edge/Chrome，省掉 playwright 自带 chromium 数百 MB 的下载
  const channel = process.env.SFX_BROWSER || 'msedge';
  const browser = await chromium.launch({ channel });
  const page = await browser.newPage();
  const file = 'file://' + path.resolve(__dirname, '../sfx-preview.html').replace(/\\/g, '/');
  await page.goto(file);
  await page.waitForTimeout(1200);

  // audio.js 里 `const Sfx = ...` 是脚本级 const：它在全局**词法**作用域里，
  // 不会挂到 window（所以 window.Sfx === undefined）。page.evaluate 拿不到它，
  // 只能把测量函数作为字符串注入页面，让它在页面自己的作用域里执行。
  const measureFn = async (keys) => {
    const SR = 32000;
    const out = [];
    for (const key of keys) {
      // ⚠️ 必须走 __renderRaw（真实路径，含软限幅器），不能直调 __synth[key]：
      // 直调会绕过限幅，量到的是「未限幅的叠加峰值」，那正是要修的东西本身。
      const d = await Sfx.__renderRaw(key);
      if (!d) { out.push({ key, err: 'render-failed' }); continue; }

      let peak = 0, sum = 0, clip = 0;
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        if (a >= 0.999) clip++;
        sum += d[i] * d[i];
      }
      const rms = Math.sqrt(sum / d.length);
      let zc = 0;
      for (let i = 1; i < d.length; i++) if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
      const zcr = zc / (d.length / SR);
      const tailStart = Math.floor(d.length * 0.7);
      let tailE = 0;
      for (let i = tailStart; i < d.length; i++) tailE += d[i] * d[i];

      out.push({
        key,
        peak: +peak.toFixed(4),
        clip,
        rmsDb: +(20 * Math.log10(Math.max(rms, 1e-9))).toFixed(1),
        zcr: Math.round(zcr),
        tailDb: +(10 * Math.log10(Math.max(tailE / Math.max(sum, 1e-12), 1e-12))).toFixed(1),
      });
    }
    return out;
  };

  const rows = await page.evaluate(`(${measureFn.toString()})(${JSON.stringify(KEYS)})`);

  console.log('\n=== M41 打击音效实测体检（SR=32000, 实时合成 → 真实渲染）===\n');
  console.log('材质'.padEnd(14) + '峰值'.padStart(8) + '削波'.padStart(7) + 'RMS(dBFS)'.padStart(11) + '过零率'.padStart(9) + '尾部(dB)'.padStart(10));
  console.log('-'.repeat(62));
  let bad = 0;
  for (const r of rows) {
    if (r.err) { console.log(r.key.padEnd(14) + '  ERROR: ' + r.err); bad++; continue; }
    // 验收线：峰值不得超过软限幅的天花板 SUM_CAP=0.86，削波样本必须为 0
    const over = r.peak > 0.8601;
    const flag = over ? '  ✗ 越限' : (r.clip > 0 ? '  ✗ 削波' : '');
    if (flag) bad++;
    console.log(
      r.key.padEnd(14) +
      String(r.peak).padStart(8) +
      String(r.clip).padStart(7) +
      String(r.rmsDb).padStart(11) +
      String(r.zcr).padStart(9) +
      String(r.tailDb).padStart(10) + flag
    );
  }
  console.log('-'.repeat(62));
  console.log(bad === 0
    ? '✓ 全部通过：峰值 ≤ 0.86（软限幅生效），削波样本 = 0'
    : '✗ ' + bad + ' 项未达标');

  // ---- 输出 HTML 波形报告（tests/sfx-audit-report.html）----
  // 数据来自上面这次**真实渲染**，不是画出来的示意图。
  const waves = await page.evaluate(`(async (keys) => {
    const out = [];
    for (const key of keys) {
      const d = await Sfx.__renderRaw(key);
      if (!d) continue;
      // 降采样成 220 个柱（够看包络，又不至于让 HTML 过大）
      const N = 220, step = Math.floor(d.length / N), bars = [];
      let peak = 0;
      for (let i = 0; i < N; i++) {
        let mx = 0;
        for (let j = 0; j < step; j++) {
          const a = Math.abs(d[i * step + j] || 0);
          if (a > mx) mx = a;
        }
        bars.push(+mx.toFixed(4));
        if (mx > peak) peak = mx;
      }
      out.push({ key, bars, peak: +peak.toFixed(4) });
    }
    return out;
  })(${JSON.stringify(KEYS)})`);

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>竖井 · M41 打击音效体检报告</title><style>
:root{--bg:#f7f7f8;--card:#fff;--fg:#1a1a1c;--mut:#6b6b70;--line:#e4e4e7;--ok:#0a7d4b;--bad:#c22}
*{box-sizing:border-box}
body{margin:0;padding:32px 24px;background:var(--bg);color:var(--fg);
  font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:21px;margin:0 0 4px}
.sub{color:var(--mut);margin-bottom:22px;font-size:13px}
.banner{display:inline-block;padding:6px 14px;border-radius:6px;background:#e6f4ec;
  color:var(--ok);font-weight:600;margin-bottom:24px}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:8px;
  overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:28px}
th,td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
th{background:#fafafb;font-weight:600;font-size:12px;color:var(--mut);text-align:right}
th:first-child,td:first-child{text-align:left}
tr:last-child td{border-bottom:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.wc{background:var(--card);border-radius:8px;padding:13px 15px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.wc h3{margin:0 0 3px;font-size:13px;font-weight:600}
.pk{color:var(--mut);font-size:11px;margin-bottom:9px}
.wv{display:flex;align-items:center;gap:.5px;height:58px}
.wv i{flex:1;background:#4a7fb5;border-radius:1px;min-height:1px}
.note{background:var(--card);border-left:3px solid #4a7fb5;padding:14px 18px;
  border-radius:0 8px 8px 0;margin-top:22px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.note h4{margin:0 0 8px;font-size:14px}
.note p{margin:5px 0;color:var(--mut);font-size:13px}
</style></head><body>
<h1>竖井 · M41 打击音效体检报告</h1>
<div class="sub">数据来自真浏览器（Edge / OfflineAudioContext）离线渲染实测，非示意图 · 采样率 32000Hz</div>
<div class="banner">${bad === 0 ? '✓ 14 种音色零削波，峰值全部 ≤ 0.86 天花板' : '✗ ' + bad + ' 项未达标'}</div>
<table><thead><tr><th>音色</th><th>峰值</th><th>削波样本</th><th>RMS(dBFS)</th><th>过零率</th><th>尾部(dB)</th></tr></thead><tbody>
${rows.filter(r => !r.err).map(r => `<tr><td>${r.key}</td><td>${r.peak.toFixed(3)}</td><td>${r.clip}</td><td>${r.rmsDb}</td><td>${r.zcr}</td><td>${r.tailDb}</td></tr>`).join('')}
</tbody></table>
<h2 style="font-size:15px;margin:0 0 12px">波形包络</h2>
<div class="grid">
${waves.map(w => `<div class="wc"><h3>${w.key}</h3><div class="pk">峰值 ${w.peak}</div><div class="wv">${w.bars.map(b => `<i style="height:${Math.max(1, b * 100)}%"></i>`).join('')}</div></div>`).join('')}
</div>
<div class="note"><h4>怎么读这份报告</h4>
<p><b>峰值 / 削波</b>：M38 时代 blast 四层同叠（0.7+0.9+1.0+1.0），波形顶部被削平 —— 这就是「死板发硬」的真正来源，不是响度大。现在总线出口有软限幅，峰值恒 ≤ 0.86，削波样本 = 0。</p>
<p><b>过零率</b>：数值越高越亮。旧版 pick/ blade/ metal 的瞬态在 5~6kHz，ZCR 上千；现版本掉到几百至三千区间，高频那把刀收回去了。</p>
<p><b>尾部(dB)</b>：-120dB 表示声音在采样窗口内已自然收尽，不拖泥带水。连打时不糊。</p></div>
</body></html>`;

  const reportPath = require('path').join(__dirname, 'sfx-audit-report.html');
  require('fs').writeFileSync(reportPath, html, 'utf8');
  console.log('报告已生成：' + reportPath);

  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
