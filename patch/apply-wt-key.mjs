// apply-wt-key.mjs
// Manage the Windows Terminal keybinding that turns the chosen paste key into
// a sendInput of \x16 (Ctrl+V's ASCII code), so the key reaches the TUI app
// instead of the terminal's own paste. Keeps a backup before writing.
//
// Usage:
//   node apply-wt-key.mjs [--key ctrl+v|ctrl+shift+v|alt+v] [--file <settings.json>] [--dry-run]
//
//   --file   target settings.json (default: the user's Windows Terminal LocalState file)
//   --dry-run  print the resulting keybindings without writing
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const keyArg = (args.find(a => a.startsWith('--key='))?.split('=')[1]) ??
               (args.includes('--key') ? args[args.indexOf('--key') + 1] : null) ?? 'ctrl+v';
const dryRun = args.includes('--dry-run');
const fileIdx = args.indexOf('--file');
const FILE = fileIdx >= 0 ? args[fileIdx + 1]
  : 'C:/Users/caoke/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json';

const KEY = String(keyArg).toLowerCase();
const VALID = ['ctrl+v', 'ctrl+shift+v', 'alt+v'];
if (!VALID.includes(KEY)) {
  console.error(`不支持的粘图键: ${keyArg}（可选: ${VALID.join(' / ')}）`);
  process.exit(1);
}

// 粘图键 -> 该键绑定 sendInput \x16；文本粘贴备用键
const PASTE_BACKUP = KEY === 'ctrl+v' ? 'ctrl+shift+v' : 'ctrl+v';

if (!existsSync(FILE)) {
  console.error(`settings.json 不存在: ${FILE}`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(FILE, 'utf8');
} catch (e) {
  console.error(`读取失败: ${e.message}`);
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch (e) {
  console.error(`settings.json 不是合法 JSON（可能含注释）：${e.message}`);
  console.error('请手动在 keybindings 中添加：');
  console.error(JSON.stringify([{ command: { action: 'sendInput', input: '\u0016' }, keys: KEY }], null, 4));
  process.exit(1);
}

if (!Array.isArray(cfg.keybindings)) cfg.keybindings = [];

// 移除所有旧的 sendInput \x16 绑定与 paste 绑定，重建为目标的键位组合。
// 兼容两种形式：内联 command 对象，以及 WT 规范化后的 id 引用
// （User.paste / User.sendInput.xxxx）。
cfg.keybindings = cfg.keybindings.filter(kb => {
  const id = String(kb.id ?? '');
  const cmd = kb.command;
  const isPaste =
    cmd === 'paste' ||
    (cmd && typeof cmd === 'object' && cmd.action === 'paste') ||
    id.startsWith('User.paste');
  const isSendInput16 =
    (cmd && typeof cmd === 'object' && cmd.action === 'sendInput' && cmd.input === '\u0016') ||
    id.startsWith('User.sendInput');
  return !(isPaste || isSendInput16);
});

// 新绑定
cfg.keybindings.push({ command: { action: 'sendInput', input: '\u0016' }, keys: KEY });
cfg.keybindings.push({ command: 'paste', keys: PASTE_BACKUP });

const out = JSON.stringify(cfg, null, 4) + '\n';

if (dryRun) {
  console.log(`dry-run: 将写入 ${FILE}`);
  console.log(`粘图键: ${KEY} -> sendInput \\u0016`);
  console.log(`文本粘贴键: ${PASTE_BACKUP} -> paste`);
  console.log('--- 最终 keybindings ---');
  console.log(JSON.stringify(cfg.keybindings, null, 2));
} else {
  const bak = FILE + '.bak';
  copyFileSync(FILE, bak);
  writeFileSync(FILE, out, 'utf8');
  console.log(`已更新 ${FILE}（备份: ${bak}）`);
  console.log(`粘图键: ${KEY} -> sendInput \\u0016`);
  console.log(`文本粘贴键: ${PASTE_BACKUP} -> paste`);
  console.log('Windows Terminal 会自动热重载，无需重启。');
}
