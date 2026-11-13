# Pinned versions

Recorded at the end of Phase 0 (P0-07, 2026-10-22), as Tech §2 requires. This is the only place
that states versions. `tests/unit/versions.test.ts` fails if the tables below drift from
`package.json` or `docker-compose.yml`.

## Runtime and services

| Tool       | Version | Pinned in                                         |
| ---------- | ------- | ------------------------------------------------- |
| Node.js    | 24.19.0 | `package.json` `engines` (>= 24); developer PC    |
| npm        | 11.17.0 | Ships with Node.js                                |
| PostgreSQL | 16.15   | `docker-compose.yml` image `postgres:16.15`       |
| Python 3   | 3.13.5  | Developer PC (`py -3.13` on Windows); `npm run reco:setup` makes `jobs/apriori/.venv` |

## Dependencies

| Package                  | Version |
| ------------------------ | ------- |
| `@radix-ui/react-dialog` | 1.3.1   |
| `@tanstack/react-query`  | 5.104.5 |
| `argon2`                 | 0.45.1  |
| `drizzle-orm`            | 0.45.4  |
| `lucide-react`           | 1.58.0  |
| `next`                   | 16.4.2  |
| `pino`                   | 10.4.0  |
| `postgres`               | 3.4.9   |
| `qrcode`                 | 1.5.4   |
| `react`                  | 19.3.0  |
| `react-dom`              | 19.3.0  |
| `zod`                    | 4.6.7   |

## Dev dependencies

| Package                  | Version |
| ------------------------ | ------- |
| `@playwright/test`       | 1.64.1  |
| `@tailwindcss/turbopack` | 4.3.3   |
| `@types/node`            | 24.19.2 |
| `@types/qrcode`          | 1.5.6   |
| `@types/react`           | 19.3.0  |
| `@types/react-dom`       | 19.3.0  |
| `drizzle-kit`            | 0.31.11 |
| `eslint`                 | 9.39.5  |
| `eslint-config-next`     | 16.4.2  |
| `eslint-config-prettier` | 10.1.8  |
| `husky`                  | 9.1.7   |
| `lint-staged`            | 17.6.0  |
| `prettier`               | 3.9.10  |
| `tailwindcss`            | 4.3.3   |
| `tsx`                    | 4.23.15 |
| `typescript`             | 5.9.3   |
| `vitest`                 | 5.0.5   |

## Python packages (Apriori job)

Pinned in `jobs/apriori/requirements.txt` (with everything they pull in) and
`requirements-dev.txt`. pandas stays on 2.3.x and the database driver is pg8000 (pure Python):
the development PC's Windows Application Control policy blocks the compiled files of pandas
3.1.1 and psycopg-binary.

| Package   | Version |
| --------- | ------- |
| `mlxtend` | 0.25.0  |
| `numpy`   | 2.5.4   |
| `pandas`  | 2.3.3   |
| `pg8000`  | 1.31.6  |
| `pytest`  | 9.2.0   |

## Changing a version

1. `npm install <package>@<version>` (`.npmrc` sets `save-exact`, so `package.json` gets the
   exact version, not a range). Read the release notes first; for Next.js also read
   `node_modules/next/dist/docs/` (see `AGENTS.md`).
2. Update the table above in the same commit.
3. Run `npm run verify`.
4. A new package with an install script stays blocked until it is reviewed and listed under
   `allowScripts` in `package.json`.

For a Python package, change `jobs/apriori/requirements*.txt` and this file together, run
`npm run reco:setup`, then `npm run verify`.

For PostgreSQL, change the image tag in `docker-compose.yml` and this file together. Minor
updates (16.x) keep the data volume; a major version needs a dump and restore.
