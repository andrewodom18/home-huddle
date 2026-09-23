# Candidate implementation and validation — 2026-09-23

Scope: the separate Home Huddle and Conversation Display Kit `dev` working trees,
including pre-existing changes at the time of testing. This evidence describes
local source and built artifacts. It does not establish deployment or submission.

## Rubric assessment

| Criterion | Candidate improvement | Evidence and remaining limit |
| --- | --- | --- |
| Technical implementation | Separate requirement capture, typed revisions, server-owned constraints, a shared three-call limit, complete schedule validation after transformation, and safe diagnostics. Availability, resource capacity, preferences, assumptions, history, and reversible edits are represented explicitly. | Source/unit checks plus an independently authored live corpus. Bedrock generates; server validation controls publication. See the live gate below. |
| Design | Visible notes and named constraints; full revision review; robust storage/network/share recovery; bounded requests and cancellation; accessible multiline composition, scrolling, and review states. | 138 Chromium/WebKit browser checks passed. Screenshots reviewed at desktop, narrow mobile, and enlarged-text layouts. Firefox and actual screen-reader testing remain unverified locally. |
| Potential impact | Broad household needs: shared appliances/cars, school transport, caregiving handoffs, roommates, gatherings, solo routines, and multi-day coordination. | Thirty independently specified planning cases. Real participant completion, comprehension, and revision success remain unmeasured; use the updated usability protocol. |
| Quality of idea | Persistent household constraints, cross-person coordination, visible proposed changes with undo, and a provider-neutral reusable conversation/review kit. | Runnable kit example and packaged React 18/19 consumers. Alexa+ remains an explicitly permitted simulation; no native Alexa+ device integration is claimed. |

## Architecture and boundaries

Amazon Bedrock Converse interprets requests and proposes schedules through typed
tools. Requirement capture and schedule generation share a maximum of three calls,
including repairs. Lambda runs the HTTP boundary and validation; DynamoDB stores
expiring read-only snapshots; IAM restricts model and table access. Local Express
uses the same service. Sharing is an explicit action, and revision proposals need
Apply before replacing the current plan. Keep current and Undo preserve control.

A bounded timing repair handles complete new plans with overlapping activities.
It changes start times only, preserves dates/people/durations and fixed commitments,
and checks every constraint before publication. It is limited to 20,000 search
attempts and 150 ms, returns the original draft when no valid repair is found, and
does not handle revisions. Sixty deterministic small cases were compared with an
independently implemented exhaustive oracle (57 feasible, three impossible): zero
mismatches. This is feasibility evidence, not a claim of global optimality. IAM SDK
retries are disabled to keep the logical and external call ceilings aligned.

A conservative capture check rejects recognized omissions of explicitly shared,
exclusive equipment before scheduling, including missing activity/resource links.
Seventeen focused tests and ten independent counterexample probes cover shared,
private, joint, capacity-two, and unrelated activities. This check does not establish
complete natural-language understanding: the captured checklist remains visible
for user review, and independently authored live expectations remain necessary.
Explicit named sequences and "after/once all finish" barriers also require a
captured dependency path. The check accepts transitive dependencies, multiple
parallel successors, and explicit gaps; it does not add edges or claim to interpret
arbitrary prose. Independent probes cover unrelated, conditional, negated, and
parallel clauses so that an ordering check does not silently impose extra work.

The output allowance is 12,000 tokens for large supported schedules, with explicit
truncation rejection. This stays within the documented [Nova 2 Converse inference
parameters](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-converse-api.html).

Custom planning supports up to twenty activities and twelve participants, bounded
same-day windows per date, explicit transitions/gaps, and the existing 1,000-character
prompt limit. Blocking uncertainty produces clarification; infeasible constraints
produce conflict feedback. Estimates are displayed as assumptions. The planner
must preserve unchanged historical/in-progress activities and reject new or moved
past activities. This does not establish universal planning correctness or globally
optimal schedules.

## Automated and visual evidence

- Home Huddle lint, application/browser/harness type checks, **446 unit tests**,
  and browser, Node, and Lambda builds passed. One opt-in live smoke test was
  skipped; the separate campaign supplies live evidence. The zipped Lambda also
  loaded from an isolated directory and rejected an invalid origin with HTTP 403
  without a provider call.
- Browser candidate: **138 passed, 93 intentionally skipped** across Chromium at
  320/390/768/1024/1440 px and WebKit mobile 390/desktop 1440. Full flows run at
  representative desktop/mobile sizes; the other widths run layout checks.
- The final daylight-saving regression (missing/repeated/crossing clock times)
  also passed a focused rerun on all four desktop/mobile Chromium/WebKit projects
  after the final local date/export guards were added.
- Tests cover welcome/examples/custom clarification, loading, retry, reset, stale
  responses, persistence/recovery, both calendar views, date navigation, editing,
  review/reject/apply/undo, notes, sharing, clipboard failure, export, About, speech
  fallback/permission, dense content, enlarged text, reduced motion, keyboard focus,
  dialog boundaries, and axe scans. Browser APIs are stubbed; these tests consume
  no model calls. See [browser coverage](../e2e/README.md).
- Final screenshots reviewed: Chromium desktop active calendar, 320 px welcome,
  WebKit mobile event editor, and enlarged mobile text with a long dialog title.
  Generated captures and report remain under `output/playwright/` (gitignored).
- Kit: **26 unit tests and 12 Chromium/WebKit browser tests passed**; lint, types,
  build, actual tarball ESM/CJS/CSS checks, and React 18/19 consumer checks passed.
- A separate fresh directory and empty npm cache successfully installed Home
  Huddle's lockfile and local kit tarball; its public components and CSS resolved.
  The package is the unpublished 0.3.0 candidate, recorded in [vendor](../vendor/README.md).

## Live planning gate

The resumable campaign and independent expectations are described in
[quality-campaign.md](quality-campaign.md). Its ledger preserves the earlier
campaign, the original 150-call ceiling, and the user-authorized nine-call
failed-case extension. Interrupted
requests retain the full three-call reservation. Source fingerprints distinguish
candidate iterations. The generated [live report](../output/live-corpus-v2/report.md)
records coverage, latency, actual/upper-bound calls, and repeated cases for its
stated source fingerprint. Fixture passes do not establish live planning quality.

**September 23 live gate: not met.** The broad campaign at fingerprint
`5c797d2317eacbf7` completed **22/30 cases: 19 passed, three failed, and zero
plans published with independently detected hard-constraint violations**. The corrected parallel,
gathering, shared-car, split-availability, cross-month, and several revision
requests passed live. The maximum twenty-task request and add-activity revision
timed out; conflicting fixed appointments returned `INVALID_TOOL_OUTPUT` instead
of a structured conflict. This source did not cover the three examples, laundry,
caregiving, school transport, roommate eligibility, or solo routine. All thirty
cases were observed across different source versions, which does not satisfy the
current-source gate or the four repeated critical-case checks.

After the user authorized only the three failed-case rechecks, the timeout was
raised from 30 to 60 seconds within a 95-second request deadline and validated
overlapping fixed commitments gained an early structured conflict. The targeted
run at fingerprint `164d297a90fdce74` passed **3/3**: `maximum-tasks` (three
calls, 44.4 seconds), `revision-add` (two calls, 7.7 seconds), and
`infeasible-fixed` (two calls, 6.0 seconds). All three outcomes satisfied their
independent checks, with no published hard-constraint violation. No previously
passing cases were rerun, per the user's instruction. The latest observation for
each of thirty cases is now a pass, but they span source versions; this is not a
current-source thirty-case pass or a repeatability result.

The original 150-call ledger was preserved and extended by at most nine calls
for these three rechecks. It now records **146 known completed calls plus nine
reserved for three interrupted requests**, a conservative upper bound of
**155/159**. The full same-source gate remains unmet under the narrowed testing
scope; do not describe it as a release pass.

## Checks that remain unavailable or outside this local implementation

- **Firefox:** configured in both suites/CI, but this host's browser could not start
  due to profile/sandbox-extension failures. No local Firefox pass is claimed.
- **VoiceOver/other screen readers:** keyboard and axe checks passed; spoken output
  and native screen-reader interactions were not verified with available tooling.
- **Real participants:** zero new participant sessions. The five-session protocol
  and result sheet remain explicitly pending in `usability-sessions.md`.
- **Devices and deployment:** no new native Alexa+/Fire TV device validation and no
  AWS deployment smoke test. Historical deployed evidence is labeled separately.

These gaps must remain visible in release/submission decisions. Source-tested,
fixture-tested, live-tested, packaged, and deployed versions are distinct.
