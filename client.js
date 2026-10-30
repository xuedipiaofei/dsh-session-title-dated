/**
 * Browser half of dsh-session-title-dated.
 *
 * Registers two seats:
 *   - a refresh button in the conversation header
 *     (`conversation.session.header.actions`)
 *   - a compact cost/duration line in the Session hover card
 *     (`sidebar.session.row.hover`)
 *
 * Hand-written module-loader bundle: React comes from the browser module
 * table, so this package has no client build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-title-dated',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement

    const STATS_PATH = '/api/session-title-dated/stats'
    const inject = ['slots', 'remote', 'remote.commands']

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
    }

    function formatCost(cny) {
      if (typeof cny !== 'number' || !Number.isFinite(cny) || cny < 0) return undefined
      if (cny < 0.01) return `≈¥${cny.toFixed(3)}`
      return `≈¥${cny.toFixed(2)}`
    }

    function formatTokens(tokens) {
      if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return undefined
      if (tokens < 1000) return `${tokens}`
      if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
      return `${(tokens / 1_000_000).toFixed(2)}M`
    }

    function RefreshIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9' }),
        h('path', { d: 'M13.5 2v4h-4' }),
      )
    }

    function RefreshAction({ sessionId, useSession, run }) {
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)
      const running =
        typeof useSession === 'function' ? useSession((snapshot) => snapshot?.running === true) : false
      const disabled = busy || running || typeof sessionId !== 'string' || sessionId === ''

      const click = async () => {
        if (busy || disabled) return
        setBusy(true)
        setFailed(false)
        try {
          await run(sessionId)
        } catch (error) {
          console.warn('session-title-dated: /retitle failed', error)
          setFailed(true)
          setTimeout(() => setFailed(false), 2500)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-title-refresh',
          disabled,
          title: running ? '会话运行中，稍后再试' : '重新生成标题',
          'aria-label': '重新生成标题',
          onClick: click,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            padding: 0,
            border: 0,
            borderRadius: 7,
            background: 'transparent',
            color: failed
              ? 'var(--dsw-alias-state-error-primary, #f87171)'
              : 'var(--dsw-alias-label-secondary, #94a3b8)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled && !busy ? 0.45 : 1,
          },
        },
        busy ? h('span', { style: { fontSize: 12 } }, '…') : h(RefreshIcon),
      )
    }

    function HoverStats({ sessionId }) {
      const [data, setData] = useState(null)
      useEffect(() => {
        let cancelled = false
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        const url = `${STATS_PATH}?sessionId=${encodeURIComponent(sessionId)}`
        fetch(url, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((payload) => {
            if (!cancelled && payload?.ok === true) setData(payload)
          })
          .catch(() => undefined)
        return () => {
          cancelled = true
        }
      }, [sessionId])

      if (data === null) return null
      const duration = formatDuration(data.durationMs)
      const cost = formatCost(data.costCny)
      const tokens = formatTokens(data.tokens)
      const parts = [
        duration === undefined ? undefined : `耗时 ${duration}`,
        cost === undefined ? undefined : `估算 ${cost}`,
        tokens === undefined ? undefined : `${tokens} tokens`,
      ].filter(Boolean)
      if (parts.length === 0) return null
      return h(
        'div',
        {
          style: {
            marginTop: 6,
            color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
          },
        },
        parts.join(' · '),
      )
    }

    function apply(ctx) {
      const run = async (sessionId) => {
        const response = await ctx.remote.commands.execute(sessionId, '/retitle', [])
        if (!response?.ok) {
          throw new Error(response?.error?.message ?? 'title command failed')
        }
        const outcome = response.value?.result
        if (outcome?.kind !== 'success') {
          throw new Error(outcome?.text ?? 'title command returned no result')
        }
        return outcome.text
      }

      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'session-title-dated-refresh',
            order: 40,
            inject: () => ({ run }),
          },
          RefreshAction,
        ),
      )

      ctx.slots.inject('sidebar.session.row.hover', () =>
        ctx.slots.register(
          {
            name: 'sidebar.session.row.hover',
            id: 'session-title-dated-stats',
            order: 0,
            inject: () => ({}),
          },
          HoverStats,
        ),
      )
    }

    return { inject, apply }
  },
})
