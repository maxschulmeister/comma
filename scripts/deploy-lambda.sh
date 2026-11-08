#!/usr/bin/env bash
# Deploys comma to AWS Lambda with the AWS CLI only (see DEPLOY.md). Safe to run again.
# It builds comma, makes or updates the stack from template.yaml, then uploads the code to the function.
#
#   STACK=comma AWS_REGION=eu-central-1 [COMMA_CONFIG=projects.ts] scripts/deploy-lambda.sh [aws cloudformation deploy options]
#
# The first deploy needs the parameters, for example `--parameter-overrides file://parameters.json`. Later deploys keep
# the parameters that are not given.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${STACK:?Set STACK, the stack name}"
: "${AWS_REGION:?Set AWS_REGION}"
export AWS_REGION

aws sts get-caller-identity > /dev/null
bun install --frozen-lockfile
bun run build
bun scripts/build-lambda.ts
rm -f dist/lambda.zip
(cd dist/lambda && zip -qr ../lambda.zip .)

aws cloudformation deploy --stack-name "$STACK" --template-file template.yaml \
  --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset "$@"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
function=$(output FunctionName)
aws lambda update-function-code --function-name "$function" --zip-file fileb://dist/lambda.zip > /dev/null
aws lambda wait function-updated-v2 --function-name "$function"
echo "comma is at $(output Url)"
