import { describe, expect, test } from "bun:test"
import { type FilterField, type FilterRule, matchesRules, readRules, renameTags, UNASSIGNED } from "@/lib/filters"
import type { Thread } from "@/types"

const thread = (patch: Partial<Thread>): Thread => ({
  id: "t1",
  page: "/",
  anchor: {} as Thread["anchor"],
  status: "open",
  createdBy: "ann",
  createdAt: 0,
  updatedAt: 0,
  resolvedAt: null,
  resolvedBy: null,
  context: null,
  assigneeId: null,
  tags: [],
  screenshot: null,
  unread: false,
  mentioned: false,
  comments: [],
  ...patch,
})
const is = (field: FilterField, ...values: string[]) => ({ field, op: "is" as const, values })

describe("filter rules", () => {
  test("Tag is: threads with any of the tags; case does not matter", () => {
    const rules = [is("tag", "bug", "Design")]
    expect(matchesRules(thread({ tags: ["Bug"] }), rules)).toBe(true)
    expect(matchesRules(thread({ tags: ["Content", "Design"] }), rules)).toBe(true)
    expect(matchesRules(thread({ tags: ["Content"] }), rules)).toBe(false)
    expect(matchesRules(thread({ tags: [] }), rules)).toBe(false)
  })

  test("Tag is not: threads with none of the tags", () => {
    const rules = [{ field: "tag" as const, op: "is not" as const, values: ["Bug", "Design"] }]
    expect(matchesRules(thread({ tags: ["Content"] }), rules)).toBe(true)
    expect(matchesRules(thread({ tags: [] }), rules)).toBe(true)
    expect(matchesRules(thread({ tags: ["Content", "design"] }), rules)).toBe(false)
  })

  test("Started by: the person who made the thread, not the people who replied; ids must be the same", () => {
    const replied = { authorId: "bob" } as Thread["comments"][number]
    expect(matchesRules(thread({ createdBy: "ann" }), [is("startedBy", "ann", "cy")])).toBe(true)
    expect(matchesRules(thread({ createdBy: "ann", comments: [replied] }), [is("startedBy", "bob")])).toBe(false)
    expect(matchesRules(thread({ createdBy: "ann" }), [is("startedBy", "Ann")])).toBe(false)
  })

  test("Assignee: a person, or Unassigned", () => {
    expect(matchesRules(thread({ assigneeId: "bob" }), [is("assignee", "bob")])).toBe(true)
    expect(matchesRules(thread({ assigneeId: null }), [is("assignee", "bob")])).toBe(false)
    expect(matchesRules(thread({ assigneeId: null }), [is("assignee", UNASSIGNED, "bob")])).toBe(true)
    expect(matchesRules(thread({ assigneeId: "cy" }), [is("assignee", UNASSIGNED)])).toBe(false)
    const notMine = [{ field: "assignee" as const, op: "is not" as const, values: ["bob"] }]
    expect(matchesRules(thread({ assigneeId: null }), notMine)).toBe(true)
  })

  test("a thread must match all rules; a rule without values (a chip that is being made) matches all", () => {
    const rules = [is("tag", "Bug"), { field: "tag" as const, op: "is not" as const, values: ["Design"] }]
    expect(matchesRules(thread({ tags: ["Bug"] }), rules)).toBe(true)
    expect(matchesRules(thread({ tags: ["Bug", "Design"] }), rules)).toBe(false)
    expect(matchesRules(thread({ tags: [] }), [is("assignee")])).toBe(true)
  })

  test("saved rules: keeps the valid ones with values", () => {
    const valid: FilterRule = { field: "assignee", op: "is not", values: [UNASSIGNED, "bob"] }
    expect(
      readRules([
        valid,
        { field: "tag", op: "is", values: [] },
        { field: "page", op: "is", values: ["/"] },
        { field: "tag", op: "has", values: ["Bug"] },
        { field: "tag", op: "is", values: ["Bug", 3] },
        null,
      ]),
    ).toEqual([valid])
    expect(readRules("tag:bug")).toEqual([])
    expect(readRules(undefined)).toEqual([])
  })

  test("a renamed tag changes in the rules; a deleted tag goes out, and so does a rule with no tags left", () => {
    const rules = [is("tag", "Bug", "Idea"), is("tag", "bug"), is("startedBy", "Bug"), is("tag")]
    expect(renameTags(rules, (name) => (name.toLowerCase() === "bug" ? "Defect" : name))).toEqual([
      is("tag", "Defect", "Idea"),
      is("tag", "Defect"),
      is("startedBy", "Bug"),
      is("tag"),
    ])
    expect(renameTags(rules, (name) => (name.toLowerCase() === "bug" ? null : name))).toEqual([
      is("tag", "Idea"),
      is("startedBy", "Bug"),
      is("tag"),
    ])
    // Nothing changed: the same rules, so the state does not change.
    expect(renameTags(rules, (name) => name)).toBe(rules)
  })
})
