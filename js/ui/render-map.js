// 地图渲染 —— DOM 节点 + SVG 连线（§15 建议：节点要 hover / 点击，DOM 事件天然支持）
// 方向与杀戮尖塔相反：D1 在顶，越往下越深。

const RenderMap = {
  // §5.1 现在是 4 条主干 / 21 层：列间距是主干的 2 倍，最宽的一张图铺到 9 列 → 772px，
  // 在 #app 的 1100px 里留出约 290px 余量，一屏看全不是问题。
  // 地图的纵横比从「宽而短」变成「窄而长」，横向不再吃紧，所以尺寸回到 4 条主干时代的取值。
  CELL_W: 76, // 相邻列的水平间距
  ROW_H: 62,  // 相邻层的垂直间距
  NODE: 38,   // 节点直径
  PAD_X: 44,  // 左右留白
  PAD_Y: 28,

  render() {
    const s = Run.state;
    const map = s.map;

    let maxCol = 0;
    map.layers.forEach(function (layer) {
      layer.forEach(function (n) { if (n.col > maxCol) maxCol = n.col; });
    });

    const W = this.PAD_X * 2 + (maxCol + 1) * this.CELL_W;
    const H = this.PAD_Y * 2 + map.depth * this.ROW_H;
    const cellW = this.CELL_W, cellH = this.ROW_H;
    const padX = this.PAD_X, padY = this.PAD_Y, node = this.NODE;

    const cx = function (c) { return padX + c * cellW + cellW / 2; };
    const cy = function (d) { return padY + (d - 1) * cellH + cellH / 2; };

    let waves = '';   // M70：逐层波浪层理（振幅 / 透明度随深度渐增）
    let lines = '';
    let buttons = '';

    // 波浪层理（M70）：每层一条，振幅 2.2→5px、alpha 随深度渐增 ——
    // 「越下越深的井」的层次感由它 + .mapwrap 的纵向渐变一起给（art.css）。
    // 周期仍与 ROW_H / PAD_Y 对齐（这里就是它们的出处，别在 CSS 再写死）。
    for (let d = 1; d <= map.depth; d++) {
      const y = padY + (d - 1) * cellH;
      const amp = 2.2 + d * 0.09;
      let p = 'M0 ' + y.toFixed(1);
      for (let x = 0; x < W; x += 120) {
        const x2 = Math.min(x + 120, W);
        p += ' Q ' + (x + 60) + ' ' + (y + (x / 120 % 2 ? amp : -amp)).toFixed(1) + ' ' + x2 + ' ' + y.toFixed(1);
      }
      waves += '<path class="stratum" d="' + p + '" fill="none" stroke="rgba(95,94,90,' +
        (0.05 + d * 0.0012).toFixed(3) + ')" stroke-width="1"/>';
    }

    map.layers.forEach(function (layer) {
      layer.forEach(function (n) {
        const x1 = cx(n.col);
        const y1 = cy(n.depth);

        n.edges.forEach(function (id) {
          const t = map.nodes[id];
          const walked = s.visited[n.id] && s.visited[id];
          const x2 = cx(t.col);
          const y2 = cy(t.depth);
          // M70：直线 → 三次贝塞尔 S 弯（控制点 = 两端 y 中点），
          // 竖进横出，斜向连线不再出锐角。已走路径双层描边（晕 + 墨）。
          const my = (y1 + y2) / 2;
          const d = 'M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ', ' + x2 + ' ' + my + ', ' + x2 + ' ' + y2;
          if (walked) {
            lines +=
              '<path class="edge-walk-glow" d="' + d + '"></path>' +
              '<path class="edge edge-walked" d="' + d + '"></path>';
          } else if (s.currentId === n.id && Run.canMoveTo(id)) {
            // M87/V1：当前可走连线高亮 —— 「下一步往哪走」沿线直接可读，
            // 不再只有节点光环。流动虚线由 art.css 管，fx-off 时退化为实线。
            lines += '<path class="edge edge-open" d="' + d + '"></path>';
          } else {
            lines += '<path class="edge" d="' + d + '"></path>';
          }
        });

        // 图形化（M8）：节点里放 SVG 图标，不再放汉字。
        // 汉字没被丢掉 —— 它仍在 title 与 aria-label 上（悬停提示与无障碍都要它），
        // 所以 NODE_TYPES[type].icon 那个字段继续有用武之地。
        // 已走过的节点换成勾：勾比「把图标调淡」明确得多。
        // M50：把 depth 一并交出去 —— 中 Boss 图标按关段分三种。
        const done = n.type !== 'entry' && s.cleared[n.id];
        let body;
        if (done) body = Art.check();
        else if (n.type === 'boss') body = Art.bossBadge(n.bossTier);
        else body = Art.node(n.type, n.depth);

        buttons +=
          '<button class="' + RenderMap.nodeClass(s, n) + '" data-id="' + n.id + '"' +
          ' style="left:' + (x1 - node / 2) + 'px;top:' + (y1 - node / 2) + 'px"' +
          ' title="' + RenderMap.nodeTitle(n) + '"' +
          ' aria-label="' + NODE_TYPES[n.type].label + '">' + body + '</button>';
      });
    });

    const svg = document.getElementById('map-svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = waves + lines;   // 层理垫底，连线在上

    const wrap = document.getElementById('map-nodes');
    wrap.style.width = W + 'px';
    wrap.style.height = H + 'px';
    wrap.innerHTML = buttons;

    // 层理波浪在 SVG 里逐层生成（周期由这里的 ROW_H / PAD_Y 决定），
    // 不再往 .mapwrap 写 CSS 变量 —— 旧的 repeating-linear-gradient 已随 M70 退役。
    this.scrollToCurrent();
    // 攀绳按钮（M78 · §13）：只在可用时露出
    const rope = document.getElementById('rope-btn');
    if (rope) {
      if (Run.canClimb()) {
        rope.hidden = false;
        rope.dataset.armed = '';
        rope.textContent = '攀绳 · 退回上一层（最大生命 −10，剩 ' + Run.ropeLeft() + ' 次）';
      } else {
        rope.hidden = true;
      }
    }
  },

  // 地图比视口高（15 层）也比视口宽（11~13 条主干），把当前节点带到视野正中。
  // 横向必须一起做：.mapwrap 靠 margin:auto 居中，只在「图比视口窄」时生效；
  // 图一旦更宽就贴左了，只跟纵向会把当前节点甩到右侧视野外。
  scrollToCurrent() {
    const cur = document.querySelector('.mnode.is-cur');
    const scroller = document.querySelector('.mapscroll');
    if (!cur || !scroller) return;

    const top = cur.offsetTop - scroller.clientHeight / 2 + this.NODE / 2;
    scroller.scrollTop = Math.max(0, top);

    const left = cur.offsetLeft - scroller.clientWidth / 2 + this.NODE / 2;
    scroller.scrollLeft = Math.max(0, left);
  },

  nodeClass(s, n) {
    const cls = ['mnode', 'mt-' + n.type];
    if (s.currentId === n.id) cls.push('is-cur');
    else if (s.cleared[n.id]) cls.push('is-done');
    else if (Run.canMoveTo(n.id)) cls.push('is-open');
    else cls.push('is-locked');
    return cls.join(' ');
  },

  nodeTitle(n) {
    if (n.type === 'boss') {
      return 'D' + n.depth + ' · 大 Boss：' + n.bossName + '（难度 ' + n.bossTier + '，路径汇聚）';
    }
    return 'D' + n.depth + ' · ' + NODE_TYPES[n.type].label;
  },
};
