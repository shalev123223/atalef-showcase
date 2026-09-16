# 003 — One override protocol for every module

**Status:** Accepted, implemented

## Context

Real operations need a manager to be able to say "I know, do it anyway". The legacy system
either blocked such actions outright or let them through silently, and each feature handled
this differently, when it handled it at all. There was no record of who bypassed what.

## Decision

Every rule is declared once in a registry and assigned one of three classes:

- **INTEGRITY** — never bypassed by anyone (role mismatch, occupied slot, illegal state
  transition, …).
- **OPERATIONAL** — blocks unless a manager with the `override.perform` permission gives
  explicit consent covering *each* rule code, with a reason.
- **WARNING** — informational only.

Every mutating service runs the same function:

```
integrity violation      → hard fail, with the message
operational, no consent  → NEEDS_OVERRIDE (typed result, UI shows the standard dialog)
otherwise                → proceed; persist an override record + a paired audit event per rule
```

## Details that matter

- **Rules are evaluated again on resubmit.** Consent applies only to the rule codes it was given
  for. If a new rule has appeared in the meantime, the manager is asked again.
- **The warning is saved exactly as shown.** The override record stores the exact message and
  data the manager saw, not just a code, so the audit trail stays true even after the message
  text changes.
- **Normal work stays fast.** The dialog appears only when an operational rule actually fires.
  A clean assignment saves in one click. Bulk actions show a single dialog covering the batch.
- Overridden assignments carry an `overrideId`, so the grid can badge them and reports can list
  them.

## Consequences

Adding a rule takes one registry entry and one check. The override and audit machinery doesn't
change. There is no code path from a warning to the database that skips recorded consent.
