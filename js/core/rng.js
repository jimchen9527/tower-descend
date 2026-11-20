// 带种子的伪随机 —— 种子存进存档后，任何一局都能复现
// M1 只有战斗用得上，但地图生成的"≥4 条路线"校验也需要它，所以一开始就用同一套

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RNG = {
  _f: null,
  seed: 0,

  init(seed) {
    this.seed = seed >>> 0;
    this._f = mulberry32(this.seed);
  },

  next() {
    return this._f();
  },

  // 闭区间整数
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  },

  // 原地洗牌
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  },
};
