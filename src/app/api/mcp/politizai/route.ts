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
import {
  getPolitizaiMcpPublicConfig,
  POLITIZAI_MCP_INSTRUCTIONS,
  POLITIZAI_MCP_SERVER_VERSION,
} from "@/modules/prospecting/domain/politizai-mcp-config";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { logger } from "@/shared/core/logging/logger";

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
    const validationIssues = error instanceof z.ZodError
      ? error.issues.slice(0, 6).map((issue) => ({
        path: issue.path.join(".") || "payload",
        code: issue.code,
        message: issue.message,
      }))
      : [];
    if (validationIssues.length > 0) {
      logger.warn(
        { errorCode: "MCP_TOOL_INVALID_INPUT", issueCount: error instanceof z.ZodError ? error.issues.length : 0, issues: validationIssues },
        "Ferramenta MCP da prospecção rejeitou entrada na validação",
      );
    } else if (!(error instanceof ApplicationError)) {
      const errorRecord = error && typeof error === "object"
        ? error as { code?: unknown; meta?: unknown }
        : null;
      logger.error(
        {
          errorCode: "MCP_TOOL_OPERATION_FAILED",
          errorName: error instanceof Error ? error.name : "UnknownError",
          prismaCode: typeof errorRecord?.code === "string" ? errorRecord.code : null,
          prismaMeta: errorRecord?.meta ?? null,
        },
        "Falha inesperada ao executar ferramenta MCP da prospecção",
      );
    }
    const message = error instanceof ApplicationError && error.expose ? error.message
      : error instanceof z.ZodError
        ? `Dados inválidos para a ferramenta: ${validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`
        : "Não foi possível concluir a operação no CRM.";
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const handler = createMcpHandler(({ authInfo }) => {
  const auth = authExtra(authInfo);
  const service = getPolitizaiMcpProspectingService();
  const server = new McpServer({ name: "Politizai Prospecção Política", version: POLITIZAI_MCP_SERVER_VERSION }, {
    instructions: POLITIZAI_MCP_INSTRUCTIONS,
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
    description: "Reserva por 45 minutos um político elegível, esgotando não capitais antes de capitais e priorizando Sul, Sudeste, Centro-Oeste, Norte e Nordeste; depois municípios menores e vereadores.",
    inputSchema: z.object({ batchId: z.string().uuid().optional() }).strict(),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    scopeChallenge: requireScopes("prospecting:research"),
  }, async ({ batchId }) => safeTool(() => service.claimNextTarget(auth, batchId)));

  server.registerTool("registrar_candidato", {
    title: "Registrar político validado",
    description: "Cria ou enriquece o político já existente; exige pesquisa completa de gabinete individual, DivulgaCandContas 2024 e Instagram; preserva contatos atuais, rejeita central compartilhada e e-mail isolado e sincroniza novos contatos no Lead liberado.",
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
