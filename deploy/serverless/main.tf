terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.41.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  tags = {
    Project = "HomeHuddle"
    Purpose = "HackathonDemo"
  }
}

resource "aws_dynamodb_table" "quota" {
  name         = "home-huddle-bedrock-quota"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "period"

  attribute {
    name = "period"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "shares" {
  name         = "home-huddle-share-snapshots"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = local.tags
}

resource "aws_iam_role" "lambda" {
  name = "home-huddle-lambda-bedrock"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "runtime" {
  name = "home-huddle-bedrock-and-quota"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = concat([var.inference_profile_arn], var.foundation_model_arns)
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.quota.arn
        Condition = {
          "ForAnyValue:StringEquals" = {
            "dynamodb:EnclosingOperation" = ["TransactWriteItems"]
          }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.shares.arn
        Condition = {
          "ForAnyValue:StringEquals" = {
            "dynamodb:EnclosingOperation" = ["TransactWriteItems"]
          }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.shares.arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/home-huddle-demo-chat"
  retention_in_days = 7
  tags              = local.tags
}

resource "aws_lambda_function" "chat" {
  function_name                  = "home-huddle-demo-chat"
  filename                       = "${path.module}/../../dist-lambda/function.zip"
  source_code_hash               = filebase64sha256("${path.module}/../../dist-lambda/function.zip")
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  role                           = aws_iam_role.lambda.arn
  memory_size                    = 512
  timeout                        = 100
  reserved_concurrent_executions = 2

  environment {
    variables = {
      BEDROCK_AUTH_MODE          = "iam"
      BEDROCK_MODEL_ID           = var.model_id
      PUBLIC_ORIGIN              = var.public_origin
      QUOTA_TABLE_NAME           = aws_dynamodb_table.quota.name
      SHARE_TABLE_NAME           = aws_dynamodb_table.shares.name
      DAILY_BEDROCK_CALL_LIMIT   = tostring(var.daily_bedrock_call_limit)
      MONTHLY_BEDROCK_CALL_LIMIT = tostring(var.monthly_bedrock_call_limit)
    }
  }

  depends_on = [
    aws_iam_role_policy.runtime,
    aws_iam_role_policy_attachment.logs,
    aws_cloudwatch_log_group.lambda,
  ]
  tags = local.tags
}

resource "aws_lambda_function_url" "chat" {
  function_name      = aws_lambda_function.chat.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [var.public_origin]
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
}

resource "aws_budgets_budget" "demo" {
  name         = "home-huddle-serverless-monthly"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
