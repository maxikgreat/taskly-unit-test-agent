import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Commands are simulated here: these tests verify the validator's trust boundary,
// not application test execution (which is verified separately in Docker).
it.each(['replace-proposal', 'change-staged-test'])('protects the proposal from PR command attack: %s', async (attack) => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskly-validator-'));
  try {
    const source = path.join(root, 'source');
    const proposal = path.join(root, 'proposal');
    const out = path.join(root, 'out');
    const bin = path.join(root, 'bin');
    for (const dir of [path.join(source, 'backend/tests'), path.join(source, 'frontend'), proposal, bin]) await mkdir(dir, { recursive: true });
    const file = { path: 'backend/tests/staged.agent.test.ts', content: "import { it, expect } from 'vitest'; it('retains the assertion', () => expect(true).toBe(true));" };
    const proposalFile = path.join(proposal, 'proposal.json');
    await writeFile(proposalFile, JSON.stringify({ files: [file] }));
    const gitArgs = path.join(root, 'diff-args.json');
    await writeFile(path.join(bin, 'npm'), `#!${process.execPath}\nconst fs = require('node:fs');
if (${JSON.stringify(attack)} === 'replace-proposal') fs.writeFileSync(${JSON.stringify(proposalFile)}, JSON.stringify({ files: [{path:'backend/src/main.ts',content:'forbidden'}] }));
if (${JSON.stringify(attack)} === 'change-staged-test' && process.argv.includes('typecheck')) fs.writeFileSync(${JSON.stringify(path.join(source, file.path))}, 'changed during execution');
`, { mode: 0o755 });
    await writeFile(path.join(bin, 'git'), `#!${process.execPath}\nconst fs = require('node:fs');
if (process.argv[2] === 'status' && process.argv.includes('-z')) process.stdout.write('?? backend/tests/staged.agent.test.ts\\0');
if (process.argv[2] === 'diff') { fs.writeFileSync(${JSON.stringify(gitArgs)}, JSON.stringify(process.argv)); process.stdout.write('mock patch'); }
`, { mode: 0o755 });
    const run = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url)), source, proposal, out], { env: { PATH: bin, HOME: root }, encoding: 'utf8', timeout: 15000 });
    const result = JSON.parse(await readFile(path.join(out, 'result.json'), 'utf8'));
    if (attack === 'replace-proposal') {
      expect(run.status).toBe(0);
      expect(result.status).toBe('passed');
      expect(await readFile(path.join(source, file.path), 'utf8')).toBe(file.content);
      expect(await readFile(gitArgs, 'utf8')).toContain(file.path);
      expect(await readFile(gitArgs, 'utf8')).not.toContain('backend/src/main.ts');
    } else {
      expect(run.status).toBe(1);
      expect(result.status).toBe('failed');
      expect(result.results.at(-1).label).toContain('Execution changed proposed tests');
      await expect(readFile(path.join(out, 'tests.patch'))).rejects.toThrow();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
