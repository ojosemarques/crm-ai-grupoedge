# 00 — Auditoria e evidências

## Objetivo

Registrar fatos verificáveis da baseline e delimitar o menor conjunto de seams a evoluir antes de implementar.

## Baseline Git

- Branch: `main`.
- `HEAD`: `df7dd55657b53b7d2f224ce0572924ebb3269828`.
- `origin/main`: mesmo commit; merge-base igual ao `HEAD`.
- Worktree único: `/Users/uscloser/Documents/ChatGPT/CRM`.
- Código rastreado limpo no início.
- Não rastreados preservados: `docs/PROMPT_EXECUCAO_INDICADORES_INTEGRADOS_V2.md`, `docs/PROMPT_INDICADORES_METRICAS_INTEGRADAS.md`, `docs/PROMPT_MASTER_FORMULARIOS_MARKETING_CRM.md`, `docs/PROMPT_SPECS_INDICADORES_INTEGRADOS_V2.md`, `docs/PROSPECCAO_ATIVA_OPEN_DOT.md`.

## Stack e regras versionadas

- Next.js `16.3.8`, React `19.3`, TypeScript `6.0.3`, Prisma `7.10`, PostgreSQL, Zod `4.6`, Vitest e Playwright (`package.json`).
- Documentação Next lida: rotas dinâmicas, Route Handlers, Proxy, caching e forms em `node_modules/next/dist/docs/01-app/`.
- Invariantes Next relevantes: `params` é assíncrono; Route Handlers não têm cache por padrão; cada mutação deve revalidar auth/autorização; o root layout atual é `force-dynamic`.
- CI em `.github/workflows/ci.yml`: segurança, migrations desde zero, lint, typecheck, unit, integração crítica, audit, build e smoke.

## Matriz de evidências

| Capacidade | Estado | Evidência exata | Reuso | Gap/risco | Task |
|---|---|---|---|---|---|
| Navegação Marketing | PRESENTE | `src/components/layout/app-shell.tsx` (`navigationGroups`, `sections`, `labels`) | incluir `/formularios` | caminho ausente | T1 |
| Permissões marketing | PRESENTE | `permission-keys.ts`: `MARKETING_JOURNEY_READ`, `MARKETING_DEFINITIONS_MANAGE`, `MARKETING_EVIDENCE_EXPORT`; defaults em `default-role-definitions.ts` | leitura, gestão e exportação | alinhar UI/API; integrações exigem capabilities cumulativas | T1/T14 |
| Definição de formulário | PARCIAL | `MarketingForm`, `MarketingFormVersion` em `prisma/schema.prisma` | manter modelos | sem slug público, draft JSON, revision, published pointer, ARCHIVED ou relações explícitas | T2 |
| Salvamento atual | PARCIAL/INCORRETO PARA BUILDER | `saveMarketingForm` em `marketing-attribution-service.ts` | retirar responsabilidade para serviço dedicado | salvar cria versão e ativa imediatamente; sem conflito otimista | T3 |
| Submissão | PRESENTE/PARCIAL | `LeadFormSubmission` | submission aceita e vínculo histórico | sem receipt público, answers tipados/reprocess state | T2/T9 |
| Intake | PRESENTE | `lead-intake-service.ts`, `getLeadIntakeService()` | único caminho de criação/anexo | pipeline configurável, etapa sempre primeira `OPEN`; phone/fullName obrigatórios | T9 |
| Atribuição | PRESENTE | `marketingEvidenceInputSchema`, `recordLeadIntakeAttributionInTransaction` | UTMs, click IDs, touchpoint/conversion | ligar form/version/session de maneira determinística | T10 |
| Sessão de marketing | PRESENTE/PARCIAL | `MarketingSession` | sessão anônima | sem form/version/eventos de funil | T2/T10/T13 |
| Telemetria de formulário | AUSENTE | nenhum modelo/serviço específico | novo fato mínimo | não usar respostas/PII como labels | T2/T13 |
| Pipeline/etapa | PRESENTE/PARCIAL | `Pipeline`, `PipelineStage`; `findReferences()` do intake | IDs canônicos | extensão aditiva para `initialStageId` validado no workspace/pipeline | T6/T9 |
| Tags | PRESENTE | `Tag`, `LeadTag`, `CommercialEntityTag` | upsert idempotente | aplicar depois do intake, na mesma orquestração/compensação | T6/T9 |
| Round-robin CRM | PRESENTE | `RoundRobinState`, `chooseRoundRobinOwner` | não reutilizar para redirect de WhatsApp | estado de redirect precisa ser por versão publicada | T2/T6 |
| Público `/f/[slug]` | AUSENTE | nenhum arquivo em `src/app/f`; `src/proxy.ts` exige sessão | nova rota e renderer | proxy/AppShell/CSP bloqueiam runtime público | T8 |
| Hardening HTTP | PRESENTE | `request-hardening.ts`: `readLimitedJson`, `createSharedRateLimiter`, `requestClientKey` | body/rate limit | política própria de submit/event | T9/T10 |
| Auth admin | PRESENTE | `authentication-guards.ts`, `request-security.ts` | `requireApiAuthentication`, `assertSameOrigin` | repetir por endpoint; nunca confiar no client | T3/T4 |
| CSP/host | PRESENTE | `proxy.ts`, `security-headers.ts` | nonce/host/correlation | permitir somente `/f/` e APIs públicas; assets/pixels allowlisted | T8/T14 |
| Secrets | PRESENTE | `SecretResolver`, `IntegrationSecretReference` | referência, nunca valor | form definition não serializa token | T14 |
| Meta CAPI | PRESENTE/PARCIAL | `conversion-feedback-service.ts` e outbox | política de privacidade, dedupe e worker | configuração por form precisa apontar para conexão/ref existente | T14 |
| Google Ads | PRESENTE/PARCIAL | `google-ads-service.ts`; conversão write marcada bloqueada sem homologação | configuração/estado local | não prometer egress não homologado | T14 |
| Outbox | PRESENTE | `OutboxEvent`, `createOutboxEventInTransaction` | efeitos pós-commit | evento allowlisted por provider | T14 |
| Mídia/branding | NÃO COMPATÍVEL | `AttachmentReference` é FK obrigatória de `Message` | nenhum upload genérico | v1 aceita apenas URL HTTPS em origins allowlisted; upload fica bloqueado | T7 |
| CSV seguro | PRESENTE | `analytics-builder-contracts.ts` (`csvCell`, `recordsCsv`) | BOM e neutralização de fórmula | stream/paginação para volume | T12 |
| Dialog acessível | PRESENTE | `components/ui/accessible-dialog.tsx` | detalhe/confirm | verificar focus trap/restore | T12/T15 |
| Testes atuais | PARCIAL | `marketing-attribution.integration.test.ts`, `lead-intake.integration.test.ts`, `proxy.test.ts`, hardening/CSP tests | baseline | nenhum teste do builder/runtime | T0–T16 |
| Deploy | PRESENTE/MANUAL | `.vercel/project.json`, `vercel.json`, runbooks em `docs/` | projeto Vercel ligado, deploy por CLI | main não auto-deploya; migration remota precede deploy | T16 |

## Fluxo atual observado

```text
admin autenticado
  -> POST /api/marketing/attribution SAVE_MARKETING_FORM
  -> marketingForm upsert status ACTIVE + currentVersion++
  -> MarketingFormVersion snapshot

entrada externa existente
  -> aquisição/webhook
  -> ServiceActor SYSTEM
  -> LeadIntakeService
  -> LeadFormSubmission + Contact/Lead + fila/pipeline inicial
  -> touchpoint/conversion/metrics/automações
```

Não existe UI `/formularios`, publicação separada, runtime público, receipt, resposta detalhada ou estatística por questão.

## Fluxo proposto

```text
admin -> FormService (draft+revision) -> publish gate
      -> MarketingFormVersion imutável -> publishedVersionId

visitante -> /f/[slug] -> snapshot ACTIVE -> sessão/eventos minimizados
          -> POST submit -> receipt/idempotência/rate limit
          -> MarketingFormSubmissionService -> LeadIntakeService(SYSTEM)
          -> LeadFormSubmission + tags + attribution + redirect seguro
          -> outbox de conversão após commit

admin -> Responses/StatisticsService -> submission/receipt/eventos/version snapshot
```

## Gaps de correção bloqueantes

1. `MarketingForm.currentVersion` não distingue draft de published; o serviço atual viola edição sem publicação.
2. Rota pública é redirecionada para login e herdaria AppShell.
3. `LeadFormSubmission` não contém sozinho um receipt reprocessável para falha anterior ao intake.
4. `LeadIntakeService` não aceita etapa inicial; só a primeira etapa aberta.
5. Slug isolado por workspace é ambíguo em `/f/[slug]`; v1 adotará `publicSlug` globalmente único e opaco o suficiente, mantendo `key` tenant-scoped.
6. `AttachmentReference` não atende branding; usar URL HTTPS allowlisted, sem upload.

## Fatos não confirmados

- Credenciais/provider Meta e Google aptos a escrita em produção.
- Origin de assets de branding a ser permitida em produção.
- Volume real de respostas; paginação/CSV será desenhado para lote limitado e cursor.
- Domínio público final do CRM; URLs serão derivadas de `APP_PUBLIC_URL`/request host confiável.

## Aceite desta auditoria

- [x] Git e alterações preexistentes inventariados.
- [x] produtores, persistência, contratos, consumidores, permissões e testes rastreados.
- [x] fluxo atual separado do proposto.
- [x] menor seam definido sem segundo intake/lead table.
- [x] gaps e decisões alimentam T0–T16.
