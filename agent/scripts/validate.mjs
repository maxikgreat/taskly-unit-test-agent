// Run only in an ephemeral job WITHOUT AI secrets or a writable GitHub token.
// PR dependencies, tests, and coverage output remain untrusted in this process.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [sourceArg, proposalArg, outArg] = process.argv.slice(2);
const source = path.resolve(sourceArg);
const proposal = path.resolve(proposalArg);
const out = path.resolve(outArg);
mkdirSync(out, { recursive: true });
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', NO_COLOR: '1' };
const results = [];
let failed = false;
function command(label, executable, args, cwd) {
  const run = spawnSync(executable, args, { cwd, env, timeout: 180000, maxBuffer: 2000000, encoding: 'utf8' });
  const passed = run.status === 0 && !run.error;
  writeFileSync(path.join(out, `${label}.log`), (run.stdout || '') + (run.stderr || ''));
  results.push({ label, passed });
  if (!passed) failed = true;
  return passed;
}
function coverage(suite, stage) {
  try {
    const file = path.join(source, suite, 'coverage/coverage-summary.json');
    copyFileSync(file, path.join(out, `${stage}-${suite}.json`));
    const summary = JSON.parse(readFileSync(file, 'utf8')).total;
    return ['statements', 'branches', 'functions', 'lines'].map(k => {
      const value = Number(summary[k]?.pct);
      return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 'unavailable';
    });
  } catch { return ['unavailable', 'unavailable', 'unavailable', 'unavailable']; }
}
const metrics = {};
try {
  const initial = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source, env, encoding: 'utf8', timeout: 10000 });
  if (initial.status !== 0 || initial.stdout.trim()) throw new Error('Validation needs a clean source checkout');
  for (const suite of ['frontend', 'backend']) {
    const cwd = path.join(source, suite);
    if (!command(`install-${suite}`, 'npm', ['ci'], cwd)) throw new Error('Dependency installation failed');
    if (!command(`baseline-${suite}`, 'npm', ['run', 'test:coverage'], cwd)) throw new Error('Baseline tests failed; proposal not applied');
    metrics[`before-${suite}`] = coverage(suite, 'before');
  }
  // Run the trusted policy and CLI, not code supplied in the PR.
  if (!command('apply', process.execPath, [path.join(agent, 'node_modules/tsx/dist/cli.mjs'), path.join(agent, 'src/cli.ts'), '--root', source, '--apply', path.join(proposal, 'proposal.json')], agent)) throw new Error('Proposal policy rejected');
  for (const suite of ['frontend', 'backend']) {
    const cwd = path.join(source, suite);
    command(`typecheck-${suite}`, 'npm', ['run', 'typecheck'], cwd);
    const passed = command(`proposed-${suite}`, 'npm', ['run', 'test:coverage'], cwd);
    metrics[`after-${suite}`] = passed ? coverage(suite, 'after') : ['unavailable', 'unavailable', 'unavailable', 'unavailable'];
  }
  // Include new tests in the patch without staging content or committing.
  const files = JSON.parse(readFileSync(path.join(proposal, 'proposal.json'), 'utf8')).files;
  const status = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: source, env, encoding: 'utf8', timeout: 10000 });
  const allowed = new Set(files.map(f => f.path));
  if (status.status !== 0 || status.stdout.split('\0').filter(Boolean).some(entry => !allowed.has(entry.slice(3)))) throw new Error('Validation modified protected paths; patch export blocked');
  for (const file of files) command('intent-to-add', 'git', ['add', '--intent-to-add', '--', file.path], source);
  const diff = files.length ? spawnSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--', ...files.map(f => f.path)], { cwd: source, env, encoding: 'utf8', maxBuffer: 500000, timeout: 10000 }) : { status: 0, stdout: '' };
  if (diff.status !== 0) throw new Error('Patch export failed');
  writeFileSync(path.join(out, 'tests.patch'), diff.stdout);
} catch (error) {
  failed = true;
  results.push({ label: error instanceof Error ? error.message : 'Validation failed', passed: false });
} finally {
  const rows = Object.entries(metrics).map(([name, values]) => `| ${name} | ${values.join(' | ')} |`).join('\n');
  writeFileSync(path.join(out, 'summary.md'), `### Separate validation\n\nResult: **${failed ? 'failed' : 'passed'}**\n\n${results.map(r => `- ${r.label}: ${r.passed ? 'passed' : 'failed'}`).join('\n')}\n\nCoverage from the PR test configuration (untrusted, informational):\n\n| Suite/stage | Statements % | Branches % | Functions % | Lines % |\n|---|---|---|---|---|\n${rows}\n`);
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: failed ? 'failed' : 'passed', results, metrics }, null, 2));
  if (failed) process.exitCode = 1;
}
