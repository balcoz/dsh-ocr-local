/**
 * dsh-ocr-local — host half (cordis plugin).
 *
 * 1. Registers the `ocr_image` tool: local PP-OCRv5 (ONNX Runtime) OCR on an
 *    image path, fully offline. Models cached in ~/.dsh-ocr/models.
 * 2. Registers the `ocr_setup` tool: one-command bootstrap (venv + deps +
 *    models), so first use is automatic instead of a manual pip dance.
 * 3. Under the web profile, registers the `/ocr/paste` route (via the
 *    optional `webServer` service): the browser half POSTs pasted image
 *    bytes, the host saves them to ~/.dsh/ocr/cache (content-deduped,
 *    pruned) and returns the path — the paste-to-path flow the cc-tui
 *    patch provides on the TUI side.
 *
 * Loaded via cordis.patch.yml; zero runtime dependencies (node builtins).
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-ocr-local'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(__dirname, '..')
const OCR_SCRIPT = join(PLUGIN_ROOT, 'ocr', 'ocr.py')
const SETUP_SCRIPT = join(PLUGIN_ROOT, 'ocr', 'setup.py')
const OCR_HOME = join(homedir(), '.dsh-ocr')
const MODELS_DIR = join(OCR_HOME, 'models')
const VENV_DIR = join(OCR_HOME, 'venv')
const PASTE_DIR = join(homedir(), '.dsh', 'ocr', 'cache')

const PASTE_MAX_BYTES = 16 * 1024 * 1024 // 16MB cap
const PASTE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

/* ------------------------------------------------------------------ */
/* 环境解析                                                             */
/* ------------------------------------------------------------------ */

function venvPythonPath() {
  return process.platform === 'win32'
    ? join(VENV_DIR, 'Scripts', 'python.exe')
    : join(VENV_DIR, 'bin', 'python')
}

/** python 解析链：config.pythonPath → DSH_OCR_PYTHON → 内置 venv → python3 → python */
function resolvePython(config = {}) {
  const candidates = [
    config.pythonPath,
    process.env.DSH_OCR_PYTHON,
    venvPythonPath(),
    process.platform === 'win32' ? 'python.exe' : 'python3',
    'python',
  ].filter(Boolean)
  for (const c of candidates) {
    if (!/[/\\]/.test(c) || existsSync(c)) return c
  }
  return candidates[0]
}

/* ------------------------------------------------------------------ */
/* OCR 执行与诊断                                                        */
/* ------------------------------------------------------------------ */

function runDoctor(config = {}) {
  return new Promise(resolve => {
    const python = resolvePython(config)
    execFile(
      python,
      ['-X', 'utf8', OCR_SCRIPT, '--doctor', ...(config.modelDir ? ['--model-dir', config.modelDir] : [])],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, python: { ok: false, error: 'python 不可用：' + String(error.message || error).slice(0, 120) } })
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          resolve({ ok: false, python: { ok: true, error: 'doctor 输出无法解析' } })
        }
      },
    )
  })
}

function runOcr(path, config = {}) {
  return new Promise(resolve => {
    const python = resolvePython(config)
    const args = [OCR_SCRIPT, path, '--full', ...(config.modelDir ? ['--model-dir', config.modelDir] : [])]
    execFile(
      python,
      ['-X', 'utf8', ...args],
      { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          let pyErr = null
          try {
            pyErr = JSON.parse(stdout.trim())
          } catch { /* stdout 不是 JSON */ }
          const reason = pyErr && pyErr.error ? pyErr.error : String(error.message || error).slice(0, 300)
          runDoctor(config).then(doctor => resolve({ text: '', path, error: reason, doctor }))
          return
        }
        let data = null
        try {
          data = JSON.parse(stdout)
        } catch { /* ignore */ }
        if (!data || !Array.isArray(data.lines)) {
          resolve({ text: '', path, error: 'OCR 输出无法解析' })
          return
        }
        resolve({
          text: data.lines.map(l => l.text).join('\n'),
          lines: data.lines,
          blocks: data.blocks || [],
          path,
          engine: 'ppocrv5',
        })
      },
    )
  })
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function missingNames(doctor) {
  const missing = []
  if (doctor.python && doctor.python.ok === false) missing.push('python')
  for (const [k, v] of Object.entries(doctor.dependencies || {})) if (!v.ok) missing.push(k)
  for (const [k, v] of Object.entries(doctor.models || {})) {
    if (!v.present) missing.push(k)
    else if (v.sha256_ok === false) missing.push(`${k}(损坏)`)
  }
  return missing
}

function renderText(value) {
  if (value.error) {
    const doc = value.doctor
    let hint
    if (doc && doc.ok === false) {
      const missing = missingNames(doc).join('、')
      hint = `环境未就绪，缺少: ${missing}。\n调用 ocr_setup 工具可一键安装（建 venv + 装依赖 + 下模型），或手动运行:\n  ${SETUP_SCRIPT}`
    } else {
      hint = `可调用 ocr_setup 工具检查/安装环境。`
    }
    return `[dsh-ocr] ${value.error}\n${hint}`
  }
  const head = `图片识别结果（${value.path}）：`
  const lines = value.lines || []
  const body = lines.map(l => l.text).join('\n').trim()
  const low = lines.filter(l => l.low_confidence)
  let tail = ''
  if (low.length) {
    const names = low.map(l => `「${l.text.slice(0, 10)}」(字高${l.font_px ?? '?'}px/置信${Math.round((l.confidence ?? 0) * 100)}%)`).join('、')
    tail = `\n\n⚠ 以下 ${low.length} 行字太小或检测置信度低，可能有误: ${names}`
  }
  return body ? `${head}\n${body}${tail}` : `${head}\n（未识别到文字）`
}

function renderSetup(value) {
  if (value.error) return `[dsh-ocr] 安装失败: ${value.error}`
  if (value.checkOnly) return `[dsh-ocr] ${value.ok ? '环境就绪 ✓' : '环境未就绪 ✗'}`
  const steps = Object.entries(value.steps || {})
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n')
  return `[dsh-ocr] 安装${value.ok ? '完成 ✓' : '未完成 ✗'}\n${steps}`
}

/* ------------------------------------------------------------------ */
/* 粘贴路由：去重 + 类型感知命名 + 缓存清理                               */
/* ------------------------------------------------------------------ */

/** timestamped paste filename: yyyyMMdd-HHmmss.fffffff-<hash8><ext> */
function pasteName(ext, hash, now = new Date()) {
  const p = (n, w) => String(n).padStart(w, '0')
  const base = `${now.getFullYear()}${p(now.getMonth() + 1, 2)}${p(now.getDate(), 2)}-` +
    `${p(now.getHours(), 2)}${p(now.getMinutes(), 2)}${p(now.getSeconds(), 2)}.` +
    `${p(now.getMilliseconds() * 10000, 7)}-${hash}`
  return `${base}${ext}`
}

/** 按内容哈希查重：返回已存在的相同图片路径 */
function findByHash(hash) {
  let names
  try {
    names = readdirSync(PASTE_DIR)
  } catch {
    return null
  }
  for (const n of names) {
    if (n.includes(`-${hash}.`)) {
      const p = join(PASTE_DIR, n)
      if (existsSync(p)) return p
    }
  }
  return null
}

function pruneCache(maxFiles, maxAgeDays) {
  if (maxFiles <= 0 && maxAgeDays <= 0) return
  let entries
  try {
    entries = readdirSync(PASTE_DIR)
      .map(n => {
        try {
          const s = statSync(join(PASTE_DIR, n))
          return s.isFile() ? { n, m: s.mtimeMs } : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return
  }
  const now = Date.now()
  if (maxAgeDays > 0) {
    for (const e of entries) {
      if (now - e.m > maxAgeDays * 864e5) {
        try {
          unlinkSync(join(PASTE_DIR, e.n))
        } catch { /* ignore */ }
      }
    }
  }
  if (maxFiles > 0) {
    const remaining = readdirSync(PASTE_DIR).length
    const excess = remaining - maxFiles
    if (excess > 0) {
      const alive = entries
        .sort((a, b) => a.m - b.m)
        .slice(0, excess)
      for (const e of alive) {
        try {
          unlinkSync(join(PASTE_DIR, e.n))
        } catch { /* ignore */ }
      }
    }
  }
}

/** magic-byte check: PNG/JPG/WebP/GIF/BMP headers */
function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg'
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50)
    return 'image/webp'
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46)
    return 'image/gif'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d)
    return 'image/bmp'
  return null
}

function registerPasteRoute(ctx, config = {}) {
  // webServer exists only under the web profile; ride a scoped ctx.inject.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], scope => {
    if (!scope.webServer || typeof scope.webServer.register !== 'function') return
    const maxFiles = Number(config.maxCacheFiles ?? 300)
    const maxAgeDays = Number(config.maxCacheAgeDays ?? 30)
    scope.webServer.register({
      name: 'ocr-paste',
      kind: 'exact',
      path: '/ocr/paste',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          // Route availability probe: { takeover } tells the browser half
          // whether to intercept image pastes. Default true; set
          // { pasteToPath: false } in plugin config to disable.
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ takeover: config.pasteToPath !== false }))
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end()
          return
        }
        try {
          const chunks = []
          let total = 0
          for await (const chunk of req) {
            total += chunk.length
            if (total > PASTE_MAX_BYTES) {
              res.writeHead(413, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: 'image too large' }))
              return
            }
            chunks.push(chunk)
          }
          const buffer = Buffer.concat(chunks)
          const type = sniffImageType(buffer)
          if (!type) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'not an image' }))
            return
          }
          const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 8)
          const existing = findByHash(hash)
          if (existing) {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ path: existing, deduped: true }))
            return
          }
          mkdirSync(PASTE_DIR, { recursive: true })
          const target = join(PASTE_DIR, pasteName(PASTE_EXT[type], hash))
          writeFileSync(target, buffer)
          pruneCache(maxFiles, maxAgeDays)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ path: target, deduped: false }))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(error?.message ?? error) }))
        }
      },
    })
  })
}

/* ------------------------------------------------------------------ */
/* 工具注册                                                             */
/* ------------------------------------------------------------------ */

function runSetup(python, argv) {
  return new Promise(resolve => {
    execFile(
      python,
      ['-X', 'utf8', ...argv],
      { encoding: 'utf8', windowsHide: true, timeout: 900000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          let data = null
          try {
            data = JSON.parse(stdout.trim())
          } catch { /* ignore */ }
          resolve(data || { ok: false, error: (data?.error) || String(error.message || error).slice(0, 300) + (stderr ? ' / ' + stderr.slice(-200) : '') })
          return
        }
        try {
          resolve(JSON.parse(stdout.trim()))
        } catch {
          resolve({ ok: false, error: 'setup 输出无法解析' })
        }
      },
    )
  })
}

export function apply(ctx, config = {}) {
  registerPasteRoute(ctx, config)

  ctx.tools.register(defineTool({
    name: 'ocr_image',
    description:
      'Run local OCR (PP-OCRv5, fully offline) on an image file and return its text content. ' +
      'Use when the user pastes or references an image (screenshot, error dialog, document photo) ' +
      'and you need to read the text in it — no vision model required. Returns the recognized text ' +
      'lines with per-line confidence, or a diagnosis (plus a hint to run the ocr_setup tool) when ' +
      'the OCR engine is not installed yet.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the image file (png/jpg/webp).',
      },
      full: {
        type: 'boolean',
        description: 'Return structured JSON (lines + blocks with confidence and box coordinates) instead of plain text.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    execute: async args => {
      const path = String(args.path ?? '').trim()
      if (!path) return { text: '', error: '缺少 path 参数（图片文件路径）', path: '' }
      if (!existsSync(path)) {
        return { text: '', error: `图片文件不存在：${path}`, path }
      }
      const result = await runOcr(path, config)
      if (args.full) result.full = { lines: result.lines || [], blocks: result.blocks || [] }
      return result
    },
    timeoutMs: 120000,
  }))

  ctx.tools.register(defineTool({
    name: 'ocr_setup',
    description:
      'Install or verify the local OCR engine (creates a venv, installs onnxruntime/numpy/opencv, ' +
      'downloads the PP-OCRv5 models with sha256 verification). Use when ocr_image reports the engine ' +
      'is not ready. Idempotent — safe to run repeatedly. Supports a mirror via DSH_OCR_MODELS_MIRROR.',
    parameters: {
      checkOnly: {
        type: 'boolean',
        description: 'Only check readiness (python + deps + models), do not install anything.',
      },
      noModels: {
        type: 'boolean',
        description: 'Install dependencies only, skip model download.',
      },
      force: {
        type: 'boolean',
        description: 'Force reinstall dependencies even if imports succeed.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSetup(value) }],
    },
    execute: async args => {
      const python = resolvePython(config)
      const argv = [SETUP_SCRIPT, '--json']
      if (args.checkOnly) argv.push('--check')
      if (args.noModels) argv.push('--no-models')
      if (args.force) argv.push('--force')
      if (config.modelDir) argv.push('--model-dir', config.modelDir)
      const result = await runSetup(python, argv)
      result.checkOnly = Boolean(args.checkOnly)
      return result
    },
    timeoutMs: 900000,
  }))
}
