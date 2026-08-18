# dsh-ocr-local

[English](README.en.md) · [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-ocr-local?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-ocr-local)
[![license](https://img.shields.io/npm/l/dsh-ocr-local?style=flat-square)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-balcoz%2Fdsh--ocr--local-2f81f7?style=flat-square)](https://github.com/balcoz/dsh-ocr-local)

A local OCR plugin for DeepSeek Harness: turn screenshots, error dialogs, chat
logs and document photos into text. **Fully offline, free, and your images
never leave your machine** — no vision model required.

## Quick start (~5 minutes)

### Step 1: Install the plugin

Run this in your terminal:

```sh
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local
```

Then **restart `dsh web`** for the plugin to take effect.

### Step 2: Prepare the engine (once)

Send any image to the agent and say:

> 识别这张图片 / Read the text in this image

If the engine is not installed yet, the tool will tell you what's missing.
Then ask the agent:

> 用 ocr_setup 工具安装 OCR 环境

The plugin will do three things automatically: **create a virtualenv → install
Python dependencies → download the recognition models** (~20MB). After that,
recognition runs locally in seconds.

> Prefer the manual way? (same thing; replace `<profile>` with yours, e.g. `web`)
>
> ```sh
> python ~/.dsh/profiles/<profile>/node_modules/dsh-ocr-local/ocr/setup.py
> ```

### Step 3: Use it

**Way A: paste a screenshot (most common)**

Press Ctrl+V / Cmd+V in the dsh web input box. The image is saved to a path,
inserted into the composer, and the agent automatically calls `ocr_image` to
read the text.

**Way B: give the agent a path**

Send the absolute path of an image file and ask the agent to read it.

## What it handles well / its limits

| ✅ Good at | ⚠️ Mediocre at |
| --- | --- |
| Screenshots, error dialogs, chat logs | Very small text (e.g. 4px) — occasional wrong characters |
| Mixed Chinese + English, long lines | Complex backgrounds, stylized fonts, handwriting |
| Dark-theme screenshots (auto-inverted) | Blurry or heavily compressed images |

Lines with **tiny text or low confidence are flagged ⚠** in the output, so you
can tell which characters not to fully trust.

## Configuration (optional — defaults work out of the box)

Config file: `~/.dsh/profiles/web/cordis.patch.yml`

```yaml
- insert:
    - id: ocr
      name: 'dsh-ocr-local'
      config:
        pythonPath: ~/miniconda3/envs/ocr/bin/python   # optional: which Python to use
        modelDir: ~/.dsh-ocr/models                     # optional: models directory
        pasteToPath: true                               # optional: false disables paste-to-path
        maxCacheFiles: 300                              # optional: paste cache file cap
        maxCacheAgeDays: 30                             # optional: paste cache retention
```

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `DSH_OCR_MODELS_MIRROR` | Model download mirror prefix (e.g. `https://ghproxy.com/` if GitHub is slow) |
| `DSH_OCR_PYTHON` | Which Python to use for OCR (auto-detected by default) |
| `DSH_OCR_MODELS` | Models directory (default `~/.dsh-ocr/models`) |

## FAQ

**Q: "Environment not ready" / "missing dependencies"?**
Ask the agent: 用 ocr_setup 工具安装 OCR 环境 — it fixes everything
automatically. Or run `python ~/.dsh/profiles/web/node_modules/dsh-ocr-local/ocr/setup.py`.

**Q: Model download is slow or fails?**
Set a mirror and re-run (idempotent):
`DSH_OCR_MODELS_MIRROR=https://ghproxy.com/ python .../ocr/setup.py`

**Q: pip complains about externally-managed-environment (PEP 668)?**
Do **not** use `--break-system-packages`. Just run `ocr/setup.py` — it creates a
virtualenv and works around the system-Python restriction.

**Q: Pasting an image does nothing?**
Make sure the plugin is installed in the `web` profile, `pasteToPath` isn't set
to `false`, and you restarted `dsh web`.

**Q: Wrong characters in the result?**
Check the ⚠ flags. Tiny text genuinely trips up the model: try a larger
screenshot, or ask the agent to double-check the flagged lines.

## How it works (one line)

Image → local PP-OCRv5 models (ONNX Runtime, CPU only) → text. The models are
downloaded to `~/.dsh-ocr/models` on first use, then everything is offline.
More details in [docs/usage.md](docs/usage.md).

## Upgrade

```sh
npx -y @deepseek-ai/dsh plugin --profile web update dsh-ocr-local
```

## License

MIT (code). Recognition models Apache-2.0 (PaddleOCR), downloaded at install
time. See [LICENSE](LICENSE).
