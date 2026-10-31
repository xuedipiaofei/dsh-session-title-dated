---
name: title-stamp-setup
description: Check Session title stamp compatibility or explain how to preview and rename a current chat. Use for plugin setup, missing tools, or title-stamp troubleshooting; do not change any title during setup.
---

# Setup and diagnosis

Explain that this is an on-demand title skill, not an automatic naming hook. Do not rename during setup or change global instructions, permissions or hooks.

Run `python3 ../session-title-stamp/scripts/format_title.py --doctor` (resolve relative to this skill folder, not cwd; add `--time-zone Asia/Shanghai` only when requested). The command needs no stdin, makes no writes, and deliberately reports official tools as not_checked. Missing thread identity in a standalone terminal is normal; repeat the check inside the active Codex chat. Check the trusted CODEX_THREAD_ID environment variable, availability of official read_thread/set_thread_title tools, Python 3.9+, and local timezone data. If the id and reader are available, read only the current chat and verify its id and createdAt; do not enumerate chats. Tools available in one desktop build are not guaranteed for every user or surface.

Report a concise capability result:
- Reader + setter + valid current-chat metadata + formatter: preview and rename available.
- Reader/metadata + formatter only: preview available; rename unavailable.
- Missing trusted metadata: category/topic suggestions only, no fabricated date.

Offer two starter requests in the user's language: “预览当前聊天的日期分类标题，时区用上海” and “刷新当前聊天标题”. Preview is read-only; refresh changes only this chat and verifies by reading it back. English categories and YYYYMMDD are supported when requested. The formatter is at ../session-title-stamp/scripts/format_title.py relative to this folder.

If an older date-title hook is already present, leave it alone. The public plugin does not schedule automatic updates; a manual request can override a prior title. Explain that the older hook may have its own naming behavior, without promising to control it. Diagnose missing host tools truthfully rather than editing app storage or installing a different plugin.
