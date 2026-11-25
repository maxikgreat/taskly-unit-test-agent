# Generate backend unit tests
Use Vitest, Supertest and existing fixtures. Mock Prisma IO, never require a database. Assert HTTP status/body plus important no-side-effect behavior for validation failures. Cover missing records, invalid IDs, database rejection and intentional defaults. Do not replace production modules to make tests pass. Use write_test with complete backend/tests/**/*.agent.test.ts content.

Import every Vitest helper used by the file, including describe when grouping tests; runtime globals are disabled. Keep fixture types explicit when introducing enum fields. Use letters, digits, underscores or hyphens in the filename before .agent.test; the write_test schema exposes the exact approved path pattern.
