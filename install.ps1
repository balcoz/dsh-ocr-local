# ============================================================
# dsh-ocr-local 一键安装（Windows）
# 1. 安装 Python 依赖（onnxruntime/numpy/opencv）
# 2. 下载 PP-OCRv5 模型到 ~/.dsh-ocr/models
# 3. 应用 cc-tui 粘图补丁（可自定义粘图键）
# 4. 更新 Windows Terminal 键绑定
# 5. 可选：注册到 dsh profile
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Profile cc-tui
#   powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey ctrl+shift+v
#   powershell -ExecutionPolicy Bypass -File install.ps1 -PasteKey alt+v -Profile web
#   -Profile 指定注册到哪个 dsh profile：cc-tui / web（两端都用就分别跑两次）
#
# -PasteKey 可选：ctrl+v（默认）| ctrl+shift+v | alt+v
# ============================================================
param(
    [string]$Profile = "",
    [string]$PasteKey = "ctrl+v",
    [switch]$SkipModels,
    [switch]$SkipPatch
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "======================================"
Write-Host " dsh-ocr-local 安装"
Write-Host "======================================"

if ($PasteKey -notin @("ctrl+v", "ctrl+shift+v", "alt+v")) {
    Write-Host "粘图键不支持: $PasteKey（可选: ctrl+v / ctrl+shift+v / alt+v）"
    exit 1
}

# 1. Python 依赖
Write-Host ""
Write-Host "[1/5] Python 依赖..."
python -c "import onnxruntime, numpy, cv2" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  安装 onnxruntime numpy opencv-python-headless ..."
    pip install onnxruntime numpy opencv-python-headless
} else {
    Write-Host "  依赖已就绪"
}

# 2. 模型
if (-not $SkipModels) {
    Write-Host ""
    Write-Host "[2/5] 模型下载（~/.dsh-ocr/models）..."
    python -X utf8 "$root\ocr\download_models.py"
    if ($LASTEXITCODE -ne 0) { Write-Host "模型下载失败，请检查网络"; exit 1 }
} else {
    Write-Host "[2/5] 跳过模型下载"
}

# 3+4. cc-tui 补丁 + WT 键绑定
if (-not $SkipPatch) {
    Write-Host ""
    Write-Host "[3/5] 应用 cc-tui 粘图补丁（粘图键: $PasteKey）..."
    node "$root\patch\apply-cc-tui-patch.mjs" --key $PasteKey
    if ($LASTEXITCODE -ne 0) { Write-Host "cc-tui 补丁失败"; exit 1 }

    Write-Host ""
    Write-Host "[4/5] 更新 Windows Terminal 键绑定..."
    node "$root\patch\apply-wt-key.mjs" --key $PasteKey
    if ($LASTEXITCODE -ne 0) { Write-Host "WT 键绑定更新失败"; exit 1 }
} else {
    Write-Host "[3/5] 跳过补丁"
    Write-Host "[4/5] 跳过补丁"
}

# 5. profile 注册
if ($Profile) {
    Write-Host ""
    Write-Host "[5/5] 注册到 dsh profile: $Profile ..."
    dsh plugin --profile $Profile add $root
    if ($LASTEXITCODE -ne 0) {
        Write-Host "dsh plugin add 失败——请手动把以下内容加入 profile 的 cordis.patch.yml："
        Write-Host ""
        Write-Host "- insert:"
        Write-Host "    - id: ocr"
        Write-Host "      name: 'dsh-ocr-local'"
    }
} else {
    Write-Host "[5/5] 跳过 profile 注册（如需：-Profile cc-tui 或 -Profile web）"
}

if ($PasteKey -eq "ctrl+v") { $textKey = "ctrl+shift+v" } else { $textKey = "ctrl+v" }

Write-Host ""
Write-Host "安装完成。"
Write-Host "  - 粘图键: $PasteKey（截图后按此键，路径自动插入输入框）"
Write-Host "  - 文本粘贴键: $textKey"
Write-Host "  - 测试: python $root\ocr\ocr.py <图片路径>"
Write-Host "  - 重启 cc-tui / WT 后生效"
