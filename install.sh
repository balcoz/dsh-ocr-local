#!/usr/bin/env bash
# ============================================================
# dsh-ocr-local 一键安装（macOS / Linux）
# 1. Python 环境自举（venv + 依赖 + 模型，幂等）
# 2. 应用 cc-tui 粘图补丁（跨平台，可自定义粘图键）
# 3. 可选：注册到 dsh profile
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

# 1+2. Python 环境自举（建 venv → 装依赖 → 下模型，全部幂等）
#      若只需依赖不需要模型，可加 --no-models；走镜像可设 DSH_OCR_MODELS_MIRROR
echo ""
echo "[1/3] Python 环境（venv + 依赖 + 模型）..."
SETUP_ARGS=()
if [[ "$SKIP_MODELS" -eq 1 ]]; then SETUP_ARGS+=(--no-models); fi
python3 -X utf8 "$ROOT/ocr/setup.py" "${SETUP_ARGS[@]}" || { echo "环境安装失败，请检查网络或设置 DSH_OCR_MODELS_MIRROR"; exit 1; }

# 3. cc-tui 补丁（跨平台）
echo ""
echo "[2/3] 应用 cc-tui 粘图补丁（$KEY）..."
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
    echo "[3/3] 注册到 dsh profile: $PROFILE ..."
    dsh plugin --profile "$PROFILE" add "$ROOT" || {
        echo "dsh plugin add 失败——请手动把以下内容加入 profile 的 cordis.patch.yml："
        echo ""
        echo "- insert:"
        echo "    - id: ocr"
        echo "      name: 'dsh-ocr-local'"
    }
else
    echo "[3/3] 跳过 profile 注册（如需：--profile cc-tui 或 --profile web）"
fi

if [[ "$KEY" == "ctrl+v" ]]; then TEXT_KEY="ctrl+shift+v"; else TEXT_KEY="ctrl+v"; fi

echo ""
echo "安装完成。"
echo "  - 粘图键: $KEY"
echo "  - 文本粘贴键: $TEXT_KEY"
echo "  - 测试: ~/.dsh-ocr/venv/bin/python \"$ROOT/ocr/ocr.py\" <图片路径>"
echo "  - 诊断: ~/.dsh-ocr/venv/bin/python \"$ROOT/ocr/ocr.py\" --doctor"
echo "  - 重启 cc-tui 后生效"
