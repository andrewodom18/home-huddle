# Quality campaign and release evidence

The current `dev` source is the candidate under test. Public deployment and the
published kit release have separate version histories.
Do not infer deployment from a local build or browser fixture result.

## Repeatable checks

- `npm run lint`, `npm run typecheck`, `npm run typecheck:browser`, and
  `npm run typecheck:scripts` verify source and test harnesses.
- `npm test` includes request/response boundaries, independent corpus oracles,
  budget persistence, scheduling, migration, recovery, and UI behavior.
- `npm run test:browser` starts only Vite and aborts unmatched POST requests.
  It does not consume Bedrock calls. Chromium, Firefox, and WebKit are configured;
  representative desktop/mobile projects exercise full flows, while remaining
  widths check responsive layouts.
- `npm run build` builds browser, Node, and Lambda artifacts.
- The kit's separate `npm run test:package` builds a tarball and checks React
  18/19 consumers, ESM/CJS exports, CSS, and TypeScript declarations.

## Live quality corpus

`scripts/planning-corpus.ts` contains thirty requests and independently authored
expectations. The corpus covers all three examples, parallel work, multiple
months, an oven/washer/car, caregiving, school transport, roommate eligibility,
solo routines, gatherings, availability, assumptions, repeated task labels,
remaining work, maximum task count, ambiguity, infeasibility, and revisions.

Assertions inspect returned events directly against requested dates, durations,
people, fixed times, order, gaps, and resource exclusivity. The model's checklist
is not the oracle. Independently specified resource capacities/use and availability
intervals are also compared with the captured requirements. Existing runtime
validation is an additional check. Practical
quality measures include task coverage, parallelism, visible assumptions and
constraints, and the number of existing activities changed by a revision.
Task coverage measures how many requested activities were found; 100% does not
mean their timing, assignments, or dependencies are correct. Those independent
checks determine the findings and pass/fail result.

The release gate requires:

1. All thirty cases observed against the current source fingerprint.
2. Zero published hard-constraint violations across all current-source observations;
   a later successful retry does not erase a violation.
3. At least 90% success on feasible custom planning and revision cases, both per
   latest case and across all current-source attempts.
4. Passing clarification/conflict cases and all three examples.
5. Two passing observations each for custom parallel work, cross-month planning,
   exact-start revisions, and reassignment on the current source.

This is a bounded evaluation, not proof of universal planning correctness or
mathematical schedule optimality. A failed gate is a release blocker, even when
offline tests pass.

## Budget and privacy

The v3 campaign is prepared but **has no authorization and has not run**. A
separate 150-call ceiling must be explicitly authorized before setting
`HOME_HUDDLE_V3_AUTHORIZED=150` and running `npm run test:quality:v3`. The runner
also requires `HOME_HUDDLE_LIVE_QUALITY=1`, set by that npm script. Without both
guards it stops before contacting the API. It uses `output/live-corpus-v3/` only,
pins the first run's source fingerprint in its own ledger, and
reserves three calls before each request. A clean run schedules all thirty cases
and a second observation of the four critical cases, with at most 102 reserved
calls before any targeted investigation. The same gate above evaluates all v3
observations; a later success cannot erase a published hard violation or a failed
observation. Source changes stop reuse of the v3 ledger, and a new campaign would
need another explicit allowance. Dates roll forward on each run so a resumed
campaign does not schedule a previously future case in the past. The operator
must restart the local API from the
frozen candidate before running; a source fingerprint of files cannot prove that
a stale API process matches them.

The historical v2 campaign allowed 150 Converse calls including repairs. On September
23 the user authorized a recheck of only the three failed cases; this adds at
most nine reserved calls for a combined ceiling of 159. The original ledger and
all its attempts remain in place under `output/live-corpus-v2/`. The initial
thirty requests reserve at most ninety calls; sixty calls are reserved for targeted
checks. Reconciled unused reservations remain available within the same ceiling.
Every attempt reserves three calls before
network I/O. Exact safe diagnostics reconcile successful/failed attempts; absent
diagnostics or interrupted requests retain all three reserved calls. An exclusive
lock prevents concurrent runners, and malformed ledgers fail closed.

`npm run test:quality` remains the historical v2 runner; do not use it to claim
v3 coverage. For either campaign, select targeted cases with
`HOME_HUDDLE_CASES=id,id`; they consume that campaign's own allowance. The oldest
campaign is preserved under `output/live-corpus/`. Never reset a ledger or raise
a cap without a new explicit allowance. Authentication or service blocking
conditions stop the runner rather than spend repeated calls.

Reports record classifications, coverage, source fingerprints, call counts, and
latency. They omit prompts, response bodies, credentials, and request IDs. Use
fictional data. Logs and reports are not substitutes for inspecting the actual UI.
`HOME_HUDDLE_QUALITY_DIAGNOSTICS=1` additionally prints bounded application feedback
and fictional event summaries to the console for a failing case; it never prints
provider/auth errors or writes full responses into campaign artifacts.

The early September 18 iterations exposed two evaluation defects, corrected with
regressions: an alternative adult was incorrectly treated as an exact assignee
list, and the word `table` matched a substring in `vegetables`. The reviewed meal
output was valid. Earlier result files are retained unchanged; candidate evidence
must use the corrected evaluator/source fingerprint.

## Human and platform checks

Review welcome, calendar, dialog, checklist, proposal, and sharing screenshots.
Walk through keyboard focus, Escape, forward/back tab boundaries, narrow layouts,
enlarged text, and reduced motion. Axe checks support this work but do not establish
screen-reader usability. Record actual VoiceOver/other screen-reader observation
separately and mark unavailable checks as unverified.

The five-session protocol in `usability-sessions.md` requires real participants.
Automated sessions and synthetic users must not be entered as volunteer evidence.
