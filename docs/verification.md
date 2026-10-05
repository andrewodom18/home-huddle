# Verification and deployment

Home Huddle's browser and Lambda are released separately. The public demo is a
web simulation; it does not claim native Alexa+ device integration.

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
