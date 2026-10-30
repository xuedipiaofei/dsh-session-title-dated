/**
 * DSH session-title provider that owns the `DATE | CATEGORY | NAME` format.
 *
 * The model only proposes a category and a name; this provider computes the
 * date from the session header, validates the category against a local
 * taxonomy, and composes the final string inside the title service's byte
 * budget. A model failure keeps an existing title; only a session without a
 * title falls back to local naming.
 *
 * Only `sessionTitle` is a declared dependency. `llm` is awaited lazily so a
 * composition without it cannot leave this entry pending and hold up startup;
 * in that case titles still fall back to local naming.
 */

import {
  buildInput,
  buildSystemPrompt,
  cleanName,
  composeTitle,
  inferCategory,
  normalizeCategory,
  parseModelOutput,
  resolveSettings,
  selectMessages,
  textFromResponse,
} from './format.js'

const PROVIDER_ID = 'dated-category'
const EXECUTOR_SPECIFIER = '@deepseek-ai/dsh-session-title-llm'
const MAX_TRACKED_SESSIONS = 64

let executorPromise

async function loadExecutor() {
  executorPromise ??= import(EXECUTOR_SPECIFIER)
  try {
    return await executorPromise
  } catch (error) {
    executorPromise = undefined
    throw error
  }
}

function sessionTimestamp(session) {
  const createdAt = session?.header?.createdAt
  if (Number.isSafeInteger(createdAt) && createdAt > 0) return createdAt
  let events
  try {
    events = session?.snapshotEvents?.() ?? []
  } catch {
    events = []
  }
  const first = events.find((event) => event?.type === 'user/message' && event?.time > 0)
  return first?.time ?? Date.now()
}

function isEligibleUserMessage(event) {
  if (event?.type !== 'user/message' || event?.data?.source?.kind !== 'user') return false
  const content = event.data.content
  if (!Array.isArray(content)) return false
  return content.some(
    (block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '',
  )
}

function bumpCount(counts, id) {
  const count = (counts.get(id) ?? 0) + 1
  counts.delete(id)
  counts.set(id, count)
  while (counts.size > MAX_TRACKED_SESSIONS) {
    const oldest = counts.keys().next()
    if (oldest.done === true) break
    counts.delete(oldest.value)
  }
  return count
}

/**
 * Register the provider.
 *
 * @param ctx - Cordis context with `sessionTitle` injected.
 * @param config - optional loader configuration; see README.md.
 */
export function apply(ctx, config) {
  const serviceMaxBytes = Number(ctx.sessionTitle?.config?.maxTitleBytes)
  const settings = resolveSettings(config, serviceMaxBytes)
  const logger = ctx.logger

  // A composition may have no llm service at all. Declaring it in `inject`
  // would leave this entry pending forever; wait for it lazily instead.
  let llmContext
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['llm'], (ready) => {
        llmContext = ready
      })
    } catch {
      llmContext = undefined
    }
  }

  const provider = {
    id: PROVIDER_ID,
    // The service schedules the first message itself. Later revisions are
    // driven by the counter below, which avoids an all-prompts call and a
    // duplicate title event on every single user message.
    automatic: 'first-prompt',
    async generate(request) {
      const startedAt = Date.now()
      const used = selectMessages(request?.messages, settings)
      if (used.length === 0) {
        throw new Error('session-title-dated: no eligible human message to name')
      }

      const sourceText = used.map((message) => message.text).join('\n')
      const previousTitle =
        request?.currentTitle !== null &&
        typeof request?.currentTitle === 'object' &&
        typeof request.currentTitle.title === 'string' &&
        request.currentTitle.title.trim() !== ''
          ? request.currentTitle.title.trim()
          : undefined
      const timestamp = sessionTimestamp(request?.session)

      let category
      let name
      let model
      try {
        if (llmContext === undefined) {
          throw new Error('the llm service is unavailable in this composition')
        }
        const { executeSessionTitleLlm } = await loadExecutor()
        const executionConfig = {
          maxInputBytes: settings.maxInputBytes,
          maxOutputTokens: settings.maxOutputTokens,
          timeoutMs: settings.timeoutMs,
          ...(settings.route === undefined ? {} : settings.route),
        }
        const response = await executeSessionTitleLlm(
          llmContext,
          executionConfig,
          request,
          PROVIDER_ID,
          {
            system: buildSystemPrompt(settings, previousTitle !== undefined),
            input: buildInput(used, previousTitle),
            messageSeqs: used.map((message) => message.seq),
            selectReasoningEffort: (selectedModel) => selectedModel?.reasoning?.efforts?.[0]?.id,
          },
        )
        const parsed = parseModelOutput(textFromResponse(response))
        if (parsed.name === undefined || parsed.name.trim() === '') {
          throw new Error('title model returned no usable name')
        }
        category = normalizeCategory(parsed.category, settings.categories, sourceText)
        name = cleanName(parsed.name, settings, sourceText)
        model = response?.model
        logger?.info?.(
          `session-title-dated: ${name} (${model?.provider ?? '?'}/${model?.model ?? '?'}, ` +
            `${Date.now() - startedAt}ms, ${used.length} messages)`,
        )
      } catch (error) {
        if (request?.signal?.aborted === true) throw error
        const detail = error instanceof Error ? error.message : String(error)
        if (previousTitle !== undefined) {
          // The service only commits a new title on a successful provider
          // return, so throwing is how a good title survives a failed retitle.
          logger?.warn?.(
            `session-title-dated: keeping the previous title after a failed retitle (${detail})`,
          )
          throw error
        }
        logger?.warn?.(
          `session-title-dated: title model unavailable, using local naming (${detail})`,
        )
        category = inferCategory(sourceText, settings.categories)
        name = cleanName(undefined, settings, sourceText)
      }

      const title = composeTitle(timestamp, category, name, settings)
      return {
        title,
        messageSeqs: used.map((message) => message.seq),
        ...(model === undefined ? {} : { model }),
      }
    },
  }

  let dispose
  try {
    dispose = ctx.sessionTitle.register(provider)
  } catch (error) {
    // Another title provider may have registered first (a profile can enable
    // both this bundle and the official experimental titles bundle). Never
    // throw from apply: that would fail this plugin's fiber and can take the
    // whole startup down. Keep the other provider and explain why.
    logger?.warn?.(
      'session-title-dated: another title provider is already registered; ' +
        'this plugin stays inactive. Disable the other provider and reload. ' +
        `(${String(error)})`,
    )
    return
  }
  if (typeof dispose === 'function') ctx.effect?.(() => dispose)

  // Retitle every N eligible human messages. Count 1 is the service's own
  // first-prompt pass; forks are intentionally skipped.
  const counts = new Map()
  if (settings.retitleEvery > 0 && typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      if (!isEligibleUserMessage(event)) return
      if (session?.header?.parentSession !== undefined) return
      const count = bumpCount(counts, session.id)
      if (count < 2 || count % settings.retitleEvery !== 0) return
      if (ctx.sessionTitle.get(session)?.source?.kind === 'user') return
      void ctx.sessionTitle.refresh(session).catch(() => undefined)
    })
    ctx.on('session/disposed', (session) => {
      counts.delete(session.id)
    })
  }

  if (globalThis.process?.env?.DSH_TITLE_DEBUG === '1') {
    console.log(
      `session-title-dated: registered provider "${PROVIDER_ID}" ` +
        `(retitleEvery=${settings.retitleEvery}, ${settings.dateFormat}, max ${settings.maxTitleBytes} bytes)`,
    )
  }
}

export const name = 'session-title-dated'
export const inject = ['sessionTitle']
