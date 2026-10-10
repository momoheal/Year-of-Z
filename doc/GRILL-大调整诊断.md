# GRILL-ME · Year of Z 大调整诊断书

> **Skill: grill-me · 模式：不夸，不哄，只烤。**
> 2026-10-10 · 分支 `arena/5c9df84a-year-of-z` · 审计人：Arena Agent
> 口径：所有结论基于 `src/` 12,824 行实测 + 33 篇设计文档 + 114 个用例 + 双入口运行时。

---

## 一句话烤熟

**你不是做了一个游戏，你是把两个半游戏硬焊在了一辆手推板车上，然后用 1990 行的 `world.ts` 当绳子捆住——绳子一断，两边都散架。**

正传想做《极乐迪斯科》的克制叙事，域外想做《逃离鸭科夫》的系统生存，工坊想做《拆枪模拟器》——三件事都对，但它们共用一套名字叫 `GameState` 的塑料袋，共享一个叫 `GameWorld` 的上帝，然后假装彼此不认识。

想做大调整？先承认：**现在的架构撑不起你已经写好的故事，更撑不起你想写完的 19 章。**

---

## 评分板 · 烤前体检（10 分制）

| 维度 | 分 | 一句人话 |
|---|---|---|
| **故事与文本** | 9.0 | 中文原创里顶尖的克制，42 节点每页 85 字以内，三处“退回”的伦理设计是全作灵魂。别动它，动它就是自毁。 |
| **玩法系统深度** | 7.5 | 域外探索的“噪音即敌 / 双时钟 / 找尸之旅 / 医疗两本账”是真设计，正传的“手续即敌人”也是真设计——但两者老死不相往来。 |
| **代码架构** | 3.2 | `world.ts 1990行` + `main.ts 1309行` = 3300 行双头怪。改一个灯光要摸 5 个文件，改一个坐标要同步 3 处。 |
| **数据驱动** | 2.8 | 坐标全硬编码，`target: [0.8, -1.6]` 这种魔数散在 5 个 `chapter*.ts` 里，建景一挪就穿墙。 |
| **可维护/可测试** | 4.0 | 114 用例全绿是假安全：纯逻辑覆盖很好，渲染层只有“注入假 renderer 跑 600 帧不崩”的冒烟。真机手感、穿墙、遮挡全靠肉眼。 |
| **产品定位** | 4.5 | 入口写着“第一—五章”，按钮却塞着“域外探索·独立切片”。玩家第一秒就要做选择题：我到底在玩哪个游戏？ |

**平均 5.1 —— 故事 90 分，工程 30 分，产品 45 分。典型的“作家把程序员绑架了”项目。**

---

## 七宗罪 · 逐条上火烤

### 罪 1：双头上帝 · `world.ts` + `main.ts` = 不可维护的核

**现状**
```
world.ts  1990 行 — 渲染 + 物理 + 相机 + 灯光 + 角色动画 + 同行者 + 狗 + 遭遇战渲染 + 场景装配 + 废弃占位兜底
main.ts   1309 行 — UI 面板 + 输入 + 存档节流 + 音频合成 + 对话状态机 + 遭遇战输入翻译 + E2E 钩子 + 标题/结尾屏
story.ts   390 行 — 却要管 5 章 42 节点的拼接 + 物品派生 + 存档迁移 + 日志
```
改一个 `side-door` 的开关，要摸 `mapdata.ts` → `world.ts` → `story.ts` → `main.ts` 四处。`GameWorld` 构造函数里直接 `new GameWorld($('game'))`，测试只能 mock 整个 THREE + cannon。

**为什么致命**
- 新人 3 天看不懂主循环，老人改一个 bug 牵动 3 个系统。
- 想加第 6 章？先在 `story.ts` 手写 `SAVE_VERSION +1`，在 `mapdata.ts` 手写 `SCENE_BOUNDS`，在 `scenery.ts` 手写 `BUILDERS`，在 `world.ts` 手写 `if (id==='new')` —— 4 处漏一处就穿墙。
- `world.setEncounter()` 里同时干了“镜头缩放 + 门旋转 + 人倒地 + 刀显隐”——这叫“方法”，不叫“系统”。

**怎么改（必做）**
把上帝拆成 **5 个系统 + 1 个总线**：
```
SceneSystem： 只管 “当前在哪个 SceneId，出生点在哪”
PhysicsSystem：cannon-es 世界，WallRect → Body，只暴露 slide()/pushOut()
RenderSystem： THREE 场景图，只管 “把 State 画出来”，不写规则
ActorSystem： 玩家/同行者/狗，步态、朝向、相机跟随
LightSystem： LIGHTS 预设插值，登记 lampGlow/lampLights
EventBus： NodeEffects/worldEvent → 各 System 订阅
```
`GameWorld` 退化为 `WorldFacade`：只做 `mount()` + `onResize()` + `tick(dt)` 调度。`main.ts` 拆出 `DialogController` / `InputMapper` / `SaveManager` / `AudioBus` 四个类。

> **烤一嘴**：你现在不是在写游戏，你是在写“能跑的文档”。1990 行的类，文档叫 `world.ts`，其实叫 `everything.ts`。

---

### 罪 2：假分支 · 线性锁死的“选择”

**现状**
```ts
// story.ts
export const NODES = [...CH1_NODES, ...CH2_NODES, ...CH3_NODES, ...CH4_NODES, ...CH5_NODES];
export function canStart(state, nodeId) {
  const next = currentNode(state); // 严格按数组下标
  if (next.id !== nodeId) return {ok:false}
}
```
42 节点是定长数组，进度是 `completed.length`。分支靠 `flags: string[]` 和 `choice:C01-05=give-water` 这种字符串埋点，三处“被退回”只是 `rejected:true` 弹回选择页。`doc/21` 里写的真分支（柳岸里多线、东街两结局、回执多签法）一个没落地。

`SAVE_VERSION 5` 的迁移是手写 `if (v<2) s={...s, version:2}` 爬梯子，靠注释保证不改语义。

**为什么致命**
- 想做真正的“陈工信任度 / 赵网格态度 / 冯师傅结局”？现在只能再塞 `flag: 'chen-trust-2'` 字符串，半年后你自己都忘了。
- 存档是“前缀校验”：`completed.every((id,i)=> NODES[i].id===id)`，插一个节点就全档作废。
- 日志 `LogEntry` 只有 `type/text/node`，没有 `choiceId/cause`，后续想做“根据日志生成人物关系”就是空谈。

**怎么改（必做）**
把 `NODES: NodeDef[]` 改成 **有向图**：
```ts
type NodeId = string;
type Edge = { to: NodeId; cond?: (s:GameState)=>boolean; cost?: string[] }
type NodeDef = { id:NodeId; scene:SceneId; edges: Edge[]; ... }
```
- 进度不再是 `length`，而是 `currentNodeId + historyStack`
- 分支用 **Condition DSL**：`hasFlag('trace-two-lines') && countItem('rice') >= 2`
- 存档改 **事件溯源**：`events: Array<{node, choice, ts}>` + `snapshot`，迁移用 `zod` schema 校验 + 自动补默认值，不用手写 `v<3`。
- 保留“被退回”作为一等公民：`RejectionRule { when, reason, hint }`，而非藏在 `ChoiceDef.rejected` 里。

> **烤一嘴**：你写了全中文最克制的“选择不算善恶值”，结果代码里选择就是 `string`。故事说“不要把没看见的写成看见的”，代码却把每个选择都写成了“看见的字符串”。

---

### 罪 3：双宇宙分裂 · 正传 vs 域外 各自造了一套轮子

**现状**
|  | 正传 | 域外 |
|---|---|---|
| 入口 | `index.html → main.ts → world.ts` | `zone.html → zmain.ts → zscene.ts` |
| 内核 | `story.ts` + `combat.ts` | `zkernel.ts 1571行` |
| 地图 | `mapdata.ts + scenery.ts` | `zdata.ts 607行 + zbricks.ts` |
| 物品 | `ItemDef {tag, note} + itemJournal delta` | `ItemDef {w,h,color,weapon} + BagItem grid` |
| 物理 | `cannon-es` 圆形玩家+盒体墙 | 自写 `slide()/pushOut()/losBlocked()` AABB |
| 存档 | `yoz.chapter1.v1` (实际存 5 章) | `yoz.zone.v1` |
| 音频 | `AudioBus` 合成 drone | `masterGain + beep/noiseBurst` 另一套 |
| 相机 | 正交 33 高 / 9,24 偏移 | 正交 42 高 / 25 偏移，另一套 zoom |

零共享。修一个“摇杆漂移”要改两处，修一个“穿墙”要理解两套碰撞。

更讽刺：**正传最精彩的“手续”设计，和域外最精彩的“噪音”设计，本该互相成就**——“噪音”本可以是旧城夜里的搜刮，“手续”本可以是域外的登记处——现在它们隔着 `zone/` 文件夹老死不相往来。

**为什么致命**
- 任何底层优化（阴影、合并几何、浮尘）都要做两遍。
- 想做“白天跑手续，晚上去域外”这种 day/night 双循环？现在是两套存档键，数据不通。
- 团队认知分裂：改正传的人不敢碰 `zkernel`，改域外的人看不懂 `scenery.ts`。

**怎么改（三选一，见文末）**
**A 统一直源（推荐长期）**：抽 `engine/` 层
```
engine/
  input/      ← 统一 Joy+Keys+Pointer → Action
  physics/    ← 统一 AABB + cannon 适配器
  render/     ← 统一 THREE 正交相机 + 灯光预设
  inventory/  ← 抽象 Inventory：正传用 List，域外用 Grid，同一接口
  save/       ← 统一 localStorage + zod + 版本迁移
  audio/      ← 统一 AudioBus
game/
  story/      ← 图结构叙事
  zone/       ← 作为 story 的一个 Mode，而非独立游戏
```
**B 维持双轨但抽公共库（短期可落地）**：先把 `buildkit.ts` 彻底作为共享积木库，把 `follow.ts` 这种纯逻辑提升为 `engine/actor`，先止血。

> **烤一嘴**：你给玩家看的标题是“同一个世界的另一条街”，给程序员看的结构是“同一个硬盘的另一个星球”。

---

### 罪 4：坐标地狱 · 魔数写死，建景与逻辑三处对不上

**现状**
```ts
// chapter3.ts
target: [4.4, 0.9] // 刀在哪？为什么是 4.4？
// mapdata.ts
{ x: 4.4, z: 0.9, hx:0.55 ... } // 同一个点，手抄一遍
// world.ts buildKitchen
knife.position.set(0, 1.04, -0.16) // 组内坐标，又一套
// combat.ts
knifeX: 4.4, knifeZ: 0.9 // 战斗逻辑再抄一遍
// scenery.ts
box(prep, 1.3, 0.08, 4.3, C.metal, 0, 0.94, 0) // 台子在哪？
```
`PARK_WALLS` 手写 30 个矩形，`SCENERY_BLOCKERS` 再手写一遍，`SCENE_BOUNDS` 再手写一遍。`SPAWNS` 和 `SCENE_CAPTIONS` 也是手写表。改一个场景要动 4 个文件，且编译期不报错——运行时才穿墙。

**怎么改**
**单一数据源：SceneDef**
```ts
// scenes/kitchen.def.ts (或 .json)
export default {
  id: 'kitchen',
  bounds: { minX:-7, maxX:7, minZ:-5.2, maxZ:5.2 },
  spawn: {x:0.5, z:4.0},
  props: [
    { id:'prepTable', pos:[5.5,0.9], size:[1.3,4.3], block:true },
    { id:'knife', pos:[4.4,0.9], interact:'grab', requires:'chair-broken' }
  ],
  blockers: 'auto' // 从 props.block 自动生成
}
```
- `story.target` 改为 `target: {ref:'knife', offset:[0,0]}`，不再是裸数字
- 建景、物理、交互、战斗四处同读一个 `SceneDef`，改一处全动
- 加 `verify:scenes` 脚本：启动时校验“每个 target 在 bounds 内，每个 blocker 不压 spawn”

> **烤一嘴**：你最引以为傲的“看得见的东西挡得住”，现在是“看得见的东西要手抄三遍才挡得住”。这不叫设计约束，这叫人肉编译器。

---

### 罪 5：贫血状态 · `flags: string[]` 是万能胶，也是万能坑

**现状**
```ts
state.flags.includes('liang-joined')
state.flags.includes('trace-two-lines')
state.flags.includes('choice:C01-05=give-water')
state.flags.includes('helpedTrapped') // zone 侧又是另一个 flags
```
`GameState` 是平坦袋子：`completed/choices/log/flags/itemJournal/player/scene`。`itemJournal` 用 delta 折叠，但 `hasItem()` 每次都要全量 `new Set()` 遍历。`flags` 无类型，无枚举，无文档，靠 `grep` 找。

`zonk` 侧 `ZoneState` 更重：`zombies/militia/noises/doors/containers/contracts/bag/ground/bagDrop/log/events/flags` 全塞一个对象，`stepZone` 187 行里处理时钟、玩家、丧尸、机动队、San、清剿——又一个上帝函数。

**怎么改**
- 用 `zod` 定义 `GameStateV*` schema，迁移自动校验
- `flags` 改枚举 + 命名空间：`Flags = { story: {...}, chapter5: {...}, world: {...} }`
- 物品改 **Command 模式**：`ItemEffect = {add, remove, log, flag, worldEvent}` 由 `applyEffect(state, effect)` 统一执行，而非散在 `completeNode` 里手写 `if (node.id==='C01-05') remove.push(...)`
- Zone 拆 **ECS-lite**：`ZombieSystem / MilitiaSystem / BagSystem / SanSystem` 各管一块，`stepZone` 只做 `systems.forEach(s=>s.tick(dt))`

---

### 罪 6：测试的安慰剂 · 114 绿点盖不住的黑洞

**现状**
- 好：`story.test.ts` 37 用例把“不可乱序 / 假存档恢复 / 分支事实 / 单页字数”都锁了，`combat.test.ts` 15 用例把“不可连杀 / 椅子耐久 / 抓取挣脱”都锁了，`zone.test.ts` 38 用例把“噪音半径 / 找尸之旅 / 重尸不可战胜”都锁了。
- 坏：渲染层只有两个“无头冒烟”：
  - `zone-scene.test.ts`：注入假 renderer 跑 600 帧“不抛异常”
  - `zone-ui.test.ts`：jsdom 灌 `zone.html` 跑几帧“面板能开”
  - 正传 `world.ts` 的 21 个场景只有 `verify.mjs` 的 Playwright 跑“逐个切场景不报错”，但 **沙箱里永远跑不了**（Chromium 下不下来），只能信 CI。

**后果**：穿墙、贴图拉伸、灯光过曝、触屏按钮挡住对话——这些真机会出的问题，测试永远不红。

**怎么改**
- 把“冒烟”升级为“视觉回归”：`npm run shot` 用 Playwright 在 CI 截 21 个场景 + 厨房战斗 3 帧 + 域外夜景 3 帧，上传 `shots/` 做像素 diff（阈值 2%）
- 给 `SceneDef` 加 **静态校验**：`pnpm verify:scene` 在无 THREE 环境下跑 `SCENE_BOUNDS.contains(target) && !blockers.overlap(spawn)`
- 给物理加 **确定性回放**：录一段输入 `[{dt, input}]`，回放校验 `playerPos` 序列，防“改一处墙，全图穿”

---

### 罪 7：产品精神分裂 · 入口即分流

**现状**
`index.html` 标题 `Z年纪事 · 第一—三章`，副标题 `第一—五章 · 出墙...`，描述 `前两章没有枪...第五章...`，按钮却有 6 个：
- 开始新的一天 / 继续上次
- 第三章试玩 / 第四章试玩 / 第五章试玩
- **域外探索 · 长夜与八点（独立切片）**

玩家第一眼看到的不是“我想去哪”，而是“我该学哪套操作”。正传是 `WASD+E` 节奏叙事，域外是 `WASD+Shift/Ctrl+左键/右键/E长按/Q/F/B/L/M/滚轮+1/2/3/4` 生存——两套操作在同一个域名下抢注意力。

`README.md` 更分裂：开头写“42 节点五章”，特性里又写“域外六种丧尸+幻觉体+三方互咬+占格背包”。

**怎么改**
二选一，别暧昧：

- **如果正传是主菜**：`index.html` 只留“开始 / 继续 / 选章”，域外收进“挑战模式”或“夜行”作为二级入口，操作统一为 `WASD+E+空格挡/J挥`，背包统一 UI。
- **如果想做双主菜**：就大方做 `z-one.com/` 选游戏：左半边“白天·手续”，右半边“夜晚·噪音”，共享同一套世界观与存档（天亮后回家的包，第二天白天用得上）。

> **烤一嘴**：你怕玩家找不到内容，所以把所有入口都摆上桌；结果玩家一看桌子，以为你还没想好今天做什么菜。

---

## 根因 · 为什么会长成这样

1.  **“先跑起来”演进**：第一章是垂直切片，`world.ts` 一次建成园区；第二章是“5 个占位场景快速接入”，`scenery.ts` 后打补丁。每次都是“在现有结构上加一个 `if (id==='new')`”，自然长成巨石。
2.  **“故事先于系统”**：文本是强项，工程是追赶。节点用数组最快，flag 用字符串最快，场景用手写坐标最快——快了 5 章，债也欠了 5 章。
3.  **“双轨并行无人统合”**：正传与域外的设计文档各自精彩（`doc/33` 甚至比正传还细），但没有一次“统合评审”决定：它们到底共享什么。

**这不是能力问题，是演进策略问题。而好消息是：你的故事与玩法都已经证明成立，现在只需要让工程追上故事。**

---

## 三条大调整路线 · 你选一条，我陪你烤完

### 路线 A：推倒重来 · 引擎化（激进，3-4 周，适合想做 19 章长篇）

- 目标：`engine/` + `game/` 分层，SceneDef 数据驱动，叙事图结构，单存档打通日夜。
- 代价：`main.ts/world.ts/zkernel/zscene` 几乎重写，期间不可发版。
- 收益：19 章、分支、多结局、编辑器可期。

### 路线 B：渐进解耦 · 止血优先（**推荐**，2 周可发版，后续平滑到 A）

- 第 1 周：拆 `world.ts` → 5 System + EventBus；拆 `main.ts` → 4 Controller；`SceneDef` 先只收敛 `SPAWNS/BOUNDS/BLOCKERS` 三表
- 第 2 周：统一 `AudioBus` + `SaveManager(zod)` + `InputMapper`；域外与正传共享 `buildkit` 与 `follow`，其余维持双轨但接口对齐
- 收益：下次加第 6 章只需改 `SceneDef + NodeGraph`，不再摸巨石；可正常发版，边发边迁。

### 路线 C：产品聚焦 · 砍一保一（最快，1 周见效，适合想先出圈）

- 砍域外或收为“实验工坊”二级入口，专注把正传 5 章的“手续”体验打磨到 9.5 分：补 6 个场景的交互密度、加字幕无障碍、加真机手感调校、加 3 张像素回归截图。
- 代价：域外暂停迭代。
- 收益：口碑最稳，GNU 式“做少做好”。

> **我的倾向：选 B。** A 太赌，C 太亏。B 是“先让代码配得上已经写好的故事”，A 是 B 跑顺后的自然结果。

---

## 30/60/90 天清单 · 选 B 的话

**30 天（止血）**
- [ ] `world.ts` 拆出 `SceneSystem/PhysicsSystem/RenderSystem/ActorSystem/LightSystem`，`GameWorld` 剩 <400 行
- [ ] `main.ts` 拆出 `DialogController/InputMapper/SaveManager/AudioBus`
- [ ] `SceneDef` 统一 `SPAWNS/SCENE_BOUNDS/SCENERY_BLOCKERS/PARK_WALLS/KITCHEN_WALLS` 为单一 JSON 源，`verify:scene` 静态校验
- [ ] `SAVE_KEY` 重命名 `yoz.save.v6` + zod 校验，`SAVE_VERSION` 改语义化 `major.minor`
- [ ] CI 加 `shots` 像素回归（21 场景 + 厨房 3 帧）

**60 天（统合）**
- [ ] 叙事改图结构 `NodeGraph`，支持 `cond/edge`，旧存档自动迁移为 `historyStack`
- [ ] `engine/` 抽公共：`input/physics(统一)/inventory/audio/save`，正传与域外同接口
- [ ] 物品系统统一：`Inventory` 接口下 `ListInventory` 与 `GridInventory` 两种实现

**90 天（产品）**
- [ ] 入口二选一：正传主入口 + 域外二级“夜行”入口，操作与背包 UI 统一
- [ ] 第 6 章按新管线上线，验证“加一章只改 SceneDef+Graph，不动引擎”
- [ ] 编辑器雏形：SceneDef 可视化摆点（哪怕只是 `scenes/*.json` + 预览页）

---

## 最后一烤 · 给作者

你的文字已经做到了最难的事——**让人认得表格上的地方，却不认得眼前的处境**。从 `C01-08` “那一栏写的是住户本人确认，不是饭送到了” 到 `C04-04` “留白不好看，可它是空的，不是错的”，再到 `C05-05` “状态不是病”，这条“手续即敌人”的线是中文游戏里罕见的克制与诚实。

别让这条线死在 `flags: string[]` 和 `target: [0.8,-1.6]` 里。

**代码可以重写，故事不能重写——所以现在，是让代码配得上故事的时候。**

---

> 想继续烤？
> - 回复 `A / B / C` 选路线，我直接在这个分支上开拆 `world.ts` 第一刀
> - 回复 `先拆场景表` / `先拆存档` / `先统合引擎`，我按你的优先级出可合并 PR
> - 回复 `保留域外` / `收起域外`，我按你的产品判断改入口

*—— grill-me done. 火还开着，等你选怎么烤。*

