export interface Config {
  model: string;
  reasoningEffort: 'low' | 'high' | 'max';
  maxIterations: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxContextBytes: number;
  timeoutMs: number;
  testTimeoutMs: number;
}

export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const effort = env.DEEPSEEK_REASONING_EFFORT ?? 'low';
  if (!['low', 'high', 'max'].includes(effort)) throw new Error('Invalid DEEPSEEK_REASONING_EFFORT');
  const integer = (name: string, fallback: number, ceiling: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    reasoningEffort: effort as Config['reasoningEffort'],
    maxIterations: integer('AGENT_MAX_ITERATIONS', 24, 100),
    maxOutputTokens: integer('AGENT_MAX_OUTPUT_TOKENS', 8192, 32768),
    maxTotalTokens: integer('AGENT_MAX_TOTAL_TOKENS', 160000, 1000000),
    maxContextBytes: integer('AGENT_MAX_CONTEXT_BYTES', 180000, 1000000),
    timeoutMs: integer('AGENT_API_TIMEOUT_MS', 90000, 300000),
    testTimeoutMs: integer('AGENT_TEST_TIMEOUT_MS', 120000, 300000),
  };
}
