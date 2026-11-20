# 《竖井》Godot 原型 — Phase 5：卡牌池完整移植（47 掘者 + 1 诅咒）

独立的 Godot 4.7.2 工程，与仓库根目录的 Web 版《竖井》**完全并存、互不影响**。

- **Phase 1**：可运行、可验证的战斗核心闭环
- **Phase 2**：占位美术 + 浮动血条 + 挥击反馈 + 竞技场地面
- **Phase 3**：卡牌数据层（`CardData` + `CardLibrary`）
- **Phase 4**：格挡 / 能量 / 回合边界
- **Phase 5（当前）**：48 张卡全部移植 + 效果引擎 + 条件效果 + 升级值

## 运行

```bash
GODOT="C:/Users/Jimchen/Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe"

"$GODOT" --path D:/竖井/godot                                        # 打开工程
"$GODOT" --headless --path D:/竖井/godot res://tests/test_runner.tscn   # 77 项测试
"$GODOT" --headless --path D:/竖井/godot --quit-after 300 res://scenes/main.tscn  # 300 帧冒烟
"$GODOT" --path D:/竖井/godot res://tests/capture_runner.tscn -- D:/竖井/godot/captures

python tools/gen_cards.py            # 从 Web 版 js/data/cards.js 重新生成 48 张 .tres
python tools/gen_cards.py --check    # 对拍：生成结果与磁盘一致
python tools/audit_upgrades.py       # 审计：每张卡的 upV 是否都落到了升级字段上
python tools/gen_sprites.py          # 重新生成占位贴图
python tools/check_scripts.py        # 括号配平 + 缩进体检
python tools/check_resources.py      # .tscn/.tres 引用一致性
```

> **不要用 `--script tests/run_tests.gd`**：该模式不加载 autoload，`EventBus` /
> `InputActions` 全部解析失败，报出一片假错误。必须走 `test_runner.tscn`
> 这个真实场景入口。**只有真实场景运行才是可信的 oracle。**

## 操作

| 输入 | 行为 |
|---|---|
| `WASD` / 方向键 | 移动 |
| `空格` / `J` | 挥击 |
| `Q` / `Enter` | 打出卡牌 |
| `E` | 结束回合（回满能量、清空格挡、敌人行动） |
| `R` | 阵亡后重开 |

## 本轮范围：48 张卡的效果模型

每张卡是**一个 `CardEffectStep` 数组**，不是一段专属脚本。加一张卡 = 加一个 `.tres`。

### 统一的数值公式

```
amount = (value + scale_value × scale_coef) + ratio_term + per_term
```

三条正交轴各自回答一个问题：

| 轴 | 问题 | 取值来源 |
|---|---|---|
| `kind` | 做什么 | 伤害 / 穿甲 / 格挡 / 治疗 / 抽牌 / 能量 / 状态 |
| `target` | 对谁做 | 单个敌人 / 全体敌人 / 自己 |
| `scale` / `ratio` / `per` | 数值多大 | 深度 / 力量 / 本回合已打出的牌 / 自身格挡 |

### 条件效果：`condition_replaces` 是唯一的 gate 判据

卡池里 4 张卡带条件，它们分成两种形状，**只有 `condition_replaces` 能区分**：

| 卡 | 文本 | 标志 | 行为 |
|---|---|---|---|
| 撬棍 | 造成 9。**若有格挡，改为** 13 | `replaces = true` | 步骤必跑，条件只换数字 |
| 安全帽 | 获得 6 格挡。**若已打出攻击牌，再**获得 3 | `replaces = false` | 条件不满足就整步跳过 |
| 撬棒连击 | 造成 7。**若击杀，抽** 2 张 | `replaces = false` | 同上 |
| 连锁爆破 | 全体 9 伤害。**若击倒任一敌人，抽** 1 张 | `replaces = false` | 同上 |

**为什么不能用「步骤有没有基础值」来判断**：`value > 0` 看似等价，实际不是。
安全帽的 3 格挡、撬棒连击的 2 张牌，作者都是直接写在独立步骤的 `value` 上，
数据层**没有任何字段标记「这一半是无条件的」**。用 `value > 0` 判断会让
撬棒连击在敌人存活时也抽 2 张牌 —— 这正是本轮修掉的 bug。

`_evaluate` 与 `_step_runs` 的分工：`gate` 决定**步骤跑不跑**（读
`condition_replaces`），`_evaluate` 决定**条件动不动数字**。

## 架构

```
cards/
├── card_data.gd           卡牌定义（费用/类型/稀有度 + effects 数组）
├── effect_spec.gd         CardEffectStep：一条效果的 8 个正交字段 + 自校验
├── card_effect.gd         结算引擎：唯一的 amount 公式与唯一的伤害出口
└── library/*.tres         48 张卡，由 tools/gen_cards.py 生成，勿手改
components/                health / block / energy / status
actors/                    actor（伤害统一入口）/ player / enemy
scenes/main.tscn           竞技场 + HUD
tests/run_tests.gd         77 项测试（真实 SceneTree）
tools/                     生成器 + 4 个检查工具
```

### 关键决策

**1. 单一真相源是 `CardData.effects` 数组**
旧的 `effect_kind` / `damage` / `block` / `energy` 平铺字段已全部删除。
它们表达不了「先给 6 格挡，若打出攻击牌再给 3」，只靠平铺字段的引擎迟早要在
代码里加特判。

**2. 加一张卡 = 加一个 `.tres`，不写脚本**
Web 版 47 张掘者卡每张一个专属 `play(ctx, card)`。照搬就是 47 个脚本文件、
无法当数据 diff、每次平衡性调整都要找程序员。数组化之后平衡性调整只改数字。

**3. 数值只算一次，先算后用**
`_evaluate` 算完数字，`_apply` 才动手。顺序不是风格问题：「液压冲击」要消耗
它读到的格挡，如果边算边用，同一张卡的第 2 步会读到已被这张卡花掉的格挡。

**4. 伤害只有 `Actor.take_damage_from` 一个出口**
力量/虚弱属于**攻击者**，脆弱属于**防御者**。三者在同一个函数里读 `source` 和
`self`，因为把力量读成防御者的会得到一个「看起来合理但完全错误」的结果：
玩家力量 3 打一个没加成的敌人，会打出基础伤害，而敌人自己的力量被加成到
打玩家那一下。

**5. 超距不能出牌**
`_make_context` 从整个 `enemy` group 填 `enemies`，不看距离。不加这层检查，
引擎会痛快地对着 900px 外的敌人结算一张伤害牌并扣掉玩家的能量。

**6. `validate()` 必须承认「数字全来自动态项」的卡是合法的**
「深井作业」是 深度×2 格挡、「液压冲击」是 格挡×1.5 伤害，两者 `value` 都是 0，
数字全部来自 scale / ratio / per。早期版本把它们判为非法，一次性丢掉 8 张卡。

## 测试覆盖

**77 项，全部在真实 `SceneTree` 中跑真实引擎节点（非 mock）。**

Phase 5 新增的重点：

- **卡池**（3）：48 张全加载 / 数量与 Web 版一致 / 每张非诅咒卡都能对真实 actor 结算
- **条件效果**（2）：撬棒连击只在击杀时抽牌 / **四种条件的 REPLACE vs ADD 形状对照**
- **升级**（1）：48 张卡的 `upV` 全部落到升级字段（`audit_upgrades.py` 独立审计）
- **引擎 bug 回归守卫**（若干）：力量归属 / 超距出牌 / 动态数值卡不被误杀

### 测试机制：`_end()` 哨兵

**每个测试体的最后一句必须是 `_end()`。**

`_case` 早期只看「有没有断言失败」，这会把**运行期异常**变成绿色 PASS ——
GDScript 遇到运行期错误会中止整个 lambda，于是后面所有断言根本没跑，
失败计数纹丝不动，被截断的测试就报了通过。实际踩到过：把裸数组
`[A, B, C]` 传给 `Array[CardData]` 参数，测试「通过」了，而它实际什么都没测。

哨兵让 `_case` 能区分「跑完了」和「中途抛错」，后者报 `[ERROR] ABORTED`。

> 构造 `Array[CardData]` 用 `_deck([...])` 辅助函数。裸数组字面量会推断成
> `Array`，传给强类型参数是**运行期**错误 —— 比解析错误更隐蔽，因为它不中断编译。

> **GDScript 没有 `%r` 格式符**。用 `%r` 只会打印一条 `ERROR: unsupported
> format character` 然后**继续执行**，测试照样报 PASS。看到这条 ERROR 要当成
> 测试失败处理。

## 踩坑记录

| 坑 | 症状 | 结论 |
|---|---|---|
| **条件 gate 判据用错** | 敌人存活时撬棒连击仍抽 2 张 | gate 只能读 `condition_replaces`；`value > 0` 不携带「无条件」信息 |
| **异常被 PASS 掩盖** | 测试体运行期抛错，后续断言全不跑，仍报 PASS | `_end()` 哨兵 + `_deck()` 强类型构造 |
| **文件末尾缺换行** | GDScript 报 `Expected end of file`，行号指向 EOF 之后 | 括号配平器查不出来（报 0 不平衡）；逐函数隔离解析才定位到 |
| **`const preload` 不能赋值** | `Cannot assign a new value to a constant` | `STRIKE_CARD.duplicate() as CardData`；共享资源不能就地改 |
| **`_spawn()` 返回基类** | 摸 `hand` / `energy` 报 `Cannot infer the type` | 加 `_spawn_player() -> Player` / `_spawn_enemy() -> Enemy` |
| **`--script` 不加载 autoload** | 一片 `Identifier not found: EventBus` 假错误 | 必须走 `test_runner.tscn`；`load() != null` 也不能当解析成功的判据 |
| **配方漏 `uv=`** | `strike` 升级后数值不变，但 `--check` 通过 | `--check` 只比对配方选出的内容，配方漏字段它察觉不到 → 新增 `audit_upgrades.py` |
| **`validate()` 误杀动态数值卡** | 8 张卡静默不加载 | 基础值为 0 但有 scale/ratio/per 是合法的 |
| **手牌标签歧义** | 「手牌：安全帽（1 费 / 6 格挡）· x4」读成「4 张安全帽」 | 数字是手牌总数、紧跟选中牌名，各自补主语 |
| 零距离不命中 | 同位时完全不掉血 | 只判 `is_instance_valid(_target)` |
| `start_turn(bonus)` 不钳制 | 上限 3 却能回 4 点 | 补 `mini(..., max_energy)` |
| `block_cleared` 信号永不发射 | 声明了但没 emit | 信号表是公开 API，声明了不发就是谎言 |
| ExtResource id 改名漏改引用 | 只报 Parse error + 行号 | `tools/check_resources.py` |
| 测试断言 9−4=3 | 我自己算错了 | 改 5 并在注释写明「这里若写 3 就是算术失误」 |

（Phase 1–4 的坑见 `.workbuddy/memory/2026-10-08.md`。）

## 下一步建议

1. **手牌 UI** —— 多张手牌的可视化、牌面渲染（费用/名称/描述/效果图标）、悬停详情。
   当前仍是「持 1 张按 Q 打出」，HUD 只有一行文字。
2. **其余角色卡池** —— 医师 / 守卫等角色的 129 张卡可复用本轮的效果引擎直接导。
3. **遗物 / 事件** —— Web 版 `relics.js` / `events.js` 尚未进入数据层。