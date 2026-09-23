# Home Huddle local live corpus

Run date: 2026-09-17. Local API only; no public-site requests or hosted quota changes.
Requests: 14/14. Converse calls: 12 known, total bounded 12–24; hard campaign ceiling 42.
Outcomes: 10 pass, 4 fail, 0 blocked. Total observed API latency 115123 ms.
Successful-response call counts come from safe API metadata; a count of one is first-pass success, and any extra calls are repairs. Error responses without count metadata are conservatively bounded. The two hosted plan/revision requests remain a post-deployment gate and were not run.

Release gate: **not met**. Four cases failed to publish a plan. A targeted recheck of those four cases also failed with HTTP 502 `INVALID_TOOL_OUTPUT` in every case (see `recheck-report.md`). Across both runs, actual Converse usage is conservatively bounded at 12–36 calls; the reserved campaign ceiling is 36 of 42 local calls. No further calls were made.

| Case | Outcome | Observed latency | Converse calls | Repair calls | Finding |
| --- | --- | ---: | --- | --- | --- |
| preset-weekday | pass | 19366 ms | 2 | 1 | Expected outcome and validated calendar |
| preset-chores | pass | 4846 ms | 1 | 0 | Expected outcome and validated calendar |
| preset-outing | pass | 17314 ms | 2 | 1 | Expected outcome and validated calendar |
| free-parallel | fail | 13229 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan |
| free-cross-month | fail | 10889 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan |
| missing-information | pass | 1140 ms | 1 | 0 | Expected outcome and validated calendar |
| unrelated-question | pass | 932 ms | 1 | 0 | Expected outcome and validated calendar |
| impossible-fixed-edit | pass | 9 ms | 0 | 0 | Expected safe rejection (VALIDATION) |
| ambiguous-event-edit | pass | 6 ms | 0 | 0 | Expected safe rejection (VALIDATION) |
| revision-exact-date | pass | 7276 ms | 1 | 0 | Expected outcome and validated calendar |
| revision-exact-start | fail | 11748 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan |
| revision-duration | pass | 11885 ms | 3 | 2 | Expected outcome and validated calendar |
| revision-assignee | fail | 12639 ms | unknown (0–3) | unknown (0–2) | expected a tool-published plan |
| revision-gap-dependency | pass | 3844 ms | 1 | 0 | Expected outcome and validated calendar |

All prompts and household names are fictional. The report intentionally omits prompts, response bodies, credentials, and request IDs.
