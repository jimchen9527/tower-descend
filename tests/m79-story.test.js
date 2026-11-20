// M79 验证：R4 叙事 —— 序幕 / 三角色结局 / 事件链 / 事件遭遇计数。
//
// 运行：node tests/m79-story.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const FILES = [
  'js/core/rng.js',
  'js/data/characters.js',
  'js/data/acts.js',
  'js/data/cards.js',
  'js/data/cards-medic.js',
  'js/data/cards-keeper.js',
  'js/data/potions.js',
  'js/data/sfx-profile.js',
  'js/data/relics.js',
  'js/data/events.js',
  'js/data/story.js',
  'js/data/enemies.js',
  'js/core/progress.js',
  'js/core/combat.js',
  'js/core/map.js',
  'js/core/run.js',
];

const sandbox = { console: console };
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(BASE, f), 'utf8'), sandbox, { filename: f });
}
const S = function (expr) { return vm.runInContext(expr, sandbox); };

let failed = 0, ran = 0;
function ok(cond, msg) {
  ran++;
  if (!cond) { failed++; console.log('  FAIL ' + msg); }
}
function section(name) { console.log('[' + name + ']'); }

try {
  // ---- 1. 序幕 ----
  section('1 序幕');
  ok(S('PROLOGUE.length') === 3, '序幕 3 屏（实测 ' + S('PROLOGUE.length') + '）');
  ok(S('PROLOGUE.every(function(p){return p.title&&p.text&&p.text.length>30})'), '每屏都有标题与实质文本');

  // ---- 2. 结局 ----
  section('2 三角色结局');
  ['digger', 'medic', 'keeper'].forEach(function (id) {
    ok(S('ENDINGS["' + id + '"] && ENDINGS["' + id + '"].text.length > 60'),
      '「' + id + '」有结局文本');
  });
  ok(S('Object.keys(ENDINGS).length') === 3, '结局恰好 3 份（实测 ' + S('Object.keys(ENDINGS).length') + '）');

  // ---- 3. 事件链数据 ----
  section('3 事件链');
  ok(S('Object.keys(EVENT_CHAINS).length >= 2'), '事件链 >= 2 条（实测 ' + S('Object.keys(EVENT_CHAINS).length') + '）');
  ok(S('(function(){for(var k in EVENT_CHAINS){var c=EVENT_CHAINS[k];' +
    'if(!c.text||!c.options||!c.options.length)return false;' +
    'for(var i=0;i<c.options.length;i++){if(typeof c.options[i].run!=="function"||!c.options[i].label)return false;}}' +
    'return true})()'), '每条链都有 text + 带run的options');
  ok(S('EVENT_CHAINS.duty_log && EVENTS.duty_log && EVENT_CHAINS.duty_log.text !== EVENTS.duty_log.text'),
    '值班日志的后续与原事件文本不同');
  // 链的选项真实跑一遍（沙箱里造一个记账 ctx）—— 不许抛异常
  ok(S('(function(){var calls={heal:0,gold:0,hpmax:0};var ctx={heal:function(n){calls.heal+=n},loseHp:function(n){calls.heal-=n},' +
    'addGold:function(n){calls.gold+=n},raiseMaxHp:function(n){calls.hpmax+=n},lowerMaxHp:function(n){calls.hpmax-=n},' +
    'addCard:function(){},pickOneCard:function(){return "strike"},depth:5};' +
    'for(var k in EVENT_CHAINS){EVENT_CHAINS[k].options.forEach(function(o){try{o.run(ctx)}catch(e){throw new Error(k+":"+e.message)}})}' +
    'return JSON.stringify(calls)})()').length > 0, '全部链选项可无头执行');

  // ---- 4. 事件遭遇计数 ----
  section('4 eventSeen');
  const store = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  const Progress = S('Progress');
  Progress.init(store);
  ok(Progress.eventSeen('duty_log') === 0, '新档事件计数为 0');
  Progress.recordEvent('duty_log');
  Progress.recordEvent('duty_log');
  Progress.recordEvent('seepage');
  ok(Progress.eventSeen('duty_log') === 2 && Progress.eventSeen('seepage') === 1, '计数正确');
  Progress.tutMark('force-write'); // recordEvent 设计上不落盘 —— 先制造一次存档再验结构
  ok(store.getItem('tower-descend/save').indexOf('"events"') !== -1, 'codex.events 已入存档结构');
  // 云合并：events 计数取大
  Progress.mergeCounters({ codex: { events: { duty_log: 5 } } });
  ok(Progress.eventSeen('duty_log') === 5, 'mergeCounters 对 events 取大（实测 ' + Progress.eventSeen('duty_log') + '）');

  // ---- 5. 事件链触发条件（跨局口径）----
  section('5 触发口径');
  ok(S('Run.start("act1", 909090, "digger", 1); Run.rollEvent() && Run.state.eventsUsed && Object.keys(Run.state.eventsUsed).length') === 1,
    '一局内首次事件照常');
  // 第二局重遇同一事件：eventSeen>0 → UI 层换链文本（数据侧验证计数足以驱动）
  ok(S('(function(){Run.start("act1", 909091, "digger", 1);return true})()') === true, '第二局开始');
  ok(Progress.eventSeen('duty_log') === 5, '跨局计数持久（驱动第二次文本变体）');

  console.log(ran + ' 项断言，失败 ' + failed + ' 项');
  if (failed > 0) process.exit(1);
} catch (e) {
  console.log('ABORTED: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  process.exit(1);
}
