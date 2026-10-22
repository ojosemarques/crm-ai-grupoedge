import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { crmMcpClientSchema, crmMcpScopes, parseCrmMcpClients } from "../src/modules/crm-mcp/application/crm-mcp-authentication";

function argument(name: string) { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3); }
const input = z.object({
  clientId: crmMcpClientSchema.shape.clientId,
  workspaceId: z.string().uuid(), memberId: z.string().uuid(),
  baseUrl: z.url().refine((value) => new URL(value).protocol === "https:" || new URL(value).hostname === "localhost", "Use HTTPS em produção."),
  expiresDays: z.coerce.number().int().min(1).max(365).default(90),
}).parse({ clientId: argument("client-id"), workspaceId: argument("workspace-id"), memberId: argument("member-id"), baseUrl: argument("base-url"), expiresDays: argument("expires-days") });

const directory = resolve(".credentials");
await mkdir(directory, { recursive: true, mode: 0o700 });
const clientsPath = resolve(directory, "crm-mcp-clients.json");
let existing: ReturnType<typeof parseCrmMcpClients> = [];
try { existing = parseCrmMcpClients(await readFile(clientsPath, "utf8")); } catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}
if (existing.some((client) => client.clientId === input.clientId)) throw new Error("Cliente já existe. Para rotacionar, remova somente esse cliente do arquivo local e execute novamente; publique a lista completa no cofre Vercel.");
const token = randomBytes(32).toString("base64url");
const client = crmMcpClientSchema.parse({
  clientId: input.clientId, workspaceId: input.workspaceId, memberId: input.memberId,
  tokenHash: createHash("sha256").update(token).digest("hex"), scopes: [...crmMcpScopes],
  expiresAt: new Date(Date.now() + input.expiresDays * 86_400_000).toISOString(),
});
const configPath = resolve(directory, `crm-mcp-${input.clientId}.json`);
const endpoint = new URL("/api/mcp/crm", input.baseUrl).href;
await writeFile(configPath, `${JSON.stringify({ mcpServers: { "grupo-edge-crm": { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await writeFile(clientsPath, JSON.stringify([...existing, client]), { mode: 0o600 });
process.stdout.write(`Configuração privada do bot: ${configPath}\nLista de clientes para CRM_MCP_CLIENTS_JSON: ${clientsPath}\nExpira em: ${client.expiresAt}\nO token não foi impresso. Preserve toda a lista ao atualizar o cofre.\n`);
