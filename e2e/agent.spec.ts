// A coding agent works on the comments: it connects, the person allows it in the widget, then it reads the comments
// and replies as the person (see /llms.txt).
import { expect, request, test } from "@playwright/test"
import {
  addComment,
  COMMA,
  endCommentMode,
  guestSession,
  openTestPage,
  pins,
  SITE,
  signIn,
  testPath,
  threadPopover,
} from "./helpers"

/** The agent asks to connect, like `curl -X POST …/agent/connect`. */
async function connectAgent() {
  const api = await request.newContext()
  const res = await api.post(`${COMMA}/agent/connect`, { data: { project: "example" } })
  expect(res.ok()).toBe(true)
  const { code, secret } = (await res.json()) as { code: string; secret: string }
  const token = () => api.post(`${COMMA}/agent/token`, { data: { secret } })
  return { api, code, token }
}

const allowDialog = (page: import("@playwright/test").Page) =>
  page.getByRole("alertdialog", { name: "Allow your agent?" })

test("the person allows the agent, and the agent's reply shows in the thread", async ({ page }) => {
  const session = await guestSession("Ada")
  await signIn(page, session)
  await openTestPage(page, "agent")
  await addComment(page, page.getByTestId("title"), "Make this bigger")
  await endCommentMode(page)

  const agent = await connectAgent()
  await page.goto(`${testPath("agent")}#comma-connect=${agent.code}`)
  const dialog = allowDialog(page)
  await expect(dialog).toContainText(agent.code)
  await expect(dialog).toContainText("as Ada: read, reply, comment, resolve, tag and assign")
  await dialog.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(dialog).toBeHidden()
  // The link does not ask again after a reload.
  expect(new URL(page.url()).hash).toBe("")

  const granted = await agent.token()
  expect(granted.status()).toBe(200)
  const authorization = `Bearer ${(await granted.json()).token}`
  const markdown = await (await agent.api.get(`${COMMA}/agent/threads`, { headers: { authorization } })).text()
  expect(markdown).toContain("Make this bigger")

  // Like an agent: the thread id from the markdown, in the section of this test's page.
  const section = markdown.split("\n## ").find((s) => s.includes(`${SITE}${testPath("agent")}`))
  const threadId = /- Thread: (\S+)/.exec(section ?? "")?.[1]
  expect(threadId).toBeTruthy()
  const reply = await agent.api.post(`${COMMA}/agent/threads/${threadId}/reply`, {
    headers: { authorization },
    data: "Fixed: the title is larger now.",
  })
  expect(reply.ok()).toBe(true)

  // The next update shows the reply, as Ada.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await pins(page).first().click()
  await expect(threadPopover(page)).toContainText("Fixed: the title is larger now.")
})

test("signed out, the person signs in first; when they do not allow it, the agent gets no token", async ({ page }) => {
  const agent = await connectAgent()
  await page.goto(`${testPath("agent-signed-out")}#comma-connect=${agent.code}`)
  const dialog = allowDialog(page)
  await expect(dialog).toContainText(agent.code)
  await dialog.getByLabel("Your name").fill("Ada")
  await dialog.getByRole("button", { name: "Continue as guest" }).click()
  await dialog.getByRole("button", { name: "Don't allow" }).click()
  await expect(dialog).toBeHidden()
  expect((await agent.token()).status()).toBe(410)
})
