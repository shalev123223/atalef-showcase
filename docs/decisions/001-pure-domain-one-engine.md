# 001 — A pure domain layer and a single engine

**Status:** Accepted, implemented

## Context

The legacy system (a WordPress plugin) had grown two scheduling engines, two training systems
and three fairness calculations. Each gave a slightly different answer, and nobody could say
which one was right. Business rules were spread across UI handlers, AJAX endpoints and SQL.

## Decision

- All business logic lives in `src/domain/`, as plain TypeScript functions over plain data.
- `src/domain/` may not import Prisma, Next.js, React or the server layer. This is an **ESLint
  error**, not a guideline.
- There is exactly one `runEngine` and exactly one `evaluateCandidate`. The manual picker, swaps,
  change-request approval and the planning simulator all go through them.

## Consequences

- The engine is deterministic and tested with in-memory fixtures. Every rule code has a test
  proving it fires at its boundary, without needing a database.
- Reports, dashboards and the simulator show the same numbers as scheduling, because they call
  the same functions.
- Duplicated behaviour now shows up as a compile error instead of lurking. For example, when the
  ranking order became a required parameter, the one call site that had been ranking
  differently stopped compiling.
- The cost is an explicit loading step: services have to assemble a `SchedulingContext` before
  calling the domain. That is a small price for a testable core.
