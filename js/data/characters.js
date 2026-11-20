// 三大角色定义（设计文档 §8）。
//
// 核心原则：三个角色的差异必须在**机制**上，不能只在数值上。
// 所以每个角色有一套独有的资源系统，规格全写在这里的 resource 字段里，
// 引擎（combat.js）只按规格执行，不认识「样本」「余烬」这些具体名字。
//
// 加载顺序：本文件是数据层第一个 —— cards.js 的 rewardPool() 默认角色要用 DEFAULT_CHAR。

const DEFAULT_CHAR = 'digger';

// 资源规格字段：
//   key       —— 字段名，同时用作状态显示的键
//   name      —— 中文名，UI 上显示
//   start     —— 开场初始值（都是 0；留字段是为了以后调平衡）
//   max       —— 上限，null = 无上限
//   perTurn   —— 每回合开始自动 +N
//   onDamaged —— 每次**被敌人击中**时 +N
//
// ⚠️ onDamaged 只认敌人的攻击，**不算自伤（loseHp）也不算中毒**。
// 引火者的自伤卡都是显式给余烬的（「献燔」写死 +3），
// 若自伤也走 onDamaged，那张卡会变成 +4，双重计数。
const CHARACTERS = {
  digger: {
    id: 'digger',
    name: '掘者',
    role: '竖井城清道夫',
    frameColor: '#5F5E5A', // 铁灰
    style: '直白工业词 · 直角边框 · 铆钉装饰',
    blurb: '不玩花活。格挡与伤害双向转化，稳定滚雪球。',
    resource: null,
    unlock: '开局可用',
    unlockDl: 0, // §3.1 解锁链：0 = 开局可用
    // §8.1：5 打击 / 4 防御 / 1 撬棍
    starterDeck: [
      'strike', 'strike', 'strike', 'strike', 'strike',
      'defend', 'defend', 'defend', 'defend',
      'crowbar',
    ],
  },

  medic: {
    id: 'medic',
    name: '拾荒医师',
    role: '旧世生物研究所的幸存者',
    frameColor: '#1D9E75', // 病绿
    style: '学术病历词 · 细衬线 · 圆角 · 细胞纹样',
    blurb: '靠样本运转。前期最弱，资源成型后翻盘。',
    resource: {
      key: 'sample',
      name: '样本',
      start: 0,
      max: 5,
      perTurn: 1,
      onDamaged: 0,
    },
    unlock: '任一角色达到 DL2',
    unlockDl: 2, // §3.1 解锁链：靠「任一角色」的最高 DL 判定
    starterDeck: [
      'scalpel', 'scalpel', 'scalpel', 'scalpel', 'scalpel',
      'tourniquet', 'tourniquet', 'tourniquet', 'tourniquet',
      'sampling',
    ],
  },

  keeper: {
    id: 'keeper',
    name: '引火者',
    role: '信奉火种的教徒',
    frameColor: '#D85A30', // 燃橙
    style: '仪式祷告词 · 手写体 · 裂痕噪点',
    blurb: '靠余烬运转。卖血换资源，血线越低越猛。',
    resource: {
      key: 'ember',
      name: '余烬',
      start: 0,
      max: null,     // 余烬不设上限 —— 卖血的代价本身就是限制
      perTurn: 0,
      onDamaged: 1,  // 被敌人击中才累积
    },
    unlock: '任一角色达到 DL4',
    unlockDl: 4, // §3.1 解锁链：靠「任一角色」的最高 DL 判定
    starterDeck: [
      'tongs', 'tongs', 'tongs', 'tongs', 'tongs',
      'ash_guard', 'ash_guard', 'ash_guard', 'ash_guard',
      'spark',
    ],
  },
};

// 角色顺序 = UI 上的展示顺序
const CHAR_ORDER = ['digger', 'medic', 'keeper'];

function characterOf(id) {
  return CHARACTERS[id] || CHARACTERS[DEFAULT_CHAR];
}
