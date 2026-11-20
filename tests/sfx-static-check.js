// 静态核对：M41 的三条铁律是否真的落到代码里（不依赖浏览器）
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../js/ui/audio.js', 'utf8');

console.log('VOL_CAP =', /var VOL_CAP = ([\d.]+)/.exec(src)[1]);
console.log('SUM_CAP =', /var SUM_CAP = ([\d.]+)/.exec(src)[1]);

// 单路 vol 上限（旧版有 0.55/0.9/1.0，是削波根源）
const overs = [];
let m; const re = /vol:\s*([\d.]+)/g;
while ((m = re.exec(src))) { const v = parseFloat(m[1]); if (v > 0.45) overs.push(v); }
console.log('单路 vol > 0.45 :', overs.length, overs.length ? JSON.stringify(overs) : '(无)');

// 亮度天花板：不应再有 >= 4000Hz 的中心频（金属的 3.2kHz 是刻意上限）
const hires = [];
const fre = /freq:\s*([0-9.]+)/g;
while ((m = fre.exec(src))) { const v = parseFloat(m[1]); if (v >= 4000) hires.push(v); }
console.log('中心频 >= 4000Hz :', hires.length, hires.length ? JSON.stringify(hires) : '(无)');

// contact 段覆盖：打击类材质应当都有接触段
console.log('contact 段出现次数 :', (src.match(/contact:/g) || []).length);

// plan() 结构必须与 M40 一致（既有断言依赖）
console.log('语义层 vol (期望 0.5) :', /rate: 1, vol: ([\d.]+),/.exec(src)[1]);
console.log('rateOf 未动 :', /lerp\(1\.06, 0\.93, w\)/.test(src));
console.log('reps 上限未动 :', /Math\.min\(o\.times \|\| 3, 4\)/.test(src));
console.log('JIT 未动 :', /var JIT = ([\d.]+)/.exec(src)[1]);
console.log('trail vol 未动 :', /vol: lerp\(0\.86, 1, w\)/.test(src));
