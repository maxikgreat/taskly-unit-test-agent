import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
import { dockerRunner } from '../src/runner.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'runner-test-')); spawn.mockReset(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function processMock() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() });
}

it('runs with no network, no credentials, bounded resources and readonly source mounts', async () => {
  let staging = '';
  spawn.mockImplementation((_cmd: string, args: string[], opts: { env: Record<string, string> }) => {
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--pull=never', '--user=1000:1000', '--cap-drop=ALL', '--memory=2g', '--pids-limit=128']));
    expect(Object.keys(opts.env).sort()).toEqual(['HOME', 'PATH']);
    expect(args.join(' ')).not.toContain('.env');
    staging = args.find(a => a.endsWith(':/proposal:ro'))!.split(':/proposal')[0];
    const child = processMock();
    setTimeout(() => { child.stdout.write('Passed tests'); child.emit('close', 0); }, 0);
    return child;
  });
  const result = await dockerRunner(root, 1000)({ files: [] });
  expect(result).toEqual({ status: 'passed', summary: 'Passed tests' });
  await expect(readdir(staging)).rejects.toThrow();
});

it('fails clearly when Docker cannot start', async () => {
  spawn.mockImplementation(() => {
    const child = processMock();
    setTimeout(() => child.emit('error', new Error('ENOENT')), 0);
    return child;
  });
  expect((await dockerRunner(root, 1000)({ files: [] })).status).toBe('failed');
});

it('kills the container and reports a timeout rather than success', async () => {
  const child = processMock();
  child.kill.mockImplementation(() => { setTimeout(() => child.emit('close', null), 0); return true; });
  spawn.mockImplementation((_cmd, args) => args[0] === 'run' ? child : processMock());
  const result = await dockerRunner(root, 20)({ files: [] });
  expect(result).toEqual({ status: 'failed', summary: 'Test execution timed out' });
  expect(spawn.mock.calls[1][1][0]).toBe('kill');
});
