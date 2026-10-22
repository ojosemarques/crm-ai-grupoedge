# Registro de decisões

Data das decisões iniciais: 2026-10-21.

## ADR-001 — Agregado e publicação

- **Decisão:** `MarketingForm` guarda rascunho/lifecycle; `MarketingFormVersion` guarda snapshot publicado imutável e hash.
- **Alternativas:** editar a versão corrente; criar conjunto totalmente novo de tabelas.
- **Evidência:** modelos existentes já representam formulário/versão, mas `saveMarketingForm` cria versão em todo save.
- **Trade-off:** migration e serviço novos; em troca, rollback/auditoria e respostas históricas consistentes.
- **Revisar quando:** houver publicação multiambiente ou branching editorial.

## ADR-002 — Recibo público, não segundo intake

- **Decisão:** `MarketingFormReceipt` controla idempotência, payload validado e reconciliação; a criação de Contact/Lead/LeadFormSubmission passa exclusivamente por `LeadIntakeService`.
- **Alternativas:** gravar direto em tabelas CRM; usar somente `LeadFormSubmission` como caixa de entrada.
- **Evidência:** intake atual concentra dedupe, tasks, routing e atribuição; a submissão exige materialização transacional já iniciada.
- **Trade-off:** um registro técnico adicional, com retenção de PII; evita duplicação de regras e perda em falha pré-intake.
- **Revisar quando:** o intake oferecer inbox nativa antes da materialização.

## ADR-003 — Eventos analíticos separados

- **Decisão:** fatos públicos de view/start/step/complete/redirect ficam em `MarketingFormEvent`, sem respostas/PII.
- **Alternativas:** derivar tudo de receipts; usar logs ou provider externo.
- **Evidência:** conversão e abandono exigem denominadores anteriores ao submit.
- **Trade-off:** mais writes controlados e retenção própria; métricas auditáveis e provider-independent.
- **Revisar quando:** houver warehouse/event bus corporativo.

## ADR-004 — Slug global no v1

- **Decisão:** `publicSlug` é globalmente único, enquanto `key` permanece único por workspace.
- **Alternativas:** slug por tenant com domínio/subpath de workspace.
- **Evidência:** URL contratada é `/f/[slug]`, sem contexto de tenant.
- **Trade-off:** colisões globais; resolução simples e sem enumeração de workspace.
- **Revisar quando:** domínios customizados ou `/w/[workspace]/f/[slug]` forem requisito.

## ADR-005 — Branding por URL validada

- **Decisão:** logo/fundo aceitam HTTPS remoto com validação estrita; upload não entra no primeiro aceite.
- **Alternativas:** adaptar `AttachmentReference`; criar storage dedicado agora.
- **Evidência:** attachment atual exige `messageId` e é orientado a mensagens.
- **Trade-off:** disponibilidade externa e CSP; evita acoplamento incorreto e migration de storage prematura.
- **Revisar quando:** produto exigir upload/asset ownership ou host allowlist fechada.

## ADR-006 — Publicação dinâmica inicialmente

- **Decisão:** resolver definição publicada no servidor com `no-store`; não usar cache compartilhado no primeiro rollout.
- **Alternativas:** ISR/tag invalidation desde o início.
- **Evidência:** pausa deve ter efeito imediato e volume ainda não foi medido.
- **Trade-off:** uma leitura por carga; comportamento operacional simples e seguro.
- **Revisar quando:** métricas mostrarem custo/latência relevante e houver teste de invalidação.

## ADR-007 — Capabilities existentes

- **Decisão:** reutilizar `MARKETING_DEFINITIONS_MANAGE` para mutações, `MARKETING_JOURNEY_READ` para leitura e `MARKETING_EVIDENCE_EXPORT` para CSV; não criar papéis paralelos.
- **Alternativas:** capabilities `FORMS_*` novas.
- **Evidência:** registry e papéis atuais já separam definição, jornada e export.
- **Trade-off:** granularidade menor no v1; menor risco de matriz incoerente.
- **Revisar quando:** gestão de formulários precisar delegação independente.

## ADR-008 — Etapa inicial aditiva no intake

- **Decisão:** adicionar `initialStageId?` ao `LeadIntakeInput`; validar que pertence ao pipeline/workspace. Sem valor, preservar primeira etapa OPEN atual.
- **Alternativas:** mover lead depois do intake; duplicar intake para forms.
- **Evidência:** `findReferences` sempre escolhe a primeira etapa OPEN.
- **Trade-off:** contrato central aumenta; evita janela inconsistente e efeitos duplicados.
- **Revisar quando:** houver política de stage por fonte no domínio CRM.

## ADR-009 — Integrações assíncronas e gated

- **Decisão:** aceite do lead precede pixels/providers; server events entram no outbox idempotente. Apenas `secretRef` persiste. Google write permanece desabilitado até homologação explícita.
- **Alternativas:** provider síncrono no submit; token na definição.
- **Evidência:** `SecretResolver`, `OutboxEvent` e conversion feedback existentes; documentação interna já bloqueia write Google não homologado.
- **Trade-off:** conversão externa eventual; submit resiliente e secret protegido.
- **Revisar quando:** provider/consentimento/SLA forem aprovados.

## ADR-010 — Rotação por versão publicada

- **Decisão:** cursor atômico por `formId + versionId`; receipt grava o destino escolhido e retry o reutiliza.
- **Alternativas:** random a cada request; cursor no rascunho/formulário.
- **Evidência:** retry não pode alternar o mesmo respondente e snapshots precisam reproduzir comportamento.
- **Trade-off:** uma linha de estado por versão; consistência e auditoria.
- **Revisar quando:** houver roteador central ponderado/health-aware.
