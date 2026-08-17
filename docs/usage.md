# 使用指南 / Usage

## 快速开始 / Quick start

```sh
# 1. install the plugin (per profile — see README)
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local

# 2. prepare the OCR engine once
pip install onnxruntime numpy opencv-python-headless
python ocr/download_models.py

# 3. restart the profile, paste an image, ask the agent to read it
```

## TUI（cc-tui）端配置

TUI 端的图片粘贴需要两处补丁（安装脚本一次搞定）：

```sh
# Windows
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile <profile>
# macOS / Linux
./install.sh --profile <profile>
```

| 项 | 说明 |
| --- | --- |
| 粘图键 `-PasteKey` | `ctrl+v`（默认）/ `ctrl+shift+v` / `alt+v` |
| Windows 终端 | 自动改写 Windows Terminal 键绑定（备份在 settings.json.bak） |
| macOS | 无需终端配置（Ctrl+V raw mode 直达应用；Cmd+V 保持系统粘贴） |
| Linux | 若终端拦截粘图键，用 `--key alt+v` 重装 |

补丁幂等、可回退：重复运行自动跳过；`--dry-run` 预览不写文件。
升级 dsh-cc-tui 后重跑安装脚本即可。

## Web 端

浏览器端自动注入（`dsh.client` 清单），无需配置。粘贴图片时：
捕获阶段监听 → `POST /ocr/paste` → 存到 `~/.dsh/ocr/cache` → 路径插入输入框。

关闭接管（例如模型支持视觉时保留原生贴图）：

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
- `full`：可选，输出结构化 JSON（文本块 + 置信度 + 坐标）

引擎未就绪时工具返回安装指引。

## 模型

- 位置：`~/.dsh-ocr/models`（环境变量 `DSH_OCR_MODELS` 可覆盖）
- 来源：PaddleOCR v5（Apache-2.0），`ocr/download_models.py` 自动下载
- 粘贴图片：`~/.dsh/ocr/cache`（deepx 风格命名 `yyyyMMdd-HHmmss.fffffff-1.png`）

## FAQ

**Q: 粘贴图片没反应？**
- TUI：确认粘图键没被终端拦截（Windows 需 WT 键绑定生效；Linux 换 `alt+v`）
- Web：确认插件装到了 web profile；浏览器控制台看 `[dsh-ocr]` 报错

**Q: 提示"OCR 引擎未就绪"？**
运行 `pip install onnxruntime numpy opencv-python-headless` +
`python ocr/download_models.py`。

**Q: 升级 dsh-cc-tui 后粘图失效？**
node_modules 被覆盖，重跑安装脚本（补丁幂等）。

**Q: 换粘图键？**
重跑 `install.ps1 -PasteKey <新键>` 或 `install.sh --key <新键>`，自动切换并清理旧绑定。
