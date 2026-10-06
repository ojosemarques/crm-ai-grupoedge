import {
  McpServer,
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
  requireScopes,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import type { McpAuthExtra } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { getPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import {
  getPolitizaiMcpProspectingService,
  inconclusiveTargetSchema,
  registerCandidateSchema,
} from "@/modules/prospecting/application/politizai-mcp-prospecting-service";
import { getPolitizaiMcpPublicConfig } from "@/modules/prospecting/domain/politizai-mcp-config";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const reviewSchema = z.object({
  candidateId: z.string().uuid(),
  status: z.enum(["READY", "REVIEW_REQUIRED", "REJECTED"]),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  expectedRevision: z.number().int().positive(),
  sourceDecisions: z.array(z.object({ sourceId: z.string().uuid(), status: z.enum(["VALID", "INVALID"]) }).strict()).max(40).default([]),
}).strict();

const completeSchema = z.object({ batchId: z.string().uuid(), status: z.enum(["COMPLETED", "CANCELLED", "FAILED"]).default("COMPLETED") }).strict();
const batchLookupSchema = z.object({
  batchId: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
});

function authExtra(authInfo: AuthInfo | undefined): McpAuthExtra {
  const parsed = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid(), memberId: z.string().uuid(), authorizingActorId: z.string().uuid() }).strict().safeParse(authInfo?.extra);
  if (!parsed.success) throw new Error("MCP_AUTH_CONTEXT_MISSING");
  return parsed.data;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

async function safeTool(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    const message = error instanceof ApplicationError && error.expose ? error.message
      : error instanceof z.ZodError ? "Dados inválidos para a ferramenta."
        : "Não foi possível concluir a operação no CRM.";
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const handler = createMcpHandler(({ authInfo }) => {
  const auth = authExtra(authInfo);
  const service = getPolitizaiMcpProspectingService();
  const server = new McpServer({ name: "Politizai Prospecção Política", version: "1.0.0" }, {
    instructions: "Seu nome completo é Politizai Pesquisa. Trabalhe continuamente enquanto houver fila. Pesquise prefeitos e vereadores em exercício em municípios com população igual ou superior a 30 mil, processando todos os municípios não capitais antes de qualquer capital, em ordem crescente de população e com vereadores antes de prefeitos. Use o navegador em nuvem e consulte TSE 2024/DivulgaCandContas, Prefeitura, Câmara, Diário Oficial, gabinete e perfis públicos verificáveis. Nunca infira contatos nem use dado vazado ou restrito. Só registre candidato com telefone e e-mail do gabinete comprovados; registre também telefone/e-mail público do político ou campanha, telefone/e-mail de assessor, WhatsApp e Instagram quando publicados e com fonte. Grave apenas no estoque e nunca envie e-mail nem crie Lead diretamente.",
  });

  server.registerTool("obter_contexto_de_pesquisa", {
    title: "Obter contexto e regras de pesquisa",
    description: "Retorna regras fixas, fontes oficiais, estado da automação, vendedores e contagem da fila.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:read"),
  }, async () => safeTool(() => service.getContext(auth)));

  server.registerTool("abrir_lote_de_pesquisa", {
    title: "Abrir ou reutilizar lote de pesquisa",
    description: "Reutiliza o lote ativo com alvos oficiais ou abre o lote mensal idempotente.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async () => safeTool(() => service.openBatch(auth)));

  server.registerTool("obter_proximo_alvo_de_pesquisa", {
    title: "Reservar próximo político",
    description: "Reserva por 45 minutos um político elegível, esgotando não capitais antes de capitais e priorizando municípios menores e vereadores.",
    inputSchema: z.object({ batchId: z.string().uuid().optional() }).strict(),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async ({ batchId }) => safeTool(() => service.claimNextTarget(auth, batchId)));

  server.registerTool("registrar_candidato", {
    title: "Registrar político validado",
    description: "Valida mandato, telefone/e-mail obrigatórios do gabinete e contatos adicionais comprovados, gravando tudo apenas no estoque do CRM.",
    inputSchema: registerCandidateSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async (input) => safeTool(() => service.registerCandidate(auth, input)));

  server.registerTool("registrar_alvo_inconclusivo", {
    title: "Registrar pesquisa inconclusiva",
    description: "Encerra a reserva sem inventar dados quando houver captcha, conflito ou contato não encontrado.",
    inputSchema: inconclusiveTargetSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async (input) => safeTool(() => service.markInconclusive(auth, input)));

  server.registerTool("consultar_pendencias_do_lote", {
    title: "Consultar lote e pendências",
    description: "Retorna contagens do lote, alvos pendentes e candidatos que exigem auditoria.",
    inputSchema: batchLookupSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:read"),
  }, async ({ batchId, batch_id }) => safeTool(() => service.getBatch(auth, batchId ?? batch_id)));

  server.registerTool("aprovar_ou_rejeitar_candidato", {
    title: "Auditar candidato",
    description: "Decide READY, REVIEW_REQUIRED ou REJECTED com controle de revisão e validação das fontes.",
    inputSchema: reviewSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:review"),
  }, async ({ candidateId, ...input }) => safeTool(() => service.reviewCandidate(auth, candidateId, input)));

  server.registerTool("concluir_lote", {
    title: "Concluir lote",
    description: "Conclui o lote somente quando não restarem alvos pendentes; também permite cancelamento ou falha explícitos.",
    inputSchema: completeSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async ({ batchId, status }) => safeTool(() => service.completeBatch(auth, batchId, status)));

  return server;
}, { legacy: "stateless", responseMode: "json", maxRequestBodySize: 256 * 1024 });

function allowlistedHostnames(): string[] {
  const config = getPolitizaiMcpPublicConfig();
  return [...new Set([
    config.resource.hostname,
    "localhost",
    "127.0.0.1",
    process.env.VERCEL_URL,
    ...(process.env.APP_TRUSTED_HOSTS ?? "").split(","),
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim().split(":")[0]!))];
}

async function serve(request: NextRequest): Promise<Response> {
  const config = getPolitizaiMcpPublicConfig();
  const rejected = hostHeaderValidationResponse(request, allowlistedHostnames())
    ?? originValidationResponse(request, [config.resource.hostname, "chatgpt.com", "chat.openai.com", "localhost", "127.0.0.1"]);
  if (rejected) return rejected;
  const gate = requireBearerAuth({
    verifier: getPolitizaiMcpOAuthService(),
    requiredScopes: ["prospecting:read"],
    expectedResource: config.resource,
    resourceMetadataUrl: config.resourceMetadataUrl.href,
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;
  return handler.fetch(request, { authInfo: auth });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
