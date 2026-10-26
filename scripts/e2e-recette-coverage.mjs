#!/usr/bin/env node
// Which recette steps the Playwright suite replays: step ids from the recette's GROUPS ×
// the tests' tags (`npx playwright test --list`). A step is covered when at least one test
// that is not a test.fixme carries its tag; a covered step that ALSO has a fixme (a part the
// app does not meet yet) must have a note in the recette's AUTO_PARTIAL, so its badge says
// "partial" instead of telling testers to skip it. Prints covered / partial / fixme-only /
// no tag; --write rewrites the recette's `const AUTO_STEPS = [...]` line (idempotent).
// Exits 1 on a tag that is not a recette step id (typo guard) or a fixme without a note.
//
//   npm run test:e2e:coverage [-- --write]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECETTE = path.join(ROOT, 'docs/tournaments/recette-user-tournaments.html')
const NOT_STEPS = new Set(['mobile'])
const AUTO_LINE = /^const AUTO_STEPS = \[.*\];$/m

const html = fs.readFileSync(RECETTE, 'utf8')
const groups = html.slice(html.indexOf('const GROUPS = ['))
const ids = [...groups.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map(m => m[1])
const partialNotes = Object.fromEntries([...(/const AUTO_PARTIAL = \{(.*)\};/.exec(html)?.[1] ?? '').matchAll(/'([a-z0-9-]+)':\s*'([^']*)'/g)].map(m => [m[1], m[2]]))

const list = JSON.parse(execFileSync('npx', ['playwright', 'test', '-c', 'tests/e2e/playwright.config.js', '--list', '--reporter=json'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
}))

function* specs(suite) {
  yield* suite.specs ?? []
  for (const child of suite.suites ?? []) yield* specs(child)
}

const active = new Set()
const withFixme = new Set()
const unknown = new Set()
for (const suite of list.suites) {
  for (const spec of specs(suite)) {
    const isFixme = spec.tests.every(t => t.annotations.some(a => a.type === 'fixme'))
    for (const raw of spec.tags) {
      const tag = raw.replace(/^@/, '')
      if (NOT_STEPS.has(tag)) continue
      if (!ids.includes(tag)) unknown.add(tag)
      else if (isFixme) withFixme.add(tag)
      else active.add(tag)
    }
  }
}

if (unknown.size) {
  console.error(`tags that are not recette step ids: ${[...unknown].sort().join(', ')}`)
  process.exit(1)
}
const unnoted = ids.filter(id => active.has(id) && withFixme.has(id) && !(id in partialNotes))
if (unnoted.length) {
  console.error(`covered steps with a test.fixme but no AUTO_PARTIAL note in the recette: ${unnoted.join(', ')}`)
  process.exit(1)
}

const covered = ids.filter(id => active.has(id))
const partial = covered.filter(id => id in partialNotes)
const onlyFixme = ids.filter(id => withFixme.has(id) && !active.has(id))
const noTag = ids.filter(id => !active.has(id) && !withFixme.has(id))
console.log(`covered (${covered.length}): ${covered.join(' ')}`)
console.log(`partial (${partial.length}): ${partial.join(' ')}`)
console.log(`fixme only (${onlyFixme.length}): ${onlyFixme.join(' ')}`)
console.log(`no tag (${noTag.length}): ${noTag.join(' ')}`)

if (process.argv.includes('--write')) {
  if (!AUTO_LINE.test(html)) {
    console.error('no `const AUTO_STEPS = [...];` line in the recette')
    process.exit(1)
  }
  const line = `const AUTO_STEPS = [${[...covered].sort().map(id => `'${id}'`).join(', ')}];`
  fs.writeFileSync(RECETTE, html.replace(AUTO_LINE, line))
  console.log(`wrote AUTO_STEPS (${covered.length} ids)`)
}
