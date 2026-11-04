// QA-04: static checks for the Maestro flows in .maestro/, runnable without a simulator or Maestro.
//
//   npm --prefix qa/e2e ci && npm --prefix qa/e2e run lint
//
// Checks: every YAML file parses; a flow is `<config>\n---\n<commands>` with appId app.bonded.mobile;
// commands are known Maestro commands; runFlow / runScript files exist; every `id:` selector is a testID
// that exists in app/ or src/ (literal or template), unless it is a listed proposal.
// Plain TypeScript that Node 24 runs as is (type stripping).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const maestroDir = path.join(repoRoot, '.maestro');
const APP_ID = 'app.bonded.mobile';

/** testIDs a flow may use before mobile adds them (none today: MOB-32 named the D02 ones). */
export const PROPOSED_IDS = new Set<string>();

const COMMANDS = new Set([
  'launchApp', 'stopApp', 'killApp', 'clearState', 'clearKeychain', 'openLink', 'tapOn', 'doubleTapOn',
  'longPressOn', 'inputText', 'inputRandomText', 'eraseText', 'hideKeyboard', 'pressKey', 'back', 'scroll',
  'scrollUntilVisible', 'swipe', 'assertVisible', 'assertNotVisible', 'assertTrue', 'extendedWaitUntil',
  'waitForAnimationToEnd', 'runFlow', 'runScript', 'evalScript', 'retry', 'repeat', 'copyTextFrom',
  'pasteText', 'takeScreenshot', 'startRecording', 'stopRecording', 'setLocation', 'travel', 'addMedia',
  'setAirplaneMode', 'toggleAirplaneMode', 'setPermissions',
]);
const SELECTOR_KEYS = new Set(['id', 'text', 'point', 'index', 'enabled', 'checked', 'focused', 'selected', 'below', 'above', 'leftOf', 'rightOf', 'containsChild', 'childOf', 'optional']);

type TestIds = { literal: Set<string>; templates: RegExp[] };

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, keep, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

/** Every testID the app can render: literal strings, and template literals as regexes. */
export function collectTestIds(): TestIds {
  const literal = new Set<string>();
  const templates: RegExp[] = [];
  const files = ['app', 'src'].flatMap((d) => walk(path.join(repoRoot, d), (f) => /\.tsx?$/.test(f)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/testID(?:=|:\s*)(?:\{\s*)?["']([^"']+)["']/g)) literal.add(m[1]);
    for (const m of src.matchAll(/testID(?:=|:\s*)\{\s*(?:[\w.]+\s*&&\s*)?`([^`]+)`/g)) {
      const esc = m[1].split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      templates.push(new RegExp(`^${esc.join('.+')}$`));
    }
  }
  return { literal, templates };
}

/** `${SCREEN}-email` -> the ids it can become (SignInView screens). */
function expand(id: string): string[] {
  if (!id.includes('${')) return [id];
  if (id.includes('${SCREEN}')) return ['08', 'J4'].map((s) => id.replaceAll('${SCREEN}', s));
  // inviter-approve.yaml: the join request card on 10, 11 or the Today card (MOB-32).
  if (id.includes('${INVITER_SCREEN}')) return ['10', '11', 'today'].map((s) => id.replaceAll('${INVITER_SCREEN}', s));
  // auth/returning-sign-in.yaml (D40): a solo account lands on 10, a paired one on Today.
  if (id.includes('${LANDING}')) return ['10', 'today'].map((s) => id.replaceAll('${LANDING}', s));
  return [];
}

type Finding = { file: string; msg: string };

function checkCommands(file: string, cmds: unknown, ids: TestIds, found: Finding[], used: Set<string>) {
  if (!Array.isArray(cmds)) {
    found.push({ file, msg: 'commands document is not a list' });
    return;
  }
  for (const c of cmds) {
    const name = typeof c === 'string' ? c : c && typeof c === 'object' ? Object.keys(c)[0] : null;
    if (!name || !COMMANDS.has(name)) {
      found.push({ file, msg: `unknown command ${JSON.stringify(name ?? c)}` });
      continue;
    }
    if (typeof c === 'string') continue;
    const arg = (c as Record<string, unknown>)[name];
    if ((name === 'runFlow' || name === 'runScript') && (typeof arg === 'string' || (arg && typeof arg === 'object' && 'file' in arg))) {
      const ref = typeof arg === 'string' ? arg : String((arg as { file: string }).file);
      if (!fs.existsSync(path.resolve(path.dirname(file), ref))) found.push({ file, msg: `${name} file not found: ${ref}` });
    }
    if (arg && typeof arg === 'object') {
      const a = arg as Record<string, unknown>;
      if (Array.isArray(a.commands)) checkCommands(file, a.commands, ids, found, used);
      for (const key of ['visible', 'notVisible']) {
        if (a[key] && typeof a[key] === 'object') checkSelector(file, a[key] as Record<string, unknown>, ids, found, used);
      }
      if (['tapOn', 'assertVisible', 'assertNotVisible', 'copyTextFrom', 'longPressOn', 'doubleTapOn', 'scrollUntilVisible'].includes(name)) {
        checkSelector(file, (name === 'scrollUntilVisible' ? a.element : a) as Record<string, unknown>, ids, found, used);
      }
      if (name === 'extendedWaitUntil' && a.timeout === undefined) found.push({ file, msg: 'extendedWaitUntil without timeout' });
    }
  }
}

function checkSelector(file: string, sel: Record<string, unknown> | undefined, ids: TestIds, found: Finding[], used: Set<string>) {
  if (!sel) return;
  for (const k of Object.keys(sel)) {
    if (!SELECTOR_KEYS.has(k) && !['timeout', 'label', 'repeat', 'delay', 'waitToSettleTimeoutMs', 'retryTapIfNoChange', 'direction', 'element'].includes(k)) {
      found.push({ file, msg: `unknown selector key ${k}` });
    }
  }
  if (typeof sel.id !== 'string') {
    // A text selector that is exactly one parameter (`${ANSWER_A}`) checks data the runner supplies
    // (answer text for the reveal rule), not app copy; that is allowed. Literal copy is not.
    const dataOnly = typeof sel.text === 'string' && /^\$\{[A-Z_]+\}$/.test(sel.text);
    // iOS system UI (the "Open in <app>?" deep-link prompt) has no testID; allowed only in its subflow.
    const systemUi = (file.endsWith('subflows/accept-link-prompt.yaml') && sel.text === 'Open') || (file.endsWith('subflows/dismiss-link-prompt.yaml') && sel.text === 'Cancel') ||
      (file.endsWith('subflows/hide-keyboard.yaml') && sel.text === 'Done');
    if (sel.text !== undefined && sel.id === undefined && !dataOnly && !systemUi) found.push({ file, msg: `selects by text only (${String(sel.text)}): use a testID` });
    return;
  }
  const raw = sel.id;
  if (PROPOSED_IDS.has(raw)) return;
  const concrete = expand(raw);
  if (concrete.length === 0) {
    found.push({ file, msg: `id ${raw} has a parameter the lint cannot expand` });
    return;
  }
  for (const id of concrete) {
    used.add(id);
    if (!ids.literal.has(id) && !ids.templates.some((r) => r.test(id))) found.push({ file, msg: `testID not in app/ or src/: ${id}` });
  }
}

export function lint(): { files: number; flows: number; used: Set<string>; findings: Finding[] } {
  const ids = collectTestIds();
  const findings: Finding[] = [];
  const used = new Set<string>();
  const files = walk(maestroDir, (f) => /\.ya?ml$/.test(f));
  let flows = 0;
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const docs = parseAllDocuments(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(docs) ? docs : [docs];
    const errors = list.flatMap((d) => d.errors.map((e) => e.message));
    if (errors.length) {
      findings.push(...errors.map((msg) => ({ file: rel, msg: `YAML: ${msg}` })));
      continue;
    }
    if (path.basename(file) === 'config.yaml') continue;
    flows++;
    if (list.length !== 2) {
      findings.push({ file: rel, msg: `expected 2 YAML documents (config, commands), got ${list.length}` });
      continue;
    }
    const config = list[0].toJS() as Record<string, unknown> | null;
    if (!config || config.appId !== APP_ID) findings.push({ file: rel, msg: `appId must be ${APP_ID}` });
    checkCommands(file, list[1].toJS(), ids, findings, used);
  }
  for (const f of findings) f.file = path.relative(repoRoot, path.resolve(repoRoot, f.file));
  return { files: files.length, flows, used, findings };
}

if (import.meta.main) {
  const { files, flows, used, findings } = lint();
  for (const f of findings) console.error(`${f.file}: ${f.msg}`);
  console.log(`maestro lint: ${files} files, ${flows} flows, ${used.size} testIDs used, ${findings.length} findings`);
  process.exit(findings.length ? 1 : 0);
}
