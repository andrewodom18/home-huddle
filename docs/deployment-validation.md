# Public deployment validation

## October 5, 2026 public update and production bug repair

The public page was rebuilt from commit `b5d0ef4314ab5492026d6b1d867d4a9127c6a2e5`
on `main`. [Public demo run 37350478827](https://github.com/andrewodom18/home-huddle/actions/runs/37350478827)
completed successfully. The served HTML references `index-L-RrcQsL.js` and
`index-QrpzYbzy.css`; the CSS contains the immediate-scroll revision fix.
[CI run 37350792038](https://github.com/andrewodom18/home-huddle/actions/runs/37350792038)
passed on that frontend commit.

At the first frontend deployment, the Lambda was unchanged. Its bundled
`dist-lambda/index.js` SHA-256 is
`37786304c50682853573fb785fd19937bf83e03fefbff839005d07dbd515abc3`,
identical to the September 25 deployed code recorded below.

A live custom request then exposed an IAM-only serialization bug: absent optional
requirements became explicit `undefined` fields and failed before scheduling.
Commit `ac7fec9` fixed the serializer and a mocked two-call IAM regression passes.
A subsequent retry no longer produced that error, but misread “next week” as
the current week. Commit `a0c64e9` grounded the next-week range to the household
time zone. A fictional public smoke request then placed a Thursday errand on
Friday, exposing a missing weekday check. Commit `1ed5209` added that check and
asks for AM/PM before interpreting bare fixed times. These are application bugs,
not AWS service or tooling friction.

The final backend build is from aligned `main` and `dev` commit
`d69935a6de8cde3cb241a59c5974d9efe6d5eefb`. The local and CloudShell
`dist-lambda/index.js` SHA-256 both equal
`436c58d7897da3f52faff027b9724f378d36c6d634f12d1137a44b9cefa9ea7f`.
CloudShell updated the existing `home-huddle-demo-chat` function in `us-east-1`;
`LastUpdateStatus=Successful`, `LastModified=2026-10-05T18:09:44Z`, and
`CodeSha256=vevsBcOttP6wFrDpKQPAgEL+vjtzp90na90hCR7t7VU=`. The existing
Function URL, role, tables, and quotas remain in place.

In an isolated browser on the public page, a fictional October 10 chores
request produced a checked plan. Moving “Clean the kitchen” from 9:00 to
9:05 AM produced a review card; Apply changed the event and Undo restored
9:00 AM. This is a narrow end-to-end smoke check, not a pass of the 30-case
same-source live planning gate or five-person usability target. The regular
Chrome profile had a separate saved failed request, which was left untouched.
Against the final Lambda, a fictional request with four bare clock times returned
a focused AM/PM clarification with zero model calls. A separate fictional
five-activity next-week request with explicit times published all five activities
on the independently expected Monday, Tuesday, and Thursday dates in two
Bedrock calls. These focused checks do not constitute a same-source live gate.

## September 25, 2026 paired deployment

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
