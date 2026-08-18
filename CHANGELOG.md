# Changelog

All notable changes to this project are documented in this file.

## [0.3.2] - 2026-08-18

- README（中/英）重写为小白友好的快速上手：三步安装（插件 → ocr_setup 引擎 →
  粘贴使用）、多端支持（TUI + Web）说明、粘图键对照表、能力/限制、FAQ。
- docs/usage.md 同步更新。
- CI：修复 doctor smoke 步骤的 YAML 语法错误（多行 -c 未缩进导致整个工作流
  解析失败）。

## [0.3.1] - 2026-08-18

### 首次使用体验（P0）
- 新增 `ocr/setup.py` 一键自举：自动建 venv → 装依赖 → 下模型，全程幂等；
  `install.sh` / `install.ps1` / 新 `ocr_setup` 工具统一走它，不再裸 pip install
  （兼容 PEP 668 / 无 root 环境）。
- `ocr.py --doctor` 环境诊断：逐项报告 python / onnxruntime / numpy / opencv /
  模型 sha256 校验，缺依赖时也能运行；`ocr_image` 报错时自动附带诊断与修复指引。
- `download_models.py` 升级：sha256 清单校验（损坏自动重下）、原子写入、重试、
  `DSH_OCR_MODELS_MIRROR` 镜像支持。

### 识别质量（P2）
- 识别增强：暗底图片自动反色 + Otsu 多候选取最高置信度；小字裁剪区自动放大；
  去除 320px 宽度上限（长行不再压扁，上限放宽到 2048）。
- 检测框按视觉行合并，碎片文本拼成完整行并去重。
- 输出带每行置信度；低置信度行在渲染中标注，`--full` 返回结构化
  `{lines, blocks}`。

### 其它
- python 解析链：`config.pythonPath` → `DSH_OCR_PYTHON` → 内置 venv → python3/python
  （解决 PATH 里没有 `python` 或解析到 Store 存根的问题）。
- 粘贴路由：按内容 sha1 去重（同图不重复落盘）、按真实类型命名、缓存按数量/天数清理。
- 客户端：目标输入框已有相同路径时不重复插入。
- 文档与 CI 更新（`--doctor` 冒烟、setup.py 语法检查）。

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
