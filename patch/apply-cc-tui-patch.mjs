// apply-cc-tui-patch.mjs
// Apply/refresh the dsh-cc-tui clipboard-image patch (cross-platform), with a
// configurable paste key. Idempotent; upgrades old Windows-only patches.
//
// Usage:
//   node apply-cc-tui-patch.mjs [--key ctrl+v|ctrl+shift+v|alt+v] [--cc-tui-dir <dir>] [--dry-run]
//
//   --key        paste key that triggers image-paste (default: ctrl+v).
//   --dry-run    print what would change without writing files.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const keyArg = (args.find(a => a.startsWith('--key='))?.split('=')[1]) ??
               (args.includes('--key') ? args[args.indexOf('--key') + 1] : null) ?? 'ctrl+v';
const dryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--cc-tui-dir');
const CC_TUI_DIR = dirIdx >= 0 ? args[dirIdx + 1] : 'C:/Users/caoke/.dsh/profiles/cc-tui/node_modules/dsh-cc-tui';
const CLIPBOARD = join(CC_TUI_DIR, 'lib/types/utils/clipboard.js');
const PROMPT = join(CC_TUI_DIR, 'lib/types/components/PromptInput.js');

const KEY = String(keyArg).toLowerCase();
const VALID = ['ctrl+v', 'ctrl+shift+v', 'alt+v'];
if (!VALID.includes(KEY)) {
  console.error(`不支持的粘图键: ${keyArg}（可选: ${VALID.join(' / ')}）`);
  process.exit(1);
}

const KEY_CONDITIONS = {
  'ctrl+v':       "if (key.ctrl && input === 'v') {",
  'ctrl+shift+v': "if (key.ctrl && key.shift && input === 'v') {",
  'alt+v':        "if (key.meta && input === 'v') {",
};

let changed = false;
const applyWrite = (path, src) => { if (!dryRun) writeFileSync(path, src, 'utf8'); };

console.log(`粘图键: ${KEY}`);
console.log(`dry-run: ${dryRun}`);
console.log(`cc-tui 目录: ${CC_TUI_DIR}`);
console.log('');

// =====================================================================
// 1. clipboard.js —— 平台分派版 readClipboard（win32/darwin/linux）
// =====================================================================
const PS_SCRIPT_JS = [
  '"$ErrorActionPreference=\'SilentlyContinue\'"',
  '"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8"',
  "'$files=$null'",
  "'try { $files = Get-Clipboard -Format FileDropList -ErrorAction Stop } catch {}'",
  "'if($files){foreach($f in $files){Write-Output (\"FILE:\"+$f.FullName)}}'",
  "'if(-not $files){'",
  "'  $img = Get-Clipboard -Format Image -ErrorAction SilentlyContinue'",
  "'  if($null -ne $img){'",
  "'    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue'",
  "'    $now = Get-Date'",
  "'    $name = $now.ToString(\"yyyyMMdd-HHmmss\") + \".\" + (\"{0:D7}\" -f ($now.Ticks % 10000000)) + \"-1.png\"'",
  "'    $dir = \"C:\\Users\\caoke\\.dsh\\ocr\\cache\"'",
  "'    if(-not (Test-Path $dir)){ New-Item -ItemType Directory -Path $dir -Force | Out-Null }'",
  "'    $target = Join-Path $dir $name'",
  "'    try { $bmp = New-Object System.Drawing.Bitmap $img; $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); Write-Output (\"IMG:\"+$target) } catch {}'",
  "'  } else {'",
  "'    $t=Get-Clipboard -Raw; if($null -ne $t){Write-Output (\"TEXT64:\"+[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t)))}'",
  "'  }'",
  "'}'",
].join(';\n');

const MAC_SCRIPT = [
  'DIR="$HOME/.dsh/ocr/cache"; mkdir -p "$DIR"',
  'NAME=$(date +%Y%m%d-%H%M%S).$(date +%N | cut -c1-7)-1.png',
  'OUT="$DIR/$NAME"',
  // osascript: 剪贴板 PNG 数据写入临时文件
  'osascript -e "set f to POSIX file \\"$OUT\\"" -e \'set d to the clipboard as «class PNGf»\' -e \'set fd to open for access f with write permission\' -e \'write d to fd\' -e \'close access fd\' >/dev/null 2>&1',
  'if [ -s "$OUT" ]; then echo "IMG:$OUT"; else',
  '  TXT=$(pbpaste 2>/dev/null); if [ -n "$TXT" ]; then echo "TEXT64:$(printf %s "$TXT" | base64)"; fi',
  'fi',
].join('\n');

const LINUX_SCRIPT = [
  'DIR="$HOME/.dsh/ocr/cache"; mkdir -p "$DIR"',
  'NAME=$(date +%Y%m%d-%H%M%S).$(date +%N | cut -c1-7)-1.png',
  'OUT="$DIR/$NAME"',
  'if xclip -selection clipboard -t image/png -o > "$OUT" 2>/dev/null && [ -s "$OUT" ]; then echo "IMG:$OUT"; else',
  '  rm -f "$OUT"',
  '  TXT=$(xclip -selection clipboard -o 2>/dev/null); if [ -n "$TXT" ]; then echo "TEXT64:$(printf %s "$TXT" | base64)"; fi',
  'fi',
].join('\n');

// 新版 readClipboard（整体替换，兼容旧补丁升级）
const NEW_READ_CLIPBOARD = `
const PS_SCRIPT = [
${PS_SCRIPT_JS}
].join('; ');

const MAC_SCRIPT = \`${MAC_SCRIPT}\`;

const LINUX_SCRIPT = \`${LINUX_SCRIPT}\`;

function platformClipboardCommand() {
  if (process.platform === 'win32') {
    return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT] };
  }
  if (process.platform === 'darwin') {
    return { cmd: 'bash', args: ['-lc', MAC_SCRIPT] };
  }
  if (process.platform === 'linux') {
    return { cmd: 'bash', args: ['-lc', LINUX_SCRIPT] };
  }
  return null;
}

export function readClipboard() {
    return new Promise(resolve => {
        let attempts = 0;
        const attempt = () => {
            attempts += 1;
            const pc = platformClipboardCommand();
            if (!pc) { resolve(null); return; }
            const child = execFile(pc.cmd, pc.args, { encoding: 'utf8', windowsHide: true, timeout: 3000 }, (error, stdout) => {
                if (error) {
                    if (attempts < 3) {
                        setTimeout(attempt, 150);
                        return;
                    }
                    resolve(null);
                    return;
                }
                const files = [];
                const texts = [];
                const images = [];
                for (const line of stdout.split(/\\r?\\n/)) {
                    if (line.startsWith('FILE:'))
                        files.push(line.slice(5));
                    else if (line.startsWith('IMG:'))
                        images.push(line.slice(4));
                    else if (line.startsWith('TEXT64:')) {
                        texts.push(Buffer.from(line.slice(7), 'base64').toString('utf8'));
                    }
                }
                if (files.length > 0)
                    resolve({ kind: 'files', paths: files });
                else if (images.length > 0)
                    resolve({ kind: 'image', path: images[0] });
                else if (texts.length > 0)
                    resolve({ kind: 'text', text: texts.join('\\n') });
                else
                    resolve(null);
            });
            child.unref();
        };
        attempt();
    });
}`;

let clip = readFileSync(CLIPBOARD, 'utf8');
const MARK_NEW = "function platformClipboardCommand()";
const MARK_OLD = "'IMG:'";

if (clip.includes(MARK_NEW)) {
  console.log('  [clipboard.js] 已是跨平台补丁，跳过。');
} else if (!clip.includes(MARK_OLD)) {
  // 原版（未打补丁）：替换 readClipboard + 加 formatClipboardInsert 的 image 分支
  const re = /export function readClipboard\(\) \{[\s\S]*?\n\}/;
  if (!re.test(clip)) { console.error('  [clipboard.js] 未找到原版 readClipboard，请人工检查。'); process.exit(1); }
  clip = clip.replace(re, NEW_READ_CLIPBOARD.trimStart());
  const old5 = "export function formatClipboardInsert(content) {\n    if (content.kind === 'files') {";
  const new5 = "export function formatClipboardInsert(content) {\n    if (content.kind === 'image') {\n        return content.path;\n    }\n    if (content.kind === 'files') {";
  if (clip.includes(old5)) clip = clip.replace(old5, new5);
  applyWrite(CLIPBOARD, clip);
  changed = true;
  console.log('  [clipboard.js] 跨平台补丁已应用（win32/darwin/linux）。');
} else {
  // 旧 Windows-only 补丁：整体升级（替换 readClipboard 函数体）
  const re = /export function readClipboard\(\) \{[\s\S]*?\n\}/;
  if (!re.test(clip)) { console.error('  [clipboard.js] 旧补丁升级失败：未找到 readClipboard。'); process.exit(1); }
  clip = clip.replace(re, NEW_READ_CLIPBOARD.trimStart());
  applyWrite(CLIPBOARD, clip);
  changed = true;
  console.log('  [clipboard.js] 已从 Windows-only 补丁升级为跨平台补丁。');
}

// =====================================================================
// 2. PromptInput.js —— 粘图键条件
// =====================================================================
let prompt = readFileSync(PROMPT, 'utf8');
const targetCond = KEY_CONDITIONS[KEY];
let found = null;
for (const [k, cond] of Object.entries(KEY_CONDITIONS)) {
  if (prompt.includes(cond)) { found = k; break; }
}
if (KEY === 'ctrl+v') {
  if (found && found !== 'ctrl+v') {
    prompt = prompt.replace(KEY_CONDITIONS[found], KEY_CONDITIONS['ctrl+v']);
    applyWrite(PROMPT, prompt);
    changed = true;
    console.log(`  [PromptInput.js] 键条件 ${found} -> ctrl+v`);
  } else {
    console.log('  [PromptInput.js] 键条件已是 ctrl+v，无需改动。');
  }
} else if (found === KEY) {
  console.log(`  [PromptInput.js] 键条件已是 ${KEY}，无需改动。`);
} else if (found) {
  prompt = prompt.replace(KEY_CONDITIONS[found], targetCond);
  applyWrite(PROMPT, prompt);
  changed = true;
  console.log(`  [PromptInput.js] 键条件 ${found} -> ${KEY}`);
} else {
  console.error('  [PromptInput.js] 未找到任何已知键条件，请人工检查。');
  process.exit(1);
}

console.log('');
console.log(changed
  ? (dryRun ? 'dry-run 结束（未写入任何文件）。' : '补丁已应用。重启 cc-tui 生效。')
  : '无需改动。');
