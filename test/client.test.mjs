import assert from 'node:assert/strict'

let loaded
const React = {
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild() {} },
  createElement() {
    return { id: '', textContent: '', remove() {} }
  },
}
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

await import('../client.js')
assert.ok(loaded, 'client.js must register through the module loader')
assert.equal(loaded.id, 'dsh-session-title-stamp')
const exported = loaded.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected module ${specifier}`)
})
assert.deepEqual(exported.inject, ['slots', 'remote', 'remote.commands'])

const registrations = []
const ctx = {
  slots: {
    inject(_name, callback) {
      callback()
    },
    register(definition, component) {
      registrations.push({ definition, component })
    },
  },
  remote: {
    commands: {
      async execute() {
        return { ok: true, value: { result: { kind: 'success', text: 'ok' } } }
      },
    },
  },
}
exported.apply(ctx)
assert.deepEqual(
  registrations.map(({ definition }) => definition.name),
  [
    'conversation.session.header.actions',
    'sidebar.workspaces.session.menu.item',
    'sidebar.session.row.hover',
  ],
)
assert.equal(typeof registrations[0].component, 'function')
assert.equal(typeof registrations[1].component, 'function')
assert.equal(typeof registrations[2].component, 'function')

console.log('client tests passed')
