# Codex：从 GitHub 安装与本地体验

[English quick start](../codex-public/README.md)

推荐先使用按需版 **Session title stamp 0.2.1**：预览、刷新当前聊天标题，中英文分类、时区与日期格式选项。它不依赖公共插件市场上架，不需要为此完成开发者身份验证，也不需要独立 API key。宿主正常的使用费用仍按自己的账户计算。

## 从 GitHub 安装

要求：带 `codex plugin` 命令的 Codex、Python 3.9+。直接改名还需要当前聊天可用的官方 read_thread / set_thread_title 工具。CLI 能安装插件，不代表 CLI 聊天必然提供桌面改名工具。

当前 Codex 适配位于独立分支 `feat/codex-title-stamp`，尚未合并到 main；必须指定分支：

```sh
codex plugin marketplace add https://github.com/xuedipiaofei/dsh-session-title-stamp.git --ref feat/codex-title-stamp
codex plugin add session-title-stamp@session-title-stamp
codex plugin list --marketplace session-title-stamp --json
```

看到 `installed: true`、`enabled: true` 和版本 `0.2.1` 后，在新聊天里选择 Session title stamp。若选择器未刷新，可在保存当前工作后重启应用。不要使用 DSH 的 `market/index.json` 安装 Codex 插件。

也可克隆源码后本地安装：

```sh
git clone --branch feat/codex-title-stamp https://github.com/xuedipiaofei/dsh-session-title-stamp.git
cd dsh-session-title-stamp
codex plugin marketplace add .
codex plugin add session-title-stamp@session-title-stamp
```

两种方式选一种。如果已有同名本地市场，先用 `codex plugin marketplace list` 确认其来源，再运行 `codex plugin marketplace remove session-title-stamp` 并添加希望使用的来源。不要直接改配置数据库或手工删除缓存。

## 第一次体验

在一个有明确主题的聊天中输入：

1. `使用 title-stamp-setup 检查这个聊天是否支持标题预览和改名。`
2. `使用 session-title-stamp 预览当前聊天标题，时区用 Asia/Shanghai；先不要改名。`
3. 确认预览合适后：`使用 session-title-stamp 刷新当前聊天标题，使用上海时区。`

英文示例：`Preview this chat title using English categories, YYYYMMDD and America/Los_Angeles.`

默认日期格式 MMDD、时区为系统本地、总长度最多 36 Unicode 码点。日期来自聊天真实创建时间，主题来自整体任务。明确指定的原样标题优先于默认格式。预览不写标题；改名前再次读标题，改名后回读确认。

插件不会因为普通编程请求就自动改名，不批量访问历史聊天。缺读写工具时会报告缺失能力：有真实创建时间可给预览；没有则只给分类/主题建议，不伪造日期或声称改名成功。此限制取决于宿主，不能承诺所有版本/平台都能直接改名。

## 环境诊断与常见问题

在源码目录中检查本地 Python 和时区：

```sh
python3 codex-public/skills/session-title-stamp/scripts/format_title.py --doctor --time-zone Asia/Shanghai
```

该命令不需要输入、不联网、不改配置或标题。`official_chat_tools: not_checked` 是预期结果；工具能力必须在聊天中检查。普通终端没有 `CODEX_THREAD_ID` 也是正常现象，不要自己伪造变量。

- 找不到 `codex plugin`：当前 CLI 不提供安装能力；升级至支持插件命令的官方版本后再试。
- Python 缺失/低于 3.9：安装支持的 Python；Windows 需要时可用 `py -3` 替代 `python3`。
- IANA 时区不可用：在实际使用的 Python 环境安装 `tzdata`（`python3 -m pip install tzdata`），再诊断；不要把失败降级成错误日期。
- 安装成功但聊天找不到技能：核对 enabled 状态，使用新聊天，并检查当前桌面应用与 CLI 是否使用同一配置目录。
- 能预览不能改名：宿主缺 setter；保留预览供手动复制，不读写应用数据库。
- 更新后看起来没变化：按下节更新市场再安装；运行时加载的是安装副本，不是仓库工作区。
- 改名后又发生变化：检查是否启用了另一个命名 hook。本插件不擅自卸载用户的旧配置。

## 更新、回退与卸载

GitHub 市场更新：

```sh
codex plugin marketplace upgrade session-title-stamp
codex plugin add session-title-stamp@session-title-stamp
codex plugin list --marketplace session-title-stamp --json
```

本地克隆来源需先 `git pull --ff-only`，再运行 plugin add。保留体验中的差异与报错；不要直接覆盖缓存来“修复”。

要固定一个已验证版本，可将 marketplace add 的 `--ref` 换成该分支的完整 commit SHA（GitHub 提交页可复制）；切换前先移除旧市场来源再添加。固定 SHA 后，upgrade 不会自动追踪后续分支提交。需要回退时同样使用已知旧 SHA，然后重新安装并检查版本。

卸载按需版：

```sh
codex plugin remove session-title-stamp@session-title-stamp
```

需要删除市场来源时再运行 `codex plugin marketplace remove session-title-stamp`。卸载不恢复已改过的标题，也不修改其他 hook。

## 两种 Codex 插件与 DSH

| 目录 | 安装标识 | 用途 |
|---|---|---|
| codex-public/ | session-title-stamp@session-title-stamp | 推荐按需版；无 hook |
| codex/ | codex-session-title-stamp@session-title-stamp | 自动命名实验版；需单独审查信任 hook |
| 根目录 lib/、client.js | DSH npm 包 | 原 DSH provider、刷新按钮和悬停统计 |

自动实验版不是按需版的必需依赖。需要自动命名时再阅读 [实验版说明](../codex/README.md)，不要同时启用两套自动命名 hook。按需版和自动实验版拥有同名技能入口，建议只安装其中一套，避免选择混淆。此仓库未修改 DSH 的 npm 版本和发布触发器。

## 开发与分发

```sh
npm test
python3 -m unittest discover -s codex -p 'test_*.py' -v
python3 scripts/package-codex.py /tmp/session-title-stamp-public.zip --public
python3 scripts/package-codex.py /tmp/session-title-stamp-local.zip
```

public ZIP 根目录为插件文件；local ZIP 包含本地市场与两种插件。打包排除测试、Python 缓存、用户配置与本地进展记录。公共市场发布暂缓，不影响 GitHub 安装；是否最终通过市场审核由官方决定。

运行模型、官方工具是否调用、是否具有权限，需要真实聊天验证；离线测试不证明模型在所有宿主的执行效果。脚本无网络请求，无遥测，按需版不保存聊天数据；不需要独立模型服务。支持入口：[GitHub Issues](https://github.com/xuedipiaofei/dsh-session-title-stamp/issues)。反馈只需版本、操作、实际现象和脱敏报错，勿提供凭据或聊天隐私。

协议依据：[官方插件与本地/Git 市场](https://developers.openai.com/plugins/build/plugins)。
