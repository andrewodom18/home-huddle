# Home Huddle planning-quality campaign

Source fingerprint: 164d297a90fdce74. Updated: 2026-09-23T19:44:32.279Z. Local API only.
Release gate: **not met**. Current-source coverage: 3/30 cases; feasible custom success: 8.7%; critical cases repeated: no.
All current-source feasible observations: 2/2 successful (100.0%). Published hard-constraint violation observations: 0. A later successful retry does not erase a published violation.
Approved ceiling: 159 actual Converse calls, including repairs. Persisted usage upper bound: 155. Requests attempted: 78. Interrupted requests retain three reserved calls.
Known completed calls: 146. Unresolved/interrupted requests: 3, reserved at up to three calls each.

Results below are the latest observation per case; differing source fingerprints require rechecks before release. UI fixtures and live planning evidence are separate. No prompts, response bodies, credentials, or request IDs are saved.

| Case | Result | Calls | Latency | Task coverage | Findings |
| --- | --- | ---: | ---: | ---: | --- |
| free-parallel | pass (older source) | 2 | 10971 ms | 100% | Expected behavior |
| free-cross-month | pass (older source) | 2 | 8470 ms | 100% | Expected behavior |
| revision-exact-start | pass (older source) | 3 | 19350 ms | 100% | Expected behavior |
| revision-assignee | pass (older source) | 3 | 22218 ms | 100% | Expected behavior |
| revision-add | pass | 2 | 7703 ms | 100% | Expected behavior |
| revision-availability | pass (older source) | 1 | 5097 ms | 100% | Expected behavior |
| ambiguous-target | pass (older source) | 0 | 12 ms | — | Expected behavior |
| preset-weekday | pass (older source) | 1 | 13569 ms | 100% | Expected behavior |
| preset-chores | pass (older source) | 1 | 6261 ms | 100% | Expected behavior |
| preset-outing | pass (older source) | 1 | 14596 ms | 100% | Expected behavior |
| meal-shared-oven | pass (older source) | 2 | 12206 ms | 100% | Expected behavior |
| laundry-resource | pass (older source) | 2 | 8953 ms | 100% | Expected behavior |
| caregiving-handoff | pass (older source) | 2 | 11701 ms | 100% | Expected behavior |
| school-transport | pass (older source) | 2 | 9626 ms | 100% | Expected behavior |
| roommate-eligibility | pass (older source) | 2 | 12123 ms | 100% | Expected behavior |
| solo-routine | pass (older source) | 2 | 7723 ms | 100% | Expected behavior |
| gathering | pass (older source) | 2 | 9093 ms | 100% | Expected behavior |
| availability | pass (older source) | 2 | 7620 ms | 100% | Expected behavior |
| split-availability | pass (older source) | 3 | 28325 ms | 100% | Expected behavior |
| shared-car | pass (older source) | 3 | 12840 ms | 100% | Expected behavior |
| visible-assumptions | pass (older source) | 2 | 6013 ms | 100% | Expected behavior |
| dated-windows | pass (older source) | 3 | 12286 ms | 100% | Expected behavior |
| repeated-labels | pass (older source) | 2 | 8036 ms | 100% | Expected behavior |
| remaining-day | pass (older source) | 2 | 5587 ms | 100% | Expected behavior |
| maximum-tasks | pass | 3 | 44351 ms | 100% | Expected behavior |
| missing-information | pass (older source) | 1 | 1262 ms | — | Expected behavior |
| infeasible-fixed | pass | 2 | 5974 ms | — | Expected behavior |
| infeasible-duration | pass (older source) | 3 | 7623 ms | — | Expected behavior |
| revision-cancel | pass (older source) | 3 | 8426 ms | 100% | Expected behavior |
| revision-elapsed-history | pass (older source) | 1 | 5728 ms | 100% | Expected behavior |

Practical quality checks cover parallelization, visible assumptions/resources/availability, task coverage, exact revision intent, resource contention, and historical preservation. Human usability and screen-reader walkthroughs are tracked separately; this report does not claim those ran.
