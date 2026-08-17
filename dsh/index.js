/**
 * dsh-ocr-local — host half (cordis plugin).
 *
 * 1. Registers the `ocr_image` tool: local PP-OCRv5 (ONNX Runtime) OCR on an
 *    image path, fully offline. Models cached in ~/.dsh-ocr/models.
 * 2. Under the web profile, registers the `/ocr/paste` route (via the
 *    optional `webServer` service): the browser half POSTs pasted image
 *    bytes, the host saves them to ~/.dsh/ocr/cache and returns the path —
 *    the same paste-to-path flow the cc-tui patch provides on the TUI side.
 *
 * Loaded via cordis.patch.yml; zero runtime dependencies (node builtins).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-ocr-local'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(__dirname, '..')
const OCR_SCRIPT = join(PLUGIN_ROOT, 'ocr', 'ocr.py')
const MODELS_DIR = join(homedir(), '.dsh-ocr', 'models')
const PASTE_DIR = join(homedir(), '.dsh', 'ocr', 'cache')

const PASTE_MAX_BYTES = 16 * 1024 * 1024 // 16MB cap
const PASTE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

function renderText(value) {
  if (value.error) {
    return `[dsh-ocr] ${value.error}\n\n安装指引：\n` +
      `  1. pip install onnxruntime numpy opencv-python-headless\n` +
      `  2. python "${join(PLUGIN_ROOT, 'ocr', 'download_models.py')}"\n` +
      `模型缓存目录：${MODELS_DIR}`
  }
  const head = `图片识别结果（${value.path}）：`
  const body = (value.text ?? '').trim()
  return body ? `${head}\n${body}` : `${head}\n（未识别到文字）`
}

function runOcr(path, full) {
  return new Promise(resolve => {
    const args = [OCR_SCRIPT, path]
    if (full) args.push('--full')
    execFile(
      'python',
      ['-X', 'utf8', ...args],
      { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const msg = String(error.message || error)
          if (/No such file|not found|ENOENT/.test(msg)) {
            resolve({ text: '', path, error: 'OCR 引擎未就绪（python/onnxruntime/模型缺失）' })
          } else {
            resolve({ text: '', path, error: `OCR 执行失败：${msg.slice(0, 300)}` })
          }
          return
        }
        resolve({ text: stdout, path })
      },
    )
  })
}

/** timestamped paste filename: yyyyMMdd-HHmmss.fffffff-1.png */
function pasteName(now = new Date()) {
  const p = (n, w) => String(n).padStart(w, '0')
  const base = `${now.getFullYear()}${p(now.getMonth() + 1, 2)}${p(now.getDate(), 2)}-` +
    `${p(now.getHours(), 2)}${p(now.getMinutes(), 2)}${p(now.getSeconds(), 2)}.` +
    `${p(now.getMilliseconds() * 10000, 7)}-1`
  return `${base}.png`
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

function registerPasteRoute(ctx, config) {
  // webServer exists only under the web profile; ride a scoped ctx.inject.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], scope => {
    if (!scope.webServer || typeof scope.webServer.register !== 'function') return
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
          res.end(JSON.stringify({ takeover: (config ?? {}).pasteToPath !== false }))
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
          mkdirSync(PASTE_DIR, { recursive: true })
          const target = join(PASTE_DIR, pasteName())
          writeFileSync(target, buffer)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ path: target }))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(error?.message ?? error) }))
        }
      },
    })
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
      'lines, or setup instructions when the OCR engine is not installed yet.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the image file (png/jpg/webp).',
      },
      full: {
        type: 'boolean',
        description: 'Return structured JSON (text blocks with confidence and box coordinates) instead of plain text.',
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
      return runOcr(path, Boolean(args.full))
    },
    timeoutMs: 120000,
  }))
}
