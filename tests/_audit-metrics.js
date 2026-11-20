// 玩法盘点度量（诊断用）：把「首屏放不放得下」这类事量化。
// 用法：node tests/_audit-metrics.js
const path = require('path');
const { chromium } = require('playwright');
const BASE = path.join(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'file:///' + path.join(BASE, 'index.html').replace(/\\/g, '/');

const rect = (sel) => `(function(){var e=document.querySelector('${sel}');if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}})()`;

(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const [tag, vw, vh] of [['1440x900', 1440, 900], ['1440x760', 1440, 760], ['390x844', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: vw, height: vh } });
    await p.goto(URL, { waitUntil: 'load' });
    await p.evaluate(() => { Progress.reset(); Progress.setDl('digger', 10); App.boot({ menu: true }); });
    // 进局 + 直接进一场普通战（满手牌）
    await p.evaluate(() => {
      Run.start('act1', 424242, 'digger', 1);
      document.getElementById('view-menu').hidden = true;
      document.querySelector('.topbar').hidden = false;
      const nodes = Run.state.map.nodes;
      let id = null;
      Object.keys(nodes).forEach((n) => { if (nodes[n].type === 'monster' && !id && nodes[n].depth > 2) id = n; });
      Run.state.currentId = id; Run.state.cleared[id] = 'entry';
      App.startBattle();
      document.getElementById('tipbar').hidden = true; // 度量首屏，先排除教学浮条
    });
    await p.waitForTimeout(500);
    const m = await p.evaluate(`(function(){
      var q=function(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}};
      var stages=q('.battle-stage'), hand=q('#hand'), end=q('#end-turn'), top=q('.topbar');
      var card=document.querySelector('#hand .card'), cardR=card?card.getBoundingClientRect():null;
      var fs=card?getComputedStyle(card).fontSize:null;
      var ms=q('.mapscroll'), mw=q('.mapwrap');
      return {
        vw: innerWidth, vh: innerHeight,
        docH: document.documentElement.scrollHeight,
        topbar: top, stage: stages, hand: hand, end: end,
        card: cardR?{w:Math.round(cardR.width),h:Math.round(cardR.height)}:null,
        cardFont: fs,
        mapScroll: ms, mapWrap: mw,
        handOver: hand?Math.max(0, hand.b-innerHeight):null,
        endOver: end?Math.max(0, end.b-innerHeight):null,
        stagesH: stages?stages.h:null
      };
    })()`);
    console.log(tag, '战斗', JSON.stringify(m));

    // 地图：横向是否溢出 / 一屏几层
    const mm = await p.evaluate(`(function(){
      App.showMap();
      document.getElementById('tipbar').hidden = true;
      var q=function(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),b:Math.round(r.bottom)}};
      var ms=document.querySelector('.mapscroll'), mw=document.querySelector('.mapwrap');
      var node=document.querySelector('.mapnodes .mnode');
      // 把当前节点挪到最右列，看 showMap 是否横向跟随
      var far=null;
      Object.keys(Run.state.map.nodes).forEach(function(id){var n=Run.state.map.nodes[id];if(!far||n.col>Run.state.map.nodes[far].col)far=id;});
      if(far){Run.state.currentId=far;Run.state.cleared[far]='entry';App.showMap();}
      var cur=document.querySelector('.mnode.is-cur'), cr=cur?cur.getBoundingClientRect():null;
      return {
        vh: innerHeight,
        scrollW: ms?ms.scrollWidth:null, clientW: ms?ms.clientWidth:null,
        scrollLeft: ms?Math.round(ms.scrollLeft):null,
        curL: cr?Math.round(cr.left):null, curR: cr?Math.round(cr.right):null,
        curVisible: cr? (cr.left>=0 && cr.right<=innerWidth):null,
        scrollH: ms?ms.scrollHeight:null, clientH: ms?ms.clientHeight:null,
        wrapW: mw?Math.round(mw.getBoundingClientRect().width):null,
        wrapH: mw?Math.round(mw.getBoundingClientRect().height):null,
        nodeW: node?Math.round(node.getBoundingClientRect().width):null,
        rowsPerScreen: ms? +(ms.clientHeight/62).toFixed(1):null
      };
    })()`);
    console.log(tag, '地图', JSON.stringify(mm));
    await p.close();
  }
  await b.close();
})();
