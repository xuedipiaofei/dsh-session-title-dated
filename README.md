# dsh-session-title-dated

[![npm](https://img.shields.io/npm/v/dsh-session-title-dated.svg)](https://www.npmjs.com/package/dsh-session-title-dated)
[![license](https://img.shields.io/npm/l/dsh-session-title-dated.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-4f46e5.svg)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](./README.zh.md)

A DeepSeek Harness title provider that names every new session in the form:

```text
DATE | CATEGORY | NAME
```

For example:

```text
1028 | 分析 | 绿洲短剧平台验证
1027 | 整改 | 四台设备第十题验收返修
1026 | 部署 | Ubuntu 环境初始化
```

Dates are computed by the plugin from the session's creation time, never by the
model. Categories are chosen from a small configurable taxonomy and validated
locally. The model only proposes the category and the name; the provider owns
the final format. If the model is unavailable, times out, or returns invalid
output, a deterministic local fallback still produces a correctly shaped title.

## Why

Long-lived workspaces collect dozens of sessions whose titles are either the
first few words of the first message or an auto-summary that drifts. A fixed
`date | category | name` convention makes the sidebar scannable across projects,
and mirrors conventions used by other coding agents.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.3 <0.3.0`.
- A working model route for the session; the title request uses the session's
  current provider/model unless configured otherwise.

## Install

### DSH Desktop / Web with Discover

Add this market index source in **Plugins → Discover → Index sources**:

```text
https://cdn.jsdelivr.net/gh/xuedipiaofei/dsh-session-title-dated@main/market/index.json
```

Then install **Dated session titles** from the list. The plugin installs as a
profile bundle and appears in the Plugins page, where it can be enabled or
disabled like any other bundle.

### CLI

After the package is published to npm:

```sh
dsh plugin --profile <profile> add dsh-session-title-dated
```

For a local checkout:

```sh
dsh plugin --profile <profile> add ./dsh-session-title-dated
```

The Electron Desktop profile is managed by the application; use its Plugins
page rather than `dsh plugin --profile desktop`.

The bundle patch disables the shipped `session-title-llm` row and inserts this
provider. Do not enable the official
`@deepseek-ai/dsh-experimental-session-titles-bundle` at the same time: both
replace the same provider slot, and the title service accepts only one provider.

## How it works

- `cordis.patch.yml` disables `session-title-llm` and inserts the
  `session-title-dated` row from this package.
- `lib/index.js` registers a provider through `ctx.sessionTitle.register()` and
  reuses `@deepseek-ai/dsh-session-title-llm` for route selection, timeouts,
  cancellation, token limits, and exact auxiliary-request logging.
- `lib/format.js` is dependency-free: date formatting, category validation,
  name sanitizing, composition, and UTF-8 byte truncation.

The provider computes the date from `session.header.createdAt` in the configured
time zone, asks the model for `{"category":"...","name":"..."}`, validates the
category against the configured taxonomy, clips the name to the title service's
byte budget, and writes one `session/title` event.

## Configuration

Override the row in the profile's `cordis.patch.yml`:

```yaml
- id: session-title-dated
  config:
    cadence: first-prompt
    dateFormat: YYMM
    timeZone: Asia/Shanghai
    categories:
      - Analysis
      - Build
      - Fix
      - Debug
      - QA
      - Deploy
      - Docs
      - Other
    maxNameChars: 20
```

| Field | Default | Meaning |
|---|---|---|
| `cadence` | `first-prompt` | Name once after the first eligible message, or `all-prompts` to retitle as the task evolves |
| `dateFormat` | `MMDD` | `MMDD` (`1028`), `YYMM` (`2610`), or `YYYYMMDD` (`20261028`) |
| `timeZone` | `Asia/Shanghai` | Time zone used to derive the date |
| `categories` | Chinese 8-item set | Categories the model may choose; labels are also used by the local fallback classifier |
| `maxNameChars` | `20` | Character cap for the name before the byte cap applies |
| `maxTitleBytes` | service cap (`80`) | Effective cap is the smaller of this and `session-title`'s `maxTitleBytes` |
| `maxInputBytes` | `8192` | Input budget for the title request |
| `maxOutputTokens` | `4096` | Output cap, including reasoning tokens |
| `timeoutMs` | `60000` | End-to-end title-request deadline |
| `provider` / `model` | session route | Optional pair to route title generation independently |

The default taxonomy is Chinese. Supply `categories` to use any other language
or domain; the prompt lists the configured labels and the local fallback maps
common English and Chinese keywords onto them.

`1028 | 分析 | ` occupies 16 UTF-8 bytes, leaving about 21 Chinese characters
within the default 80-byte title budget. Longer names are truncated at a
code-point boundary.

## Privacy and cost

- By default (`first-prompt`) the first eligible user message is sent to the
  model. With `all-prompts`, the first message plus up to five recent messages
  are sent. Message text is framed as JSON to keep user content from breaking
  delimiters.
- The request uses the session's configured provider/model, or the optional
  `provider`/`model` override. The plugin makes no other network calls and
  collects no telemetry.
- One auxiliary request is made per session by default. `all-prompts` makes one
  per new user message. Title work is asynchronous and never delays the main
  agent response; `maxOutputTokens`, `maxInputBytes`, and `timeoutMs` bound it.
- The resulting title is stored in the session log as a normal `session/title`
  event. A manual rename pins the title and later automatic revisions do not
  overwrite it.

## Compatibility notes

- This package targets the DSH 0.2 line. `engines.dsh` refuses to install it on
  0.3+ until it is updated against the new title API.
- The bundle assumes the shipped row id `session-title-llm`. If another title
  provider is already registered, activation fails rather than silently winning;
  disable the other provider first.
- The provider imports `@deepseek-ai/dsh-session-title-llm` dynamically. A
  missing or incompatible executor degrades to local naming, but a changed
  `ctx.sessionTitle` API can prevent registration. Pin the DSH range when
  publishing a release.

## Development

The repository has no runtime or build dependencies.

```sh
npm test              # format tests, provider tests with a stubbed executor, metadata/index checks
npm run validate:index # optional: validate market/index.json with the official validator if installed
npm run pack:check    # inspect the npm tarball contents
```

The provider test redirects `@deepseek-ai/dsh-session-title-llm` to
`test/support/stub-executor.mjs` with Node's `module.registerHooks`, so it
exercises the real provider without a DSH install or model credentials.

Release steps are in [PUBLISHING.md](./PUBLISHING.md).

## License

MIT © 2026 xuedipiaofei
