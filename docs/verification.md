# Verification and deployment

Home Huddle's browser and Lambda are released separately. The public demo is a
web simulation; it does not claim native Alexa+ device integration.

## Dev fixes verified October 16, 2026

The `dev` branch preserves accepted preset edits in later revisions, lets an
explicit custom-appointment change supersede its old chat history, and keeps
the share-date confirmation synchronized after an event date move and undo.
It vendors Conversation Display Kit `0.3.2`, which follows rapid responses
with smooth, interruptible scrolling and honors reduced motion. The original
blue background and composer glow are restored, and page/chat scrollbars are
hidden while scrolling remains available. Calendar navigation animates; revision
controls appear without motion so touch targets stay stationary.
The Terraform module includes both public Function
URL permissions, restricting `lambda:InvokeFunction` to URL invocations.

Local checks passed: lint, application/browser/script type checks, **482 unit
tests**, **144 Chromium/WebKit browser tests** at mobile and desktop sizes,
and client/server/Lambda builds. One opt-in live unit test remains skipped.
Terraform formatting and validation passed with the pinned AWS provider; the
packaged Lambda also cold-started and rejected an invalid origin with HTTP 403.
The kit separately passed 26 unit tests, 22 Chromium/WebKit browser
checks, and React 18/19 package-consumer checks. Firefox could not launch
because of a local profile error; no Firefox result is claimed for these fixes.
Browser planning responses are fixtures; no new live planning result is claimed.

These changes are on `dev`, pending deployment. They do not change the recorded
public frontend/API release below. The [friction log](friction-log.md) is restored
as a maintained document for the submission.

## Recorded public release

| Component | Version and evidence | Scope |
| --- | --- | --- |
| Source | [`a80f28b`](https://github.com/andrewodom18/home-huddle/commit/a80f28bfbb1e419a24351529dc63703ac7260bd5), [CI run 37359020500](https://github.com/andrewodom18/home-huddle/actions/runs/37359020500) | Lint, type checks, 476 unit tests, 181 browser tests, builds, and packaged Lambda cold start passed. One opt-in live unit test and 99 configured browser cases were skipped. Browser planning responses are fixtures. |
| Public page | [Pages run 37359024167](https://github.com/andrewodom18/home-huddle/actions/runs/37359024167) from `a80f28b` | The served frontend bundle contains the mobile review-scroll fix. |
| Public API | Existing `home-huddle-demo-chat` Lambda, updated from `a80f28b` on October 5, 2026 | AWS reported a successful code update. A fictional ambiguous-time request returned a focused AM/PM clarification without a model call. |

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
