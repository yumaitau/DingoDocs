# Tester Army end-to-end suite

Uses [`e2e`](https://tester.army/e2e) and `@e2e-dev/web` against the real Next.js app, PostgreSQL, server actions, storage and browser. No mocked application responses or AI model are needed. Existing Playwright tests remain available as `pnpm test:e2e`.

See [local verification results](./VERIFICATION.md) for recorded runs and validation details.

## Run

Requires Node 22.22.3+ on the Node 22 line, or Node 24.8+, pnpm 10.33.0, and a **disposable local PostgreSQL database whose name ends in `_e2e`**. The runner refuses remote database hosts. It migrates and seeds that database; it never resets or drops it. Repeated runs add uniquely named synthetic records, so periodically replace the disposable database yourself.

```sh
createdb dingodocs_e2e
pnpm install --frozen-lockfile
pnpm exec e2e-web install chromium
TEST_DATABASE_URL=postgres://localhost/dingodocs_e2e pnpm test:e2e:army

# A single viewport or feature:
TEST_DATABASE_URL=postgres://localhost/dingodocs_e2e pnpm test:e2e:army --target mobile
TEST_DATABASE_URL=postgres://localhost/dingodocs_e2e pnpm test:e2e:army tests/testerarmy/imports.e2e.ts --target desktop

# Targeted rerun after a successful build, only when app source/config is unchanged:
TEST_DATABASE_URL=postgres://localhost/dingodocs_e2e pnpm test:e2e:army --reuse-build tests/testerarmy/imports.e2e.ts --target desktop
```

The runner builds the app, then starts its own loopback production app on port 3107 (override `TESTERARMY_PORT`), creates random local test credentials and encryption keys, disables outbound email and AI calls, and shuts down its app when the run ends. Database server lifecycle remains yours. It does not reuse another running app. Invoke through `test:e2e:army`, which supplies the test environment, rather than invoking `e2e run` directly. Use a fresh database if the demo owner's credentials have changed.

## Coverage

- Every `src/app/**/page.tsx` route is inventoried; adding an unlisted page fails `routes.e2e.ts`.
- Desktop Chromium at 1440×1000 and mobile Chromium at 390×844.
- All workspace pages, all 17 engagement tabs, all public authentication pages, onboarding, invitation display, import preview, client portal and account pages.
- Signed-out guards and client-role restrictions on internal pages.
- All 18 navigation destinations, mobile drawer opening/closing, command-palette destinations and quick action, real search results, empty search, keyboard dismissal and shortcut.
- All four interface languages persist after reload. Notification links and individual/bulk read state persist. Portal navigation and fresh-session sign-out are exercised without revoking shared test sessions.
- Signup creates a new isolated organisation; time-zone changes persist after reload, and the new tenant cannot see seeded client records.
- Workspace select controls: each enabled option is selected and its displayed value checked, including fields inside disclosures. This verifies control interaction, **not** server persistence for every option.
- Persisted workflows: client profile/defaults; all nine assessment types; all five opportunity stages; four asset criticalities; both note kinds and all three visibilities; task priorities, active states and completion; saved board; program assignment; all five runbook execution states; five engagement roles; rules approval; timeline and time entries.
- Findings snapshot an approved template, persist all five severities, narrative fields, compliance tags and due dates. Separate author/reviewer identities exercise changes requested, peer review, QA, publication, remediation, retesting, resolution, risk acceptance and closure. Cancelled tasks leave active views while remaining in the engagement record.
- All 21 scanner formats upload through the browser and show normalized preview records. Selective import verifies included/excluded findings and duplicate prevention. Both organisation export modes download JSON.
- Both API credential types verify an allowed and forbidden scope and exercise revocation. All three evidence classifications upload, persist and download original bytes.
- Report starters, all nine palette controls, all 22 block types, duplicate/delete, undo/redo, ordering, persistence, copying, template/report independence and seven export formats.
- Every analytics period, severity and workflow option is submitted; password-recovery and missing-reset-token behavior; portal search and empty results.

## Evidence and limits

`.e2e/report.json`, `.e2e/junit.xml`, `.e2e/summary.md` and failure traces under `.e2e/results/` are generated and ignored by Git. CI runs each viewport in a separate job/database and writes the Markdown report to the job summary. It follows the repository's policy of avoiding Actions artifact uploads because of organisation storage limits. The framework suppresses screenshots after secret input, including restored authenticated sessions; traces and assertions still run. Never publish generated credentials or storage files.

Page coverage is not exhaustive state-space coverage. Option sweeps do not submit dangerous settings. Live OAuth/SSO identity providers, WebAuthn hardware, MFA recovery, real SMTP/SES, Jira/chat webhook delivery, external AI providers, production retention purges, every report/finding approval transition, annotation operation and retest outcome need additional isolated fixtures or configured providers. The current UI also contains inert controls such as Team's “Invite member”, Tasks' “New task”, engagement “More actions” and the workspace profile button; opening those workflows cannot be verified until implemented. This suite must not be described as proving every feature works.

When extending coverage, use real UI actions and verify the resulting record after reload or download. Prefer semantic locators, exact labels and unique synthetic data. Keep authentication throttling enabled. Read `pnpm exec e2e guide writing-tests` for the installed framework API.
