output "chat_url" {
  value = aws_lambda_function_url.chat.function_url
}

output "quota_table_name" {
  value = aws_dynamodb_table.quota.name
}
