# Home Huddle local live corpus

Run date: 2026-09-17. Local API only; no public-site requests or hosted quota changes.
Requests: 4/14 targeted recheck. Converse calls in this run: 0 known, total bounded 0–12; cumulative campaign upper bound 36, hard ceiling 42.
Outcomes: 0 pass, 4 fail, 0 blocked. Total observed API latency 50442 ms.
Successful-response call counts come from safe API metadata; a count of one is first-pass success, and any extra calls are repairs. Error responses without count metadata are conservatively bounded. The two hosted plan/revision requests remain a post-deployment gate and were not run.

Release gate: **not met**. The four previously failing cases failed again. Together with the initial run, actual Converse usage is conservatively bounded at 12–36 calls; the reserved campaign ceiling is 36 of 42 local calls. Stop here pending source diagnosis. No public-site requests were made.

| Case | Outcome | Observed latency | Converse calls | Repair calls | Finding |
| --- | --- | ---: | --- | --- | --- |
| free-parallel | fail | 14243 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan (HTTP 502, INVALID_TOOL_OUTPUT) |
| free-cross-month | fail | 11037 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan (HTTP 502, INVALID_TOOL_OUTPUT) |
| revision-exact-start | fail | 12324 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan (HTTP 502, INVALID_TOOL_OUTPUT) |
| revision-assignee | fail | 12838 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan (HTTP 502, INVALID_TOOL_OUTPUT) |

All prompts and household names are fictional. The report intentionally omits prompts, response bodies, credentials, and request IDs.
