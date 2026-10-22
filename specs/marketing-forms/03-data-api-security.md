# 03 — Dados, APIs e segurança

## Schema proposto

### `MarketingForm` (evolução)

- `publicSlug String @unique` — slug global v1; `key` segue único por workspace.
- `status` adiciona `ARCHIVED`.
- `revision Int @default(1)`.
- `draftSchemaVersion String`.
- `draftDefinition Json` validado.
- `publishedVersionId String?`, `publishedAt`, `pausedAt`, `archivedAt`.
- índices por `(workspaceId,status,updatedAt)` e `(workspaceId,publicSlug)`.

### `MarketingFormVersion` (evolução)

- `definitionHash String`, `publishedAt`, `publishedByActorId`.
- snapshot inclui `questions`, `options`, `style`, `destination`, `sharing`, `tracking`, `thankYou`.
- relação imutável com form; nenhuma API de update/delete.

### `MarketingFormReceipt` (novo)

- tenant/form/version/session, `publicId`, `idempotencyHash`, `status`, `answers Json`, `submissionId?`, `safeErrorCode?`, `redirectKind?`, `rotationTargetKey?`, `rotationAppliedAt?`, timestamps e soft delete.
- únicos: `(workspaceId,publicId)` e `(workspaceId,marketingFormVersionId,idempotencyHash)`.
- respostas contêm `{questionKey,value|optionKeys}` já validados; PII existe aqui e segue retenção.

### `MarketingFormEvent` (novo)

- workspace/form/version/session, kind, questionKey?, optionKey?, occurredAt, idempotencyKey, utm/referrer dimensions minimizadas e metadata segura.
- sem answer text, email, telefone ou nome.

### `MarketingFormRotationState` (novo)

- workspace/form/version, `nextIndex`, `totalAssignments`, `revision`, reset metadata.
- endpoint list permanece no snapshot versionado; estado apenas aponta índice/contadores.

### `LeadFormSubmission` (evolução)

- relação opcional `marketingFormReceiptId` única e índices existentes preservados.
- `marketingFormId`/`marketingFormVersionId` tornam-se preenchidos pelo submit público.

## Definition schema `marketing-form.v1`

Objeto strict com limites:

```ts
{
  questions: Array<{ stableKey; type; title; description?; required; position; config; mapping? }>;
  thankYou: { stableKey; title; message; ctaLabel?; groupButton? };
  destination: { sourceKey; pipelineId; initialStageId; tagIds; queueId?; priorityBandCode };
  redirects: { url?; whatsapp?; group?; rotation?; automaticKind };
  style: { title?; ctaColor; questionColor; answerColor; backgroundColor; font; radius; alignment; logoUrl?; backgroundImageUrl? };
  tracking: { meta?; google?; internalEvents: true };
}
```

Stable keys: slug-like 3–80 chars, imutáveis dentro do form. Option keys idem; posições são inteiros únicos. Configs usam discriminated union por tipo.

## APIs administrativas

- `GET/POST /api/marketing/forms` — lista/cria.
- `GET/PATCH /api/marketing/forms/[formId]` — detail/save draft.
- `POST /api/marketing/forms/[formId]/actions` — `PUBLISH|PAUSE|ACTIVATE|DUPLICATE|ARCHIVE|RESET_ROTATION`.
- `GET /api/marketing/forms/[formId]/responses`.
- `GET /api/marketing/forms/[formId]/responses/[receiptId]`.
- `POST /api/marketing/forms/[formId]/responses/[receiptId]/reprocess`.
- `POST /api/marketing/forms/[formId]/responses/export`.
- `GET /api/marketing/forms/[formId]/statistics`.

Todos: `runtime=nodejs`, params awaited, auth server-side, same-origin nas mutações, `readLimitedJson`, no-store, Zod strict, erro pelo handler padrão.

## APIs públicas

- `GET /api/public/forms/[slug]` — snapshot sanitizado.
- `POST /api/public/forms/[slug]/events` — batch limitado de eventos allowlisted.
- `POST /api/public/forms/[slug]/submit` — receipt/intake.

Sem cookie admin. Slug resolve workspace internamente. Corpo máximo: definition GET sem PII; events 32 KiB; submit 128 KiB. Submit policy inicial: 20 tentativas/10 min por hash de IP+form; events 120/min. `Retry-After` em 429.

## Auth e capabilities

- ler índice/detail/respostas/statísticas: `MARKETING_JOURNEY_READ` com recurso workspace.
- criar/editar/publicar/pausar/duplicar/arquivar/reset/reprocess: `MARKETING_DEFINITIONS_MANAGE`.
- exportar: `MARKETING_EVIDENCE_EXPORT` + `EXPORTS_EXECUTE`.
- configurar/testar Meta/Google: gestão de definição + `INTEGRATIONS_MANAGE`; secrets exigem `INTEGRATIONS_SECRETS_MANAGE`.
- público: capability derivada exclusivamente do form ativo.

## Tenant e enumeração

- Toda query admin inclui `workspaceId`.
- Pipeline/stage/source/tag/queue/connection são reconsultados no workspace.
- Público desconhecido/inativo/arquivado responde `FORM_NOT_FOUND` 404 com mesma forma e timing aproximado.
- `publicSlug` global único evita colisão ambígua; IDs internos nunca saem no JSON público.

## URLs, SSRF e CSP

- Redirect: somente `https:` e `http://localhost` em dev; sem credentials; host allowlist opcional/obrigatória em produção; WhatsApp somente `wa.me`/`api.whatsapp.com`, grupo somente `chat.whatsapp.com`.
- Branding: HTTPS e origin em `MARKETING_FORM_ASSET_ORIGINS`; servidor não faz fetch arbitrário.
- CSP pública parte da CSP atual e adiciona apenas origins configuradas/Meta quando ativo; sem script/CSS customizado ou `unsafe-inline` genérico.

## PII/LGPD/retenção

- Answers e raw payload são PII; no-store, sem logging e acesso permissionado.
- Eventos analíticos guardam apenas keys/opções fechadas.
- Consentimento é pergunta explicitamente mapeada; submissão não implica consentimento.
- Egress com PII usa política/decision existente e falha fechado.
- Soft delete/retention; legal hold prevalece; hard delete fora do v1.

## Secrets e egress

- Definition guarda `connectionId`/`referenceKey` allowlisted e flags, nunca valor.
- JSON público expõe só Pixel ID/Conversion ID públicos necessários.
- CAPI/Google server-side só via outbox depois do commit.
- Testes usam `EphemeralSecretResolver` e fetcher fake; nenhum egress real.

## Threat cases obrigatórios

Payload desconhecido/oversized; option key de outra versão; XSS em labels/respostas; formula CSV; open redirect; private IP/credentials; replay/concurrency; slug inativo; cross-tenant IDs; secret ausente; provider fail; rate limit; versão alterada entre load/submit.

## Migration

- Migration Prisma aditiva; incluir enum `ARCHIVED`, colunas, modelos, FKs e índices.
- Testar banco limpo e upgrade da baseline.
- Não editar migration aplicada.
- Antes de implementar T2, carregar `database-migration-validation` e `security-change-baseline`.

## Aceite

- Schema gera; migration aplica desde zero; relações tenant-safe.
- Todos endpoints têm testes de auth, tenant, validation e cache.
- Nenhum secret/PII aparece em outputs indevidos.
