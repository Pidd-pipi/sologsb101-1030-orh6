# 钢琴调律与琴房环境档案（gbpianotune）

面向钢琴调律师与琴行售后的本地化档案工具：按琴建档后逐次记录调律的基准音高与各音区音分偏差，登记整音、换弦与击弦机调整等维修事项，同时记录琴房温度湿度并跟踪调律周期与下次建议日期。

核心动作：**建琴档案 → 录调律前后音分 → 记整音维修 → 录琴房环境 → 算周期并提醒下次调律 → 导出档案**。

纯前端单页应用（Svelte 5 + TypeScript + Vite + Svelte SPA Router + Tailwind CSS + Dexie），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB），刷新或重启浏览器后仍然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22830**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 本项目使用 `svelte-spa-router`，它采用 **hash 路由**，因此页面地址形如 `http://localhost:22830/#/pianos`；直接访问 `http://localhost:22830` 会自动跳到 `/pianos`。
> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbpianotune}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地，迁移设备请使用应用内「导出整库备份 / 导入备份」。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Svelte 5（runes：`$state` / `$derived` / `$props` / `$effect`） | 全部页面与组件使用 runes 语法 |
| 语言 | TypeScript（`strict: true`，无 `any`） | `npm run build` 内含 `svelte-check` 类型检查 |
| UI 方案 | Tailwind CSS 3.4（手写组件类） | 不引入任何 UI 组件库，样式在 `app.css` 里以 `@layer components` 统一 |
| 构建工具 | Vite 6 | 开发服务器端口 22830 |
| 状态管理 | Svelte store（`writable` / `derived`） | `pianoStore` / `tuningStore` / `voicingStore` / `environmentStore` / `reminderStore` |
| 路由 | svelte-spa-router 5（hash 路由） | 路由表在 `src/lib/router/index.ts` |
| 本地存储 | Dexie 4（IndexedDB 封装） | 库名 `gbpianotune-db`，含结构版本号与 upgrade 迁移 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段执行类型检查与打包，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm run dev        # 开发服务器 http://localhost:22830
npm run build      # 类型检查（svelte-check）+ 生产构建，产物在 frontend/dist
npm run preview    # 本地预览构建产物（http://localhost:22830）
npm run check      # 仅做类型检查
```

---

## 四、页面与路由

| 路由 | 模块 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/pianos` | 钢琴档案台账 | Piano、Tuning、Reminder | 新建/编辑/删除琴档（删除确认与级联）、按品牌/类型/场所筛选、卡片回显最近调律日期、平均音分偏差与下次建议日期、筛选同步 URL query |
| `/tunings` | 调律记录 | Tuning、Piano | 录入基准音高与低/中/高音区音分偏差、自动计算平均与最大值、**音区偏差条形图**、超阈值自动标记需复调 |
| `/voicings` | 整音与维修 | Voicing、Piano | 登记毡槌/击弦机/换弦/踏板事项、按钢琴汇总维修履历、切换计划/已完成（完成回写钢琴状态） |
| `/environments` | 琴房温湿度记录 | Environment、Piano | 按日期录入温湿度、**超出建议区间（18–26 ℃ / 40–60 %）自动判定并用 Tailwind 高亮超标行**、超标天数统计 |
| `/reminders` | 调律周期提醒与导出 | Reminder 及全部模型 | 由周期与上次调律日期推算下次建议日期、**超期琴置顶**、按场所批量筛选、单琴档案与整库 JSON 导出导入 |

---

## 五、目录结构

```
sologsb101-1030/
├── README.md
├── docker-compose.yml
├── .env / .env.example
├── .gitignore
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files SPA fallback + gzip
    ├── .dockerignore
    ├── index.html / vite.config.ts / svelte.config.js / tsconfig.json / tsconfig.node.json
    ├── tailwind.config.js / postcss.config.js / package.json
    ├── public/favicon.svg
    └── src/
        ├── main.ts  App.svelte  app.css  vite-env.d.ts
        ├── lib/types/              # piano.ts tuning.ts voicing.ts environment.ts reminder.ts filter.ts
        ├── lib/stores/             # pianoStore tuningStore voicingStore environmentStore reminderStore
        ├── lib/components/common/  # CentsTag.svelte FilterBar.svelte StatBadge.svelte EmptyPanel.svelte
        ├── lib/hooks/              # useCentsDeviation.ts useIdbTable.ts
        ├── lib/utils/              # cents.ts db.ts export.ts seed.ts uuid.ts query.ts
        ├── lib/router/index.ts     # 路由表与导航配置
        └── routes/                 # pianos/ tunings/ voicings/ environments/ reminders/ 各一个 +page.svelte
```

---

## 六、数据存储说明

- **IndexedDB 库名**：`gbpianotune-db`（Dexie 封装），结构版本号 `version(2)`，并带 `upgrade()` 迁移逻辑。v1→v2 自动为历史行补齐行修订号、时间戳、来源操作人，并新增待确认操作表；升级幂等，重复执行不产生重复登记。
- **分表存储**：`pianos` 钢琴、`tunings` 调律、`voicings` 整音维修、`environments` 琴房环境、`reminders` 周期提醒、`pendingOperations` 待确认操作，共 6 张表；每行业务数据带 `revision` / `createdAt` / `updatedAt` / `source`（最近操作人）/ `lastClientId`（最近标签页）。
- **多标签页并发保存（乐观修订号 + 字段级三方合并）**：两个标签页同时编辑同一台琴时，先保存一方即时生效；后保存一方按「打开时的整行 + 修订号」做三方合并——
  - **不同字段**：直接合并，互不覆盖（如一方改调律记录、另一方改琴房环境）；
  - **同一字段且双方改成不同值**：已生效内容保持不动，后保存一方的值登记为一条「待确认操作」，**双方的值与操作人都保留**，确认前绝不覆盖已生效内容。
- **待确认操作**：顶栏「待确认中心」集中处理，可「保留已生效 / 采用待确认（覆盖，修订号 +1）/ 放弃」，支持批量；旧数据迁移缺来源的行也登记为待确认，补填来源后解除。操作人姓名可在中心顶部修改（跨标签页共享）。
- **原子提交**：一次提交（可含多条记录）在单个 IndexedDB 事务内执行，任何一步失败整批回滚，不留半成品；待确认操作的批量处理同为单事务。
- **派生态立即重算**：保存后，以及待确认操作确认 / 放弃后，立即在同事务内重算该琴的最近调律音分与复调标记（超阈值自动标记需复调）、周期提醒（上次调律日期 / 下次建议日期 / 状态）与钢琴状态（有计划维修→待修）。
- **首屏自动播种**：`lib/utils/db.ts` 的 `initDatabase()` 在 `pianos` 表为空时调用 `seedDatabase()`，灌入互相引用的三层演示数据（钢琴 → 调律记录 → 维修 / 环境 → 提醒），其中包含 1 台超期琴与 2 条异常环境记录，保证 5 个页面首次打开都有内容；播种幂等，清空后重进会重新播种。
- **音分换算**：`lib/utils/cents.ts` 提供 `cents = 1200 × log2(f / f0)` 与反算、与标准音 A4 = 440 Hz 的比对、偏差分档（±5 / ±10 / ±20 / ±20 以上）与配色映射。
- **无后端**：没有 API 服务、没有数据库容器；容器本身无状态，不挂载任何卷。多标签页并发由 IndexedDB 事务 + Dexie `liveQuery` 跨页推送保证。
- **级联规则**：删除钢琴会级联删除其调律、维修、环境、提醒记录及相关待确认操作。
