/**
 * DSH session-title provider that owns the `DATE | CATEGORY | NAME` format.
 *
 * The model only proposes a category and a name; this provider computes the
 * date from the session header, validates the category against a local
 * taxonomy, and composes the final string inside the title service's byte
 * budget. A model failure therefore still leaves a correctly shaped title.
 */

import {
  buildInput,
  buildSystemPrompt,
  cleanName,
  composeTitle,
  formatDate,
  inferCategory,
  normalizeCategory,
  parseModelOutput,
  resolveSettings,
  selectMessages,
  textFromResponse,
} from './format.js'

const PROVIDER_ID = 'dated-category'
const EXECUTOR_SPECIFIER = '@deepseek-ai/dsh-session-title-llm'

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

/**
 * Register the provider.
 *
 * @param ctx - Cordis context with `sessionTitle` and `llm` injected.
 * @param config - optional loader configuration; see README.md.
 */
export function apply(ctx, config) {
  const serviceMaxBytes = Number(ctx.sessionTitle?.config?.maxTitleBytes)
  const settings = resolveSettings(config, serviceMaxBytes)

  ctx.sessionTitle.register({
    id: PROVIDER_ID,
    automatic: settings.cadence,
    async generate(request) {
      const used = selectMessages(request?.messages, settings)
      if (used.length === 0) {
        throw new Error('session-title-dated: no eligible human message to name')
      }

      const sourceText = used.map((message) => message.text).join('\n')
      const currentTitle =
        request?.currentTitle !== null &&
        typeof request?.currentTitle === 'object' &&
        typeof request.currentTitle.title === 'string'
          ? request.currentTitle.title
          : undefined
      const date = formatDate(
        sessionTimestamp(request?.session),
        settings.dateFormat,
        settings.timeZone,
      )

      let category
      let name
      let model
      try {
        const { executeSessionTitleLlm } = await loadExecutor()
        const executionConfig = {
          maxInputBytes: settings.maxInputBytes,
          maxOutputTokens: settings.maxOutputTokens,
          timeoutMs: settings.timeoutMs,
          ...(settings.route === undefined ? {} : settings.route),
        }
        const response = await executeSessionTitleLlm(ctx, executionConfig, request, PROVIDER_ID, {
          system: buildSystemPrompt(settings, currentTitle !== undefined),
          input: buildInput(used, currentTitle),
          messageSeqs: used.map((message) => message.seq),
          selectReasoningEffort: (selectedModel) =>
            selectedModel?.reasoning?.efforts?.[0]?.id,
        })
        const parsed = parseModelOutput(textFromResponse(response))
        category = normalizeCategory(parsed.category, settings.categories, sourceText)
        name = cleanName(parsed.name, settings, sourceText)
        model = response?.model
      } catch (error) {
        if (request?.signal?.aborted === true) throw error
        const detail = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.(
          `session-title-dated: title model unavailable, using local naming (${detail})`,
        )
        category = inferCategory(sourceText, settings.categories)
        name = cleanName(undefined, settings, sourceText)
      }

      const title = composeTitle(date, category, name, settings.maxTitleBytes)
      return {
        title,
        messageSeqs: used.map((message) => message.seq),
        ...(model === undefined ? {} : { model }),
      }
    },
  })

  if (globalThis.process?.env?.DSH_TITLE_DEBUG === '1') {
    console.log(
      `session-title-dated: registered provider "${PROVIDER_ID}" (${settings.cadence}, ${settings.dateFormat}, max ${settings.maxTitleBytes} bytes)`,
    )
  }
}

export const name = 'session-title-dated'
export const inject = ['sessionTitle', 'llm']
