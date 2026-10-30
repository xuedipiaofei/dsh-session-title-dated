# Changelog

## 0.3.1 — 2026-10-30

- Add a native Session-row menu item that runs `/retitle` without opening a dialog.

## 0.3.0 — 2026-10-30

- Turn-aware refresh: react to completed `turn/end` events instead of counting
  every N messages, with a 2-minute cooldown and a 100-message freeze.
- Optional startup backfill for live sessions whose title is still the fallback.
- `/retitle` host command for an immediate, cooldown-free refresh.
- Browser half: a conversation-header refresh button and a Session-hover line
  with estimated cost, duration, and token count.
- `categoryPreset: zh | en` built-in taxonomies; `categories` still overrides.
- Native DSH status indicators are reused instead of adding a duplicate color
  layer.
- `refreshOnTurnEnd: false` keeps the legacy `retitleEvery` message cadence.

## 0.2.0 — 2026-10-30

- Retitle every N user messages (`retitleEvery`, default 10) through
  `ctx.sessionTitle.refresh()` instead of calling the model on every prompt.
- Failed retitles keep the existing title; local naming is used only when the
  session has no title yet.
- Configurable `template` with `{date}`, `{type}`, `{topic}`, and free
  date/time placeholders; empty segments remove their adjacent separator.
- Date/time defaults to the host's local time zone; `timeZone` remains
  configurable.
- Input is bounded to the first message plus recent messages (4 KiB default).
- Tolerant parser for labelled and fenced output; `max-tokens` responses still
  contribute usable text.
- `llm` is injected lazily; a missing LLM service no longer leaves the plugin
  entry pending.
- Registration conflicts with another title provider are logged and do not fail
  startup.
- `timeoutMs` default raised to 90 s, with a 4 KiB input budget.
- GitHub Actions OIDC publishing workflow.
- `cadence` is retained as a compatibility alias for `retitleEvery`.

## 0.1.0 — 2026-10-28

- Initial release.
- Session title provider with the fixed `DATE | CATEGORY | NAME` format.
- Date derived from the session creation time in a configurable time zone
  (`MMDD`, `YYMM`, or `YYYYMMDD`).
- Configurable category taxonomy with local validation and keyword fallback.
- Deterministic local title when the model is unavailable, times out, or returns
  invalid output.
- `first-prompt` and `all-prompts` cadences.
- Optional independent `provider`/`model` route for title generation.
- Format-1 market index and awesome-list entry included.
