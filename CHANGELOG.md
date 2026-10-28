# Changelog

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
