# Browser testing

DingoDocs uses two explicit Playwright partitions. Chromium desktop and mobile cover the complete suite, including keyboard interaction, file uploads, one-time credentials, and report workflows. Lightpanda covers compatible DOM, navigation, cookie, authentication, and REST journeys. It does not replace Chromium for screenshots, video, uploads, passkeys, or other browser-specific APIs.

## Local application

`pnpm test:e2e` starts the Next.js development server and runs the Chromium projects. `pnpm test:e2e:lightpanda` downloads the official Lightpanda 0.4.0 binary for the current macOS or Linux architecture, verifies its pinned SHA-256 digest, disables telemetry and core dumps, starts a loopback-only CDP server, and runs one test worker. The verified binary is cached under `.cache/lightpanda`.

Set `LIGHTPANDA_EXECUTABLE_PATH` to use an already installed binary. Set `LIGHTPANDA_CDP_URL` to use an already running loopback or SSH-forwarded CDP endpoint. The runner never falls back to Chromium.

## Homelab or deployed host

Set `PLAYWRIGHT_BASE_URL` to skip Playwright's local web server and test the supplied deployment. Supply deployment-specific test credentials through environment variables; do not place them in shell history, source control, test output, screenshots, or traces.

```sh
PLAYWRIGHT_BASE_URL=http://192.168.1.228:3000 \
E2E_ADMIN_EMAIL=admin@dingodocs.local \
E2E_ADMIN_PASSWORD='replace-with-test-password' \
pnpm test:e2e

PLAYWRIGHT_BASE_URL=http://192.168.1.228:3000 \
E2E_ADMIN_EMAIL=admin@dingodocs.local \
E2E_ADMIN_PASSWORD='replace-with-test-password' \
pnpm test:e2e:lightpanda
```

Use a dedicated synthetic tenant. The Chromium suite creates scoped API credentials and uploads synthetic evidence, then revokes credentials it creates. Never target a production tenant containing real client data.
