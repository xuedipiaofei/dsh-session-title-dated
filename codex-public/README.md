# Session title stamp

On-demand creation-date / category / topic titles for the current Codex chat.
No background hooks, API keys, telemetry, or chat database access.

## Install from GitHub

The Codex adapter is currently on the `feat/codex-title-stamp` branch:

```sh
codex plugin marketplace add https://github.com/xuedipiaofei/dsh-session-title-stamp.git --ref feat/codex-title-stamp
codex plugin add session-title-stamp@session-title-stamp
codex plugin list --marketplace session-title-stamp --json
```

Use a new chat after installation. Requires a plugin-capable Codex client,
Python 3.9+ and timezone data. Direct renaming additionally needs the host's
official current-chat read/write tools; installation alone does not guarantee
those tools are available. No public-directory listing is required.

Try “Use title-stamp-setup to check compatibility”, then
“Use session-title-stamp to preview this chat title”. Preview never renames.
Ask “Refresh this chat title” to explicitly apply a title and verify it.
Chinese/English categories, MMDD/YYYYMMDD, and IANA timezones are supported.
Default timezone is local, not inferred from language. Maximum 36 codepoints.

If metadata is unavailable, the skill suggests a topic/category without inventing
a date; if the setter is unavailable, copy a preview manually.

## Local diagnostics

From this plugin folder:

```sh
python3 skills/session-title-stamp/scripts/format_title.py --doctor --time-zone Asia/Shanghai
```

This checks Python, timezone and whether a current-thread identity is present.
It deliberately does not claim that official chat tools are available.
A normal terminal without a thread identity is expected. Missing timezone data
can be installed with `python3 -m pip install tzdata` in the Python environment
used by the plugin. No configuration or title is changed by diagnostics.

## Update / remove

```sh
codex plugin marketplace upgrade session-title-stamp
codex plugin add session-title-stamp@session-title-stamp
# Uninstall only when wanted:
codex plugin remove session-title-stamp@session-title-stamp
```

For a pinned version use a verified full commit SHA with marketplace `--ref`.
Install one title-stamp variant at a time to avoid duplicate skill names.
The independent local-auto variant requires trusted hooks; this package does not.

[中文完整说明](https://github.com/xuedipiaofei/dsh-session-title-stamp/blob/feat/codex-title-stamp/docs/codex-marketplace.md)
· [Support](https://github.com/xuedipiaofei/dsh-session-title-stamp/issues)

MIT. Host account usage charges still apply. Market publication is deferred.
