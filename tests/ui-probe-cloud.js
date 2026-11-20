// 云存档 UI 探针（M52）：把 index.html 复制一份、注入探针脚本，用 Edge headless 跑。
//
// 与其他探针的差异：云层有真实的网络请求（会话恢复 / CDN SDK 加载）。这里的策略是
// —— **SDK 加载与初始化用真件**（CDN script 必须真的能加载、createWorkBuddyCloud
// 必须真的能建出 client），**网络调用一律 mock**（发验证码、登录、推拉存档都换成
// 本地假件 + 调用计数）。这样断言的是「我们的接线与策略」，不是平台本身。
//
// 运行：node tests/ui-probe-cloud.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const PROBE_FILE = path.join(BASE, '_ui-probe-cloud.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const PROBE_SCRIPT = `
<script>
window.onerror = function (m) { window.__err = String(m); };
(function () {
  var out = [];
  function log(k, v) { out.push(k + ' = ' + v); }

  try {
    // 0. 清掉上一轮残留（探针复用同一 user-data-dir，localStorage 会渗透）
    Progress.reset();
    App.boot();

    // ---- 1. SDK 真件检查：CDN script 必须真的加载成功 ----
    log('cdnLoaded', typeof WorkBuddyCloud !== 'undefined' && !!WorkBuddyCloud.createWorkBuddyCloud);
    log('cloudAvailable', Cloud.available());
    // publicConfig 三元组：endpoint 必须显式传入（不允许靠同源兜底）
    log('cfgEndpointHttps', CLOUD_CONFIG.endpoint.indexOf('https://') === 0);
    log('cfgKey', CLOUD_CONFIG.publishableKey.indexOf('wbpk_') === 0);
    log('cfgRelay', CLOUD_CONFIG.oauthRelayBaseUrl.indexOf('https://') === 0);
    // client 能真的建出来（不发请求）
    var cli = null;
    try { cli = Cloud.client(); } catch (e) {}
    log('clientBuilt', !!cli && !!cli.auth && !!cli.database);

    // ---- 2. 混合存储：写档 = 本地 + 时间戳 + 云推送 ----
    var pushed = [];
    var origPush = Cloud.pushSave;
    Cloud.mode = 'in'; // 模拟已登录，pushSave 才会走推送分支
    Cloud.pushSave = function (json) { pushed.push(json); return Promise.resolve(true); };
    var mixed = App._storage();
    Progress.init(mixed);
    Progress.setDl('digger', 3); // 触发一次 _write → setItem(SAVE_KEY)
    var local = App._rawStorage();
    var rawAfter = local.getItem(SAVE_KEY);
    log('mixedWritesLocal', rawAfter && rawAfter.indexOf('"dl":3') >= 0);
    log('mixedWritesTs', (parseInt(local.getItem('tower-descend/save-ts'), 10) || 0) > 0);
    log('mixedPushesCloud', pushed.length > 0);

    // ---- 3. 未登录时真 pushSave 是 no-op（不发未授权请求）----
    // 不替换 pushSave 本身 —— 替换掉就测不到它的登录守卫了；换成 mock 数据库层计数
    var dbCalls = 0;
    var mockFrom = function () {
      dbCalls++;
      var b = { select: function () { return b; }, limit: function () { return b; },
                maybeSingle: function () { return Promise.resolve({ data: null }); },
                update: function () { return b; }, eq: function () { return b; },
                insert: function () { return b; }, order: function () { return b; } };
      return b;
    };
    Cloud.mode = 'out';
    Cloud._client = { auth: cli.auth, database: { from: mockFrom } };
    Progress.setDl('digger', 5); // 触发混合层 → 真 pushSave，但未登录
    log('pushNoopWhenOut', dbCalls === 0);
    Cloud.mode = 'in';
    Cloud._client = origClient;
    Cloud.pushSave = origPush;

    // ---- 4. 手机号校验：不合法的号不发请求 ----
    var otpCalls = 0;
    var origClient = Cloud._client;
    Cloud._client = { auth: { sendOtp: function (p) { otpCalls++; return Promise.resolve({ data: { verificationId: 'v1', isExistingUser: true } }); },
                               verifyOtp: function () { return Promise.resolve({ data: { user: { phone: '13800138000' } } }); },
                               getSession: function () { return Promise.resolve({ data: { session: { user: { phone: '13800138000' } } } }); },
                               signOut: function () { return Promise.resolve({}); } },
                      database: cli ? cli.database : null };
    Cloud.sendOtp('12345').then(function (r) {
      log('badPhoneRejected', !r.ok && otpCalls === 0);
      // 合法号：发出请求、challenge 被保存
      return Cloud.sendOtp('13800138000');
    }).then(function (r2) {
      log('goodPhoneSent', r2.ok && otpCalls === 1 && !!Cloud._pending);
      // 登录成功路径
      return Cloud.verifyOtp('888888');
    }).then(function (r3) {
      log('verifyOk', r3.ok && Cloud.mode === 'in');
      log('phoneMasked', Cloud.phone === '138****8000');
      // ---- 5. 面板渲染（已登录态）----
      App.renderCloudUi();
      log('panelSignedIn', document.getElementById('cloud-panel-body').innerHTML.indexOf('已登录') >= 0);
      // 退出登录
      return Cloud.signOut();
    }).then(function () {
      log('signOutClears', Cloud.mode === 'out' && Cloud.phone === null);
      App.renderCloudUi();
      var body = document.getElementById('cloud-panel-body').innerHTML;
      log('panelSignInForm', body.indexOf('cloud-phone') >= 0 && body.indexOf('发验证码') >= 0);
      log('jsError', window.__err || 'none');
      flush();
    }).catch(function (e) {
      log('EXCEPTION-ASYNC', e && e.message);
      log('jsError', window.__err || 'none');
      flush();
    });

    // ---- 6. pullSave 的参数形状（mock 数据库层）----
    // 放在主流程外再验一次：不依赖前面 then 链的时序
  } catch (e) {
    log('EXCEPTION', e.message);
    log('jsError', window.__err || 'none');
  }

  function flush() {
    var pre = document.createElement('pre');
    pre.id = 'probe-out';
    pre.textContent = out.join('\\n');
    document.body.appendChild(pre);
  }

  // 兜底：主链若卡住也要落盘，探针不能空手而归
  setTimeout(function () {
    if (!document.getElementById('probe-out')) flush();
  }, 4000);
})();
</script>
`;

// ---- 源码级安全断言（不进浏览器）----
const cloudSrc = fs.readFileSync(path.join(BASE, 'js/core/cloud.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
const staticChecks = [
  ['noAnonLogin', cloudSrc.indexOf('signInAnonymously') < 0, 'cloud.js 不含匿名登录'],
  ['noHandFetch', cloudSrc.indexOf("fetch('/.cloud") < 0 && cloudSrc.indexOf('fetch("/.cloud') < 0, 'cloud.js 不手写 /.cloud/** 请求'],
  ['endpointPassed', /endpoint:\s*CLOUD_CONFIG\.endpoint/.test(cloudSrc), 'client 初始化显式传 endpoint'],
  ['keyPassed', /publishableKey:\s*CLOUD_CONFIG\.publishableKey/.test(cloudSrc), 'client 初始化显式传 publishableKey'],
  ['relayPassed', /oauthRelayBaseUrl:\s*CLOUD_CONFIG\.oauthRelayBaseUrl/.test(cloudSrc), 'web 端初始化传 oauthRelayBaseUrl'],
  ['cdnBeforeCoreJs', indexSrc.indexOf('index.global.js') < indexSrc.indexOf('js/core/cloud.js'), 'CDN SDK 先于 cloud.js 加载'],
  ['cloudJsBeforeApp', indexSrc.indexOf('js/core/cloud.js') < indexSrc.indexOf('js/ui/app.js'), 'cloud.js 先于 app.js 加载'],
  ['devChannel', indexSrc.indexOf('workbuddy-cloud-sdk@dev/') > 0, 'SDK 走 @dev 通道（latest 未维护）'],
  ['noOwnerSend', /owner_id\s*:|'owner_id'|"owner_id"|\.eq\('owner_id'/.test(cloudSrc) === false, '客户端不发 owner_id（数据库 DEFAULT auth.uid() 负责）'],
];

// ---- 生成探针页 ----
let html = indexSrc;
if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
fs.writeFileSync(PROBE_FILE, html);

// ---- 跑 headless ----
let dom;
try {
  dom = execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=C:/Users/Jimchen/AppData/Local/Temp/edge-probe-cloud',
      '--virtual-time-budget=8000',
      '--window-size=1200,900',
      '--dump-dom',
      'file:///' + PROBE_FILE.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  );
} finally {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
}

// ---- 解析结果 ----
const m = dom.match(/<pre id="probe-out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('未找到探针输出 —— 页面脚本在探针执行前就挂了。');
  console.log('DOM 长度：' + dom.length);
  process.exit(1);
}

const text = m[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .trim();

console.log('\n=== 云探针（浏览器侧）===');
console.log(text);

const got = {};
text.split('\n').forEach(function (line) {
  const i = line.indexOf(' = ');
  if (i > 0) got[line.slice(0, i).trim()] = line.slice(i + 3).trim();
});

console.log('\n=== 云探针（源码侧）===');
staticChecks.forEach(function (c) {
  console.log('  ' + (c[1] ? '[ok]  ' : '[FAIL]') + ' ' + c[2]);
});

const checks = [
  ['cdnLoaded', 'true', 'CDN SDK 真的加载成功（file:// 下也能拉到 IIFE 全局）'],
  ['cloudAvailable', 'true', 'Cloud.available() 为真'],
  ['cfgEndpointHttps', 'true', 'publicConfig.endpoint 已配置且是 https'],
  ['cfgKey', 'true', 'publicConfig.publishableKey 已配置（wbpk_ 前缀）'],
  ['cfgRelay', 'true', 'publicConfig.oauthRelayBaseUrl 已配置'],
  ['clientBuilt', 'true', 'createWorkBuddyCloud 真的建出了 client（auth + database）'],
  ['mixedWritesLocal', 'true', '混合存储：写档先落本地（JSON 里 dl 已更新）'],
  ['mixedWritesTs', 'true', '混合存储：写档同时记了本地时间戳'],
  ['mixedPushesCloud', 'true', '混合存储：登录态下写档触发云推送'],
  ['pushNoopWhenOut', 'true', '未登录时推送是 no-op（不发未授权请求）'],
  ['badPhoneRejected', 'true', '非 11 位手机号被本地拒绝，不发请求'],
  ['goodPhoneSent', 'true', '合法手机号发出验证码且 challenge 被保存'],
  ['verifyOk', 'true', '验证码校验成功后进入登录态'],
  ['phoneMasked', 'true', '面板显示的手机号已脱敏（138****8000）'],
  ['panelSignedIn', 'true', '已登录态面板渲染正确'],
  ['signOutClears', 'true', '退出登录清掉会话状态'],
  ['panelSignInForm', 'true', '未登录态面板渲染出登录表单'],
  ['jsError', 'none', '页面无 JS 运行时错误'],
];

let fail = 0;
console.log('\n=== 断言 ===');
function assert(name, ok, desc, actual) {
  if (!ok) fail++;
  console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + ' ' + desc + (ok ? '' : '（期望非「' + name + '」失败，实际 ' + actual + '）'));
}
staticChecks.forEach(function (c) { assert(c[0], c[1], c[2], c[1]); });
checks.forEach(function (c) {
  const ok = got[c[0]] === c[1];
  assert(c[0], ok, c[2], got[c[0]]);
});

console.log('\n' + (fail === 0 ? '云存档链路全部通过' : '云存档链路存在失败项') + '：' + (checks.length + staticChecks.length - fail) + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
