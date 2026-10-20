---
name: walley-tenant-scope-check
description: Use when adding or changing a repository function, route, or query in Walley that reads or writes user-owned data (user_configs, matches, sessions, or anything from Wallos or Actual Budget). Confirms every query is scoped to the session's user_id and that a two-user test proves user A cannot reach user B's rows.
---

# Walley Tenant Scope Check

Walley is multi-user. CLAUDE.md requires that all queries are `where user_id = current_user_id`.

## Checklist

1. Find each new or changed query: `grep -rn "db\.\(select\|insert\|update\|delete\)" src/server`.
2. Confirm the `where` clause includes `user_id` on every user-owned table.
3. Confirm the `user_id` value comes from the authenticated session, never from the request body or query string.
4. For routes with an `:id` parameter (for example `/api/matches/:id/resolve`), confirm the lookup is `id AND user_id`. A row owned by another user must return 404, not 403, so that ids cannot be probed.
5. Confirm the response contains no rows owned by another user.
6. Confirm a two-user test exists for the route.

## Anti-pattern

Fetching by id and then checking ownership in JavaScript. The scope belongs in the query itself, so a missed check cannot leak a row.

## Output

A table with one row per query: `file:line`, scoped yes or no, and the name of the two-user test.
