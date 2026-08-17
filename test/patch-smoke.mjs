// patch-smoke.mjs — smoke tests for the patch scripts (dry-run, no writes).
// Run: node test/patch-smoke.mjs
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PATCH = join(ROOT, 'patch')
const CC_TUI = 'C:/Users/caoke/.dsh/profiles/cc-tui/node_modules/dsh-cc-tui'

let pass = 0
let fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) }
}

console.log('=== patch-smoke ===')

// 1. apply-cc-tui-patch --dry-run on a real-ish copy (idempotent, no writes)
if (process.platform === 'win32') {
  const dir = mkdtempSync(join(tmpdir(), 'ocr-patch-'))
  try {
    const utilsDir = join(dir, 'lib/types/utils')
    const compDir = join(dir, 'lib/types/components')
    mkdirSync(utilsDir, { recursive: true })
    mkdirSync(compDir, { recursive: true })
    copyFileSync(join(CC_TUI, 'lib/types/utils/clipboard.js'), join(utilsDir, 'clipboard.js'))
    copyFileSync(join(CC_TUI, 'lib/types/components/PromptInput.js'), join(compDir, 'PromptInput.js'))
    const beforeClip = readFileSync(join(CC_TUI, 'lib/types/utils/clipboard.js'), 'utf8')
    const beforePrompt = readFileSync(join(CC_TUI, 'lib/types/components/PromptInput.js'), 'utf8')
    execFileSync('node', [join(PATCH, 'apply-cc-tui-patch.mjs'), '--dry-run', '--cc-tui-dir', dir], { encoding: 'utf8' })
    ok('dry-run did not touch real clipboard.js', readFileSync(join(CC_TUI, 'lib/types/utils/clipboard.js'), 'utf8') === beforeClip)
    ok('dry-run did not touch real PromptInput.js', readFileSync(join(CC_TUI, 'lib/types/components/PromptInput.js'), 'utf8') === beforePrompt)
  } catch (e) {
    ok('apply-cc-tui-patch dry-run runs', false)
    console.error('    ' + String(e.message).split('\n')[0])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
} else {
  console.log('  - skipped (Windows-only patch paths)')
}

// 2. apply-wt-key --dry-run with a temp file (JSON valid, no writes)
{
  const file = join(tmpdir(), `wt-test-${Date.now()}.json`)
  const sample = {
    keybindings: [
      { id: 'User.paste', keys: 'ctrl+shift+v' },
      { id: 'User.sendInput.abc', keys: 'ctrl+v' },
      { id: 'User.copy', keys: 'ctrl+c' },
    ],
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, JSON.stringify(sample, null, 2))
  try {
    const out = execFileSync('node', [join(PATCH, 'apply-wt-key.mjs'), '--key', 'alt+v', '--file', file, '--dry-run'], { encoding: 'utf8' })
    ok('apply-wt-key dry-run ran', out.includes('alt+v -> sendInput'))
    const after = JSON.parse(readFileSync(file, 'utf8'))
    ok('dry-run left file untouched', after.keybindings.length === 3)
  } catch (e) {
    ok('apply-wt-key dry-run runs', false)
    console.error('    ' + String(e.message).split('\n')[0])
  } finally {
    rmSync(file, { force: true })
  }
}

// 3. package manifest sanity
{
  // strip BOM — PowerShell-written package.json may carry one
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  const pkg = readJson(join(ROOT, 'package.json'))
  ok('dsh.bundle.patch declared', Boolean(pkg.dsh?.bundle?.patch))
  ok('exports["./client"] declared', pkg.exports?.['./client'] === './dsh/client.js')
  ok('dsh.client platform=web', pkg.dsh?.client?.platform === 'web')
  ok('keywords include dsh-plugin', pkg.keywords?.includes('dsh-plugin'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
