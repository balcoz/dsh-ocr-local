#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 OCR 推理（PP-OCRv5 + ONNX Runtime，独立于 deepx）
用法:
    python ocr.py <图片路径> [--json] [--full]
    --json   输出 JSON（默认）
    --full   包含每个文本块的置信度和坐标
依赖: pip install onnxruntime numpy opencv-python-headless
"""
import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

# 模型缓存目录：优先环境变量 DSH_OCR_MODELS，否则 ~/.dsh-ocr/models
_MODELS_DIR = os.environ.get("DSH_OCR_MODELS") or str(Path.home() / ".dsh-ocr" / "models")
MODELS_DIR = Path(_MODELS_DIR)
DET_MODEL = MODELS_DIR / "PP-OCRv5_mobile_det.onnx"
REC_MODEL = MODELS_DIR / "PP-OCRv5_mobile_rec.onnx"
DICT_FILE = MODELS_DIR / "ppocrv5_dict.txt"

# PP-OCRv5 参数
DET_LIMIT_SIDE_LEN = 736      # det 最长边
DET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
REC_HEIGHT = 48               # rec 固定高度
REC_MAX_WIDTH = 320           # rec 最大宽度
REC_MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)
REC_STD = np.array([0.5, 0.5, 0.5], dtype=np.float32)
DB_THRESH = 0.3               # DB 二值化阈值
DB_BOX_THRESH = 0.5           # 检测框置信度阈值
DB_UNCLIP_RATIO = 1.6         # 框扩展系数
DB_MIN_SIZE = 3               # 最小框边长（像素）


def load_dict(path):
    """PaddleOCR 字典：每行一个字符，第一行是空行（对应 class 1 的空字符），
    必须保留空行，否则索引整体偏移。"""
    with open(path, "r", encoding="utf-8") as f:
        return [line.rstrip("\r\n") for line in f]


class PPOCRv5:
    def __init__(self, det_path=DET_MODEL, rec_path=REC_MODEL, dict_path=DICT_FILE):
        self.sess_det = ort.InferenceSession(str(det_path), providers=["CPUExecutionProvider"])
        self.sess_rec = ort.InferenceSession(str(rec_path), providers=["CPUExecutionProvider"])
        self.dict = load_dict(dict_path)
        self.det_in = self.sess_det.get_inputs()[0].name
        self.det_out = self.sess_det.get_outputs()[0].name
        self.rec_in = self.sess_rec.get_inputs()[0].name
        self.rec_out = self.sess_rec.get_outputs()[0].name

    # ---------- 检测：找文本区域 ----------
    def detect(self, img):
        h, w = img.shape[:2]
        # 保持宽高比缩放到 limit_side_len
        ratio = min(DET_LIMIT_SIDE_LEN / h, DET_LIMIT_SIDE_LEN / w, 1.0)
        nh, nw = int(round(h * ratio)), int(round(w * ratio))
        # 对齐到 32 的倍数
        nh, nw = (nh // 32) * 32, (nw // 32) * 32
        if nh == 0 or nw == 0:
            nh, nw = 32, 32
        resized = cv2.resize(img, (nw, nh))
        # NCHW + 归一化
        blob = resized.astype(np.float32) / 255.0
        blob = (blob - DET_MEAN) / DET_STD
        blob = blob.transpose(2, 0, 1)[None].astype(np.float32)
        prob = self.sess_det.run([self.det_out], {self.det_in: blob})[0][0, 0]
        prob = cv2.resize(prob, (w, h))  # 还原到原图尺寸
        # DB 二值化
        binary = (prob > DB_THRESH).astype(np.uint8) * 255
        # 轮廓 → 最小外接矩形 → unclip 扩展
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < DB_MIN_SIZE * DB_MIN_SIZE:
                continue
            rect = cv2.minAreaRect(cnt)
            box = cv2.boxPoints(rect)
            box = unclip(box, DB_UNCLIP_RATIO)
            box = box.astype(np.int32)
            if cv2.contourArea(box) < DB_MIN_SIZE * DB_MIN_SIZE:
                continue
            # 置信度：框内概率均值
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(mask, [box], 1)
            conf = float(prob[mask.astype(bool)].mean()) if mask.any() else 0.0
            if conf < DB_BOX_THRESH:
                continue
            boxes.append((box, conf))
        # 按从上到下、从左到右排序（按中心 y 分块）
        boxes.sort(key=lambda b: (b[0][:, 1].mean() // 20, b[0][:, 0].min()))
        return boxes

    # ---------- 识别：每个框裁图 → 文字 ----------
    def recognize(self, img, box):
        x, y, w, h = cv2.boundingRect(box)
        # 裁剪并扩展 10% 边距
        pad = 4
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        crop = img[y0:y1, x0:x1]
        if crop.size == 0:
            return "", 0.0
        # 灰度 → 保持长宽比缩放到高 48，宽不超过 320
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        r = REC_HEIGHT / gray.shape[0]
        nw = int(round(gray.shape[1] * r))
        nw = min(nw, REC_MAX_WIDTH)
        resized = cv2.resize(gray, (nw, REC_HEIGHT))
        # CxHxW + 归一化
        blob = resized.astype(np.float32) / 255.0
        blob = (blob - REC_MEAN[0]) / REC_STD[0]
        blob = blob[None, None].astype(np.float32)  # (1,1,H,W) → 转 3 通道
        blob = np.repeat(blob, 3, axis=1)
        logits = self.sess_rec.run([self.rec_out], {self.rec_in: blob})[0]  # (1, T, 18385)
        probs = np.exp(logits - logits.max(axis=-1, keepdims=True))
        probs /= probs.sum(axis=-1, keepdims=True)
        preds = probs[0].argmax(axis=-1)  # (T,)
        confs = probs[0].max(axis=-1)     # (T,)
        # CTC 贪心解码：去重相邻、去空白
        text_chars = []
        conf_sum, conf_cnt = 0.0, 0
        prev = -1
        for t, p in enumerate(preds):
            if p != prev:
                if p != 0 and p - 1 < len(self.dict):
                    text_chars.append(self.dict[p - 1])
                    conf_sum += confs[t]
                    conf_cnt += 1
            prev = p
        text = "".join(text_chars)
        conf = conf_sum / conf_cnt if conf_cnt else 0.0
        return text, conf

    def ocr(self, img):
        if isinstance(img, (str, Path)):
            img = cv2.imread(str(img))
            if img is None:
                raise ValueError(f"无法读取图片: {img}")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # 模型按 RGB 训练
        results = []
        boxes = self.detect(img)
        for box, det_conf in boxes:
            text, rec_conf = self.recognize(img, box)
            if not text.strip():
                continue
            results.append({
                "text": text,
                "confidence": round(float(det_conf + rec_conf) / 2, 4),
                "box": [float(v) for v in box.reshape(-1)],
            })
        return results


def unclip(box, ratio):
    """DB 后处理：按面积扩展四边形（保持形状向外扩张）"""
    area = cv2.contourArea(box)
    peri = cv2.arcLength(box, True)
    if peri < 1e-6:
        return box
    dist = area * (ratio - 1) / peri
    # 各顶点沿外法线方向移动
    result = []
    n = len(box)
    for i in range(n):
        p0 = box[i]
        p1 = box[(i + 1) % n]
        p2 = box[(i + 2) % n]
        v1 = p1 - p0
        v2 = p2 - p1
        n1 = np.array([-v1[1], v1[0]], dtype=np.float32)
        n2 = np.array([-v2[1], v2[0]], dtype=np.float32)
        n1 /= (np.linalg.norm(n1) + 1e-6)
        n2 /= (np.linalg.norm(n2) + 1e-6)
        result.append(p1 + (n1 + n2) * dist)
    return np.array(result, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser(description="PP-OCRv5 本地 OCR")
    ap.add_argument("image", help="图片路径")
    ap.add_argument("--full", action="store_true", help="输出详细 JSON（含坐标置信度）")
    ap.add_argument("--model-dir", default=str(MODELS_DIR), help="模型目录")
    args = ap.parse_args()
    global DET_MODEL, REC_MODEL, DICT_FILE
    md = Path(args.model_dir)
    DET_MODEL, REC_MODEL, DICT_FILE = md / "PP-OCRv5_mobile_det.onnx", md / "PP-OCRv5_mobile_rec.onnx", md / "ppocrv5_dict.txt"
    try:
        ocr = PPOCRv5()
    except Exception as e:
        print(json.dumps({"error": f"模型加载失败（请先下载模型到 {md}）: {e}"}, ensure_ascii=False))
        sys.exit(1)
    results = ocr.ocr(args.image)
    if args.full:
        print(json.dumps(results, ensure_ascii=False))
    else:
        text = "\n".join(r["text"] for r in results)
        print(text)


if __name__ == "__main__":
    main()
