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
const { apply, inject } = await import('../lib/index.js')

const TIMESTAMP = Date.parse('2026-10-28T01:04:09Z')
const MESSAGES = [
  { seq: 4, text: '这个目录任务先读一下背景，这是 AI 问答的 10 个验收题目' },
  { seq: 9, text: '现在部署到 8080 并复测' },
]

function setup({
  config = {},
  llm = true,
  registerError,
  titleSource = 'provider',
  serviceMaxBytes = 80,
} = {}) {
  let provider
  let dispose
  let refreshCount = 0
  const warnings = []
  const handlers = new Map()
  const ctx = {
    sessionTitle: {
      config: { maxTitleBytes: serviceMaxBytes },
      register(value) {
        if (registerError !== undefined) throw new Error(registerError)
        provider = value
        return async () => {
          dispose = true
        }
      },
      get() {
        return titleSource === 'none'
          ? undefined
          : { title: '1027 | 分析 | 旧标题', source: { kind: titleSource } }
      },
      refresh() {
        refreshCount += 1
        return Promise.resolve()
      },
    },
    logger: {
      warn(message) {
        warnings.push(String(message))
      },
      info() {},
    },
    inject(services, callback) {
      if (llm && services.includes('llm')) callback({ llm: {} })
    },
    effect(fn) {
      const value = fn()
      if (typeof value !== 'function') throw new Error('effect must return a disposer')
    },
    on(event, callback) {
      handlers.set(event, callback)
    },
  }
  apply(ctx, config)
  return {
    ctx,
    provider,
    warnings,
    handlers,
    refreshCount: () => refreshCount,
    disposed: () => dispose === true,
  }
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
    signal: new AbortController().signal,
    ...overrides,
  }
}

function eligibleEvent(seq = 1) {
  return {
    type: 'user/message',
    seq,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] },
  }
}

// 1. First generation: model path, sanitising, executor bounds.
{
  stub.reset()
  const { provider, warnings } = setup({ config: { dateFormat: 'MMDD' } })
  assert.ok(provider, 'apply() must register a provider')
  assert.equal(provider.id, 'title-stamp')
  assert.equal(provider.automatic, 'first-prompt')
  assert.deepEqual(inject, ['sessionTitle'])

  stub.reply('```json\n{"category":"整改","name":"修复登录超时|问题"}\n```')
  const result = await provider.generate(request())

  assert.equal(result.title, '1028 | 整改 | 修复登录超时 问题')
  assert.deepEqual(result.messageSeqs, [4, 9])
  assert.deepEqual(result.model, { provider: 'mock-provider', model: 'mock-title-model' })
  assert.ok(Buffer.byteLength(result.title, 'utf8') <= 80)
  assert.equal(warnings.length, 0)

  assert.equal(stub.state.calls.length, 1)
  assert.equal(stub.state.calls[0].providerId, 'title-stamp')
  assert.deepEqual(stub.state.calls[0].config, {
    maxInputBytes: 4096,
    maxOutputTokens: 4096,
    timeoutMs: 90000,
  })
  assert.deepEqual(stub.state.calls[0].messageSeqs, [4, 9])
  assert.doesNotMatch(stub.state.calls[0].input, /previousTitle/u)
  assert.match(stub.state.calls[0].system, /分类/u)
}

// 2. A failed retitle keeps the existing title by throwing to the service.
{
  stub.reset()
  const { provider, warnings } = setup()
  stub.fail('mock model down')
  await assert.rejects(
    provider.generate(request({ currentTitle: { title: '1027 | 分析 | 好标题' } })),
    /mock model down/u,
  )
  assert.match(warnings.at(-1), /keeping the previous title/u)
}

// 3. Without a title, the same failure produces a correctly shaped fallback.
{
  stub.reset()
  const { provider, warnings } = setup()
  stub.fail('mock model down')
  const result = await provider.generate(request())
  assert.match(result.title, /^1028 \| (分析|验收|部署|整改) \| /u)
  assert.deepEqual(result.messageSeqs, [4, 9])
  assert.equal(result.model, undefined)
  assert.match(warnings.at(-1), /using local naming/u)
}

// 4. No llm service: local fallback, no provider error.
{
  stub.reset()
  const { provider, warnings } = setup({ llm: false, titleSource: 'none' })
  const result = await provider.generate(request())
  assert.match(result.title, /^1028 \| /u)
  assert.match(warnings.at(-1), /llm service is unavailable|using local naming/u)
}

// 5. An unusable model output must not overwrite an existing title.
{
  stub.reset()
  const { provider } = setup()
  stub.reply('I could not decide on a title.')
  await assert.rejects(
    provider.generate(request({ currentTitle: { title: '1027 | 分析 | 好标题' } })),
    /no usable name/u,
  )
}

// 6. max-tokens with a complete JSON prefix still produces a title.
{
  stub.reset()
  const { provider } = setup()
  stub.reply('{"category":"部署","name":"Ubuntu 环境初始化"}', {
    finish: { kind: 'max-tokens' },
  })
  const result = await provider.generate(request())
  assert.equal(result.title, '1028 | 部署 | Ubuntu 环境初始化')
}

// 7. YYMM and a topic-first template.
{
  stub.reset()
  const { provider } = setup({
    config: { dateFormat: 'YYMM', template: '{topic} | {type} | {date}' },
  })
  stub.reply('{"category":"分析","name":"旧标题"}')
  const result = await provider.generate(request())
  assert.match(result.title, /^旧标题 \| 分析 \| 2610$/u)
}

function turnEndEvent() {
  return { type: 'turn/end', seq: 99, data: { reason: { kind: 'completed' } } }
}

// 8. turn/end refreshes after a completed turn, skips a cooldown, freezes a
// long session, and ignores forks.
{
  const { handlers, refreshCount } = setup({
    config: { refreshOnTurnEnd: true, refreshMinIntervalMs: 0, refreshMaxTurns: 0 },
    llm: false,
  })
  const onEvent = handlers.get('session/event')
  assert.equal(typeof onEvent, 'function')
  const session = { id: 'turn-session', header: { parentSession: undefined } }
  onEvent(session, eligibleEvent(1))
  assert.equal(refreshCount(), 0)
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 1)
  onEvent(session, eligibleEvent(2))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 2)

  // A non-completed end does not refresh.
  onEvent(session, { type: 'turn/end', data: { reason: { kind: 'error' } } })
  assert.equal(refreshCount(), 2)

  // A fork never refreshes.
  onEvent(
    { id: 'fork', header: { parentSession: 'parent' } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  )
  assert.equal(refreshCount(), 2)
}

// 9. The cooldown suppresses a second refresh inside the window.
{
  const { handlers, refreshCount } = setup({
    config: { refreshOnTurnEnd: true, refreshMinIntervalMs: 120000, refreshMaxTurns: 0 },
    llm: false,
  })
  const onEvent = handlers.get('session/event')
  const session = { id: 'cooldown', header: { parentSession: undefined } }
  onEvent(session, eligibleEvent(1))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 1)
  onEvent(session, eligibleEvent(2))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 1)
}

// 10. Over the freeze threshold, turn/end stops refreshing.
{
  const { handlers, refreshCount } = setup({
    config: { refreshOnTurnEnd: true, refreshMinIntervalMs: 0, refreshMaxTurns: 2 },
    llm: false,
  })
  const onEvent = handlers.get('session/event')
  const session = { id: 'frozen', header: { parentSession: undefined } }
  for (let seq = 1; seq <= 3; seq += 1) onEvent(session, eligibleEvent(seq))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 0)
}

// 11. Legacy message-count mode is used only when turn/end is disabled.
{
  const { handlers, refreshCount } = setup({
    config: { refreshOnTurnEnd: false, retitleEvery: 2 },
    llm: false,
  })
  const onEvent = handlers.get('session/event')
  const session = { id: 'legacy', header: { parentSession: undefined } }
  onEvent(session, eligibleEvent(1))
  onEvent(session, eligibleEvent(2))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 1)
}

// 10. Another provider already registered: stay inactive, do not throw.
{
  const { provider, warnings, handlers } = setup({ registerError: 'already registered' })
  assert.equal(provider, undefined)
  assert.match(warnings.at(-1), /another title provider is already registered/u)
  assert.equal(handlers.has('session/event'), false)
}

// 12. A pinned user title suppresses refresh.
{
  const { handlers, refreshCount } = setup({
    config: { refreshOnTurnEnd: true, refreshMinIntervalMs: 0 },
    llm: false,
    titleSource: 'user',
  })
  const onEvent = handlers.get('session/event')
  const session = { id: 'pinned', header: { parentSession: undefined } }
  onEvent(session, eligibleEvent(1))
  onEvent(session, turnEndEvent())
  assert.equal(refreshCount(), 0)
}

console.log('provider tests passed')
