#!/usr/bin/env node

import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,200}$/;

function usage() {
  return `Uso: node client.mjs <comando> --idempotency-key <chave> [--id <uuid>] [--body <arquivo|->]\n\nComandos: ${Object.keys(manifest.commands).join(", ")}`;
}

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("ARGUMENTS_INVALID");
    options[flag.slice(2)] = value;
  }
  return { command, options };
}

function configuredBaseUrl(environment) {
  const raw = environment.POLITIZAI_CRM_BASE_URL || manifest.crmBaseUrl;
  const url = new URL(raw);
  const production = new URL(manifest.crmBaseUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("CRM_BASE_URL_INVALID");
  if (url.protocol !== "https:" && !(local && environment.POLITIZAI_OPEN_DOT_ALLOW_LOCAL_SINK === "true")) throw new Error("CRM_BASE_URL_INVALID");
  if (!local && url.origin !== production.origin) throw new Error("CRM_BASE_URL_INVALID");
  return url;
}

function configuration(environment, command) {
  const role = environment.POLITIZAI_OPEN_DOT_ROLE;
  const dot = manifest.dots.find((item) => item.key === role);
  const definition = manifest.commands[command];
  if (!dot || !definition || !dot.commands.includes(command) || !dot.scopes.includes(definition.scope)) throw new Error("COMMAND_NOT_ALLOWED_FOR_ROLE");
  const clientId = environment.POLITIZAI_OPEN_DOT_CLIENT_ID;
  const secret = environment.POLITIZAI_OPEN_DOT_SECRET;
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(clientId || "") || typeof secret !== "string" || secret.length < 32 || secret.length > 500) throw new Error("CLIENT_CONFIGURATION_INVALID");
  return { dot, definition, clientId, secret, baseUrl: configuredBaseUrl(environment) };
}

async function rawBody(definition, bodyFile) {
  if (!definition.bodyRequired && !bodyFile) return "";
  if (!bodyFile) throw new Error("BODY_FILE_REQUIRED");
  let value;
  if (bodyFile === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    value = Buffer.concat(chunks).toString("utf8");
  } else {
    value = await readFile(bodyFile, "utf8");
  }
  if (Buffer.byteLength(value, "utf8") > 256 * 1024) throw new Error("BODY_TOO_LARGE");
  JSON.parse(value);
  return value;
}

function signedHeaders({ clientId, secret, method, path, body, idempotencyKey }) {
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [method, path, timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-open-dot-client-id": clientId,
    "x-open-dot-timestamp": timestamp,
    "x-open-dot-nonce": nonce,
    "x-open-dot-signature": `sha256=${signature}`,
  };
}

export async function execute(argv = process.argv.slice(2), environment = process.env, fetchImplementation = fetch) {
  if (argv.length === 0 || argv.includes("--help")) return { help: usage() };
  const { command, options } = parseArguments(argv);
  const config = configuration(environment, command);
  if (!IDEMPOTENCY_KEY.test(options["idempotency-key"] || "")) throw new Error("IDEMPOTENCY_KEY_INVALID");
  if (config.definition.idRequired && !UUID.test(options.id || "")) throw new Error("RESOURCE_ID_INVALID");
  const path = config.definition.path.replace("{id}", options.id || "");
  const body = await rawBody(config.definition, options.body);
  const response = await fetchImplementation(new URL(path, config.baseUrl), {
    method: config.definition.method,
    headers: signedHeaders({ clientId: config.clientId, secret: config.secret, method: config.definition.method, path, body, idempotencyKey: options["idempotency-key"] }),
    body: config.definition.method === "GET" ? undefined : body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  const parsed = responseText ? JSON.parse(responseText) : {};
  process.stderr.write(`${JSON.stringify({ event: "politizai_crm_request", command, status: response.status, requestId: parsed?.error?.requestId ?? null })}\n`);
  if (!response.ok) {
    const error = new Error("CRM_REQUEST_REJECTED");
    error.status = response.status;
    error.crmCode = parsed?.error?.code ?? "CRM_REQUEST_REJECTED";
    error.requestId = parsed?.error?.requestId ?? null;
    throw error;
  }
  return parsed;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  execute().then((result) => {
    if (result.help) process.stdout.write(`${result.help}\n`);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: "politizai_crm_error", code: error?.crmCode ?? (error instanceof Error ? error.message : "UNEXPECTED_ERROR"), status: error?.status ?? null, requestId: error?.requestId ?? null })}\n`);
    process.exitCode = 1;
  });
}
