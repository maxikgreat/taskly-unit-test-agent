import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from '../api/todos'
import { todoKeys } from '../api/queryKeys'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'
import type { Todo } from '../types'

vi.mock('../api/todos', () => ({
  todosApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
afterEach(() => vi.clearAllMocks())
function setup<T>(hook: () => T, current?: Todo[]) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  if (current) client.setQueryData(todoKeys.list, current)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(hook, { wrapper }) }
}

it('prepends the confirmed create response without duplicating a cached task', async () => {
  const old = { ...todoFixture, title: 'Old' }
  const other = { ...todoFixture, id: 8 }
  const { client, result } = setup(useCreateTodoMutation, [old, other])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await act(async () => {
    await result.current.mutateAsync(todoFixture)
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
})

it('initializes the cache when a task is created before the list loads', async () => {
  const { client, result } = setup(useCreateTodoMutation)
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await act(async () => {
    await result.current.mutateAsync(todoFixture)
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('updates only the matching cached task using the server response', async () => {
  const other = { ...todoFixture, id: 8 }
  const saved = { ...todoFixture, completed: true }
  const { client, result } = setup(useUpdateTodoMutation, [todoFixture, other])
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  await act(async () => {
    await result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    })
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('removes only the confirmed deleted task from the cache', async () => {
  const other = { ...todoFixture, id: 8 }
  const { client, result } = setup(useDeleteTodoMutation, [todoFixture, other])
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  await act(async () => {
    await result.current.mutateAsync(todoFixture.id)
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})

it('keeps cached data on failed deletion so retry remains possible', async () => {
  const { client, result } = setup(useDeleteTodoMutation, [todoFixture])
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Server unavailable'))
  await act(async () => {
    await expect(result.current.mutateAsync(todoFixture.id)).rejects.toThrow(
      'Server unavailable',
    )
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  expect(result.current.error?.message).toBe('Server unavailable')
})

it('does not invent a partial list when updating before the list is cached', async () => {
  const { client, result } = setup(useUpdateTodoMutation)
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  await act(async () => {
    await result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    })
  })
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('allows deletion before a list has been cached', async () => {
  const { client, result } = setup(useDeleteTodoMutation)
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  await act(async () => {
    await result.current.mutateAsync(todoFixture.id)
  })
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})
