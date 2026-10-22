# Binary Brew
Web app for a small coffee shop: QR self-order, QRIS payment, queue, POS, Apriori recommendations,
recipe-based inventory and HPP. Local-first. Solo developer.

Read docs/ before any task: 01 PRD, 02 tech, 03 app flow, 04 design brief,
05 schema, 06 implementation plan. Decisions D1–D23 in doc 01 are final.

## Rules
- Work one task ID at a time from docs/06 (e.g. P0-03). Stop at its acceptance test.
- Prices, totals and stock are computed on the server. Never trust client values.
- audit_logs and stock_movements are append-only. Never edit them.
- No customer personal data (D19). UI text is Indonesian: "kamu" for customers, "Anda" for the owner.
- Design source: Figma file z0JS6kZeYkF6h1aB6BUDnT. Use tokens, not hard-coded colours.

## Stack
Next.js App Router, TypeScript strict, Tailwind, Zod, Drizzle + SQL migrations, PostgreSQL 16 (Docker),
Vitest, Playwright, pino. Python 3 + mlxtend for the Apriori job. Exact versions: docs/versions.md
(do not state versions anywhere else). Dependencies are pinned exactly (`.npmrc` save-exact).

## Hard rules
- Money is integer rupiah. All tax/rounding arithmetic lives in src/lib/money.ts.
- Business logic lives in src/modules/*/service.ts; route handlers only validate (Zod), call a service, format the response.
- A module may only call another module through its exported service functions.
- Money and stock changes happen inside a single DB transaction (docs/05 §5). Lock rows in a fixed order.
- All UI text goes in src/i18n/id.json. Code, comments, docs and commit messages are in English.
- Never commit .env or secrets. Never log tokens, PINs or passwords.
- Migrations are forward-only SQL files; never edit a merged migration.

## Skill notes
- PostgreSQL 16: no PG17/18 features (e.g. `uuidv7()`); ids use `gen_random_uuid()`. Never `drizzle-kit push`; forward-only migration files only.
- Client fetching uses TanStack Query, not SWR. No cross-request caches for prices, stock or availability. Ask before adding a dependency a skill suggests (e.g. `better-all`, `lru-cache`).
- Accessibility target is WCAG 2.1 AA (doc 04 §10). The 3-minute auto-lock and payment countdown are intentional time limits.
- Security reviews include staff- and owner-only routes (privilege escalation, missing elevation).

## Commands
- Install: `npm install` (also enables the pre-commit hook), then copy `.env.example` to `.env` and fill it in
- Database: `npm run db:setup` (= `db:up` + `db:migrate` + `db:seed`; Docker Desktop must be running)
- Dev server: `npm run dev`
- Tests: `npm test` (unit + integration; integration needs the database), `npm run test:unit` (no database)
- Checks: `npm run typecheck`, `npm run lint`, `npm run format:check`
- Before every commit: `npm run verify` (typecheck, lint, format check, all tests)
- Schema change: `npm run db:generate -- --name=<what_changed>`, review the SQL, `npm run db:migrate`
- Later tasks add: `worker`, `reco:run` (P1-15), `test:e2e`, `seed:orders` (P1-14)

## Definition of done
`npm run verify` passes; new behaviour has tests; docs updated if a rule, route or table changed;
one focused commit per task (Conventional Commits).

## When unsure
Ask instead of inventing requirements. If a doc is ambiguous, propose a change to the doc first.

@AGENTS.md
