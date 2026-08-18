#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 OCR 推理（PP-OCRv5 + ONNX Runtime，完全离线）

用法:
    python ocr.py <图片路径> [--full] [--model-dir DIR]
    python ocr.py --doctor [--model-dir DIR]

    --full     输出 JSON：{"lines": [{text, confidence}], "blocks": [{text, confidence, box}]}
               默认输出为纯文本（行合并后的可读结果）
    --doctor   输出环境诊断 JSON（python / 依赖 / 模型校验），无需依赖也能运行

识别增强：
- 暗色背景自动反色 + Otsu 二值化（4 种预处理候选做多数投票，避免误选）
- 小字检测框按比例加大内边距并自动放大（目标字高 ~20px），避免丢笔画
- 去除 320px 宽度上限（CTC 支持长行），上限放宽到 2048
- 检测框按视觉行聚类，对整行直接识别，避免碎片拼接产生的重复字
- 输出带检测置信度、字高（font_px）与 low_confidence 风险标记
  （rec 模型 softmax 平坦，不把 rec 概率当置信度）
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

# 依赖延迟导入：--doctor 在缺依赖时也必须能跑
try:
    import cv2
    import numpy as np
    import onnxruntime as ort
    DEPS_OK = True
    DEP_ERROR = None
except Exception as _e:  # pragma: no cover - 仅在缺依赖时触发
    DEPS_OK = False
    DEP_ERROR = str(_e)
    cv2 = np = ort = None

_MODELS_DIR = os.environ.get("DSH_OCR_MODELS") or str(Path.home() / ".dsh-ocr" / "models")
MODELS_DIR = Path(_MODELS_DIR)
DET_MODEL = MODELS_DIR / "PP-OCRv5_mobile_det.onnx"
REC_MODEL = MODELS_DIR / "PP-OCRv5_mobile_rec.onnx"
DICT_FILE = MODELS_DIR / "ppocrv5_dict.txt"

# PP-OCRv5 参数
DET_LIMIT_SIDE_LEN = 736      # det 最长边
DET_MEAN = (0.485, 0.456, 0.406)
DET_STD = (0.229, 0.224, 0.225)
REC_HEIGHT = 48               # rec 固定高度
REC_MAX_WIDTH = 2048          # rec 最大宽度（原 320 会压扁长行）
MIN_GLYPH_PX = 20             # 送入 rec 前的目标字高下限（小字自动放大）
MAX_UPSCALE = 6               # 小字放大的最大倍数（防爆内存）
DB_THRESH = 0.3               # DB 二值化阈值
DB_BOX_THRESH = 0.4           # 检测框置信度阈值（原 0.5 会静默丢行）
DB_UNCLIP_RATIO = 1.6         # 框扩展系数
DB_MIN_SIZE = 3               # 最小框边长（像素）
LOW_DET_CONF = 0.6            # 检测置信度低于此值的行标记为低置信
TINY_FONT_PX = 8              # 字高低于此值的行标记为低置信（小字易错）


def load_dict(path):
    """PaddleOCR 字典：每行一个字符，第一行是空行（对应 class 1 的空字符），
    必须保留空行，否则索引整体偏移。"""
    with open(path, "r", encoding="utf-8") as f:
        return [line.rstrip("\r\n") for line in f]


def require_deps():
    if not DEPS_OK:
        raise RuntimeError(f"Python 依赖缺失: {DEP_ERROR}（请先运行 setup.py 或 pip install onnxruntime numpy opencv-python-headless）")


class PPOCRv5:
    def __init__(self, det_path=None, rec_path=None, dict_path=None):
        # 默认值在调用时读取全局（--model-dir / DSH_OCR_MODELS 才能生效）
        det_path = det_path or DET_MODEL
        rec_path = rec_path or REC_MODEL
        dict_path = dict_path or DICT_FILE
        require_deps()
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
        ratio = min(DET_LIMIT_SIDE_LEN / h, DET_LIMIT_SIDE_LEN / w, 1.0)
        nh, nw = int(round(h * ratio)), int(round(w * ratio))
        nh, nw = (nh // 32) * 32, (nw // 32) * 32
        if nh == 0 or nw == 0:
            nh, nw = 32, 32
        resized = cv2.resize(img, (nw, nh))
        mean = np.array(DET_MEAN, dtype=np.float32)
        std = np.array(DET_STD, dtype=np.float32)
        blob = resized.astype(np.float32) / 255.0
        blob = (blob - mean) / std
        blob = blob.transpose(2, 0, 1)[None].astype(np.float32)
        prob = self.sess_det.run([self.det_out], {self.det_in: blob})[0][0, 0]
        prob = cv2.resize(prob, (w, h))  # 还原到原图尺寸
        binary = (prob > DB_THRESH).astype(np.uint8) * 255
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
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(mask, [box], 1)
            conf = float(prob[mask.astype(bool)].mean()) if mask.any() else 0.0
            if conf < DB_BOX_THRESH:
                continue
            boxes.append((box, conf))
        # 按从上到下、从左到右排序（按中心 y 分块）
        boxes.sort(key=lambda b: (b[0][:, 1].mean() // 20, b[0][:, 0].min()))
        return boxes

    # ---------- 识别：每个框裁图 → 文字（多候选投票） ----------
    def recognize(self, img, box):
        """对裁剪区做 4 种预处理（灰度/Otsu/反色/反色+Otsu），
        逐候选解码后按多数投票取结果（rec 模型 softmax 平坦，按置信度选不可靠）。"""
        x, y, w, h = cv2.boundingRect(box)
        # 内边距与框高成正比：小字检测框只覆盖笔画核心，贴边裁剪会丢笔画
        pad = max(4, int(2.0 * h))
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        crop = img[y0:y1, x0:x1]
        if crop.size == 0:
            return "", 0.0
        # 小字放大：让 rec 看到真实的笔画轮廓
        if crop.shape[0] < MIN_GLYPH_PX:
            scale = min(MAX_UPSCALE, max(2.0, MIN_GLYPH_PX / crop.shape[0]))
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        variants = [gray]
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(otsu)
        inv = 255 - gray  # 暗底图反色，模型按浅底训练
        variants.append(inv)
        _, inv_otsu = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(inv_otsu)
        votes = {}
        for v in variants:
            nw = int(round(v.shape[1] * REC_HEIGHT / v.shape[0]))
            if nw < 4:
                continue
            nw = min(nw, REC_MAX_WIDTH)
            resized = cv2.resize(v, (nw, REC_HEIGHT))
            blob = resized.astype(np.float32) / 255.0
            blob = (blob - 0.5) / 0.5
            blob = np.repeat(blob[None, None], 3, axis=1).astype(np.float32)  # (1,3,H,W)
            logits = self.sess_rec.run([self.rec_out], {self.rec_in: blob})[0]
            text, conf = self._decode(logits)
            if not text.strip():
                continue
            rec = votes.get(text)
            if rec is None:
                votes[text] = [1, conf, len(votes)]
            else:
                rec[0] += 1
                rec[1] += conf
        if not votes:
            return "", 0.0
        # 多数投票；票数相同按置信度和优先序（灰度在前）决胜
        best = max(votes.items(), key=lambda kv: (kv[1][0], kv[1][1], -kv[1][2]))
        text, conf = best[0], best[1][1] / best[1][0]
        text = clean_text(text)
        return text, float(conf)

    def _decode(self, logits):
        probs = np.exp(logits - logits.max(axis=-1, keepdims=True))
        probs /= probs.sum(axis=-1, keepdims=True)
        preds = probs[0].argmax(axis=-1)
        confs = probs[0].max(axis=-1)
        # CTC 贪心解码：去重相邻、去空白
        text_chars, conf_sum, conf_cnt = [], 0.0, 0
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

    # ---------- 主流程：检测 → 行聚类 → 整行识别 ----------
    def ocr(self, img):
        if isinstance(img, (str, Path)):
            img = cv2.imread(str(img))
            if img is None:
                raise ValueError(f"无法读取图片: {img}")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # 模型按 RGB 训练
        boxes = self.detect(img)
        groups = group_boxes_into_lines(boxes)
        lines, blocks = [], []
        for group in groups:
            pts = np.vstack([b[0] for b in group])
            x0, y0 = float(pts[:, 0].min()), float(pts[:, 1].min())
            x1, y1 = float(pts[:, 0].max()), float(pts[:, 1].max())
            union = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)
            text, _rec_conf = self.recognize(img, union)
            if not text.strip():
                continue
            det_conf = sum(b[1] for b in group) / len(group)
            font_px = round(y1 - y0, 1)
            low = det_conf < LOW_DET_CONF or font_px < TINY_FONT_PX
            lines.append({
                "text": text,
                "confidence": round(float(det_conf), 4),
                "font_px": font_px,
                "low_confidence": bool(low),
            })
            for box, conf in group:
                bpts = box.reshape(-1)
                bx, by = bpts[0::2], bpts[1::2]
                blocks.append({
                    "text": text,  # 块级文本按整行结果填充（碎片级文本不可靠）
                    "confidence": round(float(conf), 4),
                    "font_px": round(float(max(by) - min(by)), 1),
                    "box": [float(v) for v in bpts],
                })
        return lines, blocks


_CJK_LATIN_1 = re.compile(r"([\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef])([A-Za-z0-9])")
_CJK_LATIN_2 = re.compile(r"([A-Za-z0-9])([\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef])")


def clean_text(text):
    """识别结果后处理：
    1. 清理行首孤立点号/标点（反色候选会把裁剪区左侧空背景误读成点号）；
    2. 中英文交界补空格（"下载deb" → "下载 deb"，符合中文排版习惯）。"""
    t = text
    while t.startswith((".", "，", "。", ",", "、", "；", ";", "：", ":")):
        # 数字序号 "1." 形式保留（"1." 不以 "." 开头，此分支兜底）
        if t.startswith(".") and len(t) > 1 and (t[1].isdigit() or t[1] == " "):
            break
        t = t[1:]
    t = _CJK_LATIN_1.sub(r"\1 \2", t)
    t = _CJK_LATIN_2.sub(r"\1 \2", t)
    return t


def group_boxes_into_lines(boxes):
    """把同一视觉行内的检测框聚成一簇（按 y 容差聚类，簇内按 x 排序）。
    返回 [[(box, det_conf), ...], ...]"""
    if not boxes:
        return []
    heights = [b[0][:, 1].max() - b[0][:, 1].min() for b in boxes]
    med_h = sorted(heights)[len(heights) // 2] if heights else 8
    tol = max(8, int(0.6 * med_h))
    groups = {}
    for box, conf in boxes:
        cy = int(box[:, 1].mean())
        x0 = float(box[:, 0].min())
        groups.setdefault(cy // tol, []).append((x0, box, conf))
    result = []
    for key in sorted(groups):
        items = sorted(groups[key], key=lambda t: t[0])
        result.append([(box, conf) for _, box, conf in items])
    return result


def unclip(box, ratio):
    """DB 后处理：按面积扩展四边形（保持形状向外扩张）"""
    area = cv2.contourArea(box)
    peri = cv2.arcLength(box, True)
    if peri < 1e-6:
        return box
    dist = area * (ratio - 1) / peri
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


def doctor(model_dir):
    """环境诊断（无需依赖即可运行）。返回 JSON 可序列化 dict。"""
    md = Path(model_dir)
    report = {
        "engine": "ppocrv5",
        "ok": False,
        "python": {
            "ok": True,
            "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "executable": sys.executable,
            "platform": sys.platform,
        },
        "dependencies": {},
        "models": {},
        "models_dir": str(md),
        "venv_dir": str(Path.home() / ".dsh-ocr" / "venv"),
    }
    for name, mod in (("numpy", "numpy"), ("opencv", "cv2"), ("onnxruntime", "onnxruntime")):
        try:
            m = __import__(mod)
            report["dependencies"][name] = {"ok": True, "version": getattr(m, "__version__", "?")}
        except Exception as e:
            report["dependencies"][name] = {"ok": False, "error": str(e)}
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from download_models import MANIFEST
    except Exception as e:
        MANIFEST = {}
        report["models"]["_manifest_error"] = str(e)
    for fname in MANIFEST:
        fp = md / fname
        entry = {"present": fp.exists(), "size": fp.stat().st_size if fp.exists() else 0}
        if fp.exists():
            try:
                import hashlib
                h = hashlib.sha256()
                with open(fp, "rb") as f:
                    for chunk in iter(lambda: f.read(256 * 1024), b""):
                        h.update(chunk)
                entry["sha256_ok"] = h.hexdigest() == MANIFEST[fname][1]
            except Exception as e:
                entry["sha256_ok"] = False
                entry["error"] = str(e)
        else:
            entry["sha256_ok"] = False
        report["models"][fname] = entry
    deps_ok = all(v.get("ok") for v in report["dependencies"].values())
    models_ok = bool(report["models"]) and all(v.get("sha256_ok") for v in report["models"].values())
    report["ok"] = bool(deps_ok and models_ok)
    return report


def main():
    ap = argparse.ArgumentParser(description="PP-OCRv5 本地 OCR（含环境诊断）")
    ap.add_argument("image", nargs="?", help="图片路径")
    ap.add_argument("--full", action="store_true", help="输出 JSON（行 + 块 + 置信度）")
    ap.add_argument("--doctor", action="store_true", help="输出环境诊断 JSON（无需依赖）")
    ap.add_argument("--model-dir", default=str(MODELS_DIR), help="模型缓存目录")
    args = ap.parse_args()
    global DET_MODEL, REC_MODEL, DICT_FILE
    md = Path(args.model_dir)
    DET_MODEL, REC_MODEL, DICT_FILE = md / "PP-OCRv5_mobile_det.onnx", md / "PP-OCRv5_mobile_rec.onnx", md / "ppocrv5_dict.txt"

    if args.doctor:
        print(json.dumps(doctor(md), ensure_ascii=False))
        return

    if not args.image:
        ap.print_usage()
        sys.exit(2)

    try:
        ocr = PPOCRv5()
        lines, blocks = ocr.ocr(args.image)
    except Exception as e:
        print(json.dumps({"error": str(e), "model_dir": str(md)}, ensure_ascii=False))
        sys.exit(1)

    if args.full:
        print(json.dumps({"image": args.image, "lines": lines, "blocks": blocks}, ensure_ascii=False))
    else:
        print("\n".join(line["text"] for line in lines))


if __name__ == "__main__":
    main()
