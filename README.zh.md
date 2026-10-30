# dsh-session-title-stamp

[English](./README.md) | 中文

给 DeepSeek Harness 的会话按模板自动生成标题。默认格式：

```text
日期 | 分类 | 名称
```

例如：

```text
1028 | 分析 | 绿洲短剧平台验证
1027 | 整改 | 四台设备第十题验收返修
1026 | 部署 | Ubuntu 环境初始化
```

日期由插件从**会话创建时间**计算，不交给模型；分类只能从可配置词表中选择，并在本地校验；模型只负责提出分类和名称，最终格式由模板决定。

## 为什么

工作区里的会话一多，侧栏标题要么是首条消息的前几个字，要么是容易漂移的自动摘要。固定成 `日期 | 分类 | 名称` 后，跨项目扫侧栏会快很多，也和其它 coding agent 的命名习惯一致。

## 要求

- DeepSeek Harness `>=0.2.1-rc.3 <0.3.0`。
- 会话有可用的模型路由；标题请求默认跟随会话当前的 provider/model，也可用 `provider`/`model` 单独指定。

## 安装

### DSH Desktop / Web（Discover）

在 **插件 → 发现（Discover）→ 索引源** 添加：

```text
https://cdn.jsdelivr.net/gh/xuedipiaofei/dsh-session-title-stamp@v0.4.0/market/index.json
```

然后在列表里安装 **Dated session titles / 日期分类会话标题**。插件以 profile bundle 的形式安装，之后可在插件页启停。

### CLI

从 GitHub 安装：

```sh
dsh plugin --profile <profile> add github:xuedipiaofei/dsh-session-title-stamp
```

从 npm 安装：

```sh
dsh plugin --profile <profile> add dsh-session-title-stamp
```

本地 checkout：

```sh
dsh plugin --profile <profile> add ./dsh-session-title-stamp
```

Electron Desktop 的 profile 由应用管理，请在应用的插件页安装，不要用 `dsh plugin --profile desktop`。

bundle 的 patch 会禁用内置的 `session-title-llm` 行并插入本插件。**不要同时启用官方的 `@deepseek-ai/dsh-experimental-session-titles-bundle`**：两者替换的是同一个 provider 槽位，标题服务只接受一个 provider。如果别的插件先注册成功，本插件只打一条 warn 并保持 inactive，不会让启动失败。

## 实现方式

- `cordis.patch.yml` 关闭 `session-title-llm`，插入本包的 `session-title-stamp` 行。
- `lib/index.js` 通过 `ctx.sessionTitle.register()` 注册提供者，并复用官方的
  `@deepseek-ai/dsh-session-title-llm` 处理路由、超时、取消、token 上限和请求日志。
- `client.js` 是手写的浏览器模块：会话头刷新按钮 + 悬停卡片成本/耗时行。

插件从 `session.header.createdAt` 按**本机时区**计算日期，让模型返回
`{"category":"...","name":"..."}`，校验分类，再按模板拼装。`{type}` 或 `{topic}` 为空时，相邻分隔符会一起消失，不会留下 `||`。

### 重算节奏

provider 注册为 `first-prompt`，首条消息由标题服务自动命名。之后插件在**每次 turn/end（回答完成）**时判断，并有两道闸：

- **冷却**：距上次自动刷新不足 `refreshMinIntervalMs`（默认 2 分钟）就跳过；
- **冻结**：用户消息数超过 `refreshMaxTurns`（默认 100）后停止自动刷新；`/retitle` 仍可用。

fork 子会话、子代理会话，以及用户手动改名固定的标题都会跳过。`refreshOnTurnEnd: false` 时回退到旧的「每 N 条消息」模式（`retitleEvery`）。

### 会话头按钮与悬停统计

0.3.0 增加了一个很小的浏览器半边：

- 会话头有一个**刷新图标**，效果等同输入 `/retitle`，会话运行中禁用；
- 鼠标悬停会话行时，在原生相对时间下面多一行：
  `耗时 1h 51m · 估算 ≈¥4.11 · 131.7M tokens`；
- 会话行 `···` 菜单里多一项「重新生成标题」，排在原生“重命名”下面；同样调用
  `/retitle`，不新开弹窗。

数字来自 `sessionStats` / `tokenUsage` 投影，按 DeepSeek 当前 CNY 价格估算，并标注「估算」。只在悬停时向宿主请求，不会为了显示数字去恢复未加载的会话。DSH 原生已经有运行中/待交互/完成未读的状态点与 loader，所以本插件**不再加一层状态颜色**。

如果悬停行不显示，说明浏览器半边没连上宿主统计路由；刷新按钮和自动标题不受影响。

### 失败时

- 已经有标题时，重算失败会**保留旧标题**：provider 抛错，标题服务据此不提交新修订。
- 只有还没有标题的会话才用本地兜底：日期 + 推断分类 + 首条消息开头。
- 模型以 `max-tokens` 结束时，只要还能解析出可用文本就继续用；只有完全不可用才算失败。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: session-title-stamp
  config:
    refreshOnTurnEnd: true
    refreshMinIntervalMs: 120000
    refreshMaxTurns: 100
    categoryPreset: zh
    template: '{date} | {type} | {topic}'
    timeZone: Asia/Shanghai
    maxNameChars: 20
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `refreshOnTurnEnd` | `true` | 回答完成后刷新；`false` 时回退到 `retitleEvery` |
| `refreshMinIntervalMs` | `120000` | 自动刷新最小间隔；`0` 关闭冷却 |
| `refreshMaxTurns` | `100` | 超过多少条用户消息后冻结自动刷新；`0` 不冻结 |
| `retitleEvery` | `10` | 旧的按消息条数模式，仅在 `refreshOnTurnEnd: false` 时使用 |
| `backfillOnStart` | `false` | 启动时对仍是 fallback 标题的 live 会话逐个补刷 |
| `backfillMaxSessions` | `30` | 单次回填最多处理多少个会话 |
| `backfillIntervalMs` | `2000` | 回填两次刷新之间的间隔 |
| `template` | `{date} \| {type} \| {topic}` | 标题模板，占位符见下 |
| `dateFormat` | `MMDD` | `{date}` 使用：`MMDD`（`1028`）/ `YYMM`（`2610`）/ `YYYYMMDD` |
| `timeZone` | 本机时区 | 日期/时间占位符使用的 IANA 时区 |
| `categoryPreset` | `zh` | 内置分类语言：`zh` 或 `en` |
| `categories` | 预设 | 显式分类词表，优先级高于 `categoryPreset` |
| `maxNameChars` | `20` | 名称字符上限（最终还受字节上限约束） |
| `maxTitleBytes` | 标题服务上限（`80`） | 实际取它与 `session-title` 的较小值 |
| `recentMessages` | `8` | 发送首条消息 + 最近 N 条消息 |
| `maxInputBytes` | `4096` | 单次标题请求输入上限 |
| `maxOutputTokens` | `4096` | 输出上限（含推理 token） |
| `timeoutMs` | `90000` | 标题请求超时 |
| `provider` / `model` | 跟随会话 | 可选，成对设置时用独立模型生成标题 |

### 模板占位符

| 占位符 | 含义 |
|---|---|
| `{date}` | 按 `dateFormat` 渲染的日期（`1028`、`2610`、`20261028`） |
| `{YYYY}` `{YY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` | 日期/时间部件，可任意拼接（`{YYYYMMDD}`、`{HHmm}`） |
| `{type}` | 分类；为空时整段及相邻分隔符一起消失 |
| `{topic}` | 名称；为空时整段及相邻分隔符一起消失 |

不认识的占位符会**原样保留**（`{MMDD} {bogus}` 会保留 `{bogus}`），方便一眼看出模板写错，而不是悄悄消失。最终仍受 `maxTitleBytes` 截断。

默认分类是中文。`categoryPreset: en` 可切到
`Analysis / Build / Fix / Debug / QA / Deploy / Docs / Other`；`categories`
可以覆盖任意预设。提示词使用配置的标签，本地兜底也会把常见中英文关键词映射过去。

## 隐私与成本

- 发送首条有效用户消息，加上最多 `recentMessages - 1` 条最近消息。消息以 JSON 包裹，避免用户文本破坏分隔符。
- 请求使用会话当前的 provider/model，或可选的 `provider`/`model` 覆盖。插件没有其它网络请求，也不收集遥测。
- 首条标题一次辅助请求，之后每个完成的 turn 最多一次（受冷却/冻结约束）。标题生成是异步的，不会阻塞主回复；`maxOutputTokens`、`maxInputBytes`、`timeoutMs` 都会约束它。
- 标题作为普通 `session/title` 事件写入会话日志。用户手动重命名后标题会被固定，后续自动命名不会覆盖。

## 兼容性

- 本包面向 DSH 0.2 线；`engines.dsh` 会在 0.3+ 上拒绝安装，直到按新 API 更新。
- bundle 依赖内置行 id `session-title-llm`。如果已有其它标题 provider 先注册，本插件会打 warn 并保持 inactive；先停用另一个再重载。
- `llm`、`commands`、`sessions`、`sessionProjections`、`connection` 都采用延迟注入；缺少哪个只损失对应能力，不影响插件加载。
- 浏览器半边依赖 Web 组合的 `sidebar.session.row.hover` 和 `conversation.session.header.actions` 座位；没有这两个座位的 shell 不会显示按钮/悬停行。
- 插件动态 import `@deepseek-ai/dsh-session-title-llm`。执行器缺失或不兼容时会降级为本地命名；如果 `ctx.sessionTitle` API 本身变化，则可能无法注册。

## 开发

仓库没有运行时依赖，也不需要构建。

```sh
npm test               # 格式测试、带 stub 执行器的 provider 测试、元数据/索引检查
npm run validate:index # 可选：用官方校验器校验 market/index.json（需先安装该包）
npm run pack:check     # 查看 npm tarball 内容
```

provider 测试用 Node 的 `module.registerHooks` 把
`@deepseek-ai/dsh-session-title-llm` 重定向到
`test/support/stub-executor.mjs`，因此不需要安装 DSH 或模型凭据。

发布步骤见 [PUBLISHING.md](./PUBLISHING.md)。

## 许可证

MIT © 2026 xuedipiaofei
