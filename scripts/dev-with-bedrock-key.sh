#!/usr/bin/env bash
set -euo pipefail
set +x

if [[ ! -t 0 ]]; then
  printf 'Run this in an interactive terminal so the key stays out of logs.\n' >&2
  exit 1
fi

case "${1:-}" in
  "")
    printf 'Paste a short-term Bedrock API key (input hidden): ' >&2
    IFS= read -r -s bedrock_dev_key
    printf '\n' >&2
    ;;
  --clipboard)
    if [[ $# -ne 1 ]] || ! command -v pbpaste >/dev/null 2>&1; then
      printf 'Clipboard mode needs macOS pbpaste and no extra arguments.\n' >&2
      exit 1
    fi
    bedrock_dev_key="$(pbpaste)"
    printf 'Read Bedrock key from the clipboard without displaying it.\n' >&2
    ;;
  *)
    printf 'Use no arguments or --clipboard.\n' >&2
    exit 1
    ;;
esac
if [[ -z "$bedrock_dev_key" ]]; then
  printf 'No key found; the preview was not started.\n' >&2
  exit 1
fi

export AWS_BEARER_TOKEN_BEDROCK="$bedrock_dev_key"
unset bedrock_dev_key
export BEDROCK_AUTH_MODE=bearer
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0
exec npm run dev
