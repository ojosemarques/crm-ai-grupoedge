import { createHash, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { openDotScopeSchema } from "@/modules/prospecting/domain/prospecting-contracts";

const executeFile = promisify(execFile);
const bundleRoot = fileURLToPath(new URL("../../../../open-dot/politizai/", import.meta.url));
const clientPath = `${bundleRoot}/client.mjs`;

type Command = Readonly<{
  method: string;
  path: string;
  scope: string;
  bodyRequired: boolean;
  idRequired: boolean;
}>;

type Manifest = Readonly<{
  schemaVersion: string;
  crmBaseUrl: string;
  dots: readonly Readonly<{
    key: string;
    name: string;
    actorKey: string;
    instructionsFile: string;
    scopes: readonly string[];
    commands: readonly string[];
  }>[];
  commands: Readonly<Record<string, Command>>;
}>;

async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(`${bundleRoot}/manifest.json`, "utf8")) as Manifest;
}

describe("bundle do conector Politizai para Open-Dot", () => {
  it("mantém três identidades e escopos mínimos sem sobreposição de pesquisa e e-mail", async () => {
    const manifest = await loadManifest();
    expect(manifest.schemaVersion).toBe("politizai-open-dot/v1");
    expect(manifest.crmBaseUrl).toBe("https://crm-ai-grupoedge.vercel.app");
    expect(manifest.dots.map((dot) => dot.key)).toEqual(["research", "auditor", "email"]);
    expect(new Set(manifest.dots.map((dot) => dot.actorKey)).size).toBe(3);

    const validScopes = new Set(openDotScopeSchema.options);
    for (const dot of manifest.dots) {
      expect(dot.scopes.every((scope) => validScopes.has(scope as never))).toBe(true);
      expect(dot.commands.every((command) => dot.scopes.includes(manifest.commands[command]!.scope))).toBe(true);
    }
    expect(manifest.dots.find((dot) => dot.key === "research")?.scopes.some((scope) => scope.startsWith("EMAIL_"))).toBe(false);
    expect(manifest.dots.find((dot) => dot.key === "auditor")?.scopes.some((scope) => scope.startsWith("EMAIL_"))).toBe(false);
    expect(manifest.dots.find((dot) => dot.key === "email")?.scopes.some((scope) => scope.startsWith("RESEARCH_"))).toBe(false);
  });

  it("não contém segredo e instrui cada Dot a tratar conteúdo externo como dado", async () => {
    const manifest = await loadManifest();
    const files = await Promise.all([
      readFile(`${bundleRoot}/manifest.json`, "utf8"),
      readFile(clientPath, "utf8"),
      ...manifest.dots.map((dot) => readFile(`${bundleRoot}/${dot.instructionsFile}`, "utf8")),
    ]);
    const bundle = files.join("\n");
    expect(bundle).not.toMatch(/currentSecret\s*[=:]\s*["'][^"']+/i);
    expect(bundle).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    for (const instructions of files.slice(2)) {
      expect(instructions).toMatch(/dado não confiável/i);
      expect(instructions).toContain("POLITIZAI_OPEN_DOT_SECRET");
    }
  });

  it("recusa localmente um comando fora do papel antes de acessar a rede", async () => {
    await expect(executeFile(process.execPath, [clientPath, "claim-email", "--idempotency-key", "permission.test"], {
      env: {
        NODE_ENV: "test",
        POLITIZAI_OPEN_DOT_ROLE: "research",
        POLITIZAI_OPEN_DOT_CLIENT_ID: "politizai-research",
        POLITIZAI_OPEN_DOT_SECRET: "x".repeat(32),
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("COMMAND_NOT_ALLOWED_FOR_ROLE") });
  });

  it("assina somente o endpoint permitido sem expor o segredo no request", async () => {
    const moduleUrl = pathToFileURL(clientPath).href;
    const client = await import(moduleUrl) as Readonly<{ execute: (argv: string[], environment: NodeJS.ProcessEnv, fetcher: typeof fetch) => Promise<unknown> }>;
    const secret = "integration-secret-with-at-least-32-chars";
    let observed: Readonly<{ url: URL; init: RequestInit }> | null = null;
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      observed = { url: new URL(String(input)), init: init ?? {} };
      return new Response(JSON.stringify({ result: { status: "OPEN" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(client.execute([
      "get-batch",
      "--idempotency-key", "batch.read.0001",
      "--id", "00000000-0000-4000-8000-000000000001",
    ], {
      NODE_ENV: "test",
      POLITIZAI_OPEN_DOT_ROLE: "research",
      POLITIZAI_OPEN_DOT_CLIENT_ID: "politizai-research",
      POLITIZAI_OPEN_DOT_SECRET: secret,
    }, fetcher)).resolves.toMatchObject({ result: { status: "OPEN" } });

    expect(observed).not.toBeNull();
    const request = observed!;
    const headers = new Headers(request.init.headers);
    const path = "/api/integrations/open-dot/v1/research-batches/00000000-0000-4000-8000-000000000001";
    const canonical = ["GET", path, headers.get("x-open-dot-timestamp"), headers.get("x-open-dot-nonce"), createHash("sha256").update("").digest("hex")].join("\n");
    expect(request.url.pathname).toBe(path);
    expect(request.init.method).toBe("GET");
    expect(headers.get("x-open-dot-signature")).toBe(`sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`);
    expect(JSON.stringify(request)).not.toContain(secret);
    expect(stderr).toHaveBeenCalledWith(expect.not.stringContaining(secret));
  });

  it("não envia credencial a um destino HTTPS fora da origem canônica", async () => {
    const client = await import(pathToFileURL(clientPath).href) as Readonly<{ execute: (argv: string[], environment: NodeJS.ProcessEnv, fetcher: typeof fetch) => Promise<unknown> }>;
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(client.execute([
      "get-batch",
      "--idempotency-key", "batch.read.0002",
      "--id", "00000000-0000-4000-8000-000000000002",
    ], {
      NODE_ENV: "test",
      POLITIZAI_CRM_BASE_URL: "https://collector.example.com",
      POLITIZAI_OPEN_DOT_ROLE: "research",
      POLITIZAI_OPEN_DOT_CLIENT_ID: "politizai-research",
      POLITIZAI_OPEN_DOT_SECRET: "x".repeat(32),
    }, fetcher)).rejects.toThrow("CRM_BASE_URL_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
