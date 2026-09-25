# Home Huddle

Home Huddle is a simulated Alexa+ household planning experience powered by
Amazon Bedrock. It turns competing household constraints into a clear,
assignable schedule and supports conversational revisions.

[Try the public demo](https://andrewodom18.github.io/home-huddle/).

The features below describe the source candidate. The public page and API are
deployed separately; check their deployment records before treating the live
demo as the same version. The latest paired deployment is recorded in
[`docs/deployment-validation.md`](docs/deployment-validation.md).

Conversation state stays in the browser. The Node API does not persist prompts;
it sends model-bound planning requests to Amazon Bedrock. The public page runs on
GitHub Pages with a small AWS Lambda backend.

## What it demonstrates

- Broad household planning for meals, errands, shared resources, caregiving,
  routines, and gatherings; three fictional examples remain convenient starting points.
- Rolling example dates: the school-week plan uses the next complete week,
  chores use the next Saturday, and the outings span nonconsecutive days
  across two months, with a garden rest between walks rather than around lunch.
  Previously saved examples retain their original dates.
- Real Amazon Nova 2 Lite tool use through the Bedrock Converse API.
- A structured, validated schedule that can be revised conversationally.
- Separate requirement interpretation and schedule generation for custom requests.
  Captured requirements become server-owned before scheduling, with stable task
  IDs, availability windows, shared-resource capacity, assumptions, and preferences.
- A first-plan review for custom requests: the original request, interpreted
  activities and constraints, dates, time zone, and assumptions appear above
  the calendar preview. The user accepts the draft, corrects a requirement,
  or starts over. A correction returns for review before the plan is saved.
- Apply/Keep current review for revisions, one-level undo, a calendar that
  navigates nonconsecutive days,
  `.ics` download, and opt-in seven-day read-only snapshot links.
- Clickable calendar events with checked date, start/end/duration, and assignee
  edits; single-day plans can also move the whole date through review and undo.
  Switch between person lanes and one shared timeline; smaller screens use
  corresponding accessible lists.
  Participant-matched event accents keep names visible, with a separate style
  for shared events.
- Optional browser speech recognition with a complete text fallback.
- An expandable, non-sensitive AWS trace showing model, tool use, call count,
  and latency; bounded failure diagnostics support repeatable quality evaluation.
- A separately released open-source UI dependency:
  [Conversation Display Kit](https://github.com/andrewodom18/conversation-display-kit).

## Architecture

```text
Browser (React + localStorage)
       │ local /api/chat or hosted Lambda Function URL
       ▼
Local Express API or hosted Lambda
       │ HTTPS + local API key or hosted IAM role
       ▼
Amazon Bedrock Converse API
       │ Nova 2 Lite captures requirements or scoped revision operations
       ▼
Server-owned requirements → schedule generation (publish_household_plan)
       ▼
Zod validation → normalized HouseholdPlan → browser
```

The server permits at most three Bedrock calls per user request. A valid tool
payload is normalized with stable task IDs, a version number, and a timestamp.
Invalid tool output is returned to the model for bounded repair and never
rendered as a plan. For free text, only displayed interpreted constraints are
verified; an uncaptured constraint is not claimed as checked.

Custom plans use a separate interpretation step before scheduling. Explicit
requirements stay distinct from estimated durations and soft preferences. The
assistant asks about blocking uncertainty or explains incompatible requirements;
otherwise it produces a draft with visible assumptions. The three-call maximum
includes interpretation, scheduling, and any repairs. The deterministic checker
verifies captured requirements, not whether a model understood every word; the
independent evaluation corpus checks that additional dimension.

For a custom request, the first generated schedule is a pending draft. Its
review shows the captured checklist and assumptions before **Use this plan**
can make it the accepted plan. The user can add or correct a requirement and
review the replacement draft, or start over. Validation covers the captured
requirements; the review asks the user to spot any omitted requirement. A
pending draft cannot be edited as an accepted event, shared, or exported.
Presets keep the faster example flow with a visible checklist summary.

First plans favor parallel work by different people. After validation, a
bounded, provider-independent compaction pass moves flexible activities
earlier where the same validator still accepts them, without another Bedrock
call. It preserves each person's task order, fixed times, and captured
dependencies and gaps; it does not claim a mathematically optimal schedule or
verify constraints the model did not capture from free text. Revisions are not
automatically retimed so requested changes remain under the user's control.

The model can answer without invoking the planning tool, but that answer still
uses one Bedrock Converse call and one unit of the shared call quota. The web
page answers standalone greetings and thanks locally without contacting the
API. Other questions, including unrelated ones, still use Bedrock; skipping
the tool does not make a model call free.

Calendar edits and recognized explicit chat requests for an event's date, start time,
end time, duration, or assignees are checked against the replacement plan before it can
be offered for review. Fixed example commitments cannot be silently moved.
An exact preset assignee edit can be checked locally without a Bedrock call;
the editor can swap one other eligible parallel activity if the entire schedule
passes the same coverage, overlap, workload, and timing checks. More complex
edits still go through the model's bounded repair path.
Ambiguous direct event edits are clarified instead of being published as
unchecked revisions.
Each event can have its own date, including dates in different weeks or months.
A new plan or proposed edit cannot schedule an event before the current time in
the selected time zone; the UI explains the attempted date and time. The server
enforces the same rule before publishing, so a direct API request cannot bypass
the browser check.
Unchanged already-started activities remain part of accepted history while future
work can be revised. Every transformed candidate, including a compacted first plan,
passes the final checks. Nonexistent or ambiguous daylight-saving times require
an unambiguous replacement.
For a new plan with complete valid activities but overlapping times, a bounded
server search can repair start times without changing people, dates, durations,
or fixed commitments. It honors availability, shared resources, dependencies,
and gaps, and publishes only after full validation. It makes no optimality claim
and does not rewrite revisions. IAM SDK retries are disabled so one logical model
call cannot silently multiply the three-call allowance.
A whole-plan date command is handled locally only for a one-day plan and does
not use Bedrock. The `.ics` file uses each event's accepted date and can be
imported into Google Calendar as a copy; there is no sign-in or live sync.

## Run locally

### Requirements

- Node.js 20 or newer.
- An AWS account with access to Amazon Bedrock in `us-east-1`.
- A local IAM session with Bedrock inference access, or a short-term Bedrock
  API key for a one-off test.

### Setup

```bash
npm ci
cp .env.example .env.local
```

This working candidate consumes the locally built Conversation Display Kit
`0.3.0` archive in `vendor/`. It is pinned in the lockfile so a standalone checkout
can run `npm ci` without the sibling repository or an unpublished release URL.
The archive includes the MIT license and public package files; its source lives
in the separate Conversation Display Kit repository. This does not publish a
new kit release or change the hosted Home Huddle demo.

Keep `.env.local` free of secrets. With an AWS CLI IAM Identity Center profile
configured outside this repository and signed in, start both servers with
`AWS_PROFILE=your-profile npm run dev`. The role needs permission to invoke the
Nova 2 Lite inference profile in `us-east-1`.

For a short one-off test without a CLI profile, generate a **short-term** key
in the Amazon Bedrock console in `us-east-1`, then start both servers from an
interactive terminal:

```bash
npm run dev:bedrock-key
```

The script asks for the key with hidden input and holds it in the local process
environment, never in a project file. Do not paste a key into chat, a command,
or `.env.local`.
If a terminal does not accept paste at the hidden prompt, copy the key and run
`npm run dev:bedrock-clipboard` instead. This reads the current macOS clipboard
without printing its contents; clear the clipboard after the server starts.
The key expires when your console session expires (at most 12 hours). Stop the
server when finished. See [AWS's short-term key instructions](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-generate.html).

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API listens only on
`127.0.0.1:8787`. Stop the old preview bridge first if it occupies that port.

## API

`POST /api/chat` accepts a message, up to 12 previous text messages, and an
optional current plan, scenario ID, and default plan date. It returns an assistant reply, an optional replacement
plan, and safe integration metadata. See `shared/contracts.ts` for the complete
Zod schemas and TypeScript types.

The same hosted POST URL also accepts `share-create` and `share-resolve`
actions. The browser keeps the unguessable token in the URL fragment and
sends it in a POST body. Snapshots contain the accepted plan, date, and time
zone—not chat history—and expire after seven days. A shared view identifies
when its snapshot was created; later plan edits do not update that link.
Sharing is for fictional demo data only; anyone with the link can read the
snapshot until expiry.

`GET /api/health` reports whether local Bedrock authentication is configured
but never exposes credentials. The hosted Lambda URL accepts the configured
page origin and checks a global quota before each Bedrock call.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run typecheck:browser
npm run typecheck:scripts
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:browser
```

The independent 30-case real-service quality campaign is opt-in and local-only.
The prior v2 campaign is preserved under `output/live-corpus-v2/`; its 159-call
allowance is nearly exhausted and does not establish a current-source pass.
A separate v3 campaign is prepared but has **not** been authorized or run.
After a separate 150-call authorization, freeze the candidate, start the
matching authenticated local API, and run:

```bash
HOME_HUDDLE_V3_AUTHORIZED=150 npm run test:quality:v3
```

The v3 runner reserves calls before each request and retains a resumable ledger
under `output/live-corpus-v3/`, separate from v2. It pins the source fingerprint,
runs all 30 cases and the four required repeats, and fails
closed if the source changes. Never delete a ledger to obtain another allowance.
No prompts or response bodies are saved. See `docs/quality-campaign.md` for the
gate, authorization state, and limitations.

The smaller historical `smoke:bedrock` command is only a connectivity check and
does not establish planning quality. Do not run it outside an agreed call allowance.
The public Lambda uses an IAM execution role and does not need a bearer key.
The preserved campaign mixes source versions and does not pass the same-version
release gate. A new campaign needs its own approved call ceiling and must run
all cases and required repeats on one frozen source fingerprint.

## Public demo deployment

The public page is built for GitHub Pages and calls a Lambda Function URL.
The Lambda uses IAM to invoke Bedrock and a DynamoDB transaction to reserve
each model call. The live demo is set to 50 calls/day and 500 calls/month,
shared by all visitors.
See the [serverless deployment guide](deploy/serverless/README.md) for the
repeatable Terraform setup. Cloning or building the repository creates no AWS
resources.

## Privacy and safety

- Use fictional data for the hackathon demonstration.
- Conversation and plan state are stored only in browser `localStorage`, but
  each request and recent history are sent to Bedrock for planning.
- Activity details saved on the calendar are included with the plan in later
  Bedrock revisions, calendar downloads, and opt-in shared snapshots. Use only
  fictional demo details; anyone with a share link can view that snapshot.
- Sharing is opt-in and stores only an immutable plan snapshot in a separate
  DynamoDB table. Expired links are rejected on read even if TTL cleanup lags.
- Audio is handled by the browser speech-recognition implementation; Home
  Huddle never receives or stores audio.
- Server logs contain request ID, model ID, latency, stop reason, tool name, and
  call count—never prompts or household details.
- `.env.local` and all other environment files are gitignored.
- The hosted function uses an IAM execution role. Never put an AWS key in the
  browser, image, or repository.

## Repositories and branches

- Main project: [andrewodom18/home-huddle](https://github.com/andrewodom18/home-huddle)
- Open-source companion:
  [andrewodom18/conversation-display-kit](https://github.com/andrewodom18/conversation-display-kit)

Development happens on `dev`. Submission-ready releases are fast-forwarded to
`main`, and both branches are kept aligned at release time.

## License

MIT
