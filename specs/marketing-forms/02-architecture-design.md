# 02 — Desenho de arquitetura

## Objetivo

Adicionar builder e runtime público sem criar intake, identidade, pipeline, tags, atribuição ou integração paralelos.

## Alternativas avaliadas

1. **Reusar apenas `definition` de versões e publicar a cada save:** rejeitada; não suporta draft, conflito ou imutabilidade operacional.
2. **Criar módulo independente com tabelas próprias de leads:** rejeitada; duplicaria intake/dedupe/tenant.
3. **Evoluir `MarketingForm` como aggregate root e usar `MarketingFormVersion` como snapshot:** escolhida.
4. **Guardar eventos em `TelemetryRecord`:** rejeitada para análise de produto; grão/retention e dimensões de pergunta merecem fato dedicado sem PII.
5. **Usar somente `LeadFormSubmission` para retry pré-intake:** insuficiente; intake pode rejeitar antes de persistir. Receipt separado escolhido.

## Componentes

```text
Admin UI (/formularios)
  -> /api/marketing/forms/*
  -> MarketingFormAdministrationService
  -> MarketingForm aggregate/draft/version/audit

Public UI (/f/[slug])
  -> PublicMarketingFormService.resolvePublished
  -> MarketingFormVersion.definition
  -> /api/public/forms/[slug]/events
  -> /api/public/forms/[slug]/submit
  -> MarketingFormSubmissionService
  -> Receipt -> LeadIntakeService -> LeadFormSubmission
  -> tags/attribution/rotation -> outbox

Responses/Statistics
  -> MarketingFormReportingService
  -> receipt/submission/events/version snapshots
```

## Módulos e ownership

- `src/modules/marketing-forms/domain/*`: schemas, publish gates, state machine, redirect/UTM/CSV/statistics policies.
- `src/modules/marketing-forms/application/*`: administração, runtime, submission e reporting.
- `src/app/formularios/*`: UI administrativa.
- `src/app/f/[slug]/*`: página pública sem shell visual.
- `src/app/api/marketing/forms/*`: API autenticada.
- `src/app/api/public/forms/*`: API anônima endurecida.
- `src/modules/leads/application/lead-intake-service.ts`: alteração aditiva apenas para `initialStageId`.

## Fluxo de publicação

1. Auth + `MARKETING_DEFINITIONS_MANAGE`.
2. Lock `marketing-form:{workspaceId}:{formId}`.
3. Recarregar form e comparar `expectedRevision`.
4. Validar draft, FKs tenant-scoped, contraste, redirect e referências de secret.
5. Calcular hash canônico da definição.
6. Criar versão `currentVersion + 1`.
7. Atualizar `publishedVersionId`, status `ACTIVE`, timestamps e revision.
8. Audit log na mesma transação.

## Fluxo de submit

1. Resolver `publicSlug` ativo e versão publicada; nunca aceitar workspace/version do client.
2. `readLimitedJson` + Zod strict + honeypot + tempo mínimo + rate limit compartilhado.
3. Lock por form/version/idempotency token hash.
4. Se receipt terminal existe, devolver replay opaco.
5. Criar receipt `PROCESSING` com answers snapshot validado e hashes necessários.
6. Resolver SYSTEM actor, source/pipeline/stage/tags dentro do workspace.
7. Chamar `LeadIntakeService` com transaction override e chave namespaced.
8. Vincular receipt/submission; aplicar tags e rotação exatamente uma vez.
9. Persistir eventos/touchpoint/conversion na arquitetura existente.
10. Enfileirar conversão externa pós-commit e retornar redirect validado.

## Concorrência e idempotência

- Draft: compare-and-swap por `revision` + lock.
- Publish: lock por form.
- Submit: unique `(workspaceId, marketingFormVersionId, idempotencyHash)` no receipt.
- Intake: unique `(workspaceId,idempotencyKey)` já existente.
- WhatsApp: lock por rotation state; cursor avança apenas ao receipt aceito, protegido por `rotationAppliedAt`.
- Eventos: unique idempotency key por sessão/form/version/tipo/question.

## Cache

- Administração/respostas: `no-store`.
- Definição pública: resolver dinamicamente; resposta `Cache-Control: private, no-store` inicialmente para garantir pause imediato. Otimização futura pode usar cache tag por form.
- PII/submit/receipt: sempre `no-store`.
- `generateStaticParams` não será usado.

## Performance/custo

- Índices por workspace/status/updated, publicSlug, form/version/submittedAt e eventos.
- Listas com cursor ou page/pageSize máximo.
- Estatística agrega SQL/groupBy, não carrega respostas ilimitadas.
- CSV itera páginas/lotes; limite operacional explícito se streaming não for viável na primeira task.
- Eventos `QUESTION_ANSWERED` guardam question/option keys, nunca texto livre.

## Falhas e compensação

- Falha antes do intake: receipt `REJECTED`/`FAILED_RETRYABLE` sem LeadFormSubmission.
- Falha durante a transação principal: rollback completo; replay retenta o mesmo receipt.
- Falha pós-commit de provider: outbox retry/dead-letter; lead permanece aceito.
- Tags ou rotação fazem parte da transação de orquestração quando possível; caso não, receipt registra pendência reprocessável.

## Reuso versus novo

- Reuso: auth, authorization, audit, rate limit, intake, contact/dedupe, pipeline, tags, sessions, touchpoints, conversions, outbox, SecretResolver, dialogs, design system, CSV helpers.
- Novo: aggregate/admin forms, receipt, form events, redirect rotation state, builder/runtime/reporting UI e APIs.

## Aceite

- Uma única cadeia de intake e identidade.
- Published snapshot imutável comprovado por teste/migration trigger ou service contract.
- Nenhum lookup administrativo apenas por ID; sempre workspace + permissão.
- Nenhuma chamada HTTP externa dentro da transação principal.
