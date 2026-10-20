# Verification and deployment

Home Huddle's browser and Lambda are released separately. The public demo is a
web simulation; it does not claim native Alexa+ device integration.

## Buffer fix released October 16, 2026

The named buffer request from the deployment smoke now updates the accepted
checklist before scheduling. A bounded local timing search can satisfy the gap
without asking the model to rewrite requirements. It preserves dates, durations,
assignments, accepted preset edits, fixed commitments, and already-started events.
Ambiguous names and additional edits do not take this shortcut. If search cannot
find a valid schedule, the model receives the updated authoritative checklist;
search exhaustion does not prove infeasibility.

Local verification passed **495 unit tests**, lint, TypeScript checks, and
client/server/Lambda builds. One opt-in Bedrock test was skipped. A real loopback
HTTP check applied the kitchen duration edit and then the exact previously failing
buffer request: both returned checked plans with **zero model calls**, a real
10-minute gap, and the accepted 30-minute kitchen duration intact. This check
used fictional data and did not contact Bedrock or the public API.

The fix was published from `501f509` to GitHub Pages and the existing Lambda.
A postdeployment check sent two fictional requests to the public API: the
kitchen editor change and the exact named buffer request. Both returned HTTP 200,
passed schema, CORS, schedule, date, and preservation checks, and used **zero
model calls**. The second plan retained the accepted 30-minute kitchen duration
and contained a real 10-minute laundry-to-break gap.

Release verification runs on `main` only:
[CI run 38941684722](https://github.com/andrewodom18/home-huddle/actions/runs/38941684722).
Both workflow jobs require `refs/heads/main`, including manual dispatches. GitHub
did not schedule a push run for this release, so CI and Pages were each manually
dispatched once against `main`.

## UI and earlier fixes

The app preserves accepted preset edits in later revisions, lets an
explicit custom-appointment change supersede its old chat history, and keeps
the share-date confirmation synchronized after an event date move and undo.
It vendors Conversation Display Kit `0.3.3`, which follows rapid responses
with smooth, interruptible scrolling and honors reduced motion. The original
blue background and composer glow are restored, and page/chat scrollbars are
hidden while scrolling remains available. Calendar navigation animates; revision
controls appear without motion so touch targets stay stationary.
The Terraform module includes both public Function
URL permissions, restricting `lambda:InvokeFunction` to URL invocations.

The [earlier release CI run](https://github.com/andrewodom18/home-huddle/actions/runs/38934536950)
passed lint, application/browser/script type checks, **482 unit tests**,
**186 Chromium/Firefox/WebKit browser tests**, and client/server/Lambda builds.
One opt-in live unit test and 102 configured viewport cases were skipped.
Terraform formatting and validation passed with the pinned AWS provider; the
packaged Lambda also cold-started and rejected an invalid origin with HTTP 403.
The kit's [Linux CI run](https://github.com/andrewodom18/conversation-display-kit/actions/runs/38934376052)
passed **29 unit tests**, **33 Chromium/Firefox/WebKit browser checks**, and
React 18/19 package-consumer checks. Its wheel interruption fix preserves native
scrolling outside an active animation and leaves Ctrl+wheel zoom available.
Browser planning responses are fixtures.

Both repositories have matching `main` and `dev` branches for this release.
The [friction log](friction-log.md) is maintained for the submission.

## Recorded public release

| Component | Version and evidence | Scope |
| --- | --- | --- |
| Application source | [`501f509`](https://github.com/andrewodom18/home-huddle/commit/501f5096e2b3a44ad3badda07cbec9179f991707), [main CI run 38941684722](https://github.com/andrewodom18/home-huddle/actions/runs/38941684722) | Includes the buffer fix and kit `0.3.3` from [`5ec5e1c`](https://github.com/andrewodom18/conversation-display-kit/commit/5ec5e1c1425c911383769e0080b2e4822b2ab9dd). |
| Public page | [Pages run 38941687942](https://github.com/andrewodom18/home-huddle/actions/runs/38941687942) from `501f509` | Restored blue background, composer glow, hidden page/chat scrollbars, and smooth navigation/following. |
| Public API | Existing `home-huddle-demo-chat` Lambda, updated from `501f509` on October 16, 2026 | AWS confirmed code SHA-256 `ZPDI+HV9BVs4Tir0qckJreUboI5flnIdyOV+gBRw6k0=`; the named buffer revision passed the public API smoke with zero model calls. |

An earlier live smoke used three fictional requests and three model calls. Preset
creation passed the local schedule/date validators and CORS checks. A kitchen
duration edit preserved its accepted requirements without a model call. A later
feasible buffer request returned a conflict, exposing the bug addressed by this
release. The new public check above verifies that specific revision path; it does
not establish broad model planning quality.

The client uses React, TypeScript, and the separately maintained Conversation
Display Kit. The API uses Bedrock Converse with Nova 2 Lite for interpretation
and scheduling, Lambda for orchestration, IAM for runtime access, and DynamoDB
for call quotas and opt-in expiring snapshots. Server-side checks reject plans
that violate captured timing, assignment, dependency, resource, or history
constraints. The custom first-plan review lets people correct requirements
that the model may have missed.

The test suite covers planning and revision validation, persistence recovery,
review and undo, sharing and export, responsive layouts, keyboard interaction,
and automated accessibility checks. The 30-case independent live planning
campaign has **not** completed on one source version. Broad live planning
reliability and a five-person usability result are therefore unverified.
Automated accessibility checks do not replace a screen-reader study.
