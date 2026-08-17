# dsh-ocr-local
[English](README.md) · [中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-ocr-local?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-ocr-local)
[![license](https://img.shields.io/npm/l/dsh-ocr-local?style=flat-square)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-balcoz%2Fdsh--ocr--local-2f81f7?style=flat-square)](https://github.com/balcoz/dsh-ocr-local)

Local OCR for DeepSeek Harness — **PP-OCRv5 + ONNX Runtime, fully offline**.
Registers the `ocr_image` tool: give it an image path, get the text inside.

No vision model needed. Works with any image the agent can reach on disk:
screenshots saved by a paste patch (`~/.dsh/ocr/cache/...`), files, diagrams,
error dialogs, photos.

## Multi-end support (TUI + Web)

| End | Paste mechanism | Piece |
| --- | --- | --- |
| **TUI (your terminal profile)** | terminal keybinding rewired (Windows) / Ctrl+V raw-mode (macOS) → `readClipboard()` platform dispatch (win32/darwin/linux) saves the image, path inserted into the prompt | `patch/apply-cc-tui-patch.mjs` + `patch/apply-wt-key.mjs` |
| **dsh web** | browser capture-phase `paste` listener → POST image bytes to `/ocr/paste` → host saves to `~/.dsh/ocr/cache` → path inserted into the composer | `dsh/client.js` (injected via `dsh.client` manifest, `exports["./client"]`) + `dsh/index.js` `webServer` route |

Both ends converge on the same contract: **the agent receives a file path, and
`ocr_image` reads it** — same as [ModLens](https://github.com/liustack/modlens)
does for its paste flow (this plugin uses local PP-OCRv5 instead of a cloud
vision engine, and stays fully offline).

The web half only takes over image pastes after the host route confirms
(`GET /ocr/paste` → `{ takeover }`); a 404 (route off / no web profile) makes
the client stand down so text paste and vision-model native pastes stay
untouched. Disable interception with `{ pasteToPath: false }` in the plugin
config.

## Platform support

| Platform | Paste key | Clipboard read | Terminal config |
| --- | --- | --- | --- |
| Windows | `ctrl+v` (default) / `ctrl+shift+v` / `alt+v` | PowerShell `Get-Clipboard` | Windows Terminal keybinding auto-applied (`apply-wt-key.mjs`) |
| macOS | `ctrl+v` (default) | `osascript` (PNG data) + `pbpaste` | none needed — Ctrl+V reaches the app in raw mode; Cmd+V stays system text paste |
| Linux | `ctrl+v` / `alt+v` (recommended if terminal intercepts) | `xclip` | none (if your terminal intercepts Ctrl+V, reinstall with `--key alt+v`) |
| HarmonyOS | — | — | — no Node runtime on HarmonyOS NEXT yet; the platform-dispatch point in `readClipboard` makes it a drop-in when DSH runs there |

Cross-platform clipboard dispatch lives in the patched `readClipboard()`:
`win32` → PowerShell, `darwin` → osascript/pbpaste, `linux` → xclip, else → `null`.

## Install

DSH profiles are isolated environments: the plugin must be added to **each**
profile you want it in.

```sh
# TUI — replace <profile> with your terminal profile name (e.g. cc-tui)
npx -y @deepseek-ai/dsh plugin --profile <profile> add dsh-ocr-local
#   then apply the terminal keybinding patch (see install.ps1 / install.sh)

# web — the browser half (dsh/client.js) is injected automatically
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local

# both ends? run both commands
```

Or from GitHub directly:

```sh
dsh plugin --profile web add github:balcoz/dsh-ocr-local
```

> Why `--profile`? Each profile has its own node_modules and cordis.patch.yml;
> `dsh plugin add` writes the plugin bundle into the profile you name. The
> plugin works in both, but the install is per-profile.

Then prepare the engine once (Python + models):

```sh
# Windows (paste key configurable, default ctrl+v)
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <profile>
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey ctrl+shift+v
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey alt+v

# manual
pip install onnxruntime numpy opencv-python-headless
python ocr/download_models.py     # downloads PP-OCRv5 models to ~/.dsh-ocr/models
```

**Paste key (`-PasteKey`)**: the shortcut that triggers image-paste; default
`ctrl+v`. Options: `ctrl+v` / `ctrl+shift+v` / `alt+v`. The installer rewires
both the TUI key handler and the Windows Terminal keybinding:

| paste key | image paste (sendInput) | text paste (paste) |
| --- | --- | --- |
| `ctrl+v` (default) | Ctrl+V | Ctrl+Shift+V |
| `ctrl+shift+v` | Ctrl+Shift+V | Ctrl+V |
| `alt+v` | Alt+V | Ctrl+V |

Pick `alt+v` or `ctrl+shift+v` if you don't want to touch your Ctrl+V habit.

Restart your TUI client (`dsh cc-tui`) or the web UI (`dsh web`), then paste
an image path and ask: "识别这张图片" — the agent calls `ocr_image` automatically.

## Usage

```
ocr_image  { "path": "C:/path/to/image.png", "full": false }
```

- `path`: absolute image path (png/jpg/webp). Required.
- `full`: optional, return structured JSON (text blocks with confidence +
  box coordinates) instead of plain text.

The tool returns recognized text lines; if the engine is not installed it
returns setup instructions instead.

## How it works

- **Engine**: `ocr/ocr.py` — PP-OCRv5 mobile det + rec ONNX models, DB
  post-processing (thresh/unclip), CTC greedy decode against
  `ppocrv5_dict.txt`. ~200 lines, no framework.
- **Models**: downloaded once by `ocr/download_models.py` to
  `~/.dsh-ocr/models` (env `DSH_OCR_MODELS` overrides). PaddleOCR models are
  Apache-2.0; they are NOT bundled in this repo.
- **Runtime**: ONNX Runtime via Python (`onnxruntime`), CPU only.
- **Plugin**: cordis plugin registering the `ocr_image` tool via
  `@deepseek-ai/dsh-tools` `defineTool`.

## Roadmap ideas

- Auto-OCR: hook message events so pasted image paths are OCR'd
  automatically before the agent answers.
- Batch: OCR all images in a directory.
- GPU provider / better models (PP-OCRv5 server).

## License

MIT (code). Models Apache-2.0 (PaddleOCR), downloaded at install time.
See [LICENSE](LICENSE).
