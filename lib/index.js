/**
 * DSH session-title provider for the `DATE | CATEGORY | NAME` template.
 *
 * The model only proposes a category and a name; this provider computes the
 * date from the session header, validates the category against a local
 * taxonomy, and composes the final string inside the title service's byte
 * budget. A failed retitle keeps an existing title; only a session without a
 * title falls back to local naming.
 *
 * Only `sessionTitle` is a declared dependency. `llm`, `commands`, `sessions`,
 * `sessionProjections`, and `connection` are awaited lazily so a composition
 * without one cannot leave this entry pending and hold up startup.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

const PROVIDER_ID = 'title-stamp'
const EXECUTOR_SPECIFIER = '@deepseek-ai/dsh-session-title-llm'
const MAX_TRACKED_SESSIONS = 64
const STATS_PATH = '/api/session-title-stamp/stats'
const STATS_TTL_MS = 30_000

/** CNY per 1M tokens, current DeepSeek Flash/Pro off-peak rates. */
const PRICING = {
  'deepseek-flash': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-v4-flash': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-v4-flash-vision-exp': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-v41-flash': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-chat': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-reasoner': { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  'deepseek-v4-pro': { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 },
}

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

function reasonKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind
  return undefined
}

function sessionEventsOf(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : session?.events
    return Array.isArray(events) ? events : []
  } catch {
    return []
  }
}

function countUserMessages(session) {
  let count = 0
  for (const event of sessionEventsOf(session)) {
    if (event?.type === 'user/message' && event?.data?.source?.kind === 'user') count += 1
  }
  return count
}

function isExcluded(session) {
  if (session?.header?.origin === 'subagent') return true
  if (session?.header?.parentSession !== undefined) return true
  return false
}

function normalizeTitle(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase()
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

function remember(map, id, value) {
  map.delete(id)
  map.set(id, value)
  while (map.size > MAX_TRACKED_SESSIONS) {
    const oldest = map.keys().next()
    if (oldest.done === true) break
    map.delete(oldest.value)
  }
}

function unwrapProjection(value) {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && Object.hasOwn(value, 'val')) return value.val
  return value
}

function tokenTotals(tokenUsage) {
  const value = unwrapProjection(tokenUsage)
  const totals = value?.totals ?? value
  if (totals === null || typeof totals !== 'object') return undefined
  const input = totals.uncachedInputTokens ?? totals.inputTokens ?? 0
  const output = totals.outputTokens ?? 0
  const cacheRead = totals.cacheReadTokens ?? 0
  const cacheWrite = totals.cacheWriteTokens ?? 0
  return {
    input: Number(input) || 0,
    output: Number(output) || 0,
    cacheRead: Number(cacheRead) || 0,
    cacheWrite: Number(cacheWrite) || 0,
  }
}

function modelOf(modelSelection) {
  const value = unwrapProjection(modelSelection)
  const selected = value?.lastUsed ?? value?.next
  if (selected !== null && typeof selected === 'object' && typeof selected.model === 'string') {
    return selected.model
  }
  return undefined
}

function estimateStats(tokenUsage, sessionStats, model) {
  const totals = tokenTotals(tokenUsage)
  const stats = unwrapProjection(sessionStats)
  const tokens = totals === undefined
    ? undefined
    : totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  const durationMs =
    stats !== null && typeof stats === 'object'
      ? (Number(stats.llmMs) || 0) + (Number(stats.toolMs) || 0)
      : undefined
  const base = typeof model === 'string' ? model.split('/').pop() : undefined
  const price = base === undefined ? undefined : PRICING[base]
  const costCny =
    price === undefined || totals === undefined
      ? undefined
      : (totals.input * price.input +
          totals.cacheRead * price.cacheRead +
          totals.cacheWrite * price.cacheWrite +
          totals.output * price.output) /
        1_000_000
  return {
    ok: true,
    durationMs,
    costCny,
    tokens,
    model: base,
    estimated: true,
  }
}

async function readCachedProjection(sessionId) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const file = join(home, 'storages', 'session_projcache', 'sessions', `session-${sessionId}.json`)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    const rows = parsed?.record?.rows ?? {}
    return {
      tokenUsage: rows.tokenUsage?.val,
      sessionStats: rows.sessionStats?.val,
      modelSelection: rows.modelSelection?.val,
    }
  } catch {
    return undefined
  }
}

async function statsFor(scope, sessionId) {
  let tokenUsage
  let sessionStats
  let modelSelection
  const live = scope.sessions?.get?.(sessionId)
  if (live !== undefined) {
    try {
      tokenUsage = scope.sessionProjections?.stateOf?.(live, 'tokenUsage')
      sessionStats = scope.sessionProjections?.stateOf?.(live, 'sessionStats')
      modelSelection = scope.sessionProjections?.stateOf?.(live, 'modelSelection')
    } catch {
      // A projection may be missing in a reduced composition; use the cache.
    }
  }
  if (tokenUsage === undefined || sessionStats === undefined) {
    const cached = await readCachedProjection(sessionId)
    tokenUsage ??= cached?.tokenUsage
    sessionStats ??= cached?.sessionStats
    modelSelection ??= cached?.modelSelection
  }
  return estimateStats(tokenUsage, sessionStats, modelOf(modelSelection))
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function registerStatsRoute(ctx, logger) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['connection', 'sessions', 'sessionProjections'], (scope) => {
    if (typeof scope.connection?.fetch?.register !== 'function') return
    const cache = new Map()
    let dispose
    try {
      dispose = scope.connection.fetch.register({
        path: STATS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url)
          const sessionId = url.searchParams.get('sessionId') ?? ''
          if (!/^[A-Za-z0-9._-]{1,128}$/u.test(sessionId)) {
            return jsonResponse({ ok: false, error: 'invalid sessionId' }, 400)
          }
          const now = Date.now()
          const hit = cache.get(sessionId)
          if (hit !== undefined && now - hit.at < STATS_TTL_MS) return jsonResponse(hit.data)
          try {
            const data = await statsFor(scope, sessionId)
            cache.set(sessionId, { at: now, data })
            while (cache.size > 128) cache.delete(cache.keys().next().value)
            return jsonResponse(data)
          } catch (error) {
            logger?.warn?.(`session-title-stamp: stats lookup failed: ${String(error)}`)
            return jsonResponse({ ok: false }, 500)
          }
        },
      })
    } catch (error) {
      logger?.warn?.(`session-title-stamp: stats route unavailable: ${String(error)}`)
      return
    }
    if (typeof dispose === 'function') ctx.effect?.(() => dispose)
  })
}

function registerRetitleCommand(ctx, logger) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['commands'], (scope) => {
    if (typeof scope.commands?.register !== 'function') return
    let dispose
    try {
      dispose = scope.commands.register({
        name: 'retitle',
        description: 'Regenerate this session title now (ignores the automatic cooldown)',
        handler: async ({ agent, signal }) => {
          try {
            const snapshot = await ctx.sessionTitle.refresh(agent.session, signal)
            if (snapshot === undefined) return { kind: 'error', text: '没有可用于生成标题的消息' }
            return { kind: 'success', text: `标题已更新：${snapshot.title}` }
          } catch (error) {
            return { kind: 'error', text: `标题更新失败：${String(error)}` }
          }
        },
      })
    } catch (error) {
      logger?.warn?.(`session-title-stamp: /retitle unavailable: ${String(error)}`)
      return
    }
    if (typeof dispose === 'function') ctx.effect?.(() => dispose)
  })
}

function scheduleBackfill(ctx, settings, logger, shouldStop) {
  if (!settings.backfillOnStart || settings.backfillMaxSessions <= 0) return
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['sessions'], (scope) => {
    if (typeof scope.sessions?.list !== 'function') return
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const sessions = Array.from(scope.sessions.list())
          let started = 0
          for (const session of sessions) {
            if (shouldStop()) return
            if (started >= settings.backfillMaxSessions) break
            if (isExcluded(session)) continue
            if (ctx.sessionTitle.get(session)?.source?.kind !== 'fallback') continue
            started += 1
            logger?.info?.(`session-title-stamp: backfilling ${session.id} (${started})`)
            void ctx.sessionTitle.refresh(session).catch(() => undefined)
            if (settings.backfillIntervalMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, settings.backfillIntervalMs))
            }
          }
        } catch (error) {
          logger?.warn?.(`session-title-stamp: backfill failed: ${String(error)}`)
        }
      })()
    }, 3000)
    if (typeof timer?.unref === 'function') timer.unref()
    ctx.effect?.(() => () => clearTimeout(timer))
  })
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
  let stopped = false

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

  const counts = new Map()
  const lastGeneratedAt = new Map()

  const provider = {
    id: PROVIDER_ID,
    // The service schedules the first message itself. Later revisions are
    // driven by turn/end below, which avoids an all-prompts call and a
    // duplicate title event on every single user message.
    automatic: 'first-prompt',
    async generate(request) {
      const startedAt = Date.now()
      const used = selectMessages(request?.messages, settings)
      if (used.length === 0) {
        throw new Error('session-title-stamp: no eligible human message to name')
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
          `session-title-stamp: ${name} (${model?.provider ?? '?'}/${model?.model ?? '?'}, ` +
            `${Date.now() - startedAt}ms, ${used.length} messages)`,
        )
      } catch (error) {
        if (request?.signal?.aborted === true) throw error
        const detail = error instanceof Error ? error.message : String(error)
        if (previousTitle !== undefined) {
          // The service only commits a new title on a successful provider
          // return, so throwing is how a good title survives a failed retitle.
          logger?.warn?.(
            `session-title-stamp: keeping the previous title after a failed retitle (${detail})`,
          )
          throw error
        }
        logger?.warn?.(
          `session-title-stamp: title model unavailable, using local naming (${detail})`,
        )
        category = inferCategory(sourceText, settings.categories)
        name = cleanName(undefined, settings, sourceText)
      }

      const title = composeTitle(timestamp, category, name, settings)
      if (previousTitle !== undefined && normalizeTitle(previousTitle) === normalizeTitle(title)) {
        logger?.info?.('session-title-stamp: title unchanged after retitle')
      }
      if (request?.session?.id !== undefined) {
        remember(lastGeneratedAt, request.session.id, Date.now())
      }
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
    // Another title provider may have registered first. Never throw from apply:
    // that would fail this plugin's fiber and can take startup down.
    logger?.warn?.(
      'session-title-stamp: another title provider is already registered; ' +
        'this plugin stays inactive. Disable the other provider and reload. ' +
        `(${String(error)})`,
    )
    return
  }
  if (typeof dispose === 'function') ctx.effect?.(() => dispose)

  registerStatsRoute(ctx, logger)
  registerRetitleCommand(ctx, logger)
  scheduleBackfill(ctx, settings, logger, () => stopped)
  ctx.effect?.(() => () => {
    stopped = true
  })

  if (typeof ctx.on !== 'function') {
    if (globalThis.process?.env?.DSH_TITLE_DEBUG === '1') {
      console.log('session-title-stamp: registered without session events')
    }
    return
  }

  const maybeRefresh = (session, reason) => {
    if (stopped || isExcluded(session)) return
    if (ctx.sessionTitle.get(session)?.source?.kind === 'user') return
    // Record the attempt before the call so a failing model is throttled too.
    remember(lastGeneratedAt, session.id, Date.now())
    void ctx.sessionTitle.refresh(session).catch(() => undefined)
    if (globalThis.process?.env?.DSH_TITLE_DEBUG === '1') {
      console.log(`session-title-stamp: refresh (${reason}) for ${session.id}`)
    }
  }

  ctx.on('session/event', (session, event) => {
    if (isEligibleUserMessage(event)) {
      bumpCount(counts, session.id)
      return
    }
    if (event?.type !== 'turn/end') return
    if (reasonKind(event.data?.reason) !== 'completed') return
    if (isExcluded(session)) return

    const count = counts.get(session.id) ?? countUserMessages(session)
    if (count <= 0) return
    if (settings.refreshMaxTurns > 0 && count > settings.refreshMaxTurns) return
    if (settings.refreshOnTurnEnd) {
      const last = lastGeneratedAt.get(session.id)
      if (settings.refreshMinIntervalMs > 0 && last !== undefined && Date.now() - last < settings.refreshMinIntervalMs) {
        return
      }
      maybeRefresh(session, `turn ${count}`)
      return
    }
    // Legacy message-count cadence, used only when turn/end is disabled.
    if (settings.retitleEvery > 0 && count % settings.retitleEvery === 0) {
      maybeRefresh(session, `message ${count}`)
    }
  })

  ctx.on('session/disposed', (session) => {
    counts.delete(session.id)
    lastGeneratedAt.delete(session.id)
  })

  if (globalThis.process?.env?.DSH_TITLE_DEBUG === '1') {
    console.log(
      `session-title-stamp: registered provider "${PROVIDER_ID}" ` +
        `(turnEnd=${settings.refreshOnTurnEnd}, ${settings.categoryPreset}, max ${settings.maxTitleBytes} bytes)`,
    )
  }
}

export const name = 'dsh-session-title-stamp'
export const inject = ['sessionTitle']
