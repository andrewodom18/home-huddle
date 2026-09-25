# Home Huddle — Submission Draft

This file collects the candidate narrative, evidence, and remaining submission
work. Source commits and public deployments have separate version histories.
Historical deployment checks below apply only to the earlier public version; current quality
evidence belongs in
`docs/implementation-validation.md` and `output/live-corpus-v2/report.md`.

**September 23 status:** the three previously failing live cases now pass on the
fixed source: a 20-task plan, an add-activity revision, and conflicting fixed
appointments. They used seven calls and published no hard-constraint violation.
Every corpus case has a latest passing observation, but those observations span
source versions. The original same-source thirty-case and critical-repeat gate
remains **not met** because the user requested only failed-case rechecks. The
preserved ledger's conservative usage is 155 of the targeted 159-call ceiling.

## Project description

Home Huddle is a simulated Alexa+ experience that turns competing household
needs into one workable plan. A family or shared household describes who is
involved, what needs to happen, and the available time. Amazon Nova 2 Lite
captures requirements separately from scheduling, asks about blocking uncertainty,
and makes estimates visible. Home Huddle checks availability, shared resources,
dependencies, fixed commitments, and task coverage before displaying a schedule.
Users can revise future work while preserving already-started activities, then
review, accept, reject, or undo the proposed changes.

The interface provides three fictional scenarios, optional speech-to-text, a
reliable typed interaction, browser-local chat persistence, opt-in read-only
snapshot sharing, and a visible AWS evidence panel. No physical Amazon device
is required for this Alexa+ simulation path.

Custom first plans enter a review step before becoming the accepted calendar.
The request, captured requirements, dates and time zone, and assumptions are
visible above the draft. The user can use it, correct a missing or mistaken
requirement and review again, or start over. This matters because the validator
checks requirements it captured; it cannot prove that every request detail was
understood. The three fictional presets retain a faster example flow with a
visible checklist summary.

## How it works

1. The React client sends a message, the last 12 text messages, and any current
   plan to the public AWS Lambda API. Local development uses an Express API.
2. The API calls Amazon Bedrock Converse in `us-east-1` using the Nova 2 Lite
   US inference profile. Custom requests first capture structured requirements;
   conversational revisions capture typed operations scoped to the request.
3. Validated requirements become server-owned before the scheduling call.
   Nova can ask a focused clarification, explain a conflict, or submit a complete
   replacement schedule through `publish_household_plan`.
4. Zod and schedule checks verify the displayed checklist, task coverage,
   assignments, fixed times, ordering, gaps, and workload. On invalid output,
   the API sends an error tool result to Nova for a bounded repair attempt.
   After a valid `publish_household_plan` result, it publishes the plan directly
   without another Nova call. Successful requirement capture sends a tool result
   back to Nova so scheduling can use the accepted checklist.
5. The browser shows a custom first plan as a pending draft and saves it
   separately from the accepted plan. It cannot be exported or shared before
   **Use this plan**. A correction passes through the checked revision path and
   returns for review. Later plans are proposals with changed times and owners
   for Apply or Keep current, plus undo.
   The Lambda uses IAM to call
   Bedrock and a DynamoDB transaction to reserve quota before each model call.
   Logs do not include prompts or household details.
6. The user can export an accepted plan as a dated `.ics` file or opt in to an
   expiring read-only share link. The shared view labels its creation time and
   does not change when the original plan changes. A separate DynamoDB table
   holds only the plan snapshot, not chat.

## Track and mini challenges

- **Primary track:** Alexa+ — simulated Alexa+ experience in a web application.
- **AWS Builder:** Amazon Bedrock Converse API and Amazon Nova 2 Lite power the
  live planning and tool-use loop. Lambda runs orchestration; DynamoDB transactions
  reserve each model call; a separate table holds opt-in expiring snapshots; IAM
  supplies runtime permissions; safe operational logs provide failure evidence.
- **Open Source:** Conversation Display Kit is a new, additional public,
  MIT-licensed React project released during the hackathon. The local `0.3.0`
  candidate improves reusable approval flows, accessibility, and independent
  package consumption. Home Huddle tests its vendored build; `v0.2.0` remains the
  published baseline. The current contribution is available in the public
  repository at the linked feature commit below.

## Required links

- GitHub username: `andrewodom18`
- Primary repository: https://github.com/andrewodom18/home-huddle
- Additional open-source repository:
  https://github.com/andrewodom18/conversation-display-kit
- Open-source contribution URL:
  https://github.com/andrewodom18/conversation-display-kit/commit/5e03c7425d4e9abc55bc385c98c5b0ce3bda7035
- Open-source published baseline:
  https://github.com/andrewodom18/conversation-display-kit/releases/tag/v0.2.0
- Live demo: https://andrewodom18.github.io/home-huddle/
- Demo video: **WIP**

## Open Source description

Conversation Display Kit provides accessible, provider-neutral React
components for conversational prototypes. It exports a message display and
composer with keyboard submission, suggested-prompt chips, a live-region status
indicator, TypeScript types, responsive CSS, theme variables, tests, examples,
and an MIT license. Version `v0.2.0` added the typed, keyboard-accessible
ChangeReviewCard. The `0.3.0` candidate adds review lifecycle states, multiple-instance
label correctness, IME-aware multiline composition, explicit limits, accessible
history navigation, and reduced-motion behavior. Its independent example and
React 18/19 consumer tests exercise the actual built archive, including types,
CSS, and ESM/CJS exports. Home Huddle consumes that same archive locally.

This matters because conversational demos often duplicate fragile chat UI and
copy provider branding. The kit gives developers a tested, neutral base that
can be adapted to their own product identity.

## Demonstration sequence

Use fictional names and dates generated relative to the recording day. Show actual
model responses; fixture recordings must be labeled as UI demonstrations.

1. Describe a new 4–6 PM meal-preparation plan with two people sharing one oven,
   and a third setting the table plus attending a fixed 20-minute call at 5 PM.
   Review the draft's captured requirements and assumptions above the preview.
   Add or correct a requirement, review the new draft, then use the plan.
2. Show parallel independent work while the oven tasks remain sequential.
3. Change the vegetable cook's availability to 5–6 PM. Inspect the moved cooking
   time and preserved 5 PM call; choose Apply, then Undo.
4. Ask for two conflicting fixed activities for the same person. Show the
   explanation and the next decision needed rather than a fabricated schedule.
5. Confirm the dates and time zone, export the calendar, and explain the opt-in
   read-only snapshot and its creation time. Show the AWS call count and latency.
6. Briefly show the kit's independent example: multiple conversations and the
   accessible proposal lifecycle. Link its contribution and test evidence.

Finish the public video and attach its URL only after recording the candidate
actually being submitted. The video is still outstanding.

## Product feedback draft

### Alexa+ simulated-experience path

- **Used for:** The primary-track conversational experience and visual demo.
- **Worked well:** The framework-neutral simulation option made it possible to
  focus on customer value and interaction quality without requiring hardware.
- **Needs work:** The simulation path would benefit from its own validation
  checklist and example submissions; nearby production MCP documentation adds
  OAuth, hosting, and certification details that do not apply to this path.
- **Onboarding:** The high-level choice was easy, but confirming the exact
  boundary between a simulation and production add-on required careful reading.
- **Would use again:** Yes, especially for validating an experience before
  committing to a production add-on.

### Amazon Bedrock Converse API

- **Used for:** Multi-turn household planning and client-side tool use.
- **Worked well:** Converse provides one consistent message and tool structure,
  and Bedrock-specific API keys keep the local demo separate from general AWS
  credentials.
- **Needs work:** JavaScript bearer-key examples should sit beside the Python
  examples, with one canonical raw HTTP or SDK flow for Converse tool use.
- **Onboarding:** Model, regional, API-key, and tool-use details were accurate
  but distributed across several pages.
- **Would use again:** Yes; the structured tool result is a strong fit for an
  interface that must render validated data rather than free-form prose.

### Amazon Nova 2 Lite

- **Used for:** Low-cost clarification, scheduling, revisions, and tool input.
- **Worked well:** Its Converse and tool-use support keeps the architecture
  small and provider-native.
- **Needs work:** The model catalog should present the in-region, geographic,
  and global model IDs together with a copyable recommendation for common
  setups.
- **Would use again:** Yes. The public demo completed an initial plan and a
  revision with genuine Converse tool calls. Browser testing also showed why
  model output needs schedule validation beyond a JSON schema.

## Friction log

Reviewed September 18, 2026 against the local Nova 2 Lite candidate. Existing
observations below are historical; dates of original encounters were not recorded.
Use the current rules and SDK documentation before presenting them as unresolved
provider issues.

References: [hackathon rules](https://amazonappdev2026.devpost.com/rules),
[Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html),
[Nova inference](https://docs.aws.amazon.com/nova/latest/nova2-userguide/core-inference.html).
Entries 1–3 describe documentation and onboarding friction. Entries 4–6
describe application/model interaction defects found during our testing; they
are not reports of AWS service outages. The latter belong in the product
quality evidence even if they are submitted as development friction.

### 1. Choosing JavaScript authentication

- **Task:** Call Converse locally using a Bedrock-specific API key.
- **Steps:** Reviewed the API-key quickstart, Converse examples, and JavaScript
  runtime documentation.
- **Expected:** One current JavaScript example showing the environment variable,
  endpoint, request body, and tool configuration.
- **Actual:** The clearest API-key examples emphasized Python or raw HTTP, while
  the JavaScript examples emphasized the general AWS credential chain.
- **Severity:** Medium.
- **Workaround:** Use Node's native `fetch` with the documented Bearer header and
  Converse REST endpoint.
- **Suggestion:** Add a first-party TypeScript bearer-key/tool-use quickstart.

### 2. Selecting the correct Nova model identifier

- **Task:** Choose a current, low-cost Nova model with Converse and tool use.
- **Steps:** Cross-referenced the model catalog, model card, API compatibility,
  and regional availability pages.
- **Expected:** A single table with lifecycle, capabilities, region, and the
  recommended model ID.
- **Actual:** The information was correct but spread across several pages, with
  in-region, geographic, and global identifiers shown in different contexts.
- **Severity:** Low.
- **Workaround:** Use the Nova 2 Lite US inference-profile ID from `us-east-1`
  and keep the value configurable. A live smoke test confirmed that the base
  model ID is rejected for on-demand throughput while the profile ID works.
- **Suggestion:** Add a copyable “recommended first request” block to every
  model card.

### 3. Scoping a simulated Alexa+ submission

- **Task:** Determine what is required when choosing the simulated web-app path.
- **Steps:** Compared the hackathon requirements with the production MCP
  onboarding documentation.
- **Expected:** A dedicated simulator checklist covering source, demo, and
  judging evidence.
- **Actual:** The hackathon rules permit a framework-neutral simulation, while
  most detailed Alexa+ documentation understandably focuses on production MCP
  add-ons.
- **Severity:** Medium.
- **Workaround:** Keep the simulation self-contained and make the agentic AWS
  call, source, and evidence panel explicit.
- **Suggestion:** Publish a small reference simulation and submission rubric.

### 4. Diagnosing structured planning failures

- **Observed:** September 17, 2026; reassessed during the September 18 candidate work.
- **Task:** Produce parallel and cross-month custom schedules and precise revisions
  with Nova 2 Lite over Converse.
- **Steps:** Run the fictional 14-case local campaign, then target four failed cases.
- **Expected:** A valid plan or a precise explanation of a conflicting requirement.
- **Actual:** Four valid requests repeatedly exhausted validation repairs. The old
  error response did not expose call counts; its report could only bound usage.
- **Severity:** High for the application release gate.
- **Workaround:** Separate requirement interpretation from scheduling, preserve
  authoritative constraints, add final-state checks and safe diagnostics, and use
  independently authored expected results. A bounded timing-only repair now
  resolves overlaps in otherwise complete new plans without changing activities,
  people, dates, or durations; revisions retain their separate validation path.
- **Suggestion:** Publish realistic multi-constraint tool-use examples and guidance
  for classifying truncated/invalid structured output and repair costs.
- **Attribution:** This is an application/model interaction, not evidence of an AWS
  service defect. The past-date, publication, revision-scope, and storage bugs were
  application bugs. The new campaign must establish whether remaining failures
  are resolved; unit tests cannot establish model reliability.

### 5. Constraint capture can hide a scheduling error

- **Observed:** September 18, 2026, local candidate campaigns.
- **Reproduction:** Run `meal-shared-oven` and `gathering` from the independently
  specified thirty-case corpus with `npm run test:quality`.
- **Actual:** Candidate iterations published overlapping exclusive oven jobs and
  a group setup before its preparation tasks. Their captured checklists omitted
  constraints, so validation against those checklists alone could not catch them.
- **Response:** Stop on independently detected published violations; preserve the
  failed observations; add conservative capture-completeness checks and regression
  tests. A later valid retry never erases a violation from the same source version.
- **Attribution:** Application interpretation/validation defects, not AWS service
  outages. The current-source gate in the linked report is the release decision;
  successful fixture tests are insufficient evidence of planning quality.

### 6. September 23 quality-campaign failures

- **Reproduction:** Run the thirty-case local corpus against source fingerprint
  `5c797d2317eacbf7`, using the separate 150-call ledger and fictional requests.
- **Observed:** Of 22 current-source cases, nineteen passed and three failed.
  `maximum-tasks` and `revision-add` stopped at the application's 30-second
  per-call timeout. `infeasible-fixed` exhausted its three-call budget with
  `INVALID_TOOL_OUTPUT` despite an overlapping fixed-appointment request. No
  current-source plan was published with an independently detected hard-constraint
  violation. Eight cases and required repeats still lack current-source evidence.
- **Response:** Local candidate code now shares a 95-second request deadline,
  gives an individual Bedrock call at most 60 seconds within it, and returns a
  deterministic conflict for validated, overlapping fixed commitments. Focused
  fake-gateway tests cover both fixes; the targeted live recheck is below.
- **Attribution:** The timeouts match an application-defined abort. The conflict
  outcome is an application/model orchestration defect. Neither observation
  establishes a Bedrock service fault.
- **Targeted recheck:** On September 23, 2026, the user authorized only the three
  failed cases. At source fingerprint `164d297a90fdce74`, `maximum-tasks` passed
  in three calls, `revision-add` in two, and `infeasible-fixed` in two. The
  independent checks found no published hard-constraint violation. Previously
  passing cases were not rerun on this source.
- **Remaining limit:** The original ledger is preserved with a nine-call
  extension. It contains 146 known completed calls plus nine reserved for three
  interrupted requests, a conservative upper bound of 155/159. The same-source
  gate remains unverified by the user's narrower testing choice.

## Current candidate completion checklist

- [ ] Current-source live quality gate met and linked.
- [ ] Firefox application checks observed on a host where its browser can launch.
- [ ] Actual VoiceOver/desktop screen-reader walkthrough recorded.
- [ ] Five independent usability sessions completed on named candidate versions;
      at least four of five complete the custom plan and revision unassisted,
      or shortfalls and retests are reported without claiming the target.
- [ ] Matching frontend and API build identifiers recorded for the public
      candidate; deployment smoke checks observed on that version.
- [ ] Public demonstration video recorded and linked.

## Historical deployed baseline verification

These checks describe the earlier deployment, not a verification of the current candidate.

- [x] Verify Nova 2 Lite access with a direct, low-token Bedrock Converse call.
- [x] Make Conversation Display Kit public and verify a clean-cache `npm ci`
      in Home Huddle resolves the pinned release asset.
- [x] Make Home Huddle public and verify both repositories expose their MIT
      licenses and run instructions without sign-in.
- [x] Deploy the GitHub Pages and Lambda demo with IAM authentication and
      DynamoDB call quotas; add its HTTPS URL above.
- [x] Run one initial plan and one revision with fictional data through the
      public Lambda URL. Both returned validated plans with tool use.
- [x] Confirm the AWS evidence panel shows tool use and latency.
- [x] Re-run lint, typecheck, tests, build, and production audit.
- [ ] Record a public video under three minutes with no copyrighted
      footage, music, or unlicensed logos.
- [ ] Add the video URL above.
- [x] Update Nova feedback with the observed live behavior.
- [ ] Revoke the 30-day development API key after judging.
