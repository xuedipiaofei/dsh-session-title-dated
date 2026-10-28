import assert from 'node:assert/strict'
import * as f from '../lib/format.js'

const ts = Date.parse('2026-10-28T01:04:09Z')
assert.equal(f.formatDate(ts, 'MMDD', 'Asia/Shanghai'), '1028')
assert.equal(f.formatDate(ts, 'YYMM', 'Asia/Shanghai'), '2610')
assert.equal(f.formatDate(ts, 'YYYYMMDD', 'Asia/Shanghai'), '20261028')
assert.equal(f.formatDate(ts, 'MMDD', 'America/New_York'), '1027')

const settings = f.resolveSettings({}, 80)
assert.equal(settings.cadence, 'first-prompt')
assert.equal(settings.dateFormat, 'MMDD')
assert.equal(settings.maxTitleBytes, 80)
assert.equal(settings.categories.length, 8)

const title = f.composeTitle('1028', '分析', '绿洲短剧平台验证', 80)
assert.equal(title, '1028 | 分析 | 绿洲短剧平台验证')
assert.ok(f.byteLength(title) <= 80)

const longTitle = f.composeTitle('1028', '分析', '这是一个非常非常长的会话名称'.repeat(10), 80)
assert.ok(f.byteLength(longTitle) <= 80)
assert.match(longTitle, /^1028 \| 分析 \| /)

const cleaned = f.cleanName('**1028 | 分析 | 修复登录超时|问题**', settings, 'fallback')
assert.equal(cleaned, '修复登录超时 问题')

assert.equal(f.normalizeCategory('整改', settings.categories, 'x'), '整改')
assert.equal(f.normalizeCategory('修复', settings.categories, 'x'), '整改')
assert.equal(f.normalizeCategory('乱写', settings.categories, '部署 nginx 上线'), '部署')
assert.equal(f.normalizeCategory('', settings.categories, '随便聊聊'), '分析')

assert.equal(f.inferCategory('部署 nginx 并上线', settings.categories), '部署')
assert.equal(f.inferCategory('帮我验收这十项', settings.categories), '验收')

assert.deepEqual(f.parseModelOutput('```json\n{"category":"整改","name":"修复登录超时"}\n```'), { category: '整改', name: '修复登录超时' })
assert.deepEqual(f.parseModelOutput('说明：{"category":"部署","name":"Ubuntu 环境初始化"} 以上'), { category: '部署', name: 'Ubuntu 环境初始化' })
assert.deepEqual(f.parseModelOutput('分类：分析\n名称：绿洲短剧平台验证'), { category: '分析', name: '绿洲短剧平台验证' })
assert.deepEqual(f.parseModelOutput('not json at all'), { category: undefined, name: undefined })

const msgs = [
  { seq: 1, text: '这个目录任务先读一下背景，这是 AI 问答的 10 个验收题目' },
  { seq: 5, text: '继续' },
  { seq: 9, text: '现在部署到 8080 并复测' },
]
const firstOnly = f.selectMessages(msgs, settings)
assert.equal(firstOnly.length, 1)
assert.equal(firstOnly[0].seq, 1)

const all = f.selectMessages(msgs, f.resolveSettings({ cadence: 'all-prompts' }, 80))
assert.deepEqual(all.map((m) => m.seq), [1, 5, 9])
assert.ok(f.byteLength(f.buildInput(all, '1027 | 分析 | 旧标题')) < 8192)

assert.equal(f.textFromResponse({ finish: { kind: 'stop' }, blocks: [{ type: 'text', text: 'x' }] }), 'x')
assert.throws(() => f.textFromResponse({ finish: { kind: 'max-tokens' }, blocks: [] }))

assert.match(f.fallbackName('https://example.com 帮我看看这个构建为什么失败\n第二行', 20), /^帮我看看这个构建为什么失败/)
assert.ok(f.byteLength(f.fallbackName('测试'.repeat(50), 10)) <= 30)

console.log('format tests passed')
console.log('sample:', title, '|', longTitle, '|', cleaned)
