# Home Huddle `dev` testing campaign — 2026-09-17

No commit or deployment was performed. Tests used fictional household data and the local API. The public site still needs a separately authorized deployment before its two-request post-deployment gate.

## Outcome

- Automated: 172 unit tests passed (one existing skip); 33 fixture-backed browser tests passed (65 deliberate viewport skips). Type checks, lint, production build, and whitespace checks passed. Browser tests made no Bedrock calls.
- Responsive: Chromium 320, 390, 768, 1024, 1440 px and WebKit mobile/desktop passed. Visually reviewed desktop and mobile calendar/editor/revision captures; flat fills and clean borders remain. No page-wide horizontal overflow was observed. The grid can pan internally at narrow widths.
- Accessibility: axe passed welcome, loaded calendar, editor, and proposal in representative Chromium/WebKit mobile runs. Keyboard focus, representative hints and target sizes, and reduced-motion behavior were exercised. This is not a full screen-reader audit.
- Live Bedrock: 10/14 initial requests passed; four valid plan/edit requests failed with `INVALID_TOOL_OUTPUT`. Four targeted rechecks and two diagnostics failed again. No invalid plan reached the UI. Release gate **not met**.

## Live cases

| Case | Initial outcome | Calls | Finding |
| --- | --- | --- | --- |
| Preset weekday | Pass | 2 (1 repair) | Canonical plan published |
| Preset chores | Pass | 1 | Canonical plan published |
| Preset outing | Pass | 2 (1 repair) | Canonical plan published |
| Free parallel work | Fail | 0–3 | 502; no plan. Recheck and diagnostic failed; diagnostic category inconclusive |
| Free cross-month | Fail | 0–3 | 502; no plan. Recheck failed |
| Missing information | Pass | 1 | Clarification without a plan |
| Unrelated question | Pass | 1 | Direct reply without a planning tool |
| Impossible fixed edit | Pass | 0 | Preflight rejected conflicting change |
| Ambiguous edit | Pass | 0 | Preflight rejected unverifiable change |
| Exact date edit | Pass | 1 | Requested date verified |
| Exact start edit | Fail | 0–3 | 502; diagnostic narrowed to checklist preservation; server-owned-checklist fix added afterward, not live-rechecked |
| Duration edit | Pass | 3 (2 repairs) | Requested duration verified |
| Assignee edit | Fail | 0–3 | 502; no plan. Recheck failed |
| Gap/dependency edit | Pass | 1 | Named gap and actual spacing verified |

The initial run observed 12 successful-response calls; failed requests have no error-side call count, so its total is bounded at 12–24. Four rechecks and two diagnostic requests add at most 18. The entire local campaign is therefore conservatively **12–42 actual Converse calls**, beneath the 50-call campaign cap. The 42-call local reservation is exhausted; six hosted calls plus a two-call buffer remain reserved but were not used. Latencies and per-case details are in [the initial report](./live-corpus/report.md), [four-case recheck](./live-corpus/recheck-report.md), and [diagnostics](./live-corpus/diagnostic-2026-09-17T20-43-16-529Z-report.md). No credentials, request prompts, or response bodies are in these reports.

## Fixes and remaining work

- Resolved contradictory preset date-edit instructions and added deterministic coverage for dates, stable IDs, overlap, parallel work, gaps, exports, and revisions.
- Discarded unverified model prose that could contradict the published calendar; validated schedule and checklist are authoritative.
- For explicit event edits, retained the established server-owned checklist except the expressly permitted date/duration delta; a model rewrite no longer silently changes unrelated requirements. Unit coverage passes. This fix needs a fresh live recheck under a new authorized call allowance.
- Fixed a double composer focus ring, low-contrast checklist hint, and an unfocusable scrolling chat transcript. Axe was rerun after these fixes.
- Still blocking release: free-text parallel and cross-month plans, plus exact-start and assignee edits, failed the last live run. The exact-start source fix has not been verified against Bedrock; the other failure mechanisms remain undiagnosed. Do not claim core revision flows pass.
- Before release: perform VoiceOver/desktop screen-reader walkthrough, manually inspect every secondary hover hint and target, verify the 320 px grid's keyboard panning, then rerun browser screenshots. After a separately authorized deploy, inspect hosted quota and run the reserved public plan/revision gate.

## Screenshots and repeatability

- [Desktop calendar](./playwright/test-results/home-huddle-welcome-active-e315f-ain-usable-at-this-viewport-chromium-1440/active-calendar.png)
- [Mobile calendar](./playwright/test-results/home-huddle-welcome-active-e315f-ain-usable-at-this-viewport-webkit-mobile/active-calendar.png)
- [Desktop event editor](./playwright/test-results/home-huddle-welcome-active-e315f-ain-usable-at-this-viewport-chromium-1440/event-editor.png)
- [Mobile revision proposal](./playwright/test-results/home-huddle-schedule-edit--50d2a-r-applied-and-can-be-undone-chromium-390/revision-proposal.png)

The full screenshot index and browser case matrix are in [the browser suite README](../e2e/README.md). Fixture responses are schema- and schedule-checked; browser storage is isolated. `npm run test:browser` is safe for CI and does not call Bedrock. The bounded live runner is `scripts/live-corpus.ts` and requires an explicit opt-in flag; its ledger prevents an accidental repeat beyond the local allowance.
