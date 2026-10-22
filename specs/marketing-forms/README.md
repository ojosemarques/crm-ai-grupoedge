# Formulários de Marketing

## Propósito

Especificar e executar a experiência de formulários conversacionais do CRM Politiza AI, da administração em `/formularios` ao runtime público em `/f/[slug]`, usando o intake canônico de leads e mantendo versionamento, idempotência, isolamento de workspace, privacidade e auditoria.

## Fonte de verdade

1. `AGENTS.md` e o contrato global informado pelo usuário.
2. Estado atual do repositório no `HEAD` registrado em `00-audit-evidence.md`.
3. Estas specs, na ordem abaixo.
4. Código, migrations e testes implementados.
5. Evidência real registrada em `12-validation.md`.

O documento `docs/PROMPT_MASTER_FORMULARIOS_MARKETING_CRM.md` é a origem do escopo, não substitui as decisões repository-first destas specs.

## Índice

- `00-audit-evidence.md` — baseline, evidências e gaps.
- `01-product-spec.md` — produto e critérios de aceite.
- `02-architecture-design.md` — arquitetura e ADRs.
- `03-data-api-security.md` — dados, APIs, segurança e privacidade.
- `04-admin-builder-ux.md` — UX administrativa.
- `05-public-form-runtime.md` — runtime público.
- `06-crm-ingestion-attribution.md` — intake, atribuição e CRM.
- `07-integrations-sharing.md` — pixels, WhatsApp, QR e UTMs.
- `08-responses-statistics.md` — respostas, CSV e estatísticas.
- `09-tasks.md` — DAG executável T0–T16.
- `10-state.md` — estado persistido da execução.
- `11-decisions.md` — ADRs curtos.
- `12-validation.md` — matriz e resultados reais.
- `13-rollout-operations.md` — rollout, operação e rollback.

## Regra de execução

- Implementar task por task na ordem de `09-tasks.md`.
- Não avançar quando o gate binário da task falhar.
- Atualizar `10-state.md` e `12-validation.md` após cada task.
- Preservar os cinco documentos não rastreados existentes em `docs/`.
- Produção foi explicitamente autorizada pelo usuário nesta sessão, mas só ocorre depois de migrations, checks, commit/push na `main`, preflight, deploy e smoke confirmados.
- Meta/Google/WhatsApp reais continuam sem egress por padrão; habilitação requer configuração válida e consentimento/base legal.

## Glossário

- **Definição:** rascunho mutável do formulário.
- **Versão publicada:** snapshot imutável servido ao público.
- **Receipt:** recibo opaco e idempotente da tentativa pública.
- **Submission:** `LeadFormSubmission` aceita pelo intake canônico.
- **Session:** sessão anônima sem PII usada para funil/UTM.
- **Stable key:** identidade imutável de pergunta/opção.
- **Published pointer:** referência atômica da definição para a versão pública ativa.

## Status geral

`SPECS_CONCLUÍDAS — T3 EM EXECUÇÃO`. A baseline foi auditada em 21/10/2026 sobre `main`/`df7dd55657b53b7d2f224ce0572924ebb3269828`.
