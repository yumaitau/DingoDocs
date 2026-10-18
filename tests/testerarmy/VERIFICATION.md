# Local verification

Validated on 18 October 2026 (UTC) against task-owned loopback PostgreSQL databases and the real Next.js application. Both Chromium viewports cover **190 unique cases**, including setup and the route inventory. There are **38 page routes** and **17 engagement tabs**.

| Check                                               | Result                                                | Evidence                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Chromium                                    | 190 unique cases verified                             | Full 184-case run passed; all six added shell journeys passed separately.                                                                                       |
| Mobile Chromium                                     | 190 unique cases verified after queue-wait correction | Full run passed 189 cases; the export case initially exhausted its 60-second wait. All four report cases then passed on both viewports with the corrected wait. |
| Signup regression                                   | Both viewports passed                                 | Mobile drawer is opened before asserting workspace identity; isolation and saved time zones are still verified.                                                 |
| Unit and PostgreSQL integration                     | 222 passed, zero skipped across 43 files              | `pnpm test --maxWorkers=2` against a separate migrated database.                                                                                                |
| Production build, TypeScript, ESLint and formatting | Passed                                                | ESLint reports three existing unused-parameter warnings outside this change.                                                                                    |

Existing browser regressions also passed:

- Playwright: **34 passed**, four intentional mobile skips for API contracts and mutable preference/runbook cases that run once on desktop. Includes real screenshot uploads, drag/reorder, reusable layouts and PDF exports.
- Lightpanda: **five passed**, covering public security metadata, guards, authenticated workspaces and tenant-scoped REST reads.

Tester Army run IDs:

- Desktop full suite: `01a14eeb-828f-7da0-a480-db2a031268bd` — 184 passed, zero failed/skipped.
- Desktop shell: `01a14efb-c01a-7050-984d-9e294efa2501` — six journeys and two setup cases passed.
- Responsive signup: `01a14eff-5644-7be5-bdeb-351e2478ecb1` — both viewport cases passed.
- Mobile full suite before queue-wait correction: `01a14eff-df07-7327-8240-e6049bfbfaae` — 189 passed, one export-wait timeout, zero skipped.
- Report regression on both viewports: `01a14f0b-4ef4-743a-b301-56dd4343e94d` — eight report cases and two setup cases passed, including all seven download formats.

The export test uses the real background worker, which processes five jobs every 30 seconds. Scanner previews also enqueue evidence scans. The corrected six-minute polling budget allows both viewport targets' scanner backlog to drain without bypassing the worker or removing export assertions.

The suite exposed and verified fixes for browser scanner MIME differences, report-template save navigation, colliding UUIDv7-based engagement references, and valid decimal time entries rejected by the HTML step constraint.

These are local results. GitHub Actions validation is a separate run after push. Coverage boundaries, including external providers and inert UI controls, are listed in [README.md](./README.md#evidence-and-limits).
