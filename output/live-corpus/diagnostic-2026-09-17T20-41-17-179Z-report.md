# Home Huddle local live corpus

Run date: 2026-09-17. Local API only; no public-site requests or hosted quota changes.
Requests: 1/14 targeted recheck. Converse calls in this run: 0 known, total bounded 0–3; cumulative campaign upper bound 39, hard ceiling 42.
Outcomes: 0 pass, 1 fail, 0 blocked. Total observed API latency 13235 ms.
Successful-response call counts come from safe API metadata; a count of one is first-pass success, and any extra calls are repairs. Error responses without count metadata are conservatively bounded. The two hosted plan/revision requests remain a post-deployment gate and were not run.

| Case | Outcome | Observed latency | Converse calls | Repair calls | Finding |
| --- | --- | ---: | --- | --- | --- |
| free-parallel | fail | 13235 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan (HTTP 502, INVALID_TOOL_OUTPUT, category: other validation issue) |

All prompts and household names are fictional. The report intentionally omits prompts, response bodies, credentials, and request IDs.
