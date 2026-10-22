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
| Python 3   | not yet | Installed and pinned with the Apriori job (P1-15) |

## Dependencies

| Package                  | Version |
| ------------------------ | ------- |
| `@radix-ui/react-dialog` | 1.3.1   |
| `argon2`                 | 0.45.1  |
| `drizzle-orm`            | 0.45.4  |
| `lucide-react`           | 1.58.0  |
| `next`                   | 16.4.2  |
| `pino`                   | 10.4.0  |
| `postgres`               | 3.4.9   |
| `react`                  | 19.3.0  |
| `react-dom`              | 19.3.0  |
| `zod`                    | 4.6.7   |

## Dev dependencies

| Package                  | Version |
| ------------------------ | ------- |
| `@tailwindcss/turbopack` | 4.3.3   |
| `@types/node`            | 24.19.2 |
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

## Changing a version

1. `npm install <package>@<version>` (`.npmrc` sets `save-exact`, so `package.json` gets the
   exact version, not a range). Read the release notes first; for Next.js also read
   `node_modules/next/dist/docs/` (see `AGENTS.md`).
2. Update the table above in the same commit.
3. Run `npm run verify`.
4. A new package with an install script stays blocked until it is reviewed and listed under
   `allowScripts` in `package.json`.

For PostgreSQL, change the image tag in `docker-compose.yml` and this file together. Minor
updates (16.x) keep the data volume; a major version needs a dump and restore.
