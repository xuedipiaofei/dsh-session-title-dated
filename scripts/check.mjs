import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = new URL('..', import.meta.url)
const path = (name) => new URL(name, root)
const text = (name) => readFileSync(path(name), 'utf8')
const json = (name) => JSON.parse(text(name))

const pkg = json('package.json')
const index = json('market/index.json')
const patch = text('cordis.patch.yml')

assert.match(pkg.name, /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u, 'invalid npm name')
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, 'invalid SemVer version')
assert.notEqual(pkg.private, true, 'package.json must not be private before publishing')
assert.equal(pkg.license, 'MIT', 'license must be MIT')
assert.ok(pkg.repository?.url, 'repository.url is required for npm/awesome-list linkage')
assert.ok(pkg.description?.length > 20, 'description should explain the plugin')
assert.ok(pkg.keywords?.includes('dsh-plugin'), 'keywords should include dsh-plugin')
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch must point at the bundle patch')
assert.match(pkg.engines?.dsh ?? '', /^\S+/, 'engines.dsh is required')
assert.equal(pkg.icon, './icon.svg', 'icon should point at the packaged SVG')
assert.equal(pkg.exports?.['./client'], './client.js', 'client entry must be exported')
assert.equal(pkg.dsh?.client?.platform, 'web', 'browser half must target the web platform')
assert.ok(Array.isArray(pkg.dsh?.client?.inject), 'browser half should declare its module dependencies')

for (const required of [
  'lib/index.js',
  'lib/format.js',
  'client.js',
  'cordis.patch.yml',
  'market/index.json',
  'icon.svg',
  'README.md',
  'README.zh.md',
  'LICENSE',
]) {
  assert.ok(existsSync(path(required)), `missing ${required}`)
}

for (const entry of pkg.files ?? []) {
  assert.ok(existsSync(path(entry)), `package.json files entry does not exist: ${entry}`)
}

assert.match(patch, /id: session-title-llm[\s\S]*disabled: true/u, 'bundle must disable the shipped provider')
assert.match(patch, new RegExp(`name: ${pkg.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'), 'bundle must insert this package')

assert.ok(pkg.peerDependencies?.['@deepseek-ai/dsh-session-title-llm'], 'executor must be a peer dependency')
assert.ok(
  !Object.hasOwn(pkg.dependencies ?? {}, '@deepseek-ai/dsh-session-title-llm'),
  'official DSH packages must not be runtime dependencies',
)

assert.equal(index.format, 1, 'market index must use format 1')
assert.ok(index.title?.en, 'market index needs an English title')
const listed = index.plugins?.find((plugin) => plugin.name === pkg.name)
assert.ok(listed, `market index must list ${pkg.name}`)
assert.ok(listed.title?.en, 'plugin entry needs an English title')
assert.ok(listed.description?.en, 'plugin entry needs an English description')
assert.equal(listed.versions?.[0]?.version, pkg.version, 'index version must match package.json')
assert.equal(listed.versions?.[0]?.engines?.dsh, pkg.engines.dsh, 'index engines.dsh must match package.json')
const source = listed.versions?.[0]?.source
assert.ok(source && (source.type === 'npm' || source.type === 'git'), 'index source must be npm or git')
if (source.type === 'git') {
  assert.match(source.url, /^https:\/\/github\.com\/[^/]+\/[^/]+$/u, 'git source URL must be canonical')
  assert.match(source.commit, /^[0-9a-f]{40}$/u, 'git source must pin a full commit SHA')
}
assert.ok(Number.isInteger(listed.versions[0].publishTimestamp), 'publishTimestamp must be integer Unix seconds')

const awesome = text('market/awesome-entry.yml')
assert.match(awesome, /category: session/u, 'awesome-list entry category should be session')
assert.match(awesome, /url: https:\/\/github\.com\//u, 'awesome-list entry needs the repository URL')

console.log(`checks passed: ${pkg.name}@${pkg.version}`)
console.log(
  `install target: ${
    source.type === 'git'
      ? `git+${source.url}.git#${source.commit}`
      : `${pkg.name}@${pkg.version}`
  }`,
)
console.log(`files: ${pkg.files.join(', ')}`)
