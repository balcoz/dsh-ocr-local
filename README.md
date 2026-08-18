# dsh-ocr-local

[English](README.en.md) · [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-ocr-local?style=flat-square&color=cb3837)](https://www.npmjs.com/package/dsh-ocr-local) [![license](https://img.shields.io/npm/l/dsh-ocr-local?style=flat-square)](LICENSE) [![GitHub](https://img.shields.io/badge/GitHub-balcoz%2Fdsh--ocr--local-2f81f7?style=flat-square)](https://github.com/balcoz/dsh-ocr-local)

给 DeepSeek Harness 装一个「本地文字识别」：把截图、报错弹窗、聊天记录、文档照片
变成文字。**完全离线、免费，图片不会离开你的电脑**，也不需要视觉大模型。

## 快速开始（约 5 分钟）

### 第 1 步：安装插件

在终端里运行：

```sh
npx -y @deepseek-ai/dsh plugin --profile web add dsh-ocr-local
```

装完后**重启 `dsh web`**，插件才会生效。

### 第 2 步：准备识别引擎（只需一次）

把任意一张图片发给 agent，说：

> 识别这张图片

如果引擎还没装好，工具会告诉你缺什么。这时再对 agent 说：

> 用 ocr_setup 工具安装 OCR 环境

插件会自动完成三件事：**建虚拟环境 → 装 Python 依赖 → 下载识别模型**
（约 20MB），之后每次识别都在本地秒级完成。

> 想手动装也可以（和上面等价，把 `<profile>` 换成你的 profile 名，如 `web`）：
>
> ```sh
> python ~/.dsh/profiles/<profile>/node_modules/dsh-ocr-local/ocr/setup.py
> ```

### 第 3 步：开始使用

**方式 A：直接粘贴截图（最常用）**

在 dsh web 的输入框里按 Ctrl+V / Cmd+V 粘贴图片，图片会自动保存成路径插入输入框，
agent 会自动调 `ocr_image` 读出里面的文字。

**方式 B：告诉 agent 图片路径**

把图片文件的绝对路径发给 agent，说「识别这张图片」。

## 能识别什么 / 有什么限制

| ✅ 擅长 | ⚠️ 效果一般 |
| --- | --- |
| 截图、报错弹窗、聊天记录 | 极小的字（如 4px）可能有个别错字 |
| 中文 + 英文混排、长段落 | 复杂背景、艺术字、手写体 |
| 暗色主题截图（自动反色处理） | 模糊或严重压缩的图片 |

识别结果里，**字太小或置信度低的行会标注 ⚠**，方便你判断哪些字不能全信。

## 配置（可选，默认不用动）

配置文件：`~/.dsh/profiles/web/cordis.patch.yml`

```yaml
- insert:
    - id: ocr
      name: 'dsh-ocr-local'
      config:
        pythonPath: ~/miniconda3/envs/ocr/bin/python   # 可选：指定 Python
        modelDir: ~/.dsh-ocr/models                     # 可选：模型目录
        pasteToPath: true                               # 可选：false 关闭「粘贴图片转路径」
        maxCacheFiles: 300                              # 可选：粘贴缓存最多文件数
        maxCacheAgeDays: 30                             # 可选：粘贴缓存保留天数
```

常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `DSH_OCR_MODELS_MIRROR` | 模型下载镜像前缀（国内下载慢时设，如 `https://ghproxy.com/`） |
| `DSH_OCR_PYTHON` | 指定 OCR 用哪个 Python（默认自动找） |
| `DSH_OCR_MODELS` | 模型存放目录（默认 `~/.dsh-ocr/models`） |

## 常见问题

**Q：提示「环境未就绪」/「缺少依赖」？**
对 agent 说「用 ocr_setup 安装 OCR 环境」即可自动修复；或手动运行
`python ~/.dsh/profiles/web/node_modules/dsh-ocr-local/ocr/setup.py`。

**Q：模型下载很慢或失败？**
设镜像后重试（幂等，可反复跑）：
`DSH_OCR_MODELS_MIRROR=https://ghproxy.com/ python .../ocr/setup.py`

**Q：系统提示 pip externally-managed-environment（PEP 668）？**
不要加 `--break-system-packages`。直接用 `ocr/setup.py`——它会自动创建虚拟环境，
绕开系统 Python 的限制。

**Q：粘贴图片没反应？**
确认插件装到了 web profile、`pasteToPath` 没被改成 `false`、且重启过 `dsh web`。

**Q：识别结果有错字？**
看输出里的 ⚠ 标注。字太小时模型确实会看走眼：把原图放大一点再试，
或让 agent 把对应行再确认一遍。

## 工作原理（一句话）

图片 → 本地 PP-OCRv5 模型（ONNX Runtime，纯 CPU）→ 文字。
模型第一次使用时下载到 `~/.dsh-ocr/models`，之后完全离线。
更多细节见 [docs/usage.md](docs/usage.md)。

## 升级

```sh
npx -y @deepseek-ai/dsh plugin --profile web update dsh-ocr-local
```

## 许可

MIT（代码）。识别模型 Apache-2.0（PaddleOCR），安装时自动下载。见 [LICENSE](LICENSE)。
