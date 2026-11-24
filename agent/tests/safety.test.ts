import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, symlink, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { applyProposal, readSource, validateProposal, sourceFiles } from '../src/safety.ts';
import { configuration } from '../src/config.ts';

let root: string;
const content = "import { it, expect } from 'vitest'; it('works', () => expect(true).toBe(true));";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'taskly-policy-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it.each(['../escape.agent.test.ts', '/tmp/escape.agent.test.ts', 'backend/src/main.ts', '.github/workflows/check.agent.test.ts', 'frontend/package.json', 'backend/tests/old.test.ts', 'backend/tests/../src/main.agent.test.ts', 'backend\\tests\\x.agent.test.ts'])('rejects forbidden writes: %s', (file) => {
  expect(() => validateProposal({ files: [{ path: file, content }] })).toThrow();
});
it.each(['it.skip(', 'test.only(', 'describe.todo(', "import 'node:child_process'", 'process.env.KEY', '/* v8 ignore next */'])('rejects disabling and dangerous constructs: %s', (bad) => {
  expect(() => validateProposal({ files: [{ path: 'backend/tests/x.agent.test.ts', content: `${content}\n${bad}` }] })).toThrow();
});
it('validates the entire proposal before writing any file', async () => {
  await expect(applyProposal(root, { files: [{ path: 'backend/tests/valid.agent.test.ts', content }, { path: 'backend/src/main.ts', content }] })).rejects.toThrow();
  await expect(readFile(path.join(root, 'backend/tests/valid.agent.test.ts'))).rejects.toThrow();
});
it('rejects symlinked parents and files', async () => {
  await mkdir(path.join(root, 'backend'));
  await symlink(tmpdir(), path.join(root, 'backend/tests'));
  await expect(applyProposal(root, { files: [{ path: 'backend/tests/x.agent.test.ts', content }] })).rejects.toThrow('Symlinks');
});
it('applies approved tests and discovers sources without following links', async () => {
  await applyProposal(root, { files: [{ path: 'backend/tests/x.agent.test.ts', content }] });
  await symlink(tmpdir(), path.join(root, 'backend/tests/link'));
  expect(await sourceFiles(root)).toEqual(['backend/tests/x.agent.test.ts']);
  expect(await readSource(root, 'backend/tests/x.agent.test.ts')).toBe(content);
});
it('rejects excessive files, duplicate paths and oversized content', () => {
  const file = { path: 'backend/tests/x.agent.test.ts', content };
  expect(() => validateProposal({ files: [file, file] })).toThrow();
  expect(() => validateProposal({ files: Array.from({ length: 11 }, (_, i) => ({ ...file, path: `backend/tests/x${i}.agent.test.ts` })) })).toThrow();
  expect(() => validateProposal({ files: [{ ...file, content: 'x'.repeat(30001) }] })).toThrow();
});
it('refuses to read symlinked source or credential files', async () => {
  await mkdir(path.join(root, 'backend/src'), { recursive: true });
  await writeFile(path.join(root, '.env'), 'TEST_SECRET=value');
  await symlink(path.join(root, '.env'), path.join(root, 'backend/src/leak.ts'));
  await expect(readSource(root, 'backend/src/leak.ts')).rejects.toThrow('Symlinks');
  await expect(readSource(root, '.env')).rejects.toThrow();
});
it('uses requested DeepSeek defaults and validates numeric controls', () => {
  expect(configuration({})).toMatchObject({ model: 'deepseek-v4-pro', maxIterations: 24 });
  expect(configuration({ DEEPSEEK_MODEL: 'compatible-model' }).model).toBe('compatible-model');
  for (const value of ['0', '-1', 'NaN', '1.5', '101']) expect(() => configuration({ AGENT_MAX_ITERATIONS: value })).toThrow();
});
