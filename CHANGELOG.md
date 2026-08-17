# Changelog

All notable changes to this project are documented in this file.

## [0.2.2] - 2026-08-17

- README: add EN/中文 language switch links.

## [0.2.1] - 2026-08-17

- README: badges + real npx install commands after npm release.

## [0.2.0] - 2026-08-17

- Multi-end support: TUI (cc-tui patch, configurable paste key) + Web
  (`dsh/client.js` injected via `dsh.client` manifest, `/ocr/paste` host route).
- Cross-platform clipboard dispatch: win32 (PowerShell) / darwin (osascript)
  / linux (xclip).
- Published to npm as `dsh-ocr-local`.

## [0.1.0] - 2026-08-15

- Local OCR engine: PP-OCRv5 mobile det+rec (ONNX Runtime), DB post-processing,
  CTC greedy decode, ~200 lines, no framework.
- `ocr_image` tool registration (cordis plugin via `dsh-tools`).
- Model auto-download script (`ocr/download_models.py`, Apache-2.0 models
  cached in `~/.dsh-ocr/models`).
