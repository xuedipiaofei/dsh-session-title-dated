/**
 * Pure formatting helpers for the dated/categorised session-title provider.
 *
 * Everything in this module is deliberately dependency-free so the naming
 * policy can be unit-tested without booting the Harness, and so a failure in
 * the model path still yields a correctly shaped local title.
 */

export const CATEGORY_PRESETS = Object.freeze({
  zh: ['分析', '实现', '整改', '排查', '验收', '部署', '文档', '其他'],
  en: ['Analysis', 'Build', 'Fix', 'Debug', 'QA', 'Deploy', 'Docs', 'Other'],
})

export const DEFAULT_CATEGORIES = [...CATEGORY_PRESETS.zh]

/** Default template: `1028 | 分析 | 登录超时`. `{date}` honours `dateFormat`. */
export const DEFAULT_TEMPLATE = '{date} | {type} | {topic}'

/** Human hints shown to the title model for the default taxonomy. */
export const CATEGORY_HINTS = {
  分析: '调研、评估、方案对比、根因分析、可行性判断',
  实现: '新功能开发、编码、脚本实现',
  整改: '修复缺陷、返工、验收问题整改',
  排查: '故障定位、调试、日志排查',
  验收: '测试、验收、逐项核对、复测',
  部署: '上线、发布、环境配置、运维',
  文档: '文档编写、整理、总结',
  其他: '以上都不合适',
  Analysis: 'research, evaluation, options, root-cause analysis',
  Build: 'new implementation, coding, scripts',
  Fix: 'defect repair, rework, acceptance fixes',
  Debug: 'troubleshooting, diagnosis, logs',
  QA: 'testing, acceptance, verification',
  Deploy: 'release, environment setup, operations',
  Docs: 'documentation, cleanup, summary',
  Other: 'none of the above',
}

/** Synonyms accepted from the model and mapped onto a configured category. */
const CATEGORY_ALIASES = {
  调研: '分析',
  评估: '分析',
  方案: '分析',
  诊断: '分析',
  复盘: '分析',
  审查: '分析',
  开发: '实现',
  编码: '实现',
  功能: '实现',
  修复: '整改',
  返工: '整改',
  缺陷: '整改',
  bug: '整改',
  问题: '整改',
  调试: '排查',
  定位: '排查',
  故障: '排查',
  测试: '验收',
  复测: '验收',
  核对: '验收',
  上线: '部署',
  发布: '部署',
  运维: '部署',
  环境: '部署',
  写作: '文档',
  整理: '文档',
  说明: '文档',
}

/** Ordered keyword table for the deterministic fallback classifier. */
const CATEGORY_KEYWORDS = [
  ['整改', ['整改', '修复', '返工', '缺陷', 'bug', '报错', '不通过', '失败', '问题']],
  ['验收', ['验收', '测试', '复测', '核对', '检查', 'acceptance', 'validation']],
  ['部署', ['部署', '上线', '发布', '环境', '运维', 'docker', 'nginx', 'deploy', 'release']],
  ['排查', ['排查', '定位', '调试', '诊断', '崩溃', '异常', 'debug', 'troubleshoot', 'traceback']],
  ['文档', ['文档', 'readme', '整理', '总结', '说明', 'document']],
  ['实现', ['实现', '开发', '新增', '编码', '功能', 'implement', 'develop', 'feature']],
  ['分析', ['分析', '评估', '调研', '方案', '对比', '验证', '研究', 'analyze', 'research', 'review']],
  ['Fix', ['fix', 'bug', 'repair', 'defect', 'error', 'issue', 'broken']],
  ['QA', ['test', 'acceptance', 'verify', 'qa', 'validation']],
  ['Deploy', ['deploy', 'release', 'ops', 'environment', 'docker', 'nginx', 'ship']],
  ['Debug', ['debug', 'troubleshoot', 'diagnose', 'crash', 'traceback', 'log']],
  ['Docs', ['doc', 'readme', 'document', 'writeup', 'summarize']],
  ['Build', ['build', 'implement', 'develop', 'feature', 'code', 'script']],
  ['Analysis', ['analyze', 'analysis', 'research', 'review', 'evaluate', 'compare']],
]

const DATE_FORMATS = new Set(['MMDD', 'YYMM', 'YYYYMMDD'])
const encoder = new TextEncoder()
const formatterCache = new Map()

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** UTF-8 byte length, the unit the session-title service budgets in. */
export function byteLength(text) {
  return encoder.encode(String(text ?? '')).length
}

/** Keep whole code points while staying within a UTF-8 byte budget. */
export function truncateToBytes(text, maxBytes) {
  const limit = Math.max(0, Math.trunc(maxBytes))
  let used = 0
  let result = ''
  for (const character of String(text ?? '')) {
    const size = byteLength(character)
    if (used + size > limit) break
    result += character
    used += size
  }
  return result
}

/** Keep whole code points while staying within a character budget. */
export function truncateToChars(text, maxChars) {
  const characters = Array.from(String(text ?? ''))
  if (characters.length <= maxChars) return characters.join('')
  return `${characters.slice(0, maxChars).join('')}…`
}

/**
 * Validate provider configuration and fill safe defaults.
 *
 * @param raw - the loader-provided plugin config.
 * @param serviceMaxBytes - the title service's own byte cap.
 */
export function resolveSettings(raw, serviceMaxBytes) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  const configured = Array.isArray(config.categories)
    ? [...new Set(config.categories.map((item) => String(item).trim()).filter(Boolean))]
    : []
  const categoryPreset = config.categoryPreset === 'en' ? 'en' : 'zh'
  const categories =
    configured.length > 0
      ? configured.slice(0, 24)
      : [...(CATEGORY_PRESETS[categoryPreset] ?? DEFAULT_CATEGORIES)]
  const serviceCap = positiveInteger(serviceMaxBytes, 80)
  const maxTitleBytes = Math.min(positiveInteger(config.maxTitleBytes, serviceCap), serviceCap)
  const route =
    typeof config.provider === 'string' &&
    config.provider.trim() !== '' &&
    typeof config.model === 'string' &&
    config.model.trim() !== ''
      ? { provider: config.provider.trim(), model: config.model.trim() }
      : undefined

  // `retitleEvery` is the current cadence. Legacy `cadence` values keep their
  // old behaviour: first-prompt = never retitle, all-prompts = every message.
  const legacyCadence = config.cadence
  const retitleEvery =
    nonNegativeInteger(config.retitleEvery) ??
    (legacyCadence === 'all-prompts' ? 1 : legacyCadence === 'first-prompt' ? 0 : 10)

  const template =
    typeof config.template === 'string' && config.template.trim() !== ''
      ? config.template.trim().slice(0, 240)
      : DEFAULT_TEMPLATE

  return Object.freeze({
    categoryPreset,
    // Legacy message-count cadence. The turn/end listener uses it only when
    // refreshOnTurnEnd is explicitly false.
    retitleEvery,
    refreshOnTurnEnd: config.refreshOnTurnEnd !== false,
    refreshMinIntervalMs:
      nonNegativeInteger(config.refreshMinIntervalMs) ?? 120000,
    refreshMaxTurns: nonNegativeInteger(config.refreshMaxTurns) ?? 100,
    backfillOnStart: config.backfillOnStart === true,
    backfillMaxSessions: positiveInteger(config.backfillMaxSessions, 30),
    backfillIntervalMs: nonNegativeInteger(config.backfillIntervalMs) ?? 2000,
    template,
    dateFormat: DATE_FORMATS.has(config.dateFormat) ? config.dateFormat : 'MMDD',
    // An absent time zone means the host's local time zone. Hard-coding a
    // region would show the wrong day to users outside it.
    timeZone:
      typeof config.timeZone === 'string' && config.timeZone.trim() !== ''
        ? config.timeZone.trim()
        : undefined,
    categories,
    maxTitleBytes,
    maxNameChars: Math.min(40, Math.max(4, positiveInteger(config.maxNameChars, 20))),
    recentMessages: Math.min(20, Math.max(2, positiveInteger(config.recentMessages, 8))),
    maxInputBytes: positiveInteger(config.maxInputBytes, 4096),
    maxOutputTokens: positiveInteger(config.maxOutputTokens, 4096),
    timeoutMs: positiveInteger(config.timeoutMs, 90000),
    ...(route === undefined ? {} : { route }),
  })
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Calendar fields for a timestamp, in a time zone or the host's local zone. */
function timeParts(epochMs, timeZone) {
  const date = new Date(Number.isFinite(epochMs) ? epochMs : Date.now())
  if (timeZone === undefined) {
    const year = date.getFullYear()
    return {
      YYYY: String(year),
      YY: String(year).slice(-2),
      MM: pad(date.getMonth() + 1),
      DD: pad(date.getDate()),
      HH: pad(date.getHours()),
      mm: pad(date.getMinutes()),
      ss: pad(date.getSeconds()),
    }
  }
  try {
    let formatter = formatterCache.get(timeZone)
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
      formatterCache.set(timeZone, formatter)
    }
    const parts = formatter.formatToParts(date)
    const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
    const year = value('year')
    const hour = value('hour') === '24' ? '00' : value('hour')
    return {
      YYYY: year,
      YY: year.slice(-2),
      MM: value('month').padStart(2, '0'),
      DD: value('day').padStart(2, '0'),
      HH: hour.padStart(2, '0'),
      mm: value('minute').padStart(2, '0'),
      ss: value('second').padStart(2, '0'),
    }
  } catch {
    // An unknown IANA name must not break a title; fall back to local time.
    return timeParts(epochMs, undefined)
  }
}

function dateFromParts(parts, format) {
  switch (format) {
    case 'YYMM':
      return `${parts.YY}${parts.MM}`
    case 'YYYYMMDD':
      return `${parts.YYYY}${parts.MM}${parts.DD}`
    default:
      return `${parts.MM}${parts.DD}`
  }
}

/**
 * Format a session timestamp in the requested compact shape.
 *
 * `MMDD` mirrors the reference Codex list (`1027`); `YYMM` yields `2610`.
 * An absent or invalid time zone uses the host's local zone.
 */
export function formatDate(epochMs, format = 'MMDD', timeZone) {
  return dateFromParts(timeParts(epochMs, timeZone), format)
}

function expandTimeTokens(inner, parts) {
  const names = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss', 'YY']
  let rest = inner
  let output = ''
  while (rest.length > 0) {
    const hit = names.find((token) => rest.startsWith(token))
    if (hit === undefined) return undefined
    output += parts[hit] ?? ''
    rest = rest.slice(hit.length)
  }
  return output
}

/** Separator characters trimmed at the edge and around an empty segment. */
const SEPARATOR_CHARS = /[\s|｜·,，、/\\–—-]/

function trimEdgeSeparators(text) {
  return text.replace(/^[\s|｜·,，、/\\–—-]+/u, '').replace(/[\s|｜·,，、/\\–—-]+$/u, '')
}

/** Marks an empty placeholder so its neighbouring separator can be removed. */
const EMPTY_SEGMENT = '\u0000'

/** Remove empty placeholders and one adjacent run of separators. */
function dropEmptySegments(text) {
  const characters = [...text]
  const kept = []
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (character !== EMPTY_SEGMENT) {
      kept.push(character)
      continue
    }
    let removedLeft = 0
    while (kept.length > 0 && SEPARATOR_CHARS.test(kept[kept.length - 1])) {
      kept.pop()
      removedLeft += 1
    }
    if (removedLeft === 0) {
      let right = index + 1
      while (right < characters.length && SEPARATOR_CHARS.test(characters[right])) right += 1
      index = right - 1
    }
  }
  return kept.join('')
}

/**
 * Render the title template.
 *
 * Placeholders: `{date}` (honours `dateFormat`), `{type}`, `{topic}`, and any
 * concatenation of `YYYY MM DD HH mm ss YY` (for example `{YYYYMMDD}`). An
 * unknown placeholder is left verbatim so a typo is visible instead of silently
 * disappearing. Empty `{type}` / `{topic}` segments remove their neighbouring
 * separator, so `1028 | <empty> | 登录超时` becomes `1028 | 登录超时`.
 */
export function formatTitle(template, epochMs, category, name, settings) {
  const parts = timeParts(epochMs, settings.timeZone)
  const filled = template.replace(/\{([^{}]*)\}/gu, (whole, inner) => {
    const key = inner.trim()
    if (key === 'type') return category.length > 0 ? category : EMPTY_SEGMENT
    if (key === 'topic') return name.length > 0 ? name : EMPTY_SEGMENT
    if (key === 'date') return dateFromParts(parts, settings.dateFormat)
    const expanded = expandTimeTokens(key, parts)
    return expanded ?? whole
  })
  return trimEdgeSeparators(dropEmptySegments(filled))
}

/** Compose the final title from the template and clip it to the byte budget. */
export function composeTitle(epochMs, category, name, settings) {
  const rendered = formatTitle(settings.template, epochMs, category, name, settings)
  const fallback = rendered || name || category || formatDate(epochMs, settings.dateFormat, settings.timeZone)
  const title = trimEdgeSeparators(truncateToBytes(fallback, settings.maxTitleBytes))
  return title || '未命名'
}

/** First useful phrase from a human message, used when the model is unavailable. */
export function fallbackName(text, maxChars = 20) {
  let value = String(text ?? '')
  value = value.replace(/```[\s\S]*?```/gu, ' ')
  value = value.replace(/`[^`]*`/gu, ' ')
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
  value = value.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
  value = value.replace(/https?:\/\/\S+/giu, ' ')
  value = value.replace(/<[^>]+>/gu, ' ')
  value = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
  value = value.replace(/[\r\n\t]+/gu, ' ')
  value = value.replace(/^\s*(?:[#>*\-–—]+|\d+[.、)])\s*/u, '')
  value = value.replace(/^\/\S+\s*/u, '')
  value = value.replace(/^(?:请|麻烦|帮我|帮忙|我想|我需要|需要|先|现在|然后)\s*/u, '')
  value = value.replace(/\s+/gu, ' ').trim()
  const sentence = value.split(/[。！？!?；;]/u)[0]?.trim() || value
  let result = Array.from(sentence).slice(0, maxChars).join('').trim()
  result = result.replace(/^[\s"'“”‘’「」『』:：,，.。;；!！?？\-–—|｜]+/u, '')
  result = result.replace(/[\s"'“”‘’「」『』:：,，.。;；!！?？\-–—|｜]+$/u, '')
  return result || '未命名会话'
}

/** Pick a category from the configured taxonomy using keyword evidence. */
export function inferCategory(text, categories = DEFAULT_CATEGORIES) {
  const haystack = String(text ?? '').toLowerCase()
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (!categories.includes(category)) continue
    if (keywords.some((keyword) => haystack.includes(keyword))) return category
  }
  if (categories.includes('分析')) return '分析'
  if (categories.includes('其他')) return '其他'
  if (categories.includes('Analysis')) return 'Analysis'
  if (categories.includes('Other')) return 'Other'
  return categories[0]
}

/** Coerce model output onto one of the configured categories. */
export function normalizeCategory(raw, categories, sourceText) {
  const candidate = String(raw ?? '')
    .replace(/[\[\]{}"'“”‘’「」『』|｜:：,，。.\s]/gu, '')
    .trim()
  if (categories.includes(candidate)) return candidate
  const alias = CATEGORY_ALIASES[candidate.toLowerCase()]
  if (alias !== undefined && categories.includes(alias)) return alias
  for (const category of categories) {
    if (candidate.includes(category)) return category
  }
  return inferCategory(sourceText, categories)
}

/** Produce a title-safe name from model output or a local fallback. */
export function cleanName(raw, settings, fallbackText = '') {
  let value = String(raw ?? '')
  value = value.replace(/```[\s\S]*?```/gu, ' ')
  value = value.replace(/`([^`]*)`/gu, '$1')
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
  value = value.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
  value = value.replace(/https?:\/\/[^\s)]+/giu, ' ')
  value = value.replace(/<[^>]+>/gu, ' ')
  value = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
  value = value.replace(/[*_~#>]+/gu, ' ')
  value = value.replace(/[\r\n\t]+/gu, ' ')
  value = value.replace(/^(?:标题|名称|会话名|主题|话题|name|title|topic)\s*[:：]\s*/iu, '')
  value = value.replace(/\s+/gu, ' ').trim()

  // Strip a date or category prefix the model may have echoed despite the
  // instruction, so the provider — not the model — owns the final format.
  // Runs before pipes become spaces, otherwise the separators are lost.
  value = value.replace(/^(?:\d{2,8}\s*[|｜:：\-–—]\s*)+/u, '')
  const categoryPattern = settings.categories.map(escapeRegExp).join('|')
  if (categoryPattern !== '') {
    value = value.replace(new RegExp(`^(?:${categoryPattern})\\s*[|｜:：\\-–—]\\s*`, 'u'), '')
    value = value.replace(new RegExp(`^(?:${categoryPattern})\\s+`, 'u'), '')
  }
  value = value.replace(/[|｜]/gu, ' ')
  value = value.replace(/^[\s"'“”‘’「」『』:：,，.。;；!！?？\-–—]+/u, '')
  value = value.replace(/[\s"'“”‘’「」『』:：,，.。;；!！?？\-–—]+$/u, '')
  value = value.replace(/\s+/gu, ' ').trim()

  const clamped = Array.from(value).slice(0, settings.maxNameChars).join('').trim()
  return clamped === '' ? fallbackName(fallbackText, settings.maxNameChars) : clamped
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function extractJsonObject(text) {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === '{') depth += 1
      else if (character === '}') {
        depth -= 1
        if (depth === 0) return text.slice(start, index + 1)
      }
    }
  }
  return undefined
}

const CATEGORY_LABEL =
  /(?:category|分类|类型|type)\s*["'“”]?\s*[:：|｜]\s*["'“”]?([^"”'\n,，}|｜]+)/iu
const NAME_LABEL =
  /(?:name|名称|主题|话题|title|topic)\s*["'“”]?\s*[:：|｜]\s*["'“”]?([^"”'\n,，}|｜]+)/iu

/**
 * Parse the model's JSON (or a relaxed key/value fallback) into category/name.
 *
 * Handles `分类：` / `类型：` / `Type:` / `主题：` / `Topic:` labels, full-width
 * bars, bullets and fenced output. A `type|topic` line is accepted as a last
 * resort, which also salvages a JSON response cut off by `max-tokens`.
 */
export function parseModelOutput(text) {
  const source = String(text ?? '').trim()
  if (source === '') return {}
  let object
  const json = extractJsonObject(source)
  if (json !== undefined) {
    try {
      const parsed = JSON.parse(json)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) object = parsed
    } catch {
      // Relaxed parsing below handles fenced or slightly malformed output.
    }
  }
  const categoryMatch = source.match(CATEGORY_LABEL)
  const nameMatch = source.match(NAME_LABEL)
  let category = firstString(
    object?.category,
    object?.['分类'],
    object?.['类型'],
    object?.type,
    categoryMatch?.[1],
  )
  let name = firstString(
    object?.name,
    object?.['名称'],
    object?.['主题'],
    object?.['话题'],
    object?.title,
    object?.topic,
    nameMatch?.[1],
  )

  if (category === undefined && name === undefined) {
    const line = source
      .split(/\r?\n/u)
      .map((part) => part.replace(/^[-\s*\d.、]+/u, '').replace(/^[「『"'“”`【\[]+/u, ''))
      .find((part) => part.trim().length > 0)
    const parts = line
      ?.split(/[|｜]/u)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts !== undefined && parts.length >= 2) {
      category = parts[0]
      name = parts.slice(1).join(' | ')
    }
  }

  return { category, name }
}

/** Extract visible text from an assembled title-model response. */
export function textFromResponse(response) {
  const finish = response?.finish?.kind
  if (finish === 'tool-calls') throw new Error('title output must contain text only')
  if (finish === 'error' || finish === 'aborted') {
    throw new Error(`title request finished with ${String(finish)}`)
  }
  // A reasoning model can spend the output budget before finishing its JSON.
  // The first line is often complete, so let the parser try instead of
  // discarding a usable title.
  if (finish !== undefined && finish !== 'stop' && finish !== 'max-tokens') {
    throw new Error(`title request finished with ${String(finish)}`)
  }
  const blocks = Array.isArray(response?.blocks) ? response.blocks : []
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  if (text.trim() === '') throw new Error('title model produced no text')
  return text
}

/** Provider system instruction: category plus a name, never the date prefix. */
export function buildSystemPrompt(settings, hasPreviousTitle) {
  const hints = settings.categories
    .map((category) => {
      const hint = CATEGORY_HINTS[category]
      return hint === undefined ? `- ${category}` : `- ${category}：${hint}`
    })
    .join('\n')
  return [
    '你为 AI 编程助手（DSH）的会话生成「分类」和「名称」。',
    '只输出一个 JSON 对象，不要 Markdown 代码块、解释或多余文字：',
    '{"category":"分析","name":"简短名称"}',
    '',
    '分类必须是以下之一：',
    hints,
    '',
    '名称规则：',
    '- 与对话主要语言一致；中文 6-18 个汉字，非中文不超过 10 个词；',
    '- 概括会话的主要主题或任务，不要只复述问候、客套或「继续」；',
    '- 不要包含日期、分类名、竖线 |、引号、换行、Markdown、文件路径或命令；',
    '- 信息不足时，按用户输入的主题起一个简短名称，不要解释。',
    ...(hasPreviousTitle
      ? [
          '如果提供了 previousTitle 且仍然准确，复用其中的分类和名称。',
          '寒暄、追问、细节补充、致谢或「继续」不应单独触发改名。',
          '只有对话主题或任务实质变化时才换用新名称。',
        ]
      : []),
  ].join('\n')
}

/** Frame the selected messages as JSON so user text cannot break delimiters. */
export function buildInput(messages, previousTitle) {
  const payload = {
    messages: messages.map((message) => ({ text: message.text })),
    ...(typeof previousTitle === 'string' && previousTitle.trim() !== ''
      ? { previousTitle: previousTitle.trim() }
      : {}),
  }
  return `根据以下 JSON 生成会话分类和名称：\n${JSON.stringify(payload)}`
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/**
 * Choose the messages sent to the title model.
 *
 * The first message anchors the original goal; the most recent messages carry
 * the current task. The middle of a long conversation is omitted so the input
 * stays bounded. Byte-budget fitting drops the oldest recent message first.
 */
export function selectMessages(messages, settings) {
  const eligible = Array.isArray(messages)
    ? messages.filter(
        (message) =>
          message !== null &&
          typeof message === 'object' &&
          Number.isSafeInteger(message.seq) &&
          typeof message.text === 'string' &&
          message.text.trim() !== '',
      )
    : []
  if (eligible.length === 0) return []
  const limit = Math.min(settings.recentMessages, eligible.length)
  let selected =
    eligible.length <= limit
      ? eligible.slice()
      : [eligible[0], ...eligible.slice(-(limit - 1))]
  selected = selected.map((message, index) => ({
    seq: message.seq,
    text: truncateToBytes(oneLine(message.text), index === 0 ? 400 : 600),
  }))
  const titlePlaceholder = 'x'.repeat(120)
  while (
    selected.length > 1 &&
    byteLength(buildInput(selected, titlePlaceholder)) > settings.maxInputBytes
  ) {
    selected = [selected[0], ...selected.slice(2)]
  }
  if (byteLength(buildInput(selected, titlePlaceholder)) > settings.maxInputBytes) {
    selected[0] = {
      seq: selected[0].seq,
      text: truncateToBytes(selected[0].text, 200),
    }
  }
  return selected
}
