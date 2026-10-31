# Session title stamp — Codex desktop adapter

本目录为含 hook 的本地实验插件（0.1.0），不是公共市场提交包。无 hook 的市场版和当前安装状态见 [市场版说明](../docs/codex-marketplace.md)。

同仓库独立插件（0.1.0）。DSH 仍使用根目录 npm 包与 market/index.json；Codex 使用本目录，不加载 Cordis、DSH provider 或 client.js。

## 功能与取舍

| 功能 | DSH | Codex 适配 |
|---|---|---|
| 日期 / 分类 / 主题 | Host provider | 本地 Python 格式化 + 官方聊天工具 |
| 创建日期 | 会话 header | read_thread.createdAt，明确 Unix 秒 |
| 自动命名 | first-prompt | UserPromptSubmit 提醒本轮结束前命名 |
| 自动刷新 | turn/end | 可选每个用户回合结束前刷新；不创建额外 Stop 续跑 |
| 手动刷新 | /retitle、按钮、菜单 | 调用 session-title-stamp 技能 |
| 手动标题保护 | 原生 pinned 标志 | 默认不接管非空标题；已接管标题改变后停止自动覆盖 |
| 节流 / 冻结 | 2 分钟 / 100 条用户消息 | 2 分钟 / 100 次成功命名；手动请求可绕过 |
| 悬停成本、耗时、token | DSH UI 扩展 | 未移植；没有核实可用的 Codex 会话行扩展接口，不套用 DeepSeek 价格 |

这是模型配合官方工具的工作流，不是独立后台标题服务。Hook 只注入提醒；模型是否调用工具取决于运行环境、任务上下文和指令优先级。Python 不读取聊天数据库、不解析 transcript、不执行模型请求、不发送网络请求。分类由当前模型生成，会占用少量当前回合 token 和工具调用时间。

## 安装（本地 / 私有市场）

要求：支持插件 hooks 的 Codex 桌面版本、Python 3.9+（使用的 Python 需带 IANA 时区数据），以及当前聊天可用的官方 read_thread、set_thread_title 工具。CLI、Web 或没有这两个工具的环境会跳过，不冒充兼容。

1. 保持仓库根目录的 `.agents/plugins/marketplace.json` 与 `codex/` 相对位置。打开该仓库作为项目；支持 marketplace CLI 的版本也可在仓库根目录运行 `codex plugin marketplace add .`。
2. 重启桌面应用，在插件目录选择本地 **Session title stamp** 市场，安装 **codex-session-title-stamp**。
3. 在客户端审查并信任 hook。安装插件不等于信任 hook；不要手改信任数据库。
4. 新建聊天测试。已有非空标题不会自动接管；输入“使用 session-title-stamp 刷新当前聊天标题”可显式接管。之后才适用可选自动刷新。

完整 ZIP 包含市场目录与 codex/；解压后以解压根目录为 marketplace root。不要单独移动市场 JSON；路径相对于市场根目录，不相对于 `.agents/plugins/`。

本机已有其他日期命名 hook 时，请选择一套启用。此适配遇到同轮其他命名 hook 会主动让出；不会自动卸载或修改旧配置。停用本插件或设 `enabled: false` 可停止自动命名。卸载后已生成标题保留。

按 [官方插件打包说明](https://developers.openai.com/plugins/build/plugins)，含生命周期 hook 的包当前只能手动安装，不能提交公共插件目录。因此这不是截图公共市场中的已上架插件。

## 配置

将 `config.example.json` 的内容保存为本插件 **PLUGIN_DATA** 目录下的 `config.json`。该目录由宿主提供，hook 上下文会把路径传给技能；不要把配置放进会被刷新覆盖的插件缓存源码。无配置时采用系统本地时区、只命名一次。示例使用 Asia/Shanghai。

- `enabled`: 自动命名开关；手动技能仍可调用。
- `autoRefresh`: 默认 false；设 true 后，只自动更新最近经本插件回读确认的标题。
- `refreshMinIntervalSeconds`: 默认 120，0 取消冷却。
- `refreshMaxUpdates`: 默认 100，0 不冻结；计数包含首次命名与手动刷新。
- `timeZone`: `local` 或 IANA 时区。日期固定来自创建时间，不随当前日期变化。

标题最多 36 个 Unicode 码点，分类为功能、设计、整改、优化、发布、分析、文档。已有标题只要不是上次本插件记录的值，就视为用户/其他工具所有。默认因此可能跳过宿主已生成标题的聊天；这是明确的保护取舍，手动刷新后可接管。不自动扫描或补命名历史聊天。

## 失败与并发

缺工具、ID 不一致、无真实创建时间、坏配置、坏状态均不改名。Hook 失败不阻断用户任务。只有 set_thread_title 后 read_thread 回读一致才保存插件状态；状态中仅有标题、更新时间、次数，不保存消息正文。

写入前再次读取标题，检测到变化则放弃。官方 setter 没有条件更新参数，因此仍存在最后一次读取与写入之间的并发改名窗口；不能宣称原子更新。中断后若已改名但状态未记入，下次自动操作会保守跳过，手动刷新可恢复。

## 验证

```sh
python3 -m unittest discover -s codex -p 'test_*.py' -v
npm test
python3 scripts/package-codex.py /tmp/codex-session-title-stamp.zip
```

离线测试覆盖日期跨时区、Unicode、ID 隔离、手动标题保护、回读失败、节流/冻结、坏输入和 hook 协议。DSH 原测试验证原功能回归。

目标环境验收仍需在安装后执行：新聊天空标题自动命名；已有标题默认保留；显式刷新并回读；配置 autoRefresh 后下一回合更新；手动改名后自动刷新停止；关闭插件后停止注入。本次开发未安装新插件，也未完成这些安装态验收；当前聊天官方工具可用和原有 hook 成功不能替代它们。

依据：[官方插件结构与本地市场](https://developers.openai.com/plugins/build/plugins)、[Hooks 协议](https://learn.chatgpt.com/docs/hooks)，核对日期 2026-10-31。
