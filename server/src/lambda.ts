// Entry: AWS Lambda (Node.js) with a Function URL. `scripts/build-lambda.ts` bundles it, with the widget next to it.
import { join } from "node:path"
import { handle, type LambdaContext, type LambdaEvent } from "@hono/aws-lambda"
import { createClient } from "@libsql/client/web"
import { lazyApp } from "./serverless"

const getApp = lazyApp(createClient, { widgetDir: join(import.meta.dirname, "widget") })

// The EventBridge schedule (template.yaml) sends `{ "cleanup": true }`. Everything else is a Function URL request.
export async function handler(event: LambdaEvent | { cleanup: true }, context: LambdaContext) {
  const app = await getApp()
  if ("cleanup" in event) return await app.cleanup()
  return handle(app)(event, context)
}
