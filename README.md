# Home Huddle

Home Huddle is a simulated Alexa+ household planning experience powered by
Amazon Bedrock. It turns competing household constraints into a clear,
assignable schedule and supports conversational revisions.

[Try the public demo](https://andrewodom18.github.io/home-huddle/).

Conversation state stays in the browser. The Node API does not persist prompts;
it sends each planning request to Amazon Bedrock. The public page runs on
GitHub Pages with a small AWS Lambda backend.

## What it demonstrates

- A conversational planning flow with three fictional, demo-ready scenarios.
- Real Amazon Nova 2 Lite tool use through the Bedrock Converse API.
- A structured, validated schedule that can be revised conversationally.
- Server-owned checklists for examples and displayed interpreted checklists for
  free text, with stable task IDs and validation before publication.
- Apply/Keep current review for revisions, one-level undo, a dated day view,
  `.ics` download, and opt-in seven-day read-only snapshot links.
- Optional browser speech recognition with a complete text fallback.
- An expandable, non-sensitive AWS trace showing model, tool use, and latency.
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
       │ Nova 2 Lite requests publish_household_plan
       ▼
Zod validation → normalized HouseholdPlan → browser
```

The server permits at most three Bedrock calls per user request. A valid tool
payload is normalized with stable task IDs, a version number, and a timestamp.
Invalid tool output is returned to the model for bounded repair and never
rendered as a plan. For free text, only displayed interpreted constraints are
verified; an uncaptured constraint is not claimed as checked.

## Run locally

### Requirements

- Node.js 20 or newer.
- An AWS account with access to Amazon Bedrock in `us-east-1`.
- A development Bedrock API key or AWS credentials with Bedrock model access.
  AWS provides a
  [30-day key quickstart](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api-keys.html).

### Setup

```bash
npm ci
cp .env.example .env.local
```

`npm ci` installs the pinned public Conversation Display Kit `v0.2.0` release
asset. It has been verified with an empty npm cache and no GitHub credentials.

Add the Bedrock key to `.env.local`:

```dotenv
AWS_BEARER_TOKEN_BEDROCK=your-key-here
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0
```

Start the local web and API servers:

```bash
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API listens only on
`127.0.0.1:8787`. Revoke the development key after judging.

## API

`POST /api/chat` accepts a message, up to 12 previous text messages, and an
optional current plan and scenario ID. It returns an assistant reply, an optional replacement
plan, and safe integration metadata. See `shared/contracts.ts` for the complete
Zod schemas and TypeScript types.

The same hosted POST URL also accepts `share-create` and `share-resolve`
actions. The browser keeps the unguessable token in the URL fragment and
sends it in a POST body. Snapshots contain the accepted plan, date, and time
zone—not chat history—and expire after seven days. Sharing is for fictional
demo data only; anyone with the link can read the snapshot until expiry.

`GET /api/health` reports whether local Bedrock authentication is configured
but never exposes credentials. The hosted Lambda URL accepts the configured
page origin and checks a global quota before each Bedrock call.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The real-service smoke test is opt-in because it incurs a Bedrock request:

```bash
npm run smoke:bedrock
```

For an AWS IAM session instead of a development key, set
`BEDROCK_AUTH_MODE=iam` and use the AWS SDK credential chain. The public Lambda
function uses an execution role and does not need a bearer key.

## Public demo deployment

The public page is built for GitHub Pages and calls a Lambda Function URL.
The Lambda uses IAM to invoke Bedrock and a DynamoDB transaction to reserve
each model call. The live demo is set to 50 calls/day and 500 calls/month,
shared by all visitors. A $1 monthly AWS budget sends email alerts at 80% and
100% of the threshold; alerts do not stop charges.
See the [serverless deployment guide](deploy/serverless/README.md) for the
repeatable Terraform setup. Cloning or building the repository creates no AWS
resources.

## Privacy and safety

- Use fictional data for the hackathon demonstration.
- Conversation and plan state are stored only in browser `localStorage`, but
  each request and recent history are sent to Bedrock for planning.
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
