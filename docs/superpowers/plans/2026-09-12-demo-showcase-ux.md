# Demo Showcase UX Implementation Plan

**Goal:** Make the existing dashboard readable during a live demo and usable on a phone.

**Architecture:** Keep Next.js 14, the existing discovery data and lifecycle API.
Refine the existing dark interface; no new backend or auth behavior.

## Design and scope

The existing screen is the reference. Image generation is unavailable in this
session, so use code-native UI and retain the sidebar, statistics, project cards
and detail drawer. Navy surfaces, blue actions, semantic status colors, 8/16/24px
spacing and explicit keyboard focus form the shared visual system. Do not call
an `on` status a successful health check.

- [x] Add a clear page heading, labeled search, result count, filter reset and retry.
- [x] Limit bulk start to visible eligible projects, with a count and confirmation.
- [x] Give cards explicit accessible detail buttons and clearer state/action hierarchy.
- [x] Fix mobile overflow, drawer focus/scroll behavior and scale feedback.
- [x] Correct the HPA restoration guidance to match ADR-017.
- [x] Update the frontend guide and validate typecheck, lint, tests and build.
- [x] Verify desktop/mobile search, filters, lifecycle, scale and keyboard behavior
  against the local simulated API.

Integration follows the current-head PR review loop; its live outcome belongs on
the PR rather than in this implementation snapshot.

## Verification

Add behavior tests for filtered bulk scope, retry, keyboard navigation and scale
validation/in-flight duplicate prevention. Preserve existing hook tests.
Use Playwright with the installed Chromium: the Browser plugin is unavailable
and Playwright MCP expects a missing Chrome binary. Keep screenshots and temporary
scripts outside Git. Compare hierarchy, copy, typography, palette, spacing and
mobile layout to the existing reference and the explicit changes above.
