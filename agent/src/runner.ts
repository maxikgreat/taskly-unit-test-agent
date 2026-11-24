import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Proposal } from './safety.ts';
import { safePath } from './safety.ts';

export interface TestResult { status: 'passed' | 'failed' | 'deferred'; summary: string }
export type TestRunner = (proposal: Proposal) => Promise<TestResult>;

export function dockerRunner(root: string, timeoutMs: number): TestRunner {
  return async (proposal) => {
    for (const dir of ['frontend/src', 'backend/src', 'backend/tests']) await safePath(root, dir);
    const staging = await mkdtemp(path.join(tmpdir(), 'taskly-tests-'));
    try {
      await writeFile(path.join(staging, 'proposal.json'), JSON.stringify(proposal));
      await chmod(staging, 0o755);
      return await new Promise<TestResult>((resolve) => {
        const name = `taskly-validation-${process.pid}-${Date.now()}`;
        const child = spawn('docker', ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '--user=1000:1000', '--tmpfs=/work:rw,exec,size=1536m,uid=1000,gid=1000', '--tmpfs=/tmp:rw,noexec,size=128m,uid=1000,gid=1000', '-v', `${root}/frontend/src:/input/frontend/src:ro`, '-v', `${root}/backend/src:/input/backend/src:ro`, '-v', `${root}/backend/tests:/input/backend/tests:ro`, '-v', `${staging}:/proposal:ro`, 'taskly-test-validation'], {
          env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let timedOut = false;
        const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16000); };
        child.stdout.on('data', capture); child.stderr.on('data', capture);
        const timer = setTimeout(() => {
          timedOut = true;
          spawn('docker', ['kill', name], { stdio: 'ignore' }).unref();
          child.kill('SIGKILL');
        }, timeoutMs);
        child.on('error', () => { clearTimeout(timer); resolve({ status: 'failed', summary: 'Docker validation could not start. Build the validation image first.' }); });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ status: code === 0 && !timedOut ? 'passed' : 'failed', summary: timedOut ? 'Test execution timed out' : output });
        });
      });
    } finally { await rm(staging, { recursive: true, force: true }); }
  };
}
