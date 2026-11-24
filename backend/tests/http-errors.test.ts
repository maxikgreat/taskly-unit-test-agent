import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import { createDatabase } from '../src/core/database.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it('health checks database availability and hides framework headers', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(response.headers['x-powered-by']).toBeUndefined();
});

it('returns a generic server error when database health fails', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('private database failure'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(response.text).not.toContain('private database');
});

it('rejects malformed and oversized JSON before accessing persistence', async () => {
  const { database, app } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const malformed = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{');
  expect(malformed.status).toBe(422);
  expect(malformed.body).toEqual({ detail: 'Invalid JSON.' });
  const oversized = await request(app).post('/api/todos').send({ title: 'x'.repeat(110000) });
  expect(oversized.status).toBe(413);
  expect(oversized.body).toEqual({ detail: 'Request body too large.' });
  expect(create).not.toHaveBeenCalled();
});

it('serves the API contract and a JSON 404 for unknown routes', async () => {
  const { app } = setup();
  expect((await request(app).get('/openapi.json')).body).toHaveProperty('openapi');
  const missing = await request(app).get('/missing');
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ detail: 'Not Found' });
});

it.each(['0', '-1', 'abc', '1.5', '9007199254740992'])('rejects invalid task ID %s without database calls', async (id) => {
  const { database, app } = setup();
  const get = vi.spyOn(database.todo, 'findUnique');
  expect((await request(app).get(`/api/todos/${id}`)).status).toBe(422);
  expect(get).not.toHaveBeenCalled();
});

it('gets an existing task and returns 404 for a missing one', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findUnique').mockResolvedValueOnce(record).mockResolvedValueOnce(null);
  const found = await request(app).get('/api/todos/1');
  expect(found.status).toBe(200);
  expect(found.body).toEqual(todo);
  expect((await request(app).get('/api/todos/99')).status).toBe(404);
});

it('patches a task and preserves the not-found contract', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'updateManyAndReturn').mockResolvedValueOnce([{ ...record, completed: true }]).mockResolvedValueOnce([]);
  const changed = await request(app).patch('/api/todos/1').send({ completed: true });
  expect(changed.status).toBe(200);
  expect(changed.body).toEqual({ ...todo, completed: true });
  expect((await request(app).patch('/api/todos/99').send({ title: 'Missing' })).status).toBe(404);
});

it.each([{}, { completed: 'yes' }, { id: 2 }, { title: ' ' }])('rejects invalid patches without side effects: %j', async (input) => {
  const { database, app } = setup();
  const update = vi.spyOn(database.todo, 'updateManyAndReturn');
  expect((await request(app).patch('/api/todos/1').send(input)).status).toBe(422);
  expect(update).not.toHaveBeenCalled();
});

it('returns an empty 204 for deletion and 404 if the task is absent', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'deleteMany').mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const deleted = await request(app).delete('/api/todos/1');
  expect(deleted.status).toBe(204);
  expect(deleted.text).toBe('');
  expect((await request(app).delete('/api/todos/1')).status).toBe(404);
});
