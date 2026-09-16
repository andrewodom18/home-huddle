# Near-zero-idle public demo

Home Huddle's public page is a GitHub Pages build. A public AWS Lambda Function
URL handles chat, using its IAM role to call Amazon Bedrock. A DynamoDB
on-demand table atomically counts **each actual Converse call** against UTC
day and month quotas. The default limits are 50 calls/day and 500 calls/month;
each chat may use up to three calls. When either quota is exhausted, the page
shows a clear message and disables immediate retry. The quota is global, so
all visitors share it.

Lambda Function URLs have no separate endpoint fee; Lambda and DynamoDB
on-demand charge for usage. GitHub Pages can host the public repository's
static build. A flood of rejected requests can still create Lambda usage
charges, and AWS Budget alerts do **not** stop spending. The Lambda function
has two reserved concurrent executions. Review current [Lambda Function URL
pricing](https://docs.aws.amazon.com/lambda/latest/dg/apig-http-invoke-decision.html),
[Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), and
[AWS Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)
before deployment.

## Prerequisites

- Public Home Huddle and Conversation Display Kit repositories, with the
  `v0.1.1` kit asset anonymously installable.
- An approved AWS SSO/profile session with Lambda, DynamoDB, IAM, CloudWatch
  Logs, Bedrock, and Budgets permissions. Never place AWS credentials in Git,
  GitHub Actions, or the browser.
- Verified Bedrock access for `us.amazon.nova-2-lite-v1:0` in `us-east-1`.
  Use `aws bedrock get-inference-profile --inference-profile-identifier
  us.amazon.nova-2-lite-v1:0 --region us-east-1` to obtain the profile ARN and
  all destination model ARNs. The Terraform role permits only those ARNs.
- A budget alert email and monthly USD threshold chosen by the owner. Put
  them only in the ignored local `terraform.tfvars` or approved secret store;
  never commit or paste them into a command log.

## Deploy the backend

From the Home Huddle root, build the single-file Lambda zip. Terraform 1.6+
and AWS provider 6.41.0 are required. The ignored `terraform.tfvars` in
`deploy/serverless` must provide `inference_profile_arn`,
`foundation_model_arns`, `monthly_budget_usd`, and `budget_email`. The default
`public_origin` is `https://andrewodom18.github.io` for the GitHub Pages
project site; set it to the exact HTTPS origin if hosting changes.

```bash
npm ci
npm run package:lambda
terraform -chdir=deploy/serverless init
terraform -chdir=deploy/serverless plan
terraform -chdir=deploy/serverless apply
terraform -chdir=deploy/serverless output -raw chat_url
```

Review the plan before applying. Terraform creates a public URL with
`authorization_type=NONE` and a CORS allowlist for the page origin. Browser
CORS and the app's Origin check reduce cross-site use; they are not
authentication. DynamoDB's conditional transaction is the Bedrock cost cap.
Terraform state contains account metadata and should be protected and backed
up outside Git. The provider lockfile is committed.

## Publish the page

Set the repository Actions variable `HOME_HUDDLE_API_URL` to Terraform's
`chat_url` output. Configure GitHub Pages to deploy from GitHub Actions, then
run the `Public demo` workflow on `main`. It builds with
`SITE_BASE_PATH=/home-huddle/` and injects the public Lambda URL into the
browser bundle. The URL is public by design; it is not an AWS credential.

Verify the HTTPS page, one fictional scenario, one revision, AWS evidence,
and a visible quota error using a temporarily low test quota. Then restore
the chosen quota and publish the video and hackathon links. Never log prompts
or household details during verification.
