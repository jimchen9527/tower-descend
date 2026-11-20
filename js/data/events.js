// 随机事件 —— 设计文档 §10。
//
// options[i].run(ctx) 结算副作用，返回值决定后面怎么走：
//   · 返回字符串           → 事件结束，把这段文字显示给玩家
//   · 返回 { text, pick }  → 还要再选一次卡，pick.mode 见 ui/render-node.js
//
// ctx 只暴露 Run 层原语，不许碰 DOM —— 这样事件能在 Node 里直接跑测试。
//
// 池子来源：§10 给了 3 个完整样例（seepage / duty_log / faceless_trader，原样落地），
// 另外 5 个是按同一世界观补的 —— §10 要求"每个大关一套（8–12 个）"，
// 不足 8 个会在「同局不重复」的规则下很快耗尽。补的 5 个可随时替换。
//
// 数值对齐 §14：起始生命 75 / 起始金币 99，所以单次事件的代价与收益量级
// 控制在「10–15 生命」「30–100 金币」「1 张卡」这三档之内。

const EVENTS = {
  // ==================== §10 样例（原样）====================

  seepage: {
    id: 'seepage',
    name: '渗水层',
    text: '井壁渗出的水是浑的，但能喝。水面下有什么在缓慢上浮。',
    options: [
      {
        label: '喝一口',
        hint: '回复 15 生命，获得诅咒卡「疫尘入肺」',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          ctx.heal(15);
          ctx.addCard('cursed_lung');
          return '水是温的，一股铁锈味。喝完没多久，你开始咳。';
        },
      },
      {
        label: '打捞',
        hint: '50% 得到遗物「锈蚀罗盘」，50% 失去 12 生命',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          if (ctx.chance(0.5)) {
            ctx.addRelic('alloy_compass');
            return '你摸到一块冰凉的金属——罗盘还在转，指针固执地朝下。';
          }
          ctx.loseHp(12);
          return '水面下伸出一只手，攥住你的手腕，然后松开。';
        },
      },
      {
        label: '离开',
        hint: '无事发生',
        run() {
          return '你绕开了水洼。身后有水滴落的声音，很规律。';
        },
      },
    ],
  },

  duty_log: {
    id: 'duty_log',
    name: '值班日志',
    text: '一具防卫体的残骸，胸口还亮着灯。它的日志只写了一行：「等待换班。已等待 109,500 天。」',
    options: [
      {
        label: '读完全部',
        hint: '+80 金币，最大生命 −5',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          ctx.addGold(80);
          ctx.lowerMaxHp(5);
          return '日志有九万页。读到第八万页，你开始明白为什么没人来换班。' +
                 '你带走了一块能换钱的芯片，和一点很难消化的东西。';
        },
      },
      {
        label: '关掉它',
        hint: '回复 8 生命，获得 1 张随机普通卡',
        run(ctx) {
          ctx.heal(8);
          const pick = ctx.pickOneCard('common');
          if (!pick) return '灯灭了。你松了口气，但什么都没找到。';
          ctx.addCard(pick);
          return '灯灭了。残骸背后的挂钩上挂着一张卡，你摘了下来。';
        },
      },
      {
        label: '留一盏灯',
        hint: '往下三层内，小怪生命 −10%',
        run(ctx) {
          ctx.addMod('enemyHpPct', -10, 3);
          return '你没动它。往下走的时候，前方的黑暗里总会先亮起一点光。';
        },
      },
    ],
  },

  faceless_trader: {
    id: 'faceless_trader',
    name: '无面商贩',
    text: '一个不见脸的身影，摊子上摆的东西你一件都不认识。',
    options: [
      {
        label: '买卡',
        hint: '−60 金币，从 3 张稀有卡中选 1',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          if (!ctx.spendGold(60)) {
            return '你掏了掏口袋——不够。它把摊子往里收了收。';
          }
          return {
            text: '你付了钱。它从摊子下面摸出三张卡，一张张摆在你面前。',
            pick: { mode: 'add', count: 3, rarity: 'rare' },
          };
        },
      },
      {
        label: '换血',
        hint: '−15 生命，随机移除 1 张牌（可移除诅咒）',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          if (!ctx.deckSize()) return '你的卡组是空的。它摊开手，表示没什么可换。';
          ctx.loseHp(15);
          const c = ctx.removeCardRandom();
          return '它把手按在你胸口。有什么东西被抽走了——' +
                 '「' + c.def.name + '」不在你的卡组里了。';
        },
      },
      {
        label: '离开',
        hint: '无事发生',
        run() {
          return '你走了。它没有抬头，也没有收摊。';
        },
      },
    ],
  },

  // ==================== 以下 5 个为 M4 补充 ====================

  collapse: {
    id: 'collapse',
    name: '塌方',
    text: '刚落脚，头顶的井壁就塌下一片。你的背包被埋在碎石下面。',
    options: [
      {
        label: '徒手挖开',
        hint: '失去 8 生命，+60 金币',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          ctx.loseHp(8);
          ctx.addGold(60);
          return '指甲翻了两个。背包挖出来的时候，里面的东西还在。';
        },
      },
      {
        label: '撑起液压支架',
        hint: '−40 金币',
        run(ctx) {
          if (!ctx.spendGold(40)) return '支架的气压不够。你只能看着碎石堆。';
          return '支架顶住了。你从容地取出背包，还顺手扶正了一根快断的横梁。';
        },
      },
      {
        label: '不要了',
        hint: '无事发生',
        run() {
          return '你留下一道记号，绕了过去。以后也许还会路过这里。';
        },
      },
    ],
  },

  mycelium: {
    id: 'mycelium',
    name: '菌毯',
    text: '一片灰绿色的菌毯顺着井壁往下铺，看不见头。菌毯边缘有个东西在反光。',
    options: [
      {
        label: '摘走反光的东西',
        hint: '获得遗物「苔藓护符」，最大生命 −8',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          if (!ctx.addRelic('moss_charm')) {
            ctx.lowerMaxHp(8);
            return '护符你早就有了一块。这一块带不走，你把它留在原地——' +
                   '但孢子已经进了肺里。';
          }
          ctx.lowerMaxHp(8);
          return '护符入手是温的，像刚从谁身上摘下来。你的呼吸开始变浅。';
        },
      },
      {
        label: '刮下菌丝',
        hint: '+70 金币',
        run(ctx) {
          ctx.addGold(70);
          return '菌丝晒干能当燃料，竖井城一直有人收。你刮了满满一袋。';
        },
      },
      {
        label: '烧掉它',
        hint: '回复 10 生命',
        run(ctx) {
          ctx.heal(10);
          return '火顺着菌毯爬下去，照亮了很深的一段井。你烤暖了手。';
        },
      },
    ],
  },

  carving: {
    id: 'carving',
    name: '井壁刻痕',
    text: '井壁上密密麻麻全是刻痕，是历次下潜的记录。最下面一行只刻了一半。',
    options: [
      {
        label: '补齐这一行',
        hint: '从 3 张卡中选 1 加入卡组',
        run() {
          return {
            text: '你刻下自己的名字。刻完才发现，这一行本来就快刻满了。',
            pick: { mode: 'add', count: 3 },
          };
        },
      },
      {
        label: '照着练习',
        hint: '升级卡组里随机 1 张卡',
        run(ctx) {
          const c = ctx.upgradeCardRandom();
          if (!c) return '刻痕很讲究，但你卡组里已经没有能再打磨的东西了。';
          return '你照着刻痕比划了很久。回到住处再拿起「' + c.def.name +
                 '」时，手顺了很多。';
        },
      },
      {
        label: '什么都不留',
        hint: '无事发生',
        run() {
          return '刻痕是给后来人看的。你没打算有后来人跟着你。';
        },
      },
    ],
  },

  slag_pool: {
    id: 'slag_pool',
    name: '熔渣池',
    text: '一池还在冒泡的熔渣，边缘结着晶体。热量烤得脸发烫。',
    options: [
      {
        label: '伸手捞结晶',
        hint: '失去 12 生命，从 3 张稀有卡中选 1',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          ctx.loseHp(12);
          return {
            text: '手臂在水面上方就烫得发白。你捞上来一块，结晶里裹着旧世的东西。',
            pick: { mode: 'add', count: 3, rarity: 'rare' },
          };
        },
      },
      {
        label: '把撬棍淬火',
        hint: '失去 5 生命，升级 1 张卡',
        run(ctx) {
          ctx.loseHp(5);
          if (!ctx.upgradableCount()) {
            return '撬棍淬好了。但你卡组里没有需要再打磨的东西。';
          }
          return { text: '撬棍淬过火，硬了一截。该给它找个配得上的用法。',
                   pick: { mode: 'upgrade' } };
        },
      },
      {
        label: '绕开',
        hint: '无事发生',
        run() {
          return '你贴着井壁走过去。背后的热气把衣服烘干了。';
        },
      },
    ],
  },

  silent_broadcast: {
    id: 'silent_broadcast',
    name: '沉默的广播',
    text: '一台半埋的广播机还在响。念的是三百年前的天气、列车时刻、寻人启事。',
    options: [
      {
        label: '听完',
        hint: '失去 5 生命，+100 金币',
        risky: true, // §3.1 第 2 条（M31）：代价型选项，DL7 起抽样偏向它
        run(ctx) {
          ctx.loseHp(5);
          ctx.addGold(100);
          return '播到最后是一条坐标，重复了三遍。你记了下来——那个位置能换钱。' +
                 '广播停的时候，你还站着，只是没听见自己在呼吸。';
        },
      },
      {
        label: '拆铜线',
        hint: '+30 金币',
        run(ctx) {
          ctx.addGold(30);
          return '外壳一撬就开。里面的铜线还是亮的。广播声在你手里断掉了。';
        },
      },
      {
        label: '不管',
        hint: '无事发生',
        run() {
          return '它继续念着那些没有收件人的启事。你继续往下走。';
        },
      },
    ],
  },

  // ==================== M60 P2 补充：8 个 ====================
  // 模板化扩充：仍是「代价换资源」三选一，数值全部压在 §14 的三档之内
  //（10–15 生命 / 30–100 金币 / 1 张卡）。遗物类事件的补偿参照 mycelium
  //（遗物 + 生命上限 −8）—— 白拿遗物会击穿商店与宝箱的价值感。

  supply_cache: {
    id: 'supply_cache',
    name: '卡住的补给箱',
    text: '一只防卫体的补给箱嵌在井壁里，锁扣锈死，只露出一条缝。',
    options: [
      {
        label: '撬开',
        hint: '失去 8 生命，+70 金币',
        risky: true,
        run(ctx) {
          ctx.loseHp(8);
          ctx.addGold(70);
          return '撬棍别进缝里压了三次才开。罐头在，火漆封条也还在。你的手心磨掉了一块皮。';
        },
      },
      {
        label: '只够得着的那些',
        hint: '回复 10 生命',
        run(ctx) {
          ctx.heal(10);
          return '缝隙里塞着两包应急口粮和半瓶电解质水。日期早过了，味道还行。';
        },
      },
      {
        label: '做记号绕开',
        hint: '无事发生',
        run() {
          return '你在箱子上敲了三长两短。说不定下次路过，你带了更好的工具。';
        },
      },
    ],
  },

  wounded_miner: {
    id: 'wounded_miner',
    name: '受困的矿工',
    text: '碎石下面压着一个还活着的矿工。他还有半壶水，和一只你很眼熟的帆布包。',
    options: [
      {
        label: '把他挖出来',
        hint: '失去 10 生命，随机升级 1 张卡',
        risky: true,
        run(ctx) {
          ctx.loseHp(10);
          const c = ctx.upgradeCardRandom();
          if (!c) return '你把他刨了出来。他讲的那些挖矿窍门，你卡组里已经用不上了。';
          return '你把他刨了出来。他半条腿都是血，还是拉着你的手比划了很久——' +
                 '「' + c.def.name + '」这么用，省力。';
        },
      },
      {
        label: '拿走帆布包',
        hint: '+90 金币',
        risky: true,
        run(ctx) {
          ctx.addGold(90);
          return '包很沉。你在碎石上留了一壶水。他没说话，但你走得很快。';
        },
      },
      {
        label: '留下口粮就走',
        hint: '−30 金币',
        run(ctx) {
          if (!ctx.spendGold(30)) return '你的口袋比他的还空。你们互相看了一眼，都没说话。';
          return '你放了一份口粮和绷带。往下三层都能听见他敲管子的声音——很有节奏。';
        },
      },
    ],
  },

  vending_machine: {
    id: 'vending_machine',
    name: '一台售货机',
    text: '售货机斜靠在井壁上，屏幕还亮着，货道里卡着一排什么东西。',
    options: [
      {
        label: '拍打货道',
        hint: '50% 从 3 张普通卡中选 1，50% 失去 6 生命',
        risky: true,
        run(ctx) {
          if (!ctx.chance(0.5)) {
            ctx.loseHp(6);
            return '机器倾下来砸在你肩上。你退开的时候，货道里什么也没掉出来。';
          }
          return {
            text: '你抡了两下，一整排水饮包装碎了，夹层里掉出几张压瘪的卡。',
            pick: { mode: 'add', count: 3, rarity: 'common' },
          };
        },
      },
      {
        label: '投币',
        hint: '−40 金币，回复 20 生命',
        run(ctx) {
          if (!ctx.spendGold(40)) return '投币口吞了你的手指又吐出来。它只认三百年前的硬币。';
          ctx.heal(20);
          return '货道咚地一声。是一管加热的营养膏——难吃，但那种「还活着」的暖意是真的。';
        },
      },
      {
        label: '离开',
        hint: '无事发生',
        run() {
          return '屏幕在你背后闪了闪，继续播放三百年前的促销广告。';
        },
      },
    ],
  },

  dust_idol: {
    id: 'dust_idol',
    name: '积尘的神龛',
    text: '石壁上凿了一座小小的神龛，神像的脸被烟熏黑了，手心朝上摊着。',
    options: [
      {
        label: '放一枚金币',
        hint: '−50 金币，获得遗物「守护神像」',
        risky: true,
        run(ctx) {
          if (!ctx.spendGold(50)) return '你翻遍了口袋，凑不出它「收」的那一枚。神像的手心还摊着。';
          if (!ctx.addRelic('guardian_idol')) {
            ctx.addGold(50);
            return '神像你早就有了。这一尊带不走——但你的金币原样躺回了手心。';
          }
          return '金币落进手心的那一刻，整面石壁嗡了一下。再抬头，神像的脸是干净的。';
        },
      },
      {
        label: '刮下烟灰',
        hint: '+35 金币',
        run(ctx) {
          ctx.addGold(35);
          return '熏了三百年的烟灰是上好的墨料，井城的书吏按克收。神像的脸花了。';
        },
      },
      {
        label: '行个礼就走',
        hint: '无事发生',
        run() {
          return '不知道该拜谁，但你还是点了下头。往下走的时候，脚步声比来时踏实。';
        },
      },
    ],
  },

  dripping_pipe: {
    id: 'dripping_pipe',
    name: '锈蚀的水管',
    text: '一根粗水管横穿甬道，接缝处往下滴着什么，在地上积了一小洼。',
    options: [
      {
        label: '接水喝',
        hint: '回复 12 生命，50% 失去 5 生命',
        risky: true,
        run(ctx) {
          ctx.heal(12);
          if (ctx.chance(0.5)) {
            ctx.loseHp(5);
            return '水能喝，就是刮嗓子。半夜你的胃拧了一下——不过第二天照常走路。';
          }
          return '水是凉的、带铁锈味，但干净。你把水壶也灌满了。';
        },
      },
      {
        label: '敲管听声',
        hint: '+25 金币',
        run(ctx) {
          ctx.addGold(25);
          return '回声不对——管壁后面有个空腔。你顺着敲到了一处旧的私人储藏点。';
        },
      },
      {
        label: '不碰它',
        hint: '无事发生',
        run() {
          return '滴水声在你身后跟了很久，规律得像有人在数数。';
        },
      },
    ],
  },

  card_game: {
    id: 'card_game',
    name: '井壁下的牌局',
    text: '三个幸存者围着一盏冷光灯打牌。看见你，他们把座位往旁边挪了挪。',
    options: [
      {
        label: '坐下来赌一把',
        hint: '−60 金币，50% 从 3 张稀有卡中选 1',
        risky: true,
        run(ctx) {
          if (!ctx.spendGold(60)) return '你押上所有金币，他们看了看，告诉你数目不对——散了。';
          if (!ctx.chance(0.5)) return '三局。你连一张像样的牌都没摸到。他们请你喝了口酒，算是补偿。';
          return {
            text: '最后一局你赢了个干净。输家笑着把卡推过来：「下把再来。」',
            pick: { mode: 'add', count: 3, rarity: 'rare' },
          };
        },
      },
      {
        label: '在旁边看',
        hint: '随机升级 1 张卡',
        run(ctx) {
          const c = ctx.upgradeCardRandom();
          if (!c) return '你看了四圈。他们出牌的路数你卡组里一张都用不上。';
          return '你看了四圈。第五回合那个反打的手法很妙——回头用「' +
                 c.def.name + '」试了试，确实快。';
        },
      },
      {
        label: '问路',
        hint: '往下四层内，小怪生命 −5%',
        run(ctx) {
          ctx.addMod('enemyHpPct', -5, 4);
          return '他们在井壁上划了张草图：哪段路的警戒系统还活着、哪段早就瞎了。';
        },
      },
    ],
  },

  brine_tank: {
    id: 'brine_tank',
    name: '盐卤槽',
    text: '一个半人高的石槽盛着乳白的盐卤，水面浮着一层结晶。热气从槽底渗上来。',
    options: [
      {
        label: '泡进去',
        hint: '最大生命 −5，回复 25 生命',
        risky: true,
        run(ctx) {
          ctx.lowerMaxHp(5);
          ctx.heal(25);
          return '伤口在盐卤里烧得钻心，然后是一种奇怪的松弛。旧伤疤泡淡了——连着一点旧血肉。';
        },
      },
      {
        label: '捞结晶',
        hint: '失去 8 生命，+60 金币',
        risky: true,
        run(ctx) {
          ctx.loseHp(8);
          ctx.addGold(60);
          return '结晶掰下来就往指尖咬。你捞了小半袋，指头上烫出了几个白泡。';
        },
      },
      {
        label: '只用热气',
        hint: '回复 8 生命',
        run(ctx) {
          ctx.heal(8);
          return '你把冻僵的手架在槽沿上。热气是别人剩下的运气，但也是运气。';
        },
      },
    ],
  },

  signal_tower: {
    id: 'signal_tower',
    name: '断了半截的信号塔',
    text: '信号塔从井壁上折下来，缆线散了一地，指示灯以三秒一次的频率明灭。',
    options: [
      {
        label: '接上求救信标',
        hint: '50% +110 金币，50% 无事发生',
        risky: true,
        run(ctx) {
          if (!ctx.chance(0.5)) return '信标响了很久。回音在井里荡了几圈，然后什么也没有。';
          ctx.addGold(110);
          return '两小时后，绳斗从上面放了下来——有人肯为一条准确的位置花钱。';
        },
      },
      {
        label: '拆储能电池',
        hint: '失去 10 生命，+80 金币',
        risky: true,
        run(ctx) {
          ctx.loseHp(10);
          ctx.addGold(80);
          return '电池拽出来的时候爆了一蓬弧光。你的半边手臂麻到肘部，货是完好的。';
        },
      },
      {
        label: '读指示灯的节奏',
        hint: '回复 6 生命',
        run(ctx) {
          ctx.heal(6);
          return '三秒一次，永远准时。你靠着塔基歇了一会儿——三百年来第一次，有什么东西比你的呼吸更稳。';
        },
      },
    ],
  },
};
