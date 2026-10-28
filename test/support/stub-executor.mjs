/**
 * Deterministic stand-in for `@deepseek-ai/dsh-session-title-llm`.
 *
 * `test/provider.test.mjs` redirects the real specifier here with
 * `module.registerHooks`, so the provider is exercised without a DSH install,
 * model credentials, or network access.
 */

export const state = {
  calls: [],
  response: undefined,
  error: undefined,
}

export function reset() {
  state.calls.length = 0
  state.response = undefined
  state.error = undefined
}

export function reply(text, overrides = {}) {
  state.response = {
    blocks: [{ type: 'text', text }],
    finish: { kind: 'stop' },
    model: { provider: 'mock-provider', model: 'mock-title-model' },
    ...overrides,
  }
}

export function fail(message) {
  state.error = new Error(message)
}

export async function executeSessionTitleLlm(ctx, config, request, providerId, prepared) {
  state.calls.push({
    config,
    providerId,
    messageSeqs: prepared.messageSeqs,
    input: prepared.input,
    system: prepared.system,
    sessionId: request?.session?.id,
  })
  if (state.error !== undefined) throw state.error
  if (state.response === undefined) throw new Error('stub response was not configured')
  return state.response
}
