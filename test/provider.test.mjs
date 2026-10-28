import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const stubUrl = new URL('./support/stub-executor.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-session-title-llm') {
      return { url: stubUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const stub = await import(stubUrl)
const { apply } = await import('../lib/index.js')

const TIMESTAMP = Date.parse('2026-10-28T01:04:09Z')
const MESSAGES = [
  { seq: 4, text: '这个目录任务先读一下背景，这是 AI 问答的 10 个验收题目' },
  { seq: 9, text: '现在部署到 8080 并复测' },
]

function setup(config = {}) {
  let provider
  const warnings = []
  const ctx = {
    sessionTitle: {
      config: { maxTitleBytes: 80 },
      register(value) {
        provider = value
      },
    },
    logger: {
      warn(message) {
        warnings.push(String(message))
      },
    },
  }
  apply(ctx, config)
  assert.ok(provider, 'apply() must register a provider')
  return { provider, warnings }
}

function request(overrides = {}) {
  return {
    session: {
      id: 'test-session',
      header: { createdAt: TIMESTAMP },
      snapshotEvents: () => [],
      append: () => {},
    },
    messages: MESSAGES,
    currentTitle: { title: '1027 | 分析 | 旧标题' },
    signal: new AbortController().signal,
    ...overrides,
  }
}

// 1. First-prompt cadence, model path, category/name sanitising, model metadata.
{
  stub.reset()
  const { provider, warnings } = setup({
    cadence: 'first-prompt',
    dateFormat: 'MMDD',
    timeZone: 'Asia/Shanghai',
  })
  assert.equal(provider.id, 'dated-category')
  assert.equal(provider.automatic, 'first-prompt')

  stub.reply('```json\n{"category":"整改","name":"修复登录超时|问题"}\n```')
  const result = await provider.generate(request())

  assert.equal(result.title, '1028 | 整改 | 修复登录超时 问题')
  assert.deepEqual(result.messageSeqs, [4])
  assert.deepEqual(result.model, { provider: 'mock-provider', model: 'mock-title-model' })
  assert.ok(Buffer.byteLength(result.title, 'utf8') <= 80)
  assert.equal(warnings.length, 0)

  assert.equal(stub.state.calls.length, 1)
  assert.equal(stub.state.calls[0].providerId, 'dated-category')
  assert.deepEqual(stub.state.calls[0].config, {
    maxInputBytes: 8192,
    maxOutputTokens: 4096,
    timeoutMs: 60000,
  })
  assert.deepEqual(stub.state.calls[0].messageSeqs, [4])
  assert.match(stub.state.calls[0].input, /currentTitle/)
  assert.match(stub.state.calls[0].system, /分类/)
}

// 2. Model failure falls back to the local classifier and the same shape.
{
  stub.reset()
  const { provider, warnings } = setup({ cadence: 'first-prompt' })
  stub.fail('mock model down')
  const result = await provider.generate(request())

  assert.match(result.title, /^1028 \| (分析|验收|部署|整改) \| /u)
  assert.deepEqual(result.messageSeqs, [4])
  assert.equal(result.model, undefined)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /title model unavailable/)
}

// 3. Invalid model output also falls back locally.
{
  stub.reset()
  const { provider } = setup({ cadence: 'first-prompt' })
  stub.reply('I could not decide on a title.')
  const result = await provider.generate(request())

  assert.match(result.title, /^1028 \| (分析|验收|部署|整改) \| /u)
  assert.ok(Buffer.byteLength(result.title, 'utf8') <= 80)
}

// 4. YYMM and all-prompts: date prefix and the selected message set.
{
  stub.reset()
  const { provider } = setup({ cadence: 'all-prompts', dateFormat: 'YYMM' })
  assert.equal(provider.automatic, 'all-prompts')

  stub.reply('{"category":"部署","name":"Ubuntu 环境初始化"}')
  const result = await provider.generate(request())

  assert.equal(result.title, '2610 | 部署 | Ubuntu 环境初始化')
  assert.deepEqual(result.messageSeqs, [4, 9])
  assert.deepEqual(stub.state.calls[0].messageSeqs, [4, 9])
}

// 5. Cancellation is not swallowed into a fallback title.
{
  stub.reset()
  const { provider } = setup({ cadence: 'first-prompt' })
  stub.fail('mock model down')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(provider.generate(request({ signal: controller.signal })), /mock model down/)
}

// 6. Overlong names stay inside the service byte cap.
{
  stub.reset()
  const { provider } = setup({ cadence: 'first-prompt' })
  stub.reply(JSON.stringify({ category: '分析', name: '这是一个非常非常长的会话名称'.repeat(10) }))
  const result = await provider.generate(request())

  assert.match(result.title, /^1028 \| 分析 \| /u)
  assert.ok(Buffer.byteLength(result.title, 'utf8') <= 80)
}

console.log('provider tests passed')
