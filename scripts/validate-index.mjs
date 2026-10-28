/**
 * Optional full validation of market/index.json with the official format-1
 * validator. The package is not a runtime dependency of this repository.
 *
 *   npm install --no-save @deepseek-ai/dsh-plugin-market-index@0.2.1-rc.3
 *   npm run validate:index
 *
 * Without the validator installed this script explains how to enable it and
 * exits successfully; `npm test` always runs the dependency-free checks.
 */
import { readFileSync } from 'node:fs'

const INDEX_URL =
  'https://cdn.jsdelivr.net/gh/xuedipiaofei/dsh-session-title-dated@main/market/index.json'

const index = JSON.parse(readFileSync(new URL('../market/index.json', import.meta.url), 'utf8'))

let validator
try {
  validator = await import('@deepseek-ai/dsh-plugin-market-index')
} catch {
  console.log('official validator not installed; run:')
  console.log('  npm install --no-save @deepseek-ai/dsh-plugin-market-index@0.2.1-rc.3')
  console.log('then re-run `npm run validate:index`')
  process.exit(0)
}

const parsed = validator.parseMarketIndex(index, INDEX_URL)
console.log(`valid format-1 index: ${parsed.plugins.length} plugin(s)`)
for (const plugin of parsed.plugins) {
  for (const version of plugin.versions) {
    const target = validator.marketInstallTarget(plugin.name, version)
    console.log(`  ${target.spec}${target.registry ? ` (registry ${target.registry})` : ''}`)
  }
}
