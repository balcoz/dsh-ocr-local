# dsh-ocr-local
[English](README.md) · [中文](README.zh.md)

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

两端汇合到同一个契约：**agent 收到文件路径，`ocr_image` 读图**——与
[ModLens](https://github.com/liustack/modlens) 的粘贴流程同构（本插件用本地
PP-OCRv5 替代云端视觉引擎，完全离线）。

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

然后准备一次 OCR 引擎（Python 依赖 + 模型）：

```sh
# Windows 一键脚本（可自定义粘图键，<profile> 换成你的终端 profile）
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <profile>
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey ctrl+shift+v   # 自定义粘图键
powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey alt+v

# 或手动
pip install onnxruntime numpy opencv-python-headless
python ocr/download_models.py     # 下载 PP-OCRv5 模型到 ~/.dsh-ocr/models
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
- `full`：可选，输出结构化 JSON（文本块 + 置信度 + 坐标）而不是纯文本

引擎未安装时工具会返回安装指引。

## 工作原理

- **引擎**：`ocr/ocr.py` —— PP-OCRv5 mobile det + rec ONNX 模型，DB 后处理
  （thresh/unclip），CTC 贪心解码 + `ppocrv5_dict.txt` 查字典。约 200 行，无框架依赖。
- **模型**：`ocr/download_models.py` 首次运行下载到 `~/.dsh-ocr/models`
  （可用环境变量 `DSH_OCR_MODELS` 覆盖）。PaddleOCR 模型 Apache-2.0，**不打进仓库**。
- **运行时**：Python `onnxruntime`，纯 CPU。
- **插件**：cordis 插件，通过 `@deepseek-ai/dsh-tools` 的 `defineTool` 注册工具。

## 后续计划

- 自动 OCR：挂钩消息事件，粘贴的图片路径在 agent 回答前自动识别
- 批量：识别目录下所有图片
- GPU / 更优模型（PP-OCRv5 server）

## 许可

MIT（代码）。模型 Apache-2.0（PaddleOCR），安装时下载。见 [LICENSE](LICENSE)。
