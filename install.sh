#!/usr/bin/env bash
# ============================================================
# dsh-ocr-local 一键安装（macOS / Linux）
# 1. 安装 Python 依赖（onnxruntime/numpy/opencv）
# 2. 下载 PP-OCRv5 模型到 ~/.dsh-ocr/models
# 3. 应用 cc-tui 粘图补丁（跨平台，可自定义粘图键）
# 4. 可选：注册到 dsh profile
#
# 用法:
#   ./install.sh --profile cc-tui
#   ./install.sh --profile cc-tui --key ctrl+v
#   ./install.sh --key alt+v --skip-models
#
# --key 可选：ctrl+v（默认）| ctrl+shift+v | alt+v
# macOS：Ctrl+V 在 Terminal.app / iTerm2 的 raw mode 下直达应用，无需终端配置。
# Linux：多数终端（gnome-terminal 等）会拦截 Ctrl+V 做粘贴，
#        若粘贴图片没反应，改用 --key alt+v。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROFILE=""
KEY="ctrl+v"
SKIP_MODELS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile) PROFILE="$2"; shift 2 ;;
        --key) KEY="$2"; shift 2 ;;
        --skip-models) SKIP_MODELS=1; shift ;;
        -h|--help) grep '^#' "$0" | sed 's/^# //'; exit 0 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

case "$KEY" in
    ctrl+v|ctrl+shift+v|alt+v) ;;
    *) echo "粘图键不支持: $KEY（可选: ctrl+v / ctrl+shift+v / alt+v）"; exit 1 ;;
esac

echo "======================================"
echo " dsh-ocr-local 安装 (macOS/Linux)"
echo "======================================"
echo "粘图键: $KEY"

# 1. Python 依赖
echo ""
echo "[1/4] Python 依赖..."
if python3 -c "import onnxruntime, numpy, cv2" 2>/dev/null; then
    echo "  依赖已就绪"
else
    echo "  安装 onnxruntime numpy opencv-python-headless ..."
    python3 -m pip install onnxruntime numpy opencv-python-headless
fi

# 2. 模型
if [[ "$SKIP_MODELS" -eq 0 ]]; then
    echo ""
    echo "[2/4] 模型下载（~/.dsh-ocr/models）..."
    python3 -X utf8 "$ROOT/ocr/download_models.py" || { echo "模型下载失败，请检查网络"; exit 1; }
else
    echo "[2/4] 跳过模型下载"
fi

# 3. cc-tui 补丁（跨平台）
echo ""
echo "[3/4] 应用 cc-tui 粘图补丁（$KEY）..."
node "$ROOT/patch/apply-cc-tui-patch.mjs" --key "$KEY"
if [[ $? -ne 0 ]]; then echo "cc-tui 补丁失败"; exit 1; fi

# macOS: 无需终端键绑定（Ctrl+V 直达应用）
# Linux: 若终端拦截粘图键，README 有说明
case "$(uname -s)" in
    Darwin) echo "  macOS: 无需终端配置（Ctrl+V 直达应用）；Cmd+V 保持系统文本粘贴" ;;
    Linux)  echo "  Linux: 若终端拦截粘图键导致无反应，请用 --key alt+v 重装" ;;
esac

# 4. profile 注册
if [[ -n "$PROFILE" ]]; then
    echo ""
    echo "[4/4] 注册到 dsh profile: $PROFILE ..."
    dsh plugin --profile "$PROFILE" add "$ROOT" || {
        echo "dsh plugin add 失败——请手动把以下内容加入 profile 的 cordis.patch.yml："
        echo ""
        echo "- insert:"
        echo "    - id: ocr"
        echo "      name: 'dsh-ocr-local'"
    }
else
    echo "[4/4] 跳过 profile 注册（如需：--profile cc-tui 或 --profile web）"
fi

if [[ "$KEY" == "ctrl+v" ]]; then TEXT_KEY="ctrl+shift+v"; else TEXT_KEY="ctrl+v"; fi

echo ""
echo "安装完成。"
echo "  - 粘图键: $KEY"
echo "  - 文本粘贴键: $TEXT_KEY"
echo "  - 测试: python3 \"$ROOT/ocr/ocr.py\" <图片路径>"
echo "  - 重启 cc-tui 后生效"
