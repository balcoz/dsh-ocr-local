#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 PP-OCRv5 ONNX 模型与字典到缓存目录（默认 ~/.dsh-ocr/models）。
模型来源：paddleocr-onnx 社区发布（PaddleOCR v5 官方模型导出），Apache-2.0 许可。
用法:
    python download_models.py            # 下载到 ~/.dsh-ocr/models
    DSH_OCR_MODELS=D:/models python download_models.py   # 自定义目录
"""
import os
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0"
FILES = {
    "PP-OCRv5_mobile_det.onnx": f"{BASE}/PP-OCRv5_mobile_det.onnx",
    "PP-OCRv5_mobile_rec.onnx": f"{BASE}/PP-OCRv5_mobile_rec.onnx",
}
DICT_URL = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt"

MODELS_DIR = Path(os.environ.get("DSH_OCR_MODELS") or Path.home() / ".dsh-ocr" / "models")


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  已存在，跳过: {dest.name}")
        return
    print(f"  下载 {dest.name} ...")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-ocr-local/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = done * 100 // total
                sys.stdout.write(f"\r    {pct}% ({done // 1024 // 1024}MB/{total // 1024 // 1024}MB)")
                sys.stdout.flush()
    sys.stdout.write("\n")
    tmp.rename(dest)
    print(f"  完成: {dest.name} ({dest.stat().st_size} 字节)")


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"模型目录: {MODELS_DIR}")
    for name, url in FILES.items():
        try:
            download(url, MODELS_DIR / name)
        except Exception as e:
            print(f"  失败 {name}: {e}", file=sys.stderr)
            return 1
    try:
        download(DICT_URL, MODELS_DIR / "ppocrv5_dict.txt")
    except Exception as e:
        print(f"  失败 ppocrv5_dict.txt: {e}", file=sys.stderr)
        return 1
    print("全部完成 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
