# Rollout e operação

## Estado real em 2026-10-22

O projeto Vercel de produção foi confirmado como `Grupo Edge / grupo-edge-crm`. Como o ambiente Production não expõe `DATABASE_URL` e não possui `DIRECT_URL`, nenhuma credencial foi inventada ou promovida. A identidade do banco foi confirmada pelo Supabase (`CRM POLITIZAI`, `postgres`, schema `crm`, região `ca-central-1`) e as duas migrations aditivas foram aplicadas pela API oficial com `search_path` explícito. A verificação confirmou os objetos no schema correto e nenhum objeto homônimo novo em `public`. Rollback permanece deploy anterior + migrations aditivas compatíveis.

O commit de implementação `e562f73` foi enviado para `main` e publicado pelo deployment Production `dpl_ETkNU5edwE77EBS4GETzYaVtb37N`, estado `Ready`. O smoke no domínio canônico confirmou health/readiness, proteção administrativa, resposta pública segura, CSP e ausência de erro/fatal/HTTP 5xx após o rollout.

## Estratégia

Entrega aditiva e reversível em aplicação:

1. migration compatível antes do código depender das novas colunas/tabelas;
2. deploy com módulo admin protegido por capability existente;
3. criar/publicar somente dados de teste ou template aprovado;
4. validar runtime e submit no domínio confirmado;
5. ativar integrações por formulário apenas após secrets/consentimento/provider homologados.

Não existe downgrade destrutivo automático. Rollback padrão é voltar ao deployment anterior mantendo tabelas/colunas aditivas; correção de dados usa procedimento explícito e auditável.

## Flags e templates

- Gate primário: capability `MARKETING_DEFINITIONS_MANAGE`; leitura/export usam suas capabilities próprias.
- Gate público: lifecycle + `publishedVersionId`; `PAUSED`/`ARCHIVED` corta resolução imediatamente.
- Meta/Google/WhatsApp: configuração por versão e flags explícitas; ausência de secret/provider degrada para sem egress, nunca para falha do lead.
- Template inicial opcional: “Captação de mandato”, criado via serviço/idempotency key e marcado como template/teste; não semear PII, workspace ou usuário inventado.

## Migração

Antes de produção:

- conferir URL/cluster/schema sem imprimir credenciais;
- confirmar backup/restore e migration history;
- executar generate e migration-from-zero em banco efêmero;
- revisar SQL para lock/rewrite/destruição; novas colunas em tabela existente devem ser nullable/default seguro;
- obter contagens/estado mínimo, aplicar uma vez e verificar migration history/constraints.

Se aparecer `DROP`, alteração incompatível ou alvo divergente, interromper antes da aplicação. Não usar `migrate reset`, `db push --accept-data-loss` ou SQL amplo.

## Staging e produção

O pedido atual autoriza `main` e produção diretamente. Isso elimina a exigência de promoção por staging, mas não os gates técnicos:

- confirmar repositório/branch/remote e projeto/account Vercel;
- confirmar banco usado pelo ambiente Production;
- checks locais/CI completos antes do push;
- commit coeso; push normal, nunca force;
- observar CI e construir deployment de produção vinculado ao commit;
- verificar URL/domínio/commit/deployment na fonte.

Caso exista Preview isolado no mesmo projeto, ele pode ser usado como smoke adicional, não como substituto do smoke de produção solicitado.

## Smoke pós-deploy

- `/formularios`: não autenticado redireciona; autorizado vê menu/índice.
- `/f/<slug-inexistente>`: 404/noindex, sem shell administrativo.
- formulário de teste publicado: load, progress, validação, submit e thank-you/redirect.
- resposta aparece uma vez no CRM e na aba Respostas; estatísticas atualizam sem duplicidade.
- logs/outbox sem erro sistêmico, PII ou secrets; provider desabilitado não bloqueia.
- headers/CSP/cache e mobile básicos.

Qualquer dado sintético deve usar prefixo inequívoco `E2E_FORM_` e ser removido/arquivado via operação de produto segura; não apagar registros reais.

## Observabilidade

Métricas/contadores recomendados, sem labels de alta cardinalidade/PII:

- public definition resolve por status;
- event accept/reject/rate-limit;
- receipt accepted/processing/completed/failed/reconciled;
- intake duration/error code;
- outbox queued/sent/retry/dead-letter por provider;
- redirect type e rotation selection por formulário/versão apenas em IDs internos.

Logs estruturados: requestId, workspaceId interno, formId/versionId/receiptId, status e código seguro. Nunca respostas, telefone, email, token, URL assinada ou payload do provider.

Alertas iniciais: aumento de submit 5xx, receipts presos, outbox dead-letter, resolução 404 anômala após publish e discrepância receipt/submission.

## Runbooks

### Pausar formulário comprometido

1. autenticar e confirmar workspace/formulário;
2. mudar lifecycle para `PAUSED` via serviço admin;
3. confirmar `/f/[slug]` 404 e registrar audit log;
4. preservar versões/receipts para investigação.

### Reconciliar receipt

1. localizar por ID público/idempotency hash, nunca por PII em log;
2. conferir status da `LeadFormSubmission` e efeitos de intake;
3. executar reprocess idempotente com capability/audit;
4. confirmar um único submission/lead/conversion/rotation.

### Provider degradado

1. manter intake ativo;
2. desabilitar integração do formulário ou pausar worker específico;
3. inspecionar outbox por código seguro;
4. reprocessar somente eventos idempotentes após correção.

### Rollback de aplicação

1. identificar deployment anterior saudável;
2. promover/redeployar sem reverter migration aditiva;
3. pausar formulários se contrato de runtime estiver incompatível;
4. verificar login, CRM existente e endpoints públicos.

## Gates externos

- secret real e homologação de Meta/Google;
- política/consentimento LGPD para enhanced conversions;
- domínio customizado e ownership de assets/uploads;
- política formal de retenção/anonymização de respostas.

Defaults seguros enquanto pendentes: integrações desligadas, URLs HTTPS validadas, retenção sem job destrutivo automático e nenhum upload.

## Critério operacional de conclusão

- migration e deployment correspondem ao commit da `main`;
- smoke e checks estão registrados em `12-validation.md`;
- rollback é possível sem perda de dados;
- não há secrets/debug/fixtures pessoais no diff;
- riscos/gates restantes estão explícitos no relatório final.
