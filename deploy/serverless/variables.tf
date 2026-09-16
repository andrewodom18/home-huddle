variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "public_origin" {
  type    = string
  default = "https://andrewodom18.github.io"
  validation {
    condition     = startswith(var.public_origin, "https://") && !endswith(var.public_origin, "/")
    error_message = "Use an HTTPS origin without a trailing slash."
  }
}

variable "model_id" {
  type    = string
  default = "us.amazon.nova-2-lite-v1:0"
}

variable "inference_profile_arn" {
  type        = string
  description = "Nova inference profile ARN for this account."
  validation {
    condition     = startswith(var.inference_profile_arn, "arn:aws:bedrock:")
    error_message = "Provide the selected Bedrock inference profile ARN."
  }
}

variable "foundation_model_arns" {
  type        = list(string)
  description = "Foundation model ARNs in the inference profile's destination regions."
  validation {
    condition     = length(var.foundation_model_arns) > 0 && alltrue([for arn in var.foundation_model_arns : startswith(arn, "arn:aws:bedrock:")])
    error_message = "Provide at least one Bedrock foundation model ARN."
  }
}

variable "daily_bedrock_call_limit" {
  type    = number
  default = 50
  validation {
    condition     = var.daily_bedrock_call_limit >= 1 && var.daily_bedrock_call_limit <= 100
    error_message = "Choose 1 to 100 Bedrock calls per UTC day."
  }
}

variable "monthly_bedrock_call_limit" {
  type    = number
  default = 500
  validation {
    condition     = var.monthly_bedrock_call_limit >= 1 && var.monthly_bedrock_call_limit <= 1000
    error_message = "Choose 1 to 1000 Bedrock calls per UTC month."
  }
}

variable "monthly_budget_usd" {
  type = number
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "Choose a positive monthly budget alert amount."
  }
}

variable "budget_email" {
  type        = string
  description = "Email address for 80% and 100% AWS Budget alerts. Keep it out of Git."
}
