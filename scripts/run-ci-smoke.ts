import { spawn } from "node:child_process";

const port = Number.parseInt(process.env.CI_SMOKE_PORT ?? "3199", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("CI_SMOKE_PORT inválida.");
}

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: {
    ...process.env,
    APP_ENV: "test",
    APP_CANONICAL_URL: baseUrl,
    APP_TRUSTED_HOSTS: `127.0.0.1:${port},127.0.0.1`,
    APP_TRUSTED_ORIGINS: baseUrl,
    NODE_ENV: "production",
    PROCESS_ROLE: "web",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000); });
server.stderr.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000); });

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Servidor encerrou antes do smoke.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // O servidor ainda está inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timeout aguardando o servidor do smoke.");
}

function expectHeader(response: Response, name: string, expected: string): void {
  if (response.headers.get(name) !== expected) throw new Error(`Header seguro ausente ou inválido: ${name}.`);
}

try {
  await waitForServer();

  const liveness = await fetch(`${baseUrl}/api/health`);
  const livenessBody = await liveness.json() as { service?: string; status?: string };
  if (!liveness.ok || livenessBody.service !== "politizai-crm" || livenessBody.status !== "ok") {
    throw new Error("Liveness não respondeu com o contrato esperado.");
  }
  if (liveness.headers.get("cache-control") !== "no-store") throw new Error("Liveness deve desabilitar cache.");

  const readiness = await fetch(`${baseUrl}/api/ready`);
  const readinessBody = await readiness.json() as { ready?: boolean; checks?: { database?: string } };
  if (!readiness.ok || readinessBody.ready !== true || readinessBody.checks?.database !== "ok") {
    throw new Error("Readiness não confirmou o PostgreSQL efêmero.");
  }

  const login = await fetch(`${baseUrl}/login`);
  if (!login.ok) throw new Error("Página de login indisponível no smoke.");
  expectHeader(login, "x-content-type-options", "nosniff");
  expectHeader(login, "x-frame-options", "DENY");
  if (!login.headers.get("content-security-policy")?.includes("default-src 'self'")) {
    throw new Error("CSP não foi aplicada à página de login.");
  }

  process.stdout.write("SMOKE CI: APROVADO (liveness, readiness, banco, login e headers).\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (serverOutput) process.stderr.write("O servidor encerrou ou não ficou pronto; consulte o log do job.\n");
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
