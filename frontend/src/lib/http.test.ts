import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

it('sends JSON headers, preserves request options, and returns parsed data', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: 1 })))
  vi.stubGlobal('fetch', fetch)
  expect(
    await request('/todos', {
      method: 'POST',
      body: '{}',
      headers: { 'X-Request': 'test' },
    }),
  ).toEqual({ id: 1 })
  expect(fetch).toHaveBeenCalledWith(
    '/api/todos',
    expect.objectContaining({
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Request': 'test' },
    }),
  )
})

it('accepts an empty 204 response without trying to parse JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  )
  expect(await request('/todos/1', { method: 'DELETE' })).toBeUndefined()
})

it('shows actionable validation errors rather than raw server details', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ detail: [{ message: 'internal schema' }] }),
          { status: 422 },
        ),
      ),
  )
  await expect(request('/todos')).rejects.toThrow('Check the task details:')
})

it('preserves a useful API error message', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Task not found.' }), {
          status: 404,
        }),
      ),
  )
  await expect(request('/todos/1')).rejects.toThrow('Task not found.')
})

it.each(['not JSON', JSON.stringify({ detail: ['unexpected'] }), '{}'])(
  'handles nonstandard error responses: %s',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status: 500 })),
    )
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  },
)

it('turns network failures into a useful connection error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('network error')),
  )
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server.',
  )
})

it('preserves cancellation rather than reporting a connection failure', async () => {
  const controller = new AbortController()
  const error = new DOMException('Cancelled', 'AbortError')
  controller.abort()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    error,
  )
})
