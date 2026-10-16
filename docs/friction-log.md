# Developer friction log

These observations were made while building Home Huddle during the hackathon.
They describe specific development experiences, not a claim that every issue is
an AWS service defect. The [historical log](https://github.com/andrewodom18/home-huddle/blob/ab035bb/SUBMISSION.md#friction-log)
preserves the original campaign and deployment notes. Current verification and
deployment limits are recorded in [verification.md](verification.md).

## 1. JavaScript authentication and the first Converse request

- **Task:** Make a local JavaScript Converse request with a short-term Bedrock key.
- **Steps:** Compare the API-key quickstart, JavaScript runtime documentation,
  and Converse tool-use examples, then assemble a runnable request.
- **Expected:** One TypeScript example with authentication, region, endpoint,
  model/profile ID, message body, and tool schema.
- **Actual:** API-key examples emphasized Python or raw HTTP while JavaScript
  examples emphasized the AWS credential chain; the complete setup required
  cross-referencing several pages.
- **Severity:** Medium; it delayed the first working request.
- **Workaround:** Use the documented bearer header with native fetch for local
  key-based requests, and the AWS SDK with an IAM execution role for Lambda.
- **Suggestion:** Publish one end-to-end TypeScript short-term-key and tool-use
  quickstart, with an IAM-based hosted alternative.

## 2. Nova model versus inference-profile identifier

- **Task:** Run Nova 2 Lite on demand through Converse in `us-east-1`.
- **Steps:** Select `amazon.nova-2-lite-v1:0`, make a live request, then retry
  with `us.amazon.nova-2-lite-v1:0`.
- **Expected:** The selected model identifier works with the documented request.
- **Actual:** The base model ID was rejected for on-demand throughput; the US
  inference-profile ID worked. Model, profile, and region guidance was spread
  across different documentation pages.
- **Severity:** Medium; the first inference request failed.
- **Workaround:** Configure the US inference-profile ID and scope IAM access to
  its profile and destination model ARNs.
- **Suggestion:** Include a copyable recommended first request on each model
  page, with the supported region and inference-profile ID together.

## 3. Scoping the Alexa+ web simulation

- **Task:** Identify the requirements for a simulated Alexa+ hackathon entry.
- **Steps:** Compare the hackathon rules with production MCP onboarding docs.
- **Expected:** A dedicated checklist for the web-simulation submission path.
- **Actual:** The rules permit a framework-neutral simulation, while detailed
  integration documentation focuses on production MCP add-ons.
- **Severity:** Medium; the difference required careful scoping.
- **Workaround:** State the simulation boundary explicitly and demonstrate real
  Bedrock planning, source code, and runtime evidence in the web app.
- **Suggestion:** Add a separate simulation checklist and runnable reference app.

## 4. Structured output does not establish schedule correctness

- **Task:** Generate parallel, multi-day plans and apply precise revisions.
- **Steps:** Run fictional independent planning cases and compare the returned
  schedule with requirements specified separately from model output.
- **Expected:** A valid plan, a useful clarification, or a clear conflict.
- **Actual:** Earlier campaigns found omitted constraints, overlaps, and
  revisions that did not make the requested change. JSON-schema checks alone
  could not detect constraints omitted from the interpreted checklist. Some
  requests also exhausted application repair or timeout budgets.
- **Severity:** High for application reliability.
- **Workaround:** Separate interpretation and scheduling; retain authoritative
  requirements; validate schedules and exact edits; bound repairs; show a
  first-plan review; preserve failed campaign observations. October 16 dev
  regressions also cover preserving accepted preset edits and overriding a
  custom appointment without resurrecting its old time from chat history.
- **Suggestion:** Provide realistic multi-constraint tool-use examples and
  guidance for independently evaluating interpretation, repairs, and call cost.
- **Attribution:** These are application/model interaction findings, not proof
  of an AWS service defect. The full current-source live campaign remains
  incomplete; passing fixture tests does not establish live planning quality.

## 5. CloudShell credentials during a Lambda update

- **Observed:** October 5, 2026.
- **Task:** Update the existing `home-huddle-demo-chat` Lambda in `us-east-1`.
- **Steps:** Run `aws sts get-caller-identity` and the Lambda update after a
  CloudShell restart; restart that CloudShell and retry.
- **Expected:** The signed-in console supplies working temporary CLI credentials.
- **Actual:** Container-role credential retrieval failed with metadata HTTP 500;
  restarting that regional CloudShell did not resolve it.
- **Severity:** High for that deployment attempt.
- **Workaround:** Open CloudShell in `us-west-2`, verify identity, and update the
  same function explicitly with `--region us-east-1`; AWS reported success.
- **Suggestion:** Improve credential-recovery diagnostics and document the
  regional-shell workaround separately from application or Bedrock failures.

## 6. Reproducing public Function URL access with Terraform

- **Observed:** October 16, 2026, during source review.
- **Task:** Reproduce the public Lambda endpoint from the checked-in Terraform.
- **Steps:** Compare the Function URL resource and resource policies with AWS's
  current Function URL authorization requirements.
- **Expected:** Applying the module grants precisely the access needed to call
  its public Function URL.
- **Actual:** `authorization_type = "NONE"` was present without the two required
  resource-policy permissions. A fresh deployment would reject public calls.
- **Severity:** High for deployment reproducibility; this review did not show
  that the existing, separately configured deployed function lacked access.
- **Workaround:** The dev module now grants `lambda:InvokeFunctionUrl` only for
  `NONE` auth and `lambda:InvokeFunction` only through the Function URL.
- **Suggestion:** Include both resource-policy grants in IaC examples and
  distinguish console-created permissions from API/Terraform provisioning.
- **Reference:** [AWS Function URL access documentation](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html).
