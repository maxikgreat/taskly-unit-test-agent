import { readFile } from 'node:fs/promises';

export const skillCatalog = {
  'analyze-pr': 'Analyze changed behavior and classify affected frontend/backend modules.',
  'identify-gaps': 'Inspect source, existing tests and coverage to identify valuable missing behavior.',
  'frontend-tests': 'Generate behavioral React, hook, and HTTP client unit tests.',
  'backend-tests': 'Generate API, validation, and repository unit tests with isolated database IO.',
  'update-tests': 'Update agent-owned tests for intentional behavior changes without weakening assertions.',
  'validate-tests': 'Execute tests in isolation or request separate CI validation.',
  'repair-tests': 'Diagnose validation failures and repair proposed tests with bounded iterations.',
  'report': 'Finish with a concise decision summary and limitations backed by observed results.',
} as const;
export type Skill = keyof typeof skillCatalog;
export async function loadSkill(name: Skill): Promise<string> {
  return readFile(new URL(`../skills/${name}.md`, import.meta.url), 'utf8');
}
