import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration } from './config.ts';
import { deepSeek } from './llm.ts';
import { runAgent, initialReport } from './agent.ts';
import { markdownReport } from './report.ts';
import { applyProposal, redact } from './safety.ts';
import { dockerRunner } from './runner.ts';

async function main() {
  const { values } = parseArgs({ options: { root: { type: 'string', default: '..' }, base: { type: 'string' }, head: { type: 'string' }, out: { type: 'string', default: '../.agent-output' }, apply: { type: 'string' }, execute: { type: 'boolean', default: false } } });
  const root = path.resolve(values.root);
  if (values.apply) {
    await applyProposal(root, JSON.parse(await readFile(values.apply, 'utf8')));
    console.log('Validated proposal applied to approved test paths. Tests still require execution.');
    return;
  }
  if (!!values.base !== !!values.head) throw new Error('Supply both --base and --head');
  const config = configuration();
  const result = process.env.DEEPSEEK_API_KEY
    ? await runAgent({ root, config, llm: deepSeek(config), base: values.base, head: values.head, runner: values.execute ? dockerRunner(root, config.testTimeoutMs) : undefined })
    : { proposal: { files: [] }, report: initialReport('DEEPSEEK_API_KEY is not configured. No live model request or test generation occurred.') };
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'proposal.json'), redact(JSON.stringify(result.proposal, null, 2)));
  await writeFile(path.join(out, 'report.json'), redact(JSON.stringify(result.report, null, 2)));
  await writeFile(path.join(out, 'report.md'), markdownReport(result.report));
  console.log(`Agent status: ${result.report.status}; ${result.report.files.length} test files; ${result.report.usage.totalTokens} API tokens. Artifacts: ${out}`);
  if (result.report.status === 'failed') process.exitCode = 1;
}
main().catch(() => { console.error('Agent command failed. Check configuration, credentials, paths and limits. No raw provider error is logged.'); process.exitCode = 1; });
