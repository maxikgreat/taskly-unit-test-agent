import { afterEach, expect, it, vi } from 'vitest';
import { deepSeek } from '../src/llm.ts';
import { configuration } from '../src/config.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const request = { model: 'deepseek-v4-pro', messages: [{ role: 'assistant' as const, content: null, reasoning_content: 'retained context' }], max_tokens: 512 };
it('uses DeepSeek via the real OpenAI SDK and transmits reasoning unchanged', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'mock', choices: [], usage: { total_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await deepSeek(configuration(), 'test-credential').complete(request);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-credential');
  expect(JSON.parse(init.body as string)).toMatchObject({ model: 'deepseek-v4-pro', max_tokens: 512, messages: [{ reasoning_content: 'retained context' }] });
});
it('requires the dedicated credential', () => {
  expect(() => deepSeek(configuration(), '')).toThrow('DEEPSEEK_API_KEY');
});
it('does not retry authentication failures or expose provider error contents', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'test-credential PRIVATE DATA' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetch);
  await expect(deepSeek(configuration(), 'test-credential').complete(request)).rejects.toThrow('LLM request failed (HTTP 401)');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('retries transient provider errors only once', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetch);
  await expect(deepSeek(configuration(), 'test-credential').complete(request)).rejects.toThrow('(HTTP 503)');
  expect(fetch).toHaveBeenCalledTimes(2);
});
