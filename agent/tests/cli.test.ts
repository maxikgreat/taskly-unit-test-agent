import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('publishes an explicit failure artifact and makes zero requests when the key is absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskly-cli-'));
  try {
    const out = path.join(root, 'output');
    const run = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, fileURLToPath(new URL('../src/cli.ts', import.meta.url)), '--root', root, '--out', out], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 15000 });
    expect(run.status).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
    expect(report.status).toBe('failed');
    expect(report.summary).toContain('DEEPSEEK_API_KEY is not configured');
    expect(report.usage.requests).toBe(0);
    expect(JSON.parse(await readFile(path.join(out, 'proposal.json'), 'utf8'))).toEqual({ files: [] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
