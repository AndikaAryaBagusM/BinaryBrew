# Binary Brew
Read docs/ before any task: 01 PRD, 02 tech, 03 app flow, 04 design brief,
05 schema, 06 implementation plan. Decisions D1–D23 in doc 01 are final.

## Rules
- Work one task ID at a time from docs/06 (e.g. P0-03). Stop at its acceptance test.
- Prices, totals and stock are computed on the server. Never trust client values.
- audit_logs and stock_movements are append-only. Never edit them.
- No customer personal data (D19). UI text is Indonesian: "kamu" for customers, "Anda" for the owner.
- Design source: Figma file z0JS6kZeYkF6h1aB6BUDnT. Use tokens, not hard-coded colours.

## Skill notes
- PostgreSQL 16: no PG17/18 features (e.g. `uuidv7()`); ids use `gen_random_uuid()`. Never `drizzle-kit push`; forward-only migration files only.
- Client fetching uses TanStack Query, not SWR. No cross-request caches for prices, stock or availability. Ask before adding a dependency a skill suggests (e.g. `better-all`, `lru-cache`).
- Accessibility target is WCAG 2.1 AA (doc 04 §10). The 3-minute auto-lock and payment countdown are intentional time limits.
- Security reviews include staff- and owner-only routes (privilege escalation, missing elevation).

## Commands
(fill in: install, dev, test, db:migrate, lint)

@AGENTS.md
