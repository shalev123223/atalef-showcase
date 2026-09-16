# 005 — Draft visibility is enforced in the service layer

**Status:** Accepted, implemented

## Context

A draft roster is the manager's workspace, and it changes many times before it's final. If an
employee sees a draft and plans around it, the damage is real. Hiding the draft in the UI isn't
enough: any request that reaches the data would expose it.

## Decision

- Weeks move through `DRAFT → PUBLISHED → ARCHIVED`.
- The services that build the schedule grid and week lists keep only `PUBLISHED` weeks unless
  the session holds `schedule.manage`. The filter runs on the server, before any data is shaped
  for the page.
- Editing a week that is already published is allowed, but it raises the operational rule
  `PUBLISHED_WEEK_EDIT`, which requires a recorded override (see decision 003).
- An archived week cannot be edited at all until it is restored.

## Consequences

No page, API route or future screen can leak a draft by accident, because the data never leaves
the service. Late changes to a published week are possible, but always deliberate and always
recorded.
