# Binary Brew

Web app for a small coffee shop: QR self-order, QRIS payment, order queue, counter POS,
Apriori recommendations, and recipe-based inventory with HPP. Runs locally first.

The specification lives in [`docs/`](docs/README.md). Work follows the task list in
[`docs/06-implementation-plan.md`](docs/06-implementation-plan.md).

## Prerequisites

| Tool           | Version                          | Needed from         |
| -------------- | -------------------------------- | ------------------- |
| Node.js        | 24 LTS or later                  | P0-01               |
| npm            | 11 or later (ships with Node 24) | P0-01               |
| Docker Desktop | current, engine running          | P0-02 (PostgreSQL)  |
| Python 3       | 3.11 or later                    | P1-15 (Apriori job) |

## Setup

1. Install dependencies. This also activates the Git pre-commit hook (Husky).

   ```bash
   npm install
   ```

2. Create `.env` from the example and fill in the empty values. Generate each secret with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

   ```bash
   cp .env.example .env
   ```

   The server refuses to start while a variable is missing or invalid, and names the variable.

3. Start PostgreSQL 16 in Docker (Docker Desktop must be running) and the app:

   ```bash
   npm run db:up
   npm run dev
   ```

Open <http://localhost:3000>. <http://localhost:3000/api/health> returns `ok` when the
database answers and `503` when it does not.

The first `db:up` also creates the `binarybrew_test` database used by integration tests.

Install scripts from dependencies are blocked by npm unless listed under `allowScripts` in
`package.json`. Review a package's script before allowing it.

## Scripts

| Command                           | What it does                                                               |
| --------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                     | Start the dev server                                                       |
| `npm run db:up`                   | Start PostgreSQL in Docker and wait until it is healthy                    |
| `npm run build` / `npm start`     | Production build and server                                                |
| `npm run typecheck`               | Generate route types, then `tsc --noEmit`                                  |
| `npm run lint`                    | ESLint                                                                     |
| `npm run format` / `format:check` | Prettier write / check                                                     |
| `npm test`                        | Vitest unit and integration tests (integration needs `db:up`)              |
| `npm run test:unit`               | Unit tests only, no database (used by the pre-commit hook)                 |
| `npm run verify`                  | Typecheck, lint, format check and tests; run before every commit and merge |

The pre-commit hook runs ESLint and Prettier on staged files, then typecheck and unit tests.

## Testing on a phone

1. Connect the phone and the PC to the same Wi-Fi.
2. Find the PC's LAN address (`ipconfig` on Windows, look for the IPv4 address, e.g. `192.168.1.20`).
3. Set `APP_BASE_URL=http://192.168.1.20:3000` in `.env`. The dev server only serves its dev
   assets to this host. Use the Wi-Fi adapter's address, not a virtual adapter's (VirtualBox
   and Hyper-V often show up as `192.168.56.x`).
4. Restart `npm run dev` and open `http://192.168.1.20:3000` on the phone.
5. On Windows, allow Node.js through the firewall for **private** networks when prompted.

HTTPS is not needed: camera QR scanning of `APP_BASE_URL` links works over plain HTTP.

## Project layout

See [Tech §4](docs/02-technical-requirements.md#4-code-structure). Business logic lives in
`src/modules/*/service.ts`; route handlers only validate, call a service and format the response.
