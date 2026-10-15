# Binary Brew — Development Documents

Planning documents for the Binary Brew web app (queue, self-order, POS, recommendations, inventory, HPP). Draft v0.1, 2026-10-08. These are meant to live in the repo under `docs/` and to be read by both the developer and Claude Code.

## Reading order

| # | Document | Read it to learn |
|---|---|---|
| 1 | [01-product-requirements.md](01-product-requirements.md) | What we are building and why; requirements (FR-xx), business rules (BR-xx), phases, decision log D1–D23, open questions |
| 2 | [02-technical-requirements.md](02-technical-requirements.md) | Architecture, stack, API surface, security, realtime, payments, Apriori job, testing |
| 3 | [03-app-flow.md](03-app-flow.md) | Order state machine, user journeys, sequence diagrams, edge cases, route map |
| 4 | [04-design-brief.md](04-design-brief.md) | Screen inventory (C/S/T/O IDs), visual language, components, copy, accessibility, Figma handoff |
| 5 | [05-backend-schema.md](05-backend-schema.md) | Full PostgreSQL DDL, invariants, transaction recipes, reference queries |
| 6 | [06-implementation-plan.md](06-implementation-plan.md) | Phased task list with acceptance criteria, `CLAUDE.md` starter, demo script, cut line, go-live checklist |

## Conventions used across the documents

- **IDs:** `D1–D23` decisions · `FR-xx-nn` functional requirements · `BR-nn` business rules · `Q1–Q10` open questions · `A1–A13` assumed defaults · `C-/S-/T-/O-nn` screens · `P0-/P1-/P2-/P3-nn` tasks · `TD-nn` technical decisions · `E1–E18` edge cases.
- **Language:** documents, code, comments and commit messages are in English. The app's UI text is Indonesian and lives only in `src/i18n/id.json`.
- **Source of truth:** the SQL in the schema document defines the data rules; the PRD defines behaviour. If code and docs disagree, fix whichever is wrong in the same pull request.

## Status of the plan

- Phase 1 (demo core, including the Apriori recommendation feature) is protected; everything else can be cut (plan §10).
- Real data (menu, recipes, order history), the demo date, tax rules and the payment gateway are still open (PRD §12). The documents use placeholder or seeded values until they are answered.
- The SQL in the schema document was checked for syntax with a PostgreSQL parser but has not yet been executed against a running database; Phase 0 task P0-03 does that.
