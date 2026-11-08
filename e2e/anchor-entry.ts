// Test build of the anchor module for e2e/anchors.spec.ts.
import { anchorBox, createAnchor, resolveAnchor } from "../widget/src/anchor"

Object.assign(window, { commaAnchor: { createAnchor, resolveAnchor, anchorBox } })
