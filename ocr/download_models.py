#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 PP-OCRv5 ONNX 模型与字典到缓存目录（默认 ~/.dsh-ocr/models）。

特点：
- sha256 校验：已存在且校验通过则跳过；损坏/不完整文件自动删除重下
- 镜像支持：DSH_OCR_MODELS_MIRROR 指定镜像前缀（ghproxy 风格，直接拼在原 URL 前）
- 原子写入：先写 .part 再 rename，中断不会留下半截"可用"文件
- 自动重试：单文件最多 3 次

用法:
    python download_models.py                 # 下载到 ~/.dsh-ocr/models
    python download_models.py --model-dir D   # 自定义目录
    DSH_OCR_MODELS_MIRROR=https://ghproxy.com/ python download_models.py

模型来源：paddleocr-onnx 社区发布（PaddleOCR v5 官方模型导出），Apache-2.0 许可。
"""
import argparse
import hashlib
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0"
DICT_URL = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt"

# 文件 -> (默认 URL, sha256)。镜像通过环境变量 DSH_OCR_MODELS_MIRROR 注入。
MANIFEST = {
    "PP-OCRv5_mobile_det.onnx": (
        f"{BASE}/PP-OCRv5_mobile_det.onnx",
        "ca3014670099126189c9519ef770470c03bf41695fb138c6bc19737bd4ba2875",
    ),
    "PP-OCRv5_mobile_rec.onnx": (
        f"{BASE}/PP-OCRv5_mobile_rec.onnx",
        "64ea1b54ea0506609378a3638ff5b2547af7e24809b890e501fb0cce54de21f7",
    ),
    "ppocrv5_dict.txt": (
        DICT_URL,
        "d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b",
    ),
}

MODELS_DIR = Path(os.environ.get("DSH_OCR_MODELS") or Path.home() / ".dsh-ocr" / "models")
RETRIES = 3


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(256 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def effective_url(url: str) -> str:
    mirror = os.environ.get("DSH_OCR_MODELS_MIRROR", "").strip().rstrip("/")
    return f"{mirror}/{url}" if mirror else url


def download(url: str, dest: Path, expected_sha: str) -> bool:
    if dest.exists():
        try:
            if dest.stat().st_size > 0 and sha256_of(dest) == expected_sha:
                print(f"  已存在且校验通过，跳过: {dest.name}")
                return True
            print(f"  文件损坏（sha256 不匹配），重新下载: {dest.name}")
            dest.unlink()
        except OSError as e:
            print(f"  校验失败: {dest.name}: {e}", file=sys.stderr)
            return False

    url = effective_url(url)
    for attempt in range(1, RETRIES + 1):
        tmp = dest.with_suffix(dest.suffix + f".part{attempt}")
        try:
            print(f"  下载 {dest.name} (尝试 {attempt}/{RETRIES}) ...")
            req = urllib.request.Request(url, headers={"User-Agent": "dsh-ocr-local/0.3.1"})
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
            actual = sha256_of(tmp)
            if actual != expected_sha:
                print(f"  sha256 不匹配（期望 {expected_sha[:12]}…，实际 {actual[:12]}…），重试", file=sys.stderr)
                tmp.unlink(missing_ok=True)
                continue
            tmp.rename(dest)
            print(f"  完成: {dest.name} ({dest.stat().st_size} 字节)")
            return True
        except Exception as e:
            tmp.unlink(missing_ok=True)
            print(f"  失败: {dest.name}: {e}", file=sys.stderr)
            if attempt < RETRIES:
                time.sleep(1)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="下载 PP-OCRv5 ONNX 模型（含 sha256 校验）")
    ap.add_argument("--model-dir", default=str(MODELS_DIR), help="模型缓存目录")
    args = ap.parse_args()
    md = Path(args.model_dir)
    md.mkdir(parents=True, exist_ok=True)
    print(f"模型目录: {md}")
    ok = True
    for name, (url, sha) in MANIFEST.items():
        if not download(url, md / name, sha):
            ok = False
    if ok:
        print("全部完成 ✓")
        return 0
    print("存在失败项，请检查网络或设置 DSH_OCR_MODELS_MIRROR", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
