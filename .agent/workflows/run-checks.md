---
description: Run every test, lint, type check and build before finishing a change
---

1. Backend tests (uses a separate test database, no network):
// turbo
   `cd backend && uv run pytest -q`
2. Backend lint and types:
// turbo
   `cd backend && uv run ruff check . && uv run mypy app`
3. Frontend types and tests:
// turbo
   `cd frontend && npx tsc -b && npx vitest run`
4. Frontend production build:
// turbo
   `cd frontend && npm run build`
5. Report the real results (counts, failures). Fix failures before committing.
