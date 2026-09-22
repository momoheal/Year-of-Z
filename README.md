# Y 年 Z（Year of Z）

> 一个"丧尸没有正面出场"的叙事探索游戏 · 中文原创故事 · 纯前端零远端资源

[English README → README.EN.md](README.EN.md)

**《Y年Z》** 是一款基于原创中文长篇故事的浏览器叙事探索游戏。第一章**《出墙》**已经可玩：
你是物流园看门人"老周"，在封控后的清晨送完"最后一车货"，再把自己一路送回小区的围墙之内。
没有枪声，没有追咬——只有撬棍、合格批次、网格围笼和一张纸质名单。

> 🌿 **分支说明**：当前可玩版本在分支 [`arena/01a0c311-year-of-z`](../../pull/1)（PR #1，基于 `main`）。
> 合并 PR 后，`main` 将附带 GitHub Pages 自动部署工作流（见下文「在线游玩」）。

---

## ✨ 特性

- **12 个叙事节点**完整流程：大门交接 → 取撬棍 → 开侧门 → 南库抉择（安置 / 交接）→ 呼叫医护 → 合格批次 → 网笼观察 → 送狗 → 物资站 → 观察点之夜 → 回家
- **等距正交 3D**：three.js + 低多边形原创几何 + Canvas 程序化材质，**零远端资源**，离线可玩
- **物理碰撞**：cannon-es（玩家圆形近似、建筑静态盒体、剧情门动态解锁）
- **双端输入**：桌面键鼠（WASD / Shift / E / 点地寻路）与移动触屏，自适应横竖屏
- **四时段光照**：晨 / 午 / 昏 / 夜平滑过渡，随剧情时间推进
- **自动存档**：localStorage，2.6s 节流写入，坏档自动恢复，刷新后可"继续"
- **工坊（Workshop）**：独立叠加层 + 独立存档键，与章节状态**严格隔离**（叙事红线：枪绝不进入第一章世界）
- **鸭子走步态 / 假 AO / 浮尘粒子 / NPC 剧情站位**：细节打磨持续中

## 🎮 快速开始

```bash
npm install        # 安装依赖（Node.js ≥ 18）
npm run dev        # 开发服务器 → http://localhost:5173
```

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器（已允许外部主机访问，兼容沙箱预览） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm run preview` | 本地预览生产构建 |
| `npm test` | vitest：12 个叙事内核不变量用例 |
| `npm run verify` | **Playwright 运行时验收**（需先 `npx playwright install chromium`；走完 12 节点关键流程并输出 5 张截图到 `shots/`） |
| `npm run pack` | 构建并打包 `dist/` → `release/yoz-*.tar.gz`（跨平台，纯 Node 实现） |

### 操作

- **移动**：WASD / 方向键，Shift 跑步；或点击地面设路标自动步行
- **交互**：靠近人物/物件后按 **E**
- **背包 / 任务**：I / Tab；**光照模式**：界面滑杆（自动 · 晨 · 午 · 昏 · 夜）
- **手机**：点地移动，点屏幕上的 E 提示交互（横屏视野更佳）

### 在线游玩（GitHub Pages）

仓库已内置 `.github/workflows/pages.yml`：合并 PR 到 `main` 后，在仓库 **Settings → Pages** 中选择
**Source: GitHub Actions**，每次推送 `main` 都会自动构建 `dist/` 并发布到
`https://<用户名>.github.io/Year-of-Z/`（Vite 已使用相对 `base: './'`，子路径直接可用）。

## 🛠 技术栈

TypeScript · Vite 5 · three.js 0.169 · cannon-es · lucide（图标）· vitest · Playwright（验收）
无服务端、无数据库、无 CDN 依赖——整个游戏是一个纯静态站点。

## 📁 项目结构

```
├── index.html            # DOM 外壳（UI 面板、标题画面）
├── src/
│   ├── main.ts           # 启动 / 输入 / 存档 / 音频 / 主循环接线
│   ├── story.ts          # 叙事内核：12 节点、物品、旗帜、存档序列化（全部纯函数可测）
│   ├── world.ts          # 场景/角色/灯光/物理/动画（4 个场景：园区·物资站·观察点·门口）
│   ├── mapdata.ts        # 碰撞墙单一数据源（构建与测试共用）
│   ├── workshop.ts       # 工坊叠加层（独立渲染器与存档）
│   └── style.css         # 响应式 UI
├── tests/story.test.ts   # 叙事内核不变量（12 用例）
├── scripts/
│   ├── verify.mjs        # Playwright 端到端验收脚本
│   └── pack.mjs          # 跨平台 dist 打包（tar.gz）
├── .github/workflows/    # CI（tsc+测试+构建）与 Pages 部署
└── doc/                  # 27+ 篇中文故事/设计文档（见 doc/README.md）
```

## 📖 文档

故事设定、章节细纲与设计核对都在 [`doc/`](doc/README.md)：

- [doc/24](doc/24-第一章Demo关卡与交互.md) — 第一章 12 节点关卡与交互规格
- [doc/25](doc/25-Demo技术路线与验收.md) — 技术路线与验收标准（含运行时验收补记）
- [doc/27](doc/27-第一章Demo实施记录.md) — 实现记录与遗留项清单

## ⚠️ 验收状态（如实记录）

自动化验证（`tsc` / `vitest` 12/12 / `vite build`）全绿；Playwright 运行时验收脚本已就位但
**尚未在交付环境执行**（该环境无法安装浏览器）。玩家侧 10–15 分钟实机体验验收待进行，
详见 doc/27 遗留项。游戏手感与数值（走速、镜头、尘埃浓度）欢迎提 issue 反馈。

## 📄 协议

[MIT](LICENSE) © 2026 momoheal
