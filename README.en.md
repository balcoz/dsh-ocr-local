# dsh-ocr-local

[English](README.en.md) · [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-ocr-local?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-ocr-local)
[![license](https://img.shields.io/npm/l/dsh-ocr-local?style=flat-square)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-balcoz%2Fdsh--ocr--local-2f81f7?style=flat-square)](https://github.com/balcoz/dsh-ocr-local)

A local OCR plugin for DeepSeek Harness: turn screenshots, error dialogs, chat
logs and document photos into text. **Fully offline, free, and your images
never leave your machine** — no vision model required.

## Multi-end support (TUI + Web)

| End | How to paste an image | How it gets recognized |
| --- | --- | --- |
| **TUI (terminal client)** | Ctrl+V / paste key / terminal menu paste | Automatic: the image enters the session → the plugin saves it locally → the text model calls `ocr_image` |
| **Web** | press Ctrl+V / Cmd+V in the browser | Automatic: paste becomes a path in the composer → `ocr_image` reads it |

Both paths converge on the same flow: **an image reaches the session, and
`ocr_image` reads the text locally**. If your model supports vision (or a
vision bridge is configured), the image goes through as-is, and the local-OCR
hint coexists with the vision pipeline.

## Quick start (~5 minutes)

### Step 1: Install the plugin

DSH profiles are isolated, so install the plugin into **each profile you use**:

```sh
# Web
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local

# TUI (replace <profile> with your terminal profile name)
npx -y @deepseek-ai/dsh plugin --profile <profile> add dsh-ocr-local
```

For the TUI end, **also run the install script once** to configure the paste
key (on Windows it also rewrites the Windows Terminal keybindings, backed up in
settings.json.bak):

```sh
# Windows
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <profile>

# macOS / Linux
./install.sh --profile <profile>
```

Then **restart dsh** for the plugin to take effect.

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

- Web: press Ctrl+V / Cmd+V in the composer.
- TUI: press the paste key (see the table below).

The image is saved to a path, inserted into the input, and the agent
automatically calls `ocr_image` to read the text.

**Way B: give the agent a path**

Send the absolute path of an image file and ask the agent to read it.

## Paste key (TUI)

The shortcut configured at install time, `ctrl+v` by default; `ctrl+shift+v`
and `alt+v` are also available. Pick `alt+v` or `ctrl+shift+v` if you don't
want to touch your Ctrl+V text-paste habit:

| paste key | image paste | text paste |
| --- | --- | --- |
| `ctrl+v` (default) | Ctrl+V | Ctrl+Shift+V |
| `ctrl+shift+v` | Ctrl+Shift+V | Ctrl+V |
| `alt+v` | Alt+V | Ctrl+V |

To change the key, re-run the install script
(`install.ps1 -PasteKey <new>` / `install.sh --key <new>`) — it switches and
cleans up the old binding. The patch is idempotent.

## What it handles well / its limits

| ✅ Good at | ⚠️ Mediocre at |
| --- | --- |
| Screenshots, error dialogs, chat logs | Very small text (e.g. 4px) — occasional wrong characters |
| Mixed Chinese + English, long lines | Complex backgrounds, stylized fonts, handwriting |
| Dark-theme screenshots (auto-inverted) | Blurry or heavily compressed images |

Lines with **tiny text or low confidence are flagged ⚠** in the output, so you
can tell which characters not to fully trust.

## Configuration (optional — defaults work out of the box)

### Recognition modes and switches

| Scenario | Behavior | Switch |
| --- | --- | --- |
| **Text-only model** | Pasted/attached images are auto-saved to the local cache and a path hint is injected into the model's context → the model calls `ocr_image` for local recognition | This plugin's `autoOcr` (default `true`; set `false` to disable the auto hint — `ocr_image` still works manually) |
| **Vision-capable model** | The image goes through to the model as-is for direct viewing; the local-OCR hint coexists without interference | Decided by **your model/client** config (the model declares vision capability or a vision bridge is enabled) — **this plugin does not intervene** |

`autoOcr` only controls the "local OCR hint" half: once an image enters the
session, the plugin saves it and prompts the model to recognize it. Whether the
image is also sent to a vision model is decided by your model/client and is
independent of `autoOcr` — both can be on at the same time.

Config file: `~/.dsh/profiles/web/cordis.patch.yml`

```yaml
- insert:
    - id: ocr
      name: 'dsh-ocr-local'
      config:
        autoOcr: true                                   # optional: false disables auto OCR hint on pasted images
        pythonPath: ~/miniconda3/envs/ocr/bin/python   # optional: which Python to use
        modelDir: ~/.dsh-ocr/models                     # optional: models directory
        pasteToPath: true                               # optional: false disables web paste-to-path
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

**Q: Pasting an image does nothing in the TUI?**
First make sure the terminal client can read clipboard images: Windows/macOS
work out of the box; on Linux (Wayland) install `wl-clipboard` (or `xclip` on
X11), otherwise the terminal can't read clipboard images and paste fails
silently. Once the image reaches the session, this plugin saves it and prompts
the model to run `ocr_image`.

**Q: Pasting an image does nothing in the Web UI?**
Make sure the plugin is installed in the `web` profile, `pasteToPath` isn't set
to `false`, and you restarted `dsh web`.

**Q: Wrong characters in the result?**
Check the ⚠ flags. Tiny text genuinely trips up the model: try a larger
screenshot, or ask the agent to double-check the flagged lines.

## How it works (one line)

Images pasted from any end (TUI paste / web paste / attachments) enter the
session; the plugin saves them to `~/.dsh/ocr/cache` and prompts the model,
which calls `ocr_image` → local PP-OCRv5 models (ONNX Runtime, CPU only) →
text. Models are downloaded to `~/.dsh-ocr/models` on first use, then
everything is offline. More details in [docs/usage.md](docs/usage.md).

## Upgrade

```sh
npx -y @deepseek-ai/dsh plugin --profile web update dsh-ocr-local
```

If pasting stops working after a TUI upgrade (plugin files overwritten), just
re-run the install script (idempotent).

## License

MIT (code). Recognition models Apache-2.0 (PaddleOCR), downloaded at install
time. See [LICENSE](LICENSE).
