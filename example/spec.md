# Spec — Tiny CRUD REST API

Build a small Node.js HTTP service.

## Functional requirements

- Single resource: `Task` (id, title, done)
- Endpoints:
  - `GET /tasks` — list all
  - `POST /tasks` — create one (body: `{ title }`)
  - `PATCH /tasks/:id` — toggle `done`
  - `DELETE /tasks/:id` — remove
- In-memory store (no DB, no file persistence)
- Returns JSON, sets correct status codes (200, 201, 204, 404)

## Non-functional

- Node.js 20+, Express 5
- ESM (`type: module` in `package.json`, `.mjs` files)
- One file per concern: `server.mjs`, `tasks.mjs` (model + handlers)
- README with `yarn install && yarn start` + a `curl` example for each endpoint

## Out of scope

- Authentication
- Database
- Tests (let critic flag this if it cares; reviser may add)
