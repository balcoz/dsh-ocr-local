# 使用指南 / Usage

## 快速开始 / Quick start

```sh
# 1. 安装插件（装到要用的每个 profile；web 和 TUI 都装就各跑一次）
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local
npx -y @deepseek-ai/dsh plugin --profile <tui-profile> add dsh-ocr-local

# 2. 准备识别引擎（一次即可：venv + 依赖 + 模型，幂等）
python ~/.dsh/profiles/web/node_modules/dsh-ocr-local/ocr/setup.py

# 3. TUI 端配置粘图键（Windows 会同时改写 Windows Terminal 键绑定）
#    Windows: powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <tui-profile>
#    macOS/Linux: ./install.sh --profile <tui-profile>

# 4. 重启 dsh，粘贴图片并让 agent 识别
```

## TUI 端配置

TUI 端粘贴图片需要配置粘图键，安装脚本一次搞定（幂等、可重跑）：

| 项 | 说明 |
| --- | --- |
| 粘图键 `-PasteKey` | `ctrl+v`（默认）/ `ctrl+shift+v` / `alt+v` |
| Windows | 自动改写 Windows Terminal 键绑定（备份在 settings.json.bak） |
| macOS | 无需终端配置（Ctrl+V raw mode 直达应用；Cmd+V 保持系统粘贴） |
| Linux | 若终端拦截粘图键，用 `--key alt+v` 重装 |

换粘图键：重跑安装脚本，自动切换并清理旧绑定。升级后粘图失效（插件文件被
覆盖）时，重跑安装脚本即可。

## Web 端

浏览器端随插件自动注入，无需额外配置。粘贴图片时：
捕获阶段监听 → `POST /ocr/paste` → 存到 `~/.dsh/ocr/cache` → 路径插入输入框。

关闭「粘贴图片转路径」（例如想保留原生贴图）：

```yaml
# profile 的 cordis.patch.yml 中覆盖配置
- insert:
    - id: ocr
      name: 'dsh-ocr-local'
      config:
        pasteToPath: false
```

## ocr_image 工具

```json
{ "path": "C:/path/to/image.png", "full": false }
```

- `path`：图片绝对路径，必填
- `full`：可选，输出结构化 JSON（行/块 + 置信度 + 坐标）

引擎未就绪时工具返回**诊断**（缺哪个依赖 / 哪个模型损坏）并提示修复；
同一会话可调用 `ocr_setup` 一键安装：

```json
{ "checkOnly": true }   // 只检查不安装；false 则执行完整安装
```

## 自动识别（autoOcr，默认开启）

任何端（TUI 终端客户端粘贴 / web 粘贴 / 附件）的图片进入会话后，插件监听
`user/message` 事件：把图片附件保存到 `~/.dsh/ocr/cache`，并向模型注入一条
提示（含保存路径），文本模型即可调用 `ocr_image` 本地识别。

**与视觉模型的关系**：`autoOcr` 只控制"本地 OCR 提示"这一半。图片是否同时
发给视觉模型由**你的模型/客户端**决定（模型声明识图能力或启用视觉桥），
本插件不干预、两者可并存。

| 开关 | 位置 | 说明 |
| --- | --- | --- |
| `autoOcr: true`（默认） | 插件配置 | 图片进会话 → 自动保存 + 提示模型本地识别 |
| `autoOcr: false` | 插件配置 | 关闭自动提示；仍可手动让模型调 `ocr_image` |
| 视觉模型路径 | 模型/客户端配置 | 本插件不提供开关，由你的模型能力决定 |

> Linux 提示：终端客户端读取剪贴板图片依赖系统工具——Wayland 需安装
> `wl-clipboard`，X11 需 `xclip`；Windows/macOS 开箱即用。

> 文档约定：README / CHANGELOG / 提交消息不出现其他插件的名称，
> 统一使用「TUI 终端客户端」「视觉模型」等通用表述。

## 模型

- 位置：`~/.dsh-ocr/models`（环境变量 `DSH_OCR_MODELS` 可覆盖）
- 来源：PaddleOCR v5（Apache-2.0），`ocr/download_models.py` 自动下载（sha256 校验，
  环境变量 `DSH_OCR_MODELS_MIRROR` 可指定镜像前缀）
- 粘贴图片缓存：`~/.dsh/ocr/cache`（时间戳 + 内容哈希命名
  `yyyyMMdd-HHmmss.fffffff-<hash8>.png`，同图自动去重，按数量/天数清理）

## 诊断命令

```sh
# 逐项检查：python / 依赖 / 模型 sha256（无需依赖即可运行）
python ~/.dsh/profiles/web/node_modules/dsh-ocr-local/ocr/ocr.py --doctor

# 只检查不安装
python ~/.dsh/profiles/web/node_modules/dsh-ocr-local/ocr/setup.py --check
```

## FAQ

**Q: TUI 端粘贴图片没反应？**
确认粘图键没被终端拦截（Windows 需 Windows Terminal 键绑定生效；
Linux 换 `alt+v` 重装）。

**Q: Web 端粘贴图片没反应？**
确认插件装到了 web profile、`pasteToPath` 没被改成 `false`、重启过 `dsh web`；
浏览器控制台看 `[dsh-ocr]` 报错。

**Q: 提示"环境未就绪 / OCR 引擎未就绪"？**
调用 `ocr_setup` 工具一键安装，或手动：
`python .../ocr/setup.py`（建 venv + 装依赖 + 下模型，幂等）。
先用 `python .../ocr/ocr.py --doctor` 看具体缺什么。

**Q: pip 报 externally-managed-environment（PEP 668）？**
不要用 `--break-system-packages`，直接跑 `ocr/setup.py`（会自动建 venv）。

**Q: 模型下载失败/慢？**
设 `DSH_OCR_MODELS_MIRROR=https://ghproxy.com/` 后重跑 setup（幂等）。

**Q: 升级插件后功能没变化？**
重启 dsh 让插件重新加载。
