#!/usr/bin/env node
/**
 * Finish the awesome-dsh-plugin submission with the GitHub REST API.
 *
 * It is intentionally dependency-free and safe to run repeatedly:
 *   node scripts/community-pr.mjs --check     # preflight only
 *   node scripts/community-pr.mjs --dry-run   # show the planned API calls
 *   node scripts/community-pr.mjs             # fork, commit, open the PR
 *
 * Authentication, in priority order:
 *   1. GH_TOKEN or GITHUB_TOKEN
 *   2. DSH_GITHUB_TOKEN_FILE, or ~/.dsh/github-token (chmod 600)
 *   3. `gh auth token` when the GitHub CLI is installed and logged in
 *
 * Without a token the script performs public preflight reads and prints the
 * exact manual steps; it never prompts for a secret.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OWNER = 'xuedipiaofei'
const REPO = 'dsh-session-title-stamp'
const UPSTREAM_OWNER = 'awesome-dsh-plugin'
const UPSTREAM_REPO = 'awesome-dsh-plugin'
const FORK_REPO = 'awesome-dsh-plugin'
const BRANCH = 'add/xuedipiaofei-dsh-session-title-stamp'
const ENTRY_PATH = 'data/plugins/xuedipiaofei__dsh-session-title-stamp.yml'
const ENTRY_FILE = new URL('../market/awesome-entry.yml', import.meta.url)
const API = 'https://api.github.com'
const DAY_MS = 24 * 60 * 60 * 1000

const args = new Set(process.argv.slice(2))
const CHECK_ONLY = args.has('--check')
const DRY_RUN = args.has('--dry-run') || CHECK_ONLY
const FORCE = args.has('--force')

function findToken() {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (fromEnv?.trim()) return fromEnv.trim()
  const files = [
    process.env.DSH_GITHUB_TOKEN_FILE,
    join(homedir(), '.dsh', 'github-token'),
  ].filter(Boolean)
  for (const file of files) {
    try {
      if (!existsSync(file)) continue
      const token = readFileSync(file, 'utf8').trim()
      if (token !== '') return token
    } catch {
      // Try the next source.
    }
  }
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (token !== '') return token
  } catch {
    // gh is optional.
  }
  return undefined
}

async function api(path, { method = 'GET', body, token, allow404 = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${REPO}-community-pr`,
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (allow404 && response.status === 404) return undefined
  if (!response.ok) {
    const message = data !== null && typeof data === 'object' ? data.message : data
    throw new Error(`${method} ${path} -> ${response.status}: ${message}`)
  }
  return data
}

function plan(label, method, path) {
  console.log(`  [${method}] ${path}  (${label})`)
}

function manualSteps(reason) {
  console.log('')
  console.log(`Manual step needed: ${reason}`)
  console.log('1. Fork https://github.com/awesome-dsh-plugin/awesome-dsh-plugin')
  console.log(`2. Add ${ENTRY_PATH} with the contents of market/awesome-entry.yml`)
  console.log('3. Open a pull request against the default branch')
  console.log('')
  console.log('To automate this next time, do one of:')
  console.log('  gh auth login')
  console.log('  export GH_TOKEN=...')
  console.log('  install -m 600 /dev/null ~/.dsh/github-token && editor ~/.dsh/github-token')
}

const token = findToken()
console.log(`GitHub token: ${token === undefined ? 'not found (preflight only)' : 'found'}`)

const repo = await api(`/repos/${OWNER}/${REPO}`)
const createdAt = Date.parse(repo.created_at)
const readyAt = createdAt + DAY_MS
const now = Date.now()
console.log(`Repository: ${repo.full_name}`)
console.log(`Created:    ${repo.created_at} (1-day gate at ${new Date(readyAt).toISOString()})`)
console.log(`Visibility: ${repo.private ? 'private' : 'public'}`)
console.log(`Topics:     ${(repo.topics ?? []).join(', ') || '(none)'}`)

if (now < readyAt && !FORCE) {
  const remaining = Math.ceil((readyAt - now) / 60000)
  console.log(`\nNOT READY: the community list requires a repository at least 1 day old; ~${remaining} minutes remain.`)
  console.log('Re-run after the gate, or use --force only for a dry run.')
  process.exit(2)
}

if (repo.private) {
  console.error('\nThe repository must be public before submitting.')
  process.exit(2)
}

const topics = repo.topics ?? []
const needsTopic = !topics.includes('dsh-plugin')
if (needsTopic) {
  console.log('Topic "dsh-plugin" is missing (required by the community list).')
  if (token !== undefined && !DRY_RUN) {
    await api(`/repos/${OWNER}/${REPO}/topics`, {
      method: 'PUT',
      token,
      body: { names: [...topics, 'dsh-plugin'] },
    })
    console.log('Topic "dsh-plugin" added.')
  } else if (DRY_RUN) {
    plan('add the required topic', 'PUT', `/repos/${OWNER}/${REPO}/topics`)
  } else {
    manualSteps('add the "dsh-plugin" topic in the repository settings')
    process.exit(2)
  }
}

const entry = readFileSync(ENTRY_FILE, 'utf8').replace(/^(?:#[^\n]*\n)+\n?/u, '')
if (!entry.includes('category: session')) {
  console.error(`\n${ENTRY_FILE.pathname} must declare category: session`)
  process.exit(1)
}

if (token === undefined) {
  manualSteps('no GitHub token was found')
  for (const [label, method, path] of [
    ['verify the fork exists', 'GET', `/repos/${OWNER}/${FORK_REPO}`],
    ['create the branch', 'POST', `/repos/${OWNER}/${FORK_REPO}/git/refs`],
    ['commit the entry', 'PUT', `/repos/${OWNER}/${FORK_REPO}/contents/${ENTRY_PATH}`],
    ['open the pull request', 'POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`],
  ]) {
    plan(label, method, path)
  }
  process.exit(0)
}

const upstream = await api(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`)
const base = upstream.default_branch
console.log(`Upstream:   ${UPSTREAM_OWNER}/${UPSTREAM_REPO} (${base})`)

let fork = await api(`/repos/${OWNER}/${FORK_REPO}`, { token, allow404: true })
if (fork === undefined) {
  console.log('Fork does not exist yet.')
  if (DRY_RUN) {
    plan('fork the community list', 'POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`)
  } else {
    await api(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, { method: 'POST', token })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      fork = await api(`/repos/${OWNER}/${FORK_REPO}`, { token, allow404: true })
      if (fork !== undefined) break
    }
    if (fork === undefined) {
      console.error('The fork was requested but is not ready yet; re-run in a minute.')
      process.exit(2)
    }
  }
}

const existingPrs = await api(
  `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?state=open&head=${OWNER}:${BRANCH}&base=${base}`,
  { token },
)
if (existingPrs.length > 0) {
  console.log(`An open pull request already exists: ${existingPrs[0].html_url}`)
  process.exit(0)
}

const branchRef = await api(`/repos/${OWNER}/${FORK_REPO}/git/ref/heads/${BRANCH}`, {
  token,
  allow404: true,
})
let branchSha = branchRef?.object?.sha
if (branchSha === undefined) {
  if (DRY_RUN) {
    plan('create the branch from upstream', 'POST', `/repos/${OWNER}/${FORK_REPO}/git/refs`)
  } else {
    const baseRef = await api(`/repos/${OWNER}/${FORK_REPO}/git/ref/heads/${base}`, { token })
    await api(`/repos/${OWNER}/${FORK_REPO}/git/refs`, {
      method: 'POST',
      token,
      body: { ref: `refs/heads/${BRANCH}`, sha: baseRef.object.sha },
    })
    branchSha = baseRef.object.sha
  }
}

const existingFile = await api(
  `/repos/${OWNER}/${FORK_REPO}/contents/${ENTRY_PATH}?ref=${encodeURIComponent(BRANCH)}`,
  { token, allow404: true },
)
const encoded = Buffer.from(entry, 'utf8').toString('base64')
const sameContent =
  existingFile !== undefined &&
  existingFile.content?.replace(/\n/gu, '') === encoded

if (sameContent) {
  console.log('Entry already exists on the branch with identical content.')
} else if (DRY_RUN) {
  plan('create or update the entry', 'PUT', `/repos/${OWNER}/${FORK_REPO}/contents/${ENTRY_PATH}`)
} else {
  await api(`/repos/${OWNER}/${FORK_REPO}/contents/${ENTRY_PATH}`, {
    method: 'PUT',
    token,
    body: {
      message: `Add ${OWNER}/${REPO}`,
      content: encoded,
      branch: BRANCH,
      ...(existingFile === undefined ? {} : { sha: existingFile.sha }),
    },
  })
  console.log(`Entry committed to ${OWNER}/${FORK_REPO}:${BRANCH}`)
}

if (DRY_RUN) {
  plan('open the pull request', 'POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`)
  console.log('\nDry run complete; no GitHub changes were made.')
  process.exit(0)
}

const pr = await api(`/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
  method: 'POST',
  token,
  body: {
    title: `Add ${OWNER}/${REPO}`,
    head: `${OWNER}:${BRANCH}`,
    base,
    body: [
      `Adds [${OWNER}/${REPO}](https://github.com/${OWNER}/${REPO}).`,
      '',
      'A DSH session-title provider that names new sessions `DATE | CATEGORY | NAME`,',
      'with a deterministic local fallback. It ships as a `dsh.bundle` and is published',
      `on npm as \`${REPO}@0.1.0\`.`,
      '',
      'Validation:',
      '- `npm test` (format, provider with a stubbed executor, metadata/index checks)',
      '- `npm run validate:index` with the official format-1 validator',
      '- Installed into throwaway DSH profiles from both the Git commit and npm',
      '',
      `Market index: https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@v0.1.0/market/index.json`,
    ].join('\n'),
  },
})
console.log(`Pull request opened: ${pr.html_url}`)
