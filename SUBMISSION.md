# Home Huddle — Submission Draft

This file collects the evidence, feedback, and demo sequence completed for
the Amazon Developer Hackathon submission.

## Project description

Home Huddle is a simulated Alexa+ experience that turns competing household
needs into one workable plan. A family or shared household describes who is
involved, what needs to happen, and the available time. Amazon Nova 2 Lite
decides whether one clarification is needed or invokes a structured planning
tool. Home Huddle validates the tool output, displays clear ownership and
timing, and lets the user revise the complete plan conversationally.

The interface provides three fictional scenarios, optional speech-to-text, a
reliable typed interaction, browser-local chat persistence, opt-in read-only
snapshot sharing, and a visible AWS evidence panel. No physical Amazon device
is required for this Alexa+ simulation path.

## How it works

1. The React client sends a message, the last 12 text messages, and any current
   plan to the public AWS Lambda API. Local development uses an Express API.
2. The API calls Amazon Bedrock Converse in `us-east-1` using the Nova 2 Lite
   US inference profile and the `publish_household_plan` tool definition.
3. Nova either asks one concise clarification or returns a complete tool
   payload. Revisions must send a full replacement plan.
4. Zod and schedule checks verify the displayed checklist, task coverage,
   assignments, fixed times, ordering, gaps, and workload. On invalid output,
   the API sends an error tool result to Nova for a bounded repair attempt.
   On valid output, it publishes the plan directly; it does not send a
   successful tool result back to Nova.
5. The browser renders and saves the first plan locally. Later plans are
   proposals with changed times and owners for Apply or Keep current, plus undo.
   The Lambda uses IAM to call
   Bedrock and a DynamoDB transaction to reserve quota before each model call.
   Logs do not include prompts or household details.
6. The user can export a dated `.ics` file or opt in to an expiring read-only
   share link. A separate DynamoDB table holds only the plan snapshot, not chat.

## Track and mini challenges

- **Primary track:** Alexa+ — simulated Alexa+ experience in a web application.
- **AWS Builder:** Amazon Bedrock Converse API and Amazon Nova 2 Lite power the
  live planning and tool-use loop in `server/bedrock.ts` and
  `server/chatService.ts`.
- **Open Source:** Conversation Display Kit is a new, additional public,
  MIT-licensed React project released during the hackathon. Home Huddle pins
  its `v0.2.0` release asset, including the accessible ChangeReviewCard.

## Required links

- GitHub username: `andrewodom18`
- Primary repository: https://github.com/andrewodom18/home-huddle
- Additional open-source repository:
  https://github.com/andrewodom18/conversation-display-kit
- Open-source contribution/release URL:
  https://github.com/andrewodom18/conversation-display-kit/releases/tag/v0.2.0
- Live demo: https://andrewodom18.github.io/home-huddle/
- Demo video: **WIP**

## Open Source description

Conversation Display Kit provides accessible, provider-neutral React
components for conversational prototypes. It exports a message display and
composer with keyboard submission, suggested-prompt chips, a live-region status
indicator, TypeScript types, responsive CSS, theme variables, tests, examples,
and an MIT license. Version `v0.2.0` adds the typed, keyboard-accessible
ChangeReviewCard with tests and an example. Home Huddle consumes this release directly,
demonstrating that the package works outside its own repository.

This matters because conversational demos often duplicate fragile chat UI and
copy provider branding. The kit gives developers a tested, neutral base that
can be adapted to their own product identity.

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

## Final verification

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
