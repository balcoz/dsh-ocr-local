# 本地 OCR 工具（PP-OCRv5 + ONNX Runtime，独立于 deepx）

图片本地文字识别，不依赖任何云端服务。模型与 deepx-code 同源（官方 PaddleOCR v5
ONNX 导出），但独立下载、独立存储、独立推理。

## 目录结构

```
C:\deepseek\tool\ocr\
├── ocr.py                 识别脚本（检测 + 识别 + CTC 解码）
├── models\
│   ├── PP-OCRv5_mobile_det.onnx   文本检测模型（4.7MB）
│   ├── PP-OCRv5_mobile_rec.onnx   文本识别模型（16.5MB）
│   └── ppocrv5_dict.txt           中文字典（74KB）
└── README.md
```

## 依赖（一次性安装）

```
pip install onnxruntime numpy opencv-python-headless
```

## 用法

```bash
# 输出纯文本（每行一个文本块）
python ocr.py <图片路径>

# 输出完整 JSON（含坐标和置信度）
python ocr.py <图片路径> --full
```

示例输出（纯文本模式）：
```
tcm-edu
Navicat
Tip：/model切换模型
探索未至之境！
```

## 技术细节

- **检测**：图片缩放到最长边 736（对齐 32 的倍数）→ det 模型 → DB 后处理
  （阈值 0.3 二值化、轮廓查找、unclip 1.6 扩展、置信度过滤）
- **识别**：每个文本框裁图 → 高度 48、宽度 ≤320 缩放 → rec 模型 →
  softmax + argmax → CTC 贪心解码（去重、去空白）→ 查字典
- **字典**：PaddleOCR 惯例，文件首行为空行（对应 class 1），加载时**必须保留空行**，
  否则索引整体偏移 1 位导致乱码
- **模型 IO**：rec 输出形状为 (N, T, 18385)（T 在前），解码按最后一维 argmax
- **通道**：模型按 RGB 训练，cv2 读图后需 BGR→RGB

## 踩坑记录

1. 字典首行空行不能过滤（偏移 bug 已修复）
2. rec 输出维度 (N,T,C) 不是 (N,C,T)（曾导致 argmax 维度错乱）
3. 超宽大字号文字行会被压扁到 320 宽，识别略降（真实截图场景不受影响）

## 集成

AI 助手收到图片路径后执行 `python C:\deepseek\tool\ocr\ocr.py <路径>`
即可获得图片文字内容（当前模型不支持视觉时的替代方案）。
