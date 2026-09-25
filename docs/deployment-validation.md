# Public deployment validation — 2026-09-25

The frontend and Lambda were built from Home Huddle commit
`a33a15854e36e1ca4c4194097031947225b4ec2b` on `main` and `dev`.
This records deployment and smoke checks, not a pass of the live planning-quality
gate or a usability study.

| Component | Deployment evidence | Observed check |
| --- | --- | --- |
| Source | [CI run 36154082137](https://github.com/andrewodom18/home-huddle/actions/runs/36154082137) | Lint, types, unit tests, Chromium/Firefox/WebKit browser tests, build, and packaged Lambda cold start passed on the source commit. |
| Public page | [Public demo run 36154895229](https://github.com/andrewodom18/home-huddle/actions/runs/36154895229) | Deployed from the same commit. The live HTML served `index-BCWm7C0U.js` and `index-CRGtO7mi.css`; the bundle contained the draft-review heading. Headless Chromium rendered the live welcome screen at 390 and 1440 pixels without page errors or horizontal overflow. |
| Lambda | Existing `home-huddle-demo-chat` in `us-east-1` | The CloudShell checkout resolved to the source commit. Its `dist-lambda/index.js` SHA-256 was `37786304c50682853573fb785fd19937bf83e03fefbff839005d07dbd515abc3`, identical to the local build. `update-function-code` completed with `LastUpdateStatus=Successful`, `CodeSha256=1k2lZdA1A18Vv5tI63Sd1ohPk1RGv3b1m1T8Qf8c7qQ=`, and `LastModified=2026-09-25T15:35:03Z`. |
| Live share API | Existing Function URL, fictional test plan | One `share-create` followed by `share-resolve` returned the expected plan and a valid `createdAt` timestamp. The token was held in memory and not logged. This used no Bedrock call. |

The code-only Lambda update retained the existing role, Function URL, tables, and
quotas. It bypassed Terraform because this Mac's installed AWS CLI and Terraform
binaries cannot run on its architecture, and the original Terraform state and
variables were unavailable locally. Recover and reconcile that state before a
future `terraform apply`; do not initialize a fresh state against the existing
named resources.

The v3 30-case same-source Bedrock campaign has not been authorized or run. The
five independent usability sessions and a public demonstration video also remain
open. The checks above establish the deployed code path and a narrow share smoke
test, not broad live planning quality.
