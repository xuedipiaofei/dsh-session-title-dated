import assert from 'node:assert/strict'
import * as f from '../lib/format.js'

const ts = Date.parse('2026-10-28T01:04:09Z')
assert.equal(f.formatDate(ts, 'MMDD', 'Asia/Shanghai'), '1028')
assert.equal(f.formatDate(ts, 'YYMM', 'Asia/Shanghai'), '2610')
assert.equal(f.formatDate(ts, 'YYYYMMDD', 'Asia/Shanghai'), '20261028')
assert.equal(f.formatDate(ts, 'MMDD', 'America/New_York'), '1027')
assert.match(f.formatDate(ts, 'MMDD'), /^\d{4}$/u)

const settings = f.resolveSettings({}, 80)
assert.equal(settings.retitleEvery, 10)
assert.equal(settings.dateFormat, 'MMDD')
assert.equal(settings.template, '{date} | {type} | {topic}')
assert.equal(settings.timeZone, undefined)
assert.equal(settings.maxTitleBytes, 80)
assert.equal(settings.maxInputBytes, 4096)
assert.equal(settings.maxOutputTokens, 4096)
assert.equal(settings.timeoutMs, 90000)
assert.equal(settings.categories.length, 8)
assert.equal(settings.refreshOnTurnEnd, true)
assert.equal(settings.refreshMinIntervalMs, 120000)
assert.equal(settings.refreshMaxTurns, 100)
assert.equal(settings.backfillOnStart, false)
const english = f.resolveSettings({ categoryPreset: 'en' }, 80)
assert.equal(english.categories[0], 'Analysis')
assert.equal(english.categories.at(-1), 'Other')
assert.equal(f.inferCategory('fix the login bug', english.categories), 'Fix')
assert.match(f.buildSystemPrompt(english, false), /Analysis/u)
assert.equal(f.resolveSettings({ cadence: 'first-prompt' }, 80).retitleEvery, 0)
assert.equal(f.resolveSettings({ cadence: 'all-prompts' }, 80).retitleEvery, 1)
assert.equal(f.resolveSettings({ retitleEvery: 3 }, 80).retitleEvery, 3)

const title = f.composeTitle(ts, '分析', '绿洲短剧平台验证', settings)
assert.equal(title, '1028 | 分析 | 绿洲短剧平台验证')
assert.ok(f.byteLength(title) <= 80)

const yy = f.resolveSettings({ dateFormat: 'YYMM' }, 80)
assert.equal(f.composeTitle(ts, '分析', '绿洲短剧平台验证', yy), '2610 | 分析 | 绿洲短剧平台验证')

const custom = f.resolveSettings({ template: '{YYYYMMDD} {topic}' }, 80)
assert.equal(f.composeTitle(ts, '分析', '项目复盘', custom), '20261028 项目复盘')

const topicFirst = f.resolveSettings({ template: '{topic} | {MMDD}' }, 80)
assert.equal(f.composeTitle(ts, '分析', '项目复盘', topicFirst), '项目复盘 | 1028')

// An empty type removes its neighbouring separators instead of leaving `||`.
const emptyType = f.composeTitle(ts, '', '登录失败', settings)
assert.equal(emptyType, '1028 | 登录失败')

const longTitle = f.composeTitle(ts, '分析', '这是一个非常非常长的会话名称'.repeat(10), settings)
assert.ok(f.byteLength(longTitle) <= 80)
assert.match(longTitle, /^1028 \| 分析 \| /u)

const unknown = f.resolveSettings({ template: '{MMDD} {bogus}' }, 80)
assert.equal(f.composeTitle(ts, '分析', 'x', unknown), '1028 {bogus}')

const cleaned = f.cleanName('**1028 | 分析 | 修复登录超时|问题**', settings, 'fallback')
assert.equal(cleaned, '修复登录超时 问题')
assert.equal(f.cleanName('主题：登录 401', settings, 'fallback'), '登录 401')

assert.equal(f.normalizeCategory('整改', settings.categories, 'x'), '整改')
assert.equal(f.normalizeCategory('修复', settings.categories, 'x'), '整改')
assert.equal(f.normalizeCategory('乱写', settings.categories, '部署 nginx 上线'), '部署')
assert.equal(f.normalizeCategory('', settings.categories, '随便聊聊'), '分析')

assert.equal(f.inferCategory('部署 nginx 并上线', settings.categories), '部署')
assert.equal(f.inferCategory('帮我验收这十项', settings.categories), '验收')

assert.deepEqual(f.parseModelOutput('```json\n{"category":"整改","name":"修复登录超时"}\n```'), {
  category: '整改',
  name: '修复登录超时',
})
assert.deepEqual(
  f.parseModelOutput('说明：{"category":"部署","name":"Ubuntu 环境初始化"} 以上'),
  { category: '部署', name: 'Ubuntu 环境初始化' },
)
assert.deepEqual(f.parseModelOutput('类型：整改｜主题：修复登录超时'), {
  category: '整改',
  name: '修复登录超时',
})
assert.deepEqual(f.parseModelOutput('Type: Debug\nTopic: login 401'), {
  category: 'Debug',
  name: 'login 401',
})
assert.deepEqual(f.parseModelOutput('部署|Ubuntu 初始化'), {
  category: '部署',
  name: 'Ubuntu 初始化',
})
assert.deepEqual(f.parseModelOutput('{"category":"分析","name":"绿洲短剧'), {
  category: '分析',
  name: '绿洲短剧',
})
assert.deepEqual(f.parseModelOutput('not a title'), { category: undefined, name: undefined })

const messages = Array.from({ length: 20 }, (_, index) => ({
  seq: index + 1,
  text: `第 ${index + 1} 条消息，讲述一个很长的任务背景和当前进度`,
}))
const selected = f.selectMessages(messages, settings)
assert.equal(selected.length, 8)
assert.equal(selected[0].seq, 1)
assert.equal(selected.at(-1).seq, 20)
assert.deepEqual(
  selected.map((message) => message.seq),
  [...selected.map((message) => message.seq)].sort((left, right) => left - right),
)
assert.ok(f.byteLength(f.buildInput(selected, '1027 | 分析 | 旧标题')) <= 4096)

const tiny = f.resolveSettings({ recentMessages: 3, maxInputBytes: 1200 }, 80)
const tinySelected = f.selectMessages(messages, tiny)
assert.equal(tinySelected.length, 3)
assert.equal(tinySelected[0].seq, 1)
assert.equal(tinySelected.at(-1).seq, 20)
assert.ok(f.byteLength(f.buildInput(tinySelected, 'x'.repeat(120))) <= 1200)

assert.equal(
  f.textFromResponse({ finish: { kind: 'stop' }, blocks: [{ type: 'text', text: 'x' }] }),
  'x',
)
assert.equal(
  f.textFromResponse({
    finish: { kind: 'max-tokens' },
    blocks: [{ type: 'text', text: '{"category":"分析"' }],
  }),
  '{"category":"分析"',
)
assert.throws(() => f.textFromResponse({ finish: { kind: 'tool-calls' }, blocks: [] }))
assert.throws(() => f.textFromResponse({ finish: { kind: 'stop' }, blocks: [] }))

assert.match(f.fallbackName('https://example.com 帮我看看这个构建为什么失败\n第二行', 20), /^帮我看看这个构建为什么失败/u)
assert.equal(f.fallbackName('/compact', 20), '未命名会话')
assert.ok(f.byteLength(f.fallbackName('测试'.repeat(50), 10)) <= 30)

console.log('format tests passed')
console.log('sample:', title, '|', longTitle, '|', cleaned)
