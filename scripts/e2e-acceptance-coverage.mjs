#!/usr/bin/env node
// Which acceptance steps the Playwright suite replays: step ids from the acceptance pages' GROUPS ×
// the tests' tags (`npx playwright test --list`). A step is covered when at least one test
// that is not a test.fixme carries its tag; a covered step that ALSO has a fixme (a part the
// app does not meet yet) must have a note in its acceptance page's AUTO_PARTIAL, so its badge says
// "partial" instead of telling testers to skip it. Prints covered / partial / fixme-only /
// no tag per page; --write rewrites each page's own `const AUTO_STEPS = [...]` line (idempotent).
// Exits 1 on a tag that is not an acceptance step id (typo guard), a fixme without a note, or
// a step id declared in two pages (a tag must name one step).
//
//   npm run test:e2e:coverage [-- --write]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ACCEPTANCE_PAGES = [
  'docs/tournaments/acceptance-user-tournaments.html',
  'docs/tournaments/acceptance-mono-faction-sealed.html',
]
const NOT_STEPS = new Set(['mobile'])
const AUTO_LINE = /^const AUTO_STEPS = \[.*\];$/m

const pages = ACCEPTANCE_PAGES.map(file => {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const groups = html.slice(html.indexOf('const GROUPS = ['))
  const ids = [...groups.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map(m => m[1])
  const partialNotes = Object.fromEntries([...(/const AUTO_PARTIAL = \{(.*)\};/.exec(html)?.[1] ?? '').matchAll(/'([a-z0-9-]+)':\s*'([^']*)'/g)].map(m => [m[1], m[2]]))
  return { file, html, ids, partialNotes }
})

const pageOf = new Map()
const twice = new Set()
for (const page of pages) {
  for (const id of page.ids) {
    if (pageOf.has(id) && pageOf.get(id) !== page) twice.add(id)
    pageOf.set(id, page)
  }
}
if (twice.size) {
  console.error(`step id declared in two acceptance pages: ${[...twice].sort().join(', ')}`)
  process.exit(1)
}

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
      if (!pageOf.has(tag)) unknown.add(tag)
      else if (isFixme) withFixme.add(tag)
      else active.add(tag)
    }
  }
}

if (unknown.size) {
  console.error(`tags that are not acceptance step ids: ${[...unknown].sort().join(', ')}`)
  process.exit(1)
}
const unnoted = pages.flatMap(p => p.ids.filter(id => active.has(id) && withFixme.has(id) && !(id in p.partialNotes)))
if (unnoted.length) {
  console.error(`covered steps with a test.fixme but no AUTO_PARTIAL note in their acceptance page: ${unnoted.join(', ')}`)
  process.exit(1)
}
const write = process.argv.includes('--write')
const missingLine = pages.filter(p => !AUTO_LINE.test(p.html))
if (write && missingLine.length) {
  console.error(`no \`const AUTO_STEPS = [...];\` line in: ${missingLine.map(p => p.file).join(', ')}`)
  process.exit(1)
}

for (const { file, html, ids, partialNotes } of pages) {
  const covered = ids.filter(id => active.has(id))
  const partial = covered.filter(id => id in partialNotes)
  const onlyFixme = ids.filter(id => withFixme.has(id) && !active.has(id))
  const noTag = ids.filter(id => !active.has(id) && !withFixme.has(id))
  console.log(`${file}`)
  console.log(`  covered (${covered.length}): ${covered.join(' ')}`)
  console.log(`  partial (${partial.length}): ${partial.join(' ')}`)
  console.log(`  fixme only (${onlyFixme.length}): ${onlyFixme.join(' ')}`)
  console.log(`  no tag (${noTag.length}): ${noTag.join(' ')}`)

  if (write) {
    const line = `const AUTO_STEPS = [${[...covered].sort().map(id => `'${id}'`).join(', ')}];`
    fs.writeFileSync(path.join(ROOT, file), html.replace(AUTO_LINE, line))
    console.log(`  wrote AUTO_STEPS (${covered.length} ids)`)
  }
}
