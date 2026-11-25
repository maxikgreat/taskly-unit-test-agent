import { lstat, readdir, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const testFilePathSchema = z.string().max(240).regex(/^(?:backend\/tests\/[\w/-]+\.agent\.test\.ts|frontend\/src\/[\w/-]+\.agent\.test\.tsx?)$/);
export const proposalSchema = z.object({
  files: z.array(z.object({ path: testFilePathSchema, content: z.string().min(1).max(30000) }).strict()).max(10),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;

export function testPath(file: string): boolean {
  return validRelative(file) && testFilePathSchema.safeParse(file).success;
}

function validRelative(file: string): boolean {
  return !path.isAbsolute(file) && !file.includes('\\') && file.split('/').every((part) => part !== '.' && part !== '..' && part !== '');
}

export async function safePath(root: string, file: string): Promise<string> {
  if (!validRelative(file)) throw new Error('Unsafe relative path');
  const base = await realpath(root);
  let current = base;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not permitted');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}

export function readable(file: string): boolean {
  if (!validRelative(file) || /(?:^|\/)(?:node_modules|coverage|generated|\.\w+)(?:\/|$)/.test(file)) return false;
  return /^(?:frontend|backend)\/(?:src|tests)\/.*\.(?:ts|tsx)$/.test(file)
    || /^(?:frontend|backend)\/(?:package\.json|(?:vite|vitest)\.config\.ts)$/.test(file);
}

export async function readSource(root: string, file: string): Promise<string> {
  if (!readable(file)) throw new Error('File is outside readable source paths');
  const target = await safePath(root, file);
  const info = await lstat(target);
  if (!info.isFile() || info.size > 40000) throw new Error('Source file too large or not regular');
  return readFile(target, 'utf8');
}

export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const full = await safePath(root, dir);
    const entries = await readdir(full, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'generated', 'coverage'].includes(entry.name)) continue;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && readable(file)) files.push(file);
      if (files.length > 500) throw new Error('Repository file limit exceeded');
    }
  }
  for (const dir of ['frontend/src', 'backend/src', 'backend/tests']) await walk(dir);
  return files.sort();
}

export function validateProposal(input: unknown): Proposal {
  const proposal = proposalSchema.parse(input);
  const names = new Set<string>();
  for (const file of proposal.files) {
    if (!testPath(file.path) || names.has(file.path)) throw new Error('Proposal contains forbidden or duplicate test paths');
    names.add(file.path);
    if (/\b(?:it|test|describe)\s*\.\s*(?:skip|todo|only)\b|\b(?:eval|Function)\s*\(|node:(?:child_process|vm)|(?:child_process|execSync|spawnSync)|process\s*\.\s*env|@vitest-environment|istanbul ignore|v8 ignore/.test(file.content)) {
      throw new Error('Proposal contains disallowed test constructs');
    }
    if (!/\b(?:it|test)\s*(?:\(|\.each\s*\()/.test(file.content) || !/\bexpect\s*\(/.test(file.content)) throw new Error('Tests need test cases and assertions');
  }
  return proposal;
}

// This is a path/content policy, not a JavaScript sandbox. Execution must happen
// in a separate runner without secrets, or the Docker sandbox in runner.ts.
export async function applyProposal(root: string, input: unknown) {
  const proposal = validateProposal(input);
  const targets = await Promise.all(proposal.files.map((file) => safePath(root, file.path)));
  for (let i = 0; i < targets.length; i++) {
    await mkdir(path.dirname(targets[i]), { recursive: true });
    await writeFile(targets[i], proposal.files[i].content, { flag: 'w' });
  }
}

export function redact(text: string, secrets: string[] = [process.env.DEEPSEEK_API_KEY ?? '', process.env.GITHUB_TOKEN ?? '', process.env.GH_TOKEN ?? '']): string {
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{12,}|github_pat_[\w_]+)\b/g, '[REDACTED]');
}
