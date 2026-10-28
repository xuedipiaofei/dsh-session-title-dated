# dsh-session-title-dated

[English](./README.md) | 中文

给 DeepSeek Harness 的新会话自动生成固定格式的标题：

```text
日期 | 分类 | 名称
```

例如：

```text
1028 | 分析 | 绿洲短剧平台验证
1027 | 整改 | 四台设备第十题验收返修
1026 | 部署 | Ubuntu 环境初始化
```

日期由插件从**会话创建时间**计算，不交给模型；分类只能从可配置词表中选择，并在本地校验；模型只负责提出分类和名称，最终格式由插件拼装。模型不可用、超时或输出不合法时，插件会用本地规则生成同样格式的标题，不会退回无格式标题。

## 为什么

工作区里的会话一多，侧栏标题要么是首条消息的前几个字，要么是容易漂移的自动摘要。固定成 `日期 | 分类 | 名称` 后，跨项目扫侧栏会快很多，也和其它 coding agent 的命名习惯一致。

## 要求

- DeepSeek Harness `>=0.2.1-rc.3 <0.3.0`。
- 会话有可用的模型路由；标题请求默认跟随会话当前的 provider/model。

## 安装

### DSH Desktop / Web（Discover）

在 **插件 → 发现（Discover）→ 索引源** 添加：

```text
https://cdn.jsdelivr.net/gh/xuedipiaofei/dsh-session-title-dated@main/market/index.json
```

然后在列表里安装 **Dated session titles / 日期分类会话标题**。插件以 profile bundle 的形式安装，之后可在插件页启停。索引钉的是 GitHub commit，所以不依赖 npm 发布。

### CLI

从 GitHub 安装：

```sh
dsh plugin --profile <profile> add github:xuedipiaofei/dsh-session-title-dated
```

npm 发布后也可以用短形式：

```sh
dsh plugin --profile <profile> add dsh-session-title-dated
```

本地 checkout：

```sh
dsh plugin --profile <profile> add ./dsh-session-title-dated
```

Electron Desktop 的 profile 由应用管理，请在应用的插件页安装，不要用 `dsh plugin --profile desktop`。

bundle 的 patch 会禁用内置的 `session-title-llm` 行并插入本插件。**不要同时启用官方的 `@deepseek-ai/dsh-experimental-session-titles-bundle`**：两者替换的是同一个 provider 槽位，标题服务只接受一个 provider。

## 实现方式

- `cordis.patch.yml` 关闭 `session-title-llm`，插入本包的 `session-title-dated` 行。
- `lib/index.js` 通过 `ctx.sessionTitle.register()` 注册提供者，并复用官方的
  `@deepseek-ai/dsh-session-title-llm` 处理路由、超时、取消、token 上限和请求日志。
- `lib/format.js` 无依赖：日期、分类校验、名称清洗、格式拼装、按 UTF-8 字节截断。

插件从 `session.header.createdAt` 按配置时区计算日期，让模型返回
`{"category":"...","name":"..."}`，校验分类、按标题服务的字节预算裁剪名称，最后写入一条 `session/title` 事件。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: session-title-dated
  config:
    cadence: first-prompt
    dateFormat: YYMM
    timeZone: Asia/Shanghai
    categories:
      - 分析
      - 实现
      - 整改
      - 排查
      - 验收
      - 部署
      - 文档
      - 其他
    maxNameChars: 20
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `cadence` | `first-prompt` | 首条消息后命名一次；`all-prompts` 每次新提示都尝试更新 |
| `dateFormat` | `MMDD` | `MMDD`（`1028`）/ `YYMM`（`2610`）/ `YYYYMMDD`（`20261028`） |
| `timeZone` | `Asia/Shanghai` | 计算日期用的时区 |
| `categories` | 内置中文 8 类 | 模型可选分类；也用于本地兜底分类 |
| `maxNameChars` | `20` | 名称字符上限（最终还受字节上限约束） |
| `maxTitleBytes` | 标题服务上限（`80`） | 实际取它与 `session-title` 的 `maxTitleBytes` 较小值 |
| `maxInputBytes` | `8192` | 标题请求输入上限 |
| `maxOutputTokens` | `4096` | 输出上限（含推理 token） |
| `timeoutMs` | `60000` | 标题请求超时 |
| `provider` / `model` | 跟随会话 | 可选，成对设置时用独立模型生成标题 |

默认分类是中文。需要英文或其它领域词表时直接替换 `categories`；提示词会使用配置的标签，本地兜底也会把常见中英文关键词映射到这些标签。

`1028 | 分析 | ` 占 16 个 UTF-8 字节，默认 80 字节标题预算下名称约可用 21 个汉字；超长会在完整码点处截断。

## 隐私与成本

- 默认 `first-prompt` 只把首条有效用户消息发给模型；`all-prompts` 会发首条消息加最多 5 条最近消息。消息以 JSON 包裹，避免用户文本破坏分隔符。
- 请求使用会话当前的 provider/model，或可选的 `provider`/`model` 覆盖。插件没有其它网络请求，也不收集遥测。
- 默认每个会话一次辅助请求；`all-prompts` 每次新用户消息一次。标题生成是异步的，不会阻塞主回复；`maxOutputTokens`、`maxInputBytes`、`timeoutMs` 都会约束它。
- 标题作为普通 `session/title` 事件写入会话日志。用户手动重命名后标题会被固定，后续自动命名不会覆盖。

## 兼容性

- 本包面向 DSH 0.2 线；`engines.dsh` 会在 0.3+ 上拒绝安装，直到按新 API 更新。
- bundle 依赖内置行 id `session-title-llm`。如果已有其它标题 provider 注册，本插件会激活失败而不是悄悄抢占；先停用另一个。
- 插件动态 import `@deepseek-ai/dsh-session-title-llm`。执行器缺失或不兼容时会降级为本地命名；如果 `ctx.sessionTitle` API 本身变化，则可能无法注册。

## 开发

仓库没有运行时依赖，也不需要构建。

```sh
npm test              # 格式测试、带 stub 执行器的 provider 测试、元数据/索引检查
npm run validate:index # 可选：用官方校验器校验 market/index.json（需先安装该包）
npm run pack:check    # 查看 npm tarball 内容
```

provider 测试用 Node 的 `module.registerHooks` 把
`@deepseek-ai/dsh-session-title-llm` 重定向到
`test/support/stub-executor.mjs`，因此不需要安装 DSH 或模型凭据。

发布步骤见 [PUBLISHING.md](./PUBLISHING.md)。

## 许可证

MIT © 2026 xuedipiaofei
