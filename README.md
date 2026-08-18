# dsh-ocr-local
[English](README.en.md) · [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-ocr-local?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-ocr-local) [![license](https://img.shields.io/npm/l/dsh-ocr-local?style=flat-square)](LICENSE) [![GitHub](https://img.shields.io/badge/GitHub-balcoz%2Fdsh--ocr--local-2f81f7?style=flat-square)](https://github.com/balcoz/dsh-ocr-local)

DeepSeek Harness 本地 OCR 插件——**PP-OCRv5 + ONNX Runtime，完全离线**。
注册 `ocr_image` 工具：给一个图片路径，返回图片里的文字。

不需要视觉模型。agent 能访问到的任何图片都能识别：粘图补丁保存的截图
（`~/.dsh/ocr/cache/...`）、文件、图表、报错弹窗、照片。

## 多端支持（TUI + Web）

| 端               | 粘贴机制                                                                                                | 组件                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **TUI（你的终端 profile）** | 终端键位重绑定（Windows）/ Ctrl+V raw mode 直达（macOS）→ `readClipboard()` 平台分派（win32/darwin/linux）保存图片，路径插入输入框 | `patch/apply-cc-tui-patch.mjs` + `patch/apply-wt-key.mjs`                                   |
| **dsh web**     | 浏览器捕获阶段 `paste` 监听 → POST 图片字节到 `/ocr/paste` → 宿主保存到 `~/.dsh/ocr/cache` → 路径插入输入框                   | `dsh/client.js`（经 `dsh.client` 清单注入，`exports["./client"]`）+ `dsh/index.js` 的 `webServer` 路由 |

两端汇合到同一个契约：**agent 收到文件路径，`ocr_image` 读图**。
本地引擎意味着零 API 费用、无数据外传，粘贴链路与识别链路完全离线。

Web 端只在宿主路由确认接管后（`GET /ocr/paste` → `{ takeover }`）才拦截图片
粘贴；路由 404（未启用/非 web profile）时客户端自动让位，文本粘贴与视觉
模型的原生贴图不受影响。可在插件配置里设 `{ pasteToPath: false }` 关闭拦截。

## 平台支持

| 平台      | 粘图键                                    | 剪贴板读取                          | 终端配置                                         |
| ------- | -------------------------------------- | ------------------------------ | -------------------------------------------- |
| Windows | `ctrl+v`（默认）/ `ctrl+shift+v` / `alt+v` | PowerShell `Get-Clipboard`     | Windows Terminal 键绑定自动配置（`apply-wt-key.mjs`） |
| macOS   | `ctrl+v`（默认）                           | `osascript`（PNG 数据）+ `pbpaste` | 无需配置——raw mode 下 Ctrl+V 直达应用；Cmd+V 保持系统文本粘贴  |
| Linux   | `ctrl+v` / 终端拦截时推荐 `alt+v`             | `xclip`                        | 无需（若终端拦截 Ctrl+V，用 `--key alt+v` 重装）          |
| HarmonyOS | — | — | 暂无 Node 运行时；`readClipboard()` 的平台分派点已预留，DSH 支持鸿蒙后可即插即用 |

跨平台剪贴板分派在补丁后的 `readClipboard()`：`win32` → PowerShell，
`darwin` → osascript/pbpaste，`linux` → xclip，其他平台返回 null。

### macOS / Linux 安装

```sh
./install.sh --profile <profile>            # 默认粘图键 ctrl+v，<profile> 换成你的终端 profile（如 cc-tui）
./install.sh --profile <profile> --key alt+v
```

## 安装

DSH 的 profile 是互相隔离的环境：插件要装到`每一个`你想使用的 profile。

```sh
# TUI —— 把 <profile> 换成你的终端 profile 名（如 cc-tui）
npx -y @deepseek-ai/dsh plugin --profile <profile> add dsh-ocr-local
#   之后还要跑终端键位补丁（见 install.ps1 / install.sh）

# web —— 浏览器端（dsh/client.js）随安装自动注入
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local

# 两端都要？两条命令都跑
```

或直接从 GitHub 安装：`dsh plugin --profile web add github:balcoz/dsh-ocr-local`。

> 为什么带 `--profile`？每个 profile 有自己的 node_modules 和
> cordis.patch.yml；`dsh plugin add` 把插件写进你指定的那个 profile。
> 插件两端都能用，但安装是按 profile 分开的。

然后准备一次 OCR 引擎——**不需要手动装 Python 依赖**，自举脚本会完成
（建 venv → 装依赖 → 下模型，全部幂等）：

```sh
# Windows 一键脚本（可自定义粘图键，<profile> 换成你的终端 profile）
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <profile>
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey ctrl+shift+v   # 自定义粘图键
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey alt+v

# macOS / Linux
./install.sh --profile <profile>

# 或手动（与 install 脚本等价）
python ocr/setup.py          # 建 ~/.dsh-ocr/venv + 装依赖 + 下模型到 ~/.dsh-ocr/models
```

如果模型下载慢（GitHub 不稳定），设置镜像前缀再跑一次（幂等）：

```sh
DSH_OCR_MODELS_MIRROR=https://ghproxy.com/ python ocr/setup.py
```

**粘图键（-PasteKey）**：粘贴图片时使用的快捷键，默认 `ctrl+v`。
可选 `ctrl+v` / `ctrl+shift+v` / `alt+v`。安装时指定后：

| 粘图键            | 粘图（sendInput） | 文本粘贴（paste）  |
| -------------- | ------------- | ------------ |
| `ctrl+v`（默认）   | Ctrl+V        | Ctrl+Shift+V |
| `ctrl+shift+v` | Ctrl+Shift+V  | Ctrl+V       |
| `alt+v`        | Alt+V         | Ctrl+V       |

不想改动自己习惯的 Ctrl+V 文本粘贴，就选 `alt+v` 或 `ctrl+shift+v`。

重启你的 TUI 客户端（如 `dsh cc-tui`）或 web UI（`dsh web`），把图片路径发给 agent 说"识别这张图片"，
它会自动调用 `ocr_image`。

## 使用

```
ocr_image  { "path": "C:/path/to/image.png", "full": false }
```

- `path`：图片绝对路径（png/jpg/webp），必填
- `full`：可选，输出结构化 JSON（行/块 + 置信度 + 坐标）而不是纯文本

引擎未就绪时 `ocr_image` 会返回**诊断**（缺哪个依赖 / 哪个模型损坏）并提示修复。
可以在同一个会话里直接调用：

```
ocr_setup  { "checkOnly": false }    # 一键安装；checkOnly: true 只检查不装
```

## 识别质量增强

- 暗色背景截图自动反色 + Otsu 二值化（4 种预处理候选**多数投票**，避免误选）
- 小字检测框按比例加大内边距并自动放大，避免丢笔画；长行不再被 320px 截断（上限 2048）
- 检测框按视觉行聚类，**对整行直接识别**，避免碎片拼接的重复字
- 每行输出检测置信度与字高（`font_px`）；字太小或置信度低的行标注 ⚠
  （注：rec 模型 softmax 平坦，置信度以检测为准，不误报识别概率）

## 配置

插件配置（web profile 的 cordis.patch.yml 中）：

```yaml
- insert:
    - id: ocr
      name: 'dsh-ocr-local'
      config:
        pythonPath: ~/miniconda3/envs/ocr/bin/python   # 可选：指定 python
        modelDir: ~/.dsh-ocr/models                     # 可选：模型目录
        pasteToPath: true                               # 可选：false 关闭粘贴接管
        maxCacheFiles: 300                              # 可选：粘贴缓存最大文件数
        maxCacheAgeDays: 30                             # 可选：粘贴缓存保留天数
```

环境变量（对 install / setup / ocr 均生效）：

| 变量 | 作用 |
| --- | --- |
| `DSH_OCR_PYTHON` | 指定 OCR 用哪个 python（优先于内置 venv） |
| `DSH_OCR_VENV` | venv 目录（默认 `~/.dsh-ocr/venv`） |
| `DSH_OCR_MODELS` | 模型目录（默认 `~/.dsh-ocr/models`） |
| `DSH_OCR_MODELS_MIRROR` | 模型下载镜像前缀（ghproxy 风格，如 `https://ghproxy.com/`） |

## 故障排查

```sh
python ocr/ocr.py --doctor          # 逐项诊断：python / 依赖 / 模型 sha256
~/.dsh-ocr/venv/bin/python ocr/ocr.py --doctor   # 使用内置 venv 的诊断
python ocr/setup.py --check         # 只检查不安装
```

常见问题：

- **pip 报 externally-managed-environment（PEP 668）**：直接用 `python ocr/setup.py`，
  它会建 venv 绕开系统 python，不再需要 `--break-system-packages`。
- **模型下载失败/超时**：设 `DSH_OCR_MODELS_MIRROR` 镜像后重跑 setup（幂等）。
- **识别不准**：检查是否为暗底/小字截图——新版本已自动处理；仍不准可看置信度标注。

## 工作原理

- **引擎**：`ocr/ocr.py` —— PP-OCRv5 mobile det + rec ONNX 模型，DB 后处理
  （thresh/unclip），CTC 贪心解码 + `ppocrv5_dict.txt` 查字典；含暗底反色、
  小字放大、长行支持、行合并与置信度输出。约 300 行，无框架依赖。
- **安装**：`ocr/setup.py` 一键自举（venv + 依赖 + 模型），`ocr.py --doctor`
  提供环境诊断。
- **模型**：`ocr/download_models.py` 下载到 `~/.dsh-ocr/models`，sha256 校验 +
  镜像支持（可用环境变量 `DSH_OCR_MODELS` / `DSH_OCR_MODELS_MIRROR` 覆盖）。
  PaddleOCR 模型 Apache-2.0，**不打进仓库**。
- **运行时**：Python `onnxruntime`，纯 CPU。
- **插件**：cordis 插件，通过 `@deepseek-ai/dsh-tools` 的 `defineTool` 注册工具。

## 后续计划

- 自动 OCR：挂钩消息事件，粘贴的图片路径在 agent 回答前自动识别
- 批量：识别目录下所有图片
- GPU / 更优模型（PP-OCRv5 server）

## 许可

MIT（代码）。模型 Apache-2.0（PaddleOCR），安装时下载。见 [LICENSE](LICENSE)。
