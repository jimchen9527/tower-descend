// M77 验证：R2 新手引导 —— 术语表 + glossify + progress.tut 标记。
//
// 防线（memory 教训）：
//   ① 全称断言前先验集合非空；
//   ② 期望值与实测值并排打印；
//   ③ try/catch 包装 + 结尾哨兵（异常即 ABORTED，不报 PASS）。
//
// 运行：node tests/m77-tutorial.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/glossary.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/cards-medic.js',
  'js/data/cards-keeper.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/enemies.js',
  'js/core/progress.js',
];

function makeStore() {
  return {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
}

const store = makeStore();
const sandbox = { console: console, __store: store };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}

let failed = 0, ran = 0;
function ok(cond, msg) {
  ran++;
  if (!cond) { failed++; console.log('  FAIL ' + msg); }
}
function section(name) { console.log('[' + name + ']'); }
function endSentinel() {
  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
}

try {
  // ---- 1. 术语表本身 ----
  // 顶层 const 不进 context 对象（vm 与浏览器同款行为），用 runInContext 取。
  const S = function (expr) { return vm.runInContext(expr, sandbox); };
  section('1 术语表内容');
  const terms = S('Object.keys(GLOSSARY)');
  ok(terms.length >= 10, '术语数 >= 10（实测 ' + terms.length + '）');
  ['格挡', '消耗', '燃烧', '中毒', '样本', '余烬', '意图'].forEach(function (t) {
    ok(typeof S('GLOSSARY[' + JSON.stringify(t) + ']') === 'string' &&
      S('GLOSSARY[' + JSON.stringify(t) + ']').length > 6, '术语「' + t + '」有实质释义');
  });
  // 卡面高频词都该有覆盖：全卡池文本采样，出现的已知术语必须有词条
  const cardTexts = S('(function(){var a=[];for(var k in CARDS){try{a.push(String(CARDS[k].text(CARDS[k].v)||""))}catch(e){}}return a})()');
  ok(Object.keys(S('CARDS')).length > 100, '卡池非空（实测 ' + Object.keys(S('CARDS')).length + ' 张）');
  ok(cardTexts.length > 100, '卡面文本采样非空（实测 ' + cardTexts.length + ' 张）');
  const freq = {};
  const termRe = /(格挡|消耗|燃烧|中毒|力量|虚弱|脆弱|诅咒)/g;
  cardTexts.forEach(function (t) { let m; while ((m = termRe.exec(t))) freq[m[1]] = (freq[m[1]] || 0) + 1; });
  for (const t of Object.keys(freq)) {
    ok(!!S("GLOSSARY[" + JSON.stringify(t) + "]"), '卡面高频术语「' + t + '」（出现 ' + freq[t] + ' 次）有词条');
  }

  // ---- 2. glossify 行为 ----
  section('2 glossify');
  const glossify = sandbox.glossify;
  ok(typeof glossify === 'function', 'glossify 是函数');
  const g1 = glossify('获得 5 点格挡。消耗。');
  ok(g1.indexOf('<span class="term" data-term="格挡">格挡</span>') !== -1, '普通术语被包裹（实测 ' + g1 + '）');
  ok(g1.indexOf('data-term="消耗"') !== -1, '同段第二个术语也被包裹');
  const g2 = glossify('格挡格挡');
  ok(g2.split('data-term="格挡"').length - 1 === 1, '同一术语只包第一处（实测包裹 ' + (g2.split('data-term="格挡"').length - 1) + ' 处）');
  const g3 = glossify('没有任何术语的普通文本');
  ok(g3.indexOf('<span') === -1, '无术语时不产生标记');
  ok(glossify('') === '', '空串安全');
  ok(glossify(null) === '', 'null 安全');
  // 长术语优先：样本 vs 样本费用 之类不含子串冲突，但验证「中毒」不被「重度中毒」拆坏
  const g4 = glossify('施加中毒 3 层，并获得 3 点格挡');
  ok(g4.indexOf('data-term="中毒">中毒<') !== -1, '混合文本包裹正确');
  // 卡面实跑：所有采样文本过一遍 glossify 不抛异常、术语都成了标记
  let wrapped = 0;
  cardTexts.forEach(function (t) {
    const out = glossify(t);
    ok(typeof out === 'string' && out.length >= t.length, '卡面 glossify 不变短');
    wrapped += (out.match(/class="term"/g) || []).length;
  });
  ok(wrapped > 50, '全卡池包裹总数 > 50（实测 ' + wrapped + '）—— 非空集防线');

  // ---- 3. progress.tut ----
  section('3 progress.tut');
  const Progress = S('Progress');
  Progress.init(store);
  ok(Progress.tutSeen('combat') === false, '新档：combat 未看过');
  Progress.tutMark('combat');
  ok(Progress.tutSeen('combat') === true, '标记后：combat 已看过');
  ok(store.getItem('tower-descend/save').indexOf('"combat":true') !== -1, '标记已落盘');
  // 旧档（无 tut 块）宽容补块：手工写一份 M75 形状的档
  const oldSave = JSON.parse(store.getItem('tower-descend/save'));
  delete oldSave.tut;
  store.setItem('tower-descend/save', JSON.stringify(oldSave));
  Progress.data = null; // 强制重读
  Progress.init(store);
  ok(Progress.tutSeen('combat') === false, '旧档缺 tut 块：重读后不炸且视为未看过（可重新引导，可接受）');
  Progress.tutMark('rest');
  ok(Progress.tutSeen('rest') === true, '旧档补块后可正常标记');
  // reset 清空
  Progress.reset();
  ok(Progress.tutSeen('rest') === false && Progress.tutSeen('combat') === false, 'reset 后引导标记清空');

  endSentinel();
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
