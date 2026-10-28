/**
 * Pure formatting helpers for the dated/categorised session-title provider.
 *
 * Everything in this module is deliberately dependency-free so the naming
 * policy can be unit-tested without booting the Harness, and so a failure in
 * the model path still yields a correctly shaped local title.
 */

export const DEFAULT_CATEGORIES = [
  '分析',
  '实现',
  '整改',
  '排查',
  '验收',
  '部署',
  '文档',
  '其他',
]

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
]

const DATE_FORMATS = new Set(['MMDD', 'YYMM', 'YYYYMMDD'])
const encoder = new TextEncoder()
const formatterCache = new Map()

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
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
  const categories = configured.length > 0 ? configured.slice(0, 24) : [...DEFAULT_CATEGORIES]
  const serviceCap = positiveInteger(serviceMaxBytes, 80)
  const maxTitleBytes = Math.min(positiveInteger(config.maxTitleBytes, serviceCap), serviceCap)
  const route =
    typeof config.provider === 'string' &&
    config.provider.trim() !== '' &&
    typeof config.model === 'string' &&
    config.model.trim() !== ''
      ? { provider: config.provider.trim(), model: config.model.trim() }
      : undefined
  return Object.freeze({
    cadence: config.cadence === 'all-prompts' ? 'all-prompts' : 'first-prompt',
    dateFormat: DATE_FORMATS.has(config.dateFormat) ? config.dateFormat : 'MMDD',
    timeZone:
      typeof config.timeZone === 'string' && config.timeZone.trim() !== ''
        ? config.timeZone.trim()
        : 'Asia/Shanghai',
    categories,
    maxTitleBytes,
    maxNameChars: Math.min(40, Math.max(4, positiveInteger(config.maxNameChars, 20))),
    maxInputBytes: positiveInteger(config.maxInputBytes, 8192),
    maxOutputTokens: positiveInteger(config.maxOutputTokens, 4096),
    timeoutMs: positiveInteger(config.timeoutMs, 60000),
    ...(route === undefined ? {} : { route }),
  })
}

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Format a session timestamp in the requested compact shape.
 *
 * `MMDD` mirrors the reference Codex list (`1027`); `YYMM` yields `2610`.
 */
export function formatDate(epochMs, format = 'MMDD', timeZone = 'Asia/Shanghai') {
  const date = new Date(Number.isFinite(epochMs) ? epochMs : Date.now())
  let parts
  try {
    parts = formatterFor(timeZone).formatToParts(date)
  } catch {
    parts = formatterFor('UTC').formatToParts(date)
  }
  const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
  const year = value('year')
  const month = value('month').padStart(2, '0')
  const day = value('day').padStart(2, '0')
  switch (format) {
    case 'YYMM':
      return `${year.slice(-2)}${month}`
    case 'YYYYMMDD':
      return `${year}${month}${day}`
    default:
      return `${month}${day}`
  }
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
  value = value.replace(/^(?:标题|名称|会话名|name|title)\s*[:：]\s*/iu, '')
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

/** Compose the exact `DATE | CATEGORY | NAME` shape inside the byte budget. */
export function composeTitle(date, category, name, maxBytes) {
  const prefix = `${date} | ${category} | `
  const budget = maxBytes - byteLength(prefix)
  if (budget < 6) {
    const compact = truncateToBytes(`${date} | ${category}`, maxBytes).trim()
    return compact === '' ? truncateToBytes(date, maxBytes) : compact
  }
  const safeName = truncateToBytes(name, budget).trim() || '未命名'
  const title = `${prefix}${safeName}`.trim()
  return truncateToBytes(title, maxBytes).trim()
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

/** Parse the model's JSON (or a relaxed key/value fallback) into category/name. */
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
  const categoryMatch = source.match(
    /(?:category|分类)\s*["'“”]?\s*[:：]\s*["'“”]?([^"”'\n,，}]+)/iu,
  )
  const nameMatch = source.match(
    /(?:name|名称|标题|会话名)\s*["'“”]?\s*[:：]\s*["'“”]?([^"”'\n,，}]+)/iu,
  )
  return {
    category: firstString(object?.category, object?.['分类'], categoryMatch?.[1]),
    name: firstString(object?.name, object?.['名称'], object?.['标题'], nameMatch?.[1]),
  }
}

/** Extract visible text from an assembled title-model response. */
export function textFromResponse(response) {
  const finish = response?.finish?.kind
  if (finish === 'max-tokens') throw new Error('title output reached maxOutputTokens')
  if (finish === 'tool-calls') throw new Error('title output must contain text only')
  if (finish !== 'stop') throw new Error(`title request finished with ${String(finish ?? 'unknown')}`)
  const blocks = Array.isArray(response?.blocks) ? response.blocks : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/** Provider system instruction: category plus a name, never the date prefix. */
export function buildSystemPrompt(settings, hasCurrentTitle) {
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
    ...(hasCurrentTitle
      ? [
          '如果提供了 currentTitle 且仍然准确，复用其中的分类和名称。',
          '寒暄、追问、细节补充、致谢或「继续」不应单独触发改名。',
          '只有对话主题或任务实质变化时才换用新名称。',
        ]
      : []),
  ].join('\n')
}

/** Frame the selected messages as JSON so user text cannot break delimiters. */
export function buildInput(messages, currentTitle) {
  const payload = {
    messages: messages.map((message) => ({ text: message.text })),
    ...(typeof currentTitle === 'string' && currentTitle.trim() !== ''
      ? { currentTitle: currentTitle.trim() }
      : {}),
  }
  return `根据以下 JSON 生成会话分类和名称：\n${JSON.stringify(payload)}`
}

/**
 * Choose the messages sent to the title model.
 *
 * First-prompt uses only the first eligible message; all-prompts keeps the
 * opening message and the most recent tail so a retitle follows the task
 * without paying for the whole history.
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
  const limit = settings.cadence === 'first-prompt' ? 1 : 6
  let selected =
    eligible.length <= limit
      ? eligible.slice()
      : [eligible[0], ...(limit > 1 ? eligible.slice(-(limit - 1)) : [])]
  const perMessage = selected.length === 1 ? 1600 : 900
  selected = selected.map((message) => ({
    seq: message.seq,
    text: truncateToChars(message.text.replace(/\s+/gu, ' ').trim(), perMessage),
  }))
  // Keep the serialized input under the executor's byte bound with headroom
  // for currentTitle and the prose wrapper.
  while (
    selected.length > 1 &&
    byteLength(buildInput(selected, undefined)) > settings.maxInputBytes - 400
  ) {
    selected = [selected[0], ...selected.slice(2)]
  }
  return selected
}
