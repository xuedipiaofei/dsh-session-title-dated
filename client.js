/**
 * Browser half of dsh-session-title-stamp.
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
  id: 'dsh-session-title-stamp',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement

    const NS = 'dsh-session-title-stamp'
    const STATS_PATH = '/api/session-title-stamp/stats'
    const inject = ['slots', 'remote', 'remote.commands', 'locale']
    const DICT = {
      zh: {
        menu: '自动生成标题',
        tip: '自动识别分类，生成「日期 | 分类 | 名称」标题',
        running: '会话运行中，稍后再试',
        duration: '耗时',
        estimate: '估算',
      },
      en: {
        menu: 'Generate title',
        tip: 'Detect the category and generate a DATE | CATEGORY | NAME title',
        running: 'Session is running; try again later',
        duration: 'Duration',
        estimate: 'est.',
      },
    }

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

    function RefreshAction({ sessionId, useSession, run, t }) {
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
          console.warn('session-title-stamp: /retitle failed', error)
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
          title: running ? t('running') : t('tip'),
          'aria-label': t('menu'),
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

    function HoverStats({ sessionId, t }) {
      const [data, setData] = useState(null)
      useEffect(() => {
        let cancelled = false
        setData(null)
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
        duration === undefined ? undefined : `${t('duration')} ${duration}`,
        cost === undefined ? undefined : `${t('estimate')} ${cost}`,
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

    function RegenerateMenuItem({ sessionId, useMenuOpenState, run, t }) {
      const menuState =
        typeof useMenuOpenState === 'function' ? useMenuOpenState() : null
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dsh-title-menu-item',
          title: t('tip'),
          onClick: async () => {
            if (Array.isArray(menuState) && typeof menuState[1] === 'function') {
              menuState[1](false)
            }
            try {
              await run(sessionId)
            } catch (error) {
              console.warn('session-title-stamp: /retitle failed', error)
            }
          },
        },
        h(
          'span',
          { className: 'dsh-title-menu-icon', 'aria-hidden': 'true' },
          h(RefreshIcon),
        ),
        h('span', null, t('menu')),
      )
    }

    const STYLE_ID = 'dsh-session-title-stamp-style'

    function installStyle(ctx) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
.dsh-title-menu-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;font-weight:400;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-title-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-title-menu-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-tertiary,#94a3b8))}
.dsh-title-menu-icon svg{width:14px;height:14px}
.dsh-title-menu-item > span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`
      document.head.appendChild(style)
      ctx.effect?.(() => () => style.remove())
    }

    function apply(ctx) {
      installStyle(ctx)
      ctx.effect?.(() => ctx.locale.register(NS, DICT))
      const t = ctx.locale.bind(NS)
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
            id: 'session-title-stamp-refresh',
            order: 40,
            inject: () => ({ run, t }),
          },
          RefreshAction,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'session-title-stamp-retitle',
            order: 0,
            inject: () => ({ run, t }),
          },
          RegenerateMenuItem,
        ),
      )

      ctx.slots.inject('sidebar.session.row.hover', () =>
        ctx.slots.register(
          {
            name: 'sidebar.session.row.hover',
            id: 'session-title-stamp-stats',
            order: 0,
            inject: () => ({ t }),
          },
          HoverStats,
        ),
      )
    }

    return { inject, apply }
  },
})
