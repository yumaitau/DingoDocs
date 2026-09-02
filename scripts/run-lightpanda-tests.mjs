import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const version = "0.4.0";
const binaries = {
  "darwin-arm64": {
    asset: "lightpanda-aarch64-macos",
    sha256: "840547bb7b98743a3e32618a4d120ac4a75e7c3c2d227ecf5ce8d508ddc118b7",
  },
  "darwin-x64": {
    asset: "lightpanda-x86_64-macos",
    sha256: "fe50a51d4983dd1b93d410c5ac176bb14b7e57da940a5a0eb381a69f18bc57bd",
  },
  "linux-arm64": {
    asset: "lightpanda-aarch64-linux",
    sha256: "5e3b54deed642ffeb2b8f24a1931e54c51161f44d9d728135da3d4863cb722fb",
  },
  "linux-x64": {
    asset: "lightpanda-x86_64-linux",
    sha256: "bfcf9bd7e80939b87232aa114a49d8f397f51af0c2632d9fc58d4a6d4386624f",
  },
};

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function installLightpanda() {
  if (process.env.LIGHTPANDA_EXECUTABLE_PATH) {
    await access(process.env.LIGHTPANDA_EXECUTABLE_PATH);
    return process.env.LIGHTPANDA_EXECUTABLE_PATH;
  }

  const binary = binaries[`${process.platform}-${process.arch}`];
  if (!binary)
    throw new Error(
      `Lightpanda ${version} is not available for ${process.platform}-${process.arch}`,
    );

  const directory = resolve(".cache/lightpanda", version, binary.sha256);
  const executable = join(directory, "lightpanda");
  try {
    await access(executable);
    return executable;
  } catch {
    await mkdir(directory, { recursive: true });
  }

  const temporary = `${executable}.${process.pid}.download`;
  const url = `https://github.com/lightpanda-io/browser/releases/download/${version}/${binary.asset}`;
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(
      `Unable to download Lightpanda ${version}: ${response.status}`,
    );

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { mode: 0o755 }),
    );
    const actual = await sha256(temporary);
    if (actual !== binary.sha256)
      throw new Error(
        `Lightpanda checksum mismatch: expected ${binary.sha256}, received ${actual}`,
      );
    await chmod(temporary, 0o755);
    await rename(temporary, executable);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return executable;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to reserve a Lightpanda port");
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForCdp(endpoint, processClosed, stderr) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const closed = await Promise.race([
      processClosed.then((code) => ({ code })),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 100)),
    ]);
    if (closed)
      throw new Error(
        `Lightpanda exited with code ${closed.code}: ${stderr().trim()}`,
      );
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
  }
  throw new Error(`Lightpanda CDP endpoint did not start at ${endpoint}`);
}

async function runTests(endpoint) {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config=playwright.lightpanda.config.ts",
      ...process.argv.slice(2),
    ],
    {
      env: { ...process.env, LIGHTPANDA_CDP_URL: endpoint },
      stdio: "inherit",
    },
  );
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolvePromise(code ?? (signal ? 1 : 0)),
    );
  });
}

async function main() {
  if (process.env.LIGHTPANDA_CDP_URL) {
    process.exitCode = await runTests(process.env.LIGHTPANDA_CDP_URL);
    return;
  }

  const executable = await installLightpanda();
  const port = await availablePort();
  const endpoint = `http://127.0.0.1:${port}`;
  let stderr = "";
  const lightpanda = spawn(
    executable,
    [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "warn",
    ],
    {
      env: {
        ...process.env,
        LIGHTPANDA_DISABLE_TELEMETRY: "true",
        LIGHTPANDA_DISABLE_CORE_DUMP: "true",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  lightpanda.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const processClosed = new Promise((resolvePromise, reject) => {
    lightpanda.once("error", reject);
    lightpanda.once("exit", (code) => resolvePromise(code));
  });

  try {
    await waitForCdp(endpoint, processClosed, () => stderr);
    process.exitCode = await runTests(endpoint);
  } finally {
    lightpanda.kill("SIGTERM");
    await Promise.race([
      processClosed,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
