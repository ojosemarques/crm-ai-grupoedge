# Etapa 19 — matriz final de paridade C01–C15

## Regra de decisão

Esta matriz fecha T19.1 e T19.3 sem transformar ausência de evidência em aceite.
A comparação usa as fontes públicas da Clint registradas em
[`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md), pois o solicitante
confirmou que não existe conta de avaliação disponível. Os quatro experimentos
que dependem de trial continuam não verificáveis; nenhum resultado foi
presumido.

- `PAR`: comportamento executado na Politizai e equivalente sustentado por fonte pública suficiente.
- `PARCIAL`: núcleo executado, mas existe lacuna comparativa ou externa relevante.
- `BLOQUEADO`: o aceite depende de canal, provedor, credencial ou fato externo ausente/inelegível.
- `DIVERGENTE`: decisão intencional da Politizai difere da Clint e está documentada.

Os responsáveis abaixo representam a revisão delegada pelo solicitante aos
agentes de produto, engenharia e operação. `PAR` não aprova operação real nem
substitui os gates produtivos de T19.2.

## Decisão por capacidade

| ID | Estado | Responsável | Decisão verificável |
|---|---|---|---|
| C01 | PARCIAL | Engenharia de dados + Operação | Identidade, multi vínculo, CSV e massa foram executados; a deduplicação equivalente da Clint segue indisponível sem trial. |
| C02 | PAR | Produto CRM + Engenharia | Modelo reutilizável, cópia, prévia, migração e rollback têm execução e comparação pública suficientes. |
| C03 | PAR | Operação comercial + Engenharia | Kanban/lista, filtros, redistribuição, concorrência, fechamento e RBAC têm prova executável. |
| C04 | DIVERGENTE | Produto Mandato + Operação | A Politizai preserva uma oportunidade longa com plano de conta e espera pactuada; essa extensão não possui objeto equivalente comprovado na Clint. |
| C05 | BLOQUEADO | Operação de atendimento + Segurança | Inbox local e posse exclusiva passam; conversa real multicanal depende de canais externos e WhatsApp é inelegível no escopo político atual. |
| C06 | BLOQUEADO | Growth + Privacidade | Segmentação, aprovação, custo, supressão e retry passam no simulador; nenhum fornecedor de envio foi homologado. |
| C07 | BLOQUEADO | Operação + Segurança | E-mail, telefonia, calendário, reunião e web móvel passam localmente; entrega, PSTN, OAuth e transcrição reais não foram homologados. |
| C08 | PARCIAL | Produto IA + Segurança | Construtor, base, avaliação, publicação e rollback passam em runtime determinístico; provedor externo e equivalência integral da governança Clint não foram comprovados. |
| C09 | BLOQUEADO | Operação de atendimento + Produto IA | Posse, pausa, proposta de campos e handoff passam; agente real em WhatsApp/Instagram não pode ser aceito sem canal homologado. |
| C10 | PARCIAL | Produto IA + Engenharia | Consulta e criação assistida com prévia, aprovação, cancelamento e undo passam; voz e comportamento transversal da Aura seguem sem prova operacional Clint. |
| C11 | PAR | Automação + Operação | Grafo versionado, publicação, execução antiga, retry e idempotência têm prova executável e fonte pública equivalente. |
| C12 | PARCIAL | Plataforma + Segurança | Webhooks assinados, API v1, cursor, idempotência e rollback passam; plano, limites e cobertura efetiva da API Clint seguem sem trial. |
| C13 | PARCIAL | Receita + Financeiro | Eventos assinados, ordem, replay, compra, assinatura e reembolso passam; provedor e caixa externos não foram reconciliados. Venda consultiva permanecer fora do checkout é diferença intencional. |
| C14 | PAR | Receita + Operação | Construtor, base temporal, filtros, CSV, drilldown, metas e forecast usam a mesma coorte e têm prova executável. |
| C15 | BLOQUEADO | Growth + Privacidade | UTM, custo, consentimento, orçamento e outbox passam; recibo real de conversão Meta/Google não existe e o escopo Meta é restrito. |

## Evidências anexadas

Cada seção inclui as sete facetas exigidas por T19.1. O teste
[`stage19-parity-matrix.test.ts`](../src/modules/readiness/domain/stage19-parity-matrix.test.ts)
falha se faltar capacidade, estado, responsável, faceta ou arquivo referenciado.

### C01

- **Funcional:** [`accounts.spec.ts`](../tests/e2e/accounts.spec.ts) e [`lead-entry.spec.ts`](../tests/e2e/lead-entry.spec.ts).
- **Integração:** [`portability.integration.test.ts`](../tests/integration/portability.integration.test.ts) e [`contact-identity.integration.test.ts`](../tests/integration/contact-identity.integration.test.ts).
- **Falha/retry:** roundtrip CSV, replay idempotente, conflito de payload, dry-run e fingerprint expirado na integração de portabilidade.
- **RBAC/privacidade:** exportação por escopo, neutralização CSV e negativas cross-workspace nos mesmos testes e em [`auth-rbac.integration.test.ts`](../tests/integration/auth-rbac.integration.test.ts).
- **Acessibilidade/mobile:** navegação e 360 responsivos em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** pessoa com duas contas e oportunidades, IDs antes/depois e CSV sintético em [`CONTACTS_ACCOUNTS_PORTABILITY.md`](./CONTACTS_ACCOUNTS_PORTABILITY.md).
- **Clint:** C01 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); deduplicação operacional continua indisponível sem trial.

### C02

- **Funcional:** [`commercial-settings.spec.ts`](../tests/e2e/commercial-settings.spec.ts) e [`pre-sales-pipeline.spec.ts`](../tests/e2e/pre-sales-pipeline.spec.ts).
- **Integração:** [`pipeline-templates.integration.test.ts`](../tests/integration/pipeline-templates.integration.test.ts).
- **Falha/retry:** prévia com fingerprint, versão otimista, migração inválida e rollback da última aplicação no teste de templates.
- **RBAC/privacidade:** equipes A/B, workspace, leitura e mutação server-side no mesmo teste.
- **Acessibilidade/mobile:** funil responsivo em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** modelo, versões imutáveis, mapa de etapas, cards afetados e histórico em [`PIPELINE_TEMPLATES_CONFIGURATION.md`](./PIPELINE_TEMPLATES_CONFIGURATION.md).
- **Clint:** C02 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md), inclusive o risco público de exclusão compartilhada.

### C03

- **Funcional:** [`opportunities-sales.spec.ts`](../tests/e2e/opportunities-sales.spec.ts) e [`pre-sales-pipeline.spec.ts`](../tests/e2e/pre-sales-pipeline.spec.ts).
- **Integração:** [`opportunities-sales.integration.test.ts`](../tests/integration/opportunities-sales.integration.test.ts) e [`pre-sales-pipeline.integration.test.ts`](../tests/integration/pre-sales-pipeline.integration.test.ts).
- **Falha/retry:** revisão otimista, transição inválida, fechamento sem motivo e reexecução idempotente nas integrações.
- **RBAC/privacidade:** owner, equipe, origem e negativas cross-workspace em pipeline e oportunidades.
- **Acessibilidade/mobile:** Kanban móvel em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** `StageHistory`, snapshot de resultado, responsável, filtros e razão de perda persistidos.
- **Clint:** C03 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md).

### C04

- **Funcional:** jornada Mandato em [`consultative-sales-gates.integration.test.ts`](../tests/integration/consultative-sales-gates.integration.test.ts).
- **Integração:** [`account-plan.integration.test.ts`](../tests/integration/account-plan.integration.test.ts).
- **Falha/retry:** revisão de proposta, reentrada, espera pactuada e comando idempotente sem tarefa duplicada.
- **RBAC/privacidade:** oportunidade autorizada por owner/equipe/origem e isolamento de workspace.
- **Acessibilidade/mobile:** Meu Dia e atividades móveis em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** plano, trilhas, revisões, proposta v1/v2 e troca de stakeholder em [`ACCOUNT_PLAN_LONG_CADENCE.md`](./ACCOUNT_PLAN_LONG_CADENCE.md).
- **Clint:** C04 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); plano de conta é extensão Politizai.

### C05

- **Funcional:** [`omnichannel-inbox.spec.ts`](../tests/e2e/omnichannel-inbox.spec.ts).
- **Integração:** [`omnichannel-inbox.integration.test.ts`](../tests/integration/omnichannel-inbox.integration.test.ts) e [`whatsapp.integration.test.ts`](../tests/integration/whatsapp.integration.test.ts).
- **Falha/retry:** mensagem duplicada, claim concorrente, transferência e retomada sem segunda resposta.
- **RBAC/privacidade:** posse, fila, setor, workspace e ocultação de endereço em [`INBOX_UNIFIED_STAGE07.md`](./INBOX_UNIFIED_STAGE07.md).
- **Acessibilidade/mobile:** inbox móvel em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** conversa, mensagem, vínculo comercial, assignment history e audit log sintéticos.
- **Clint:** C05 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); WhatsApp Politizai permanece `INELIGIBLE` em [`WHATSAPP_CLOUD_API.md`](./WHATSAPP_CLOUD_API.md).

### C06

- **Funcional:** campanha no simulador em [`outbound-campaigns.integration.test.ts`](../tests/integration/outbound-campaigns.integration.test.ts).
- **Integração:** a mesma suíte cobre segmento, prévia, aprovação, agenda, processamento e relatório.
- **Falha/retry:** hash divergente, opt-out tardio, sobreposição, retry/backoff, cancelamento e replay.
- **RBAC/privacidade:** permissões distintas de leitura/configuração/aprovação/execução e payload de tela minimizado.
- **Acessibilidade/mobile:** shell e navegação móvel compartilhados em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts); a campanha não tem aceite externo.
- **Dados:** destinatários, supressões, custo estimado, attempts e recibos persistidos em [`STAGE10_OUTBOUND_CAMPAIGNS.md`](./STAGE10_OUTBOUND_CAMPAIGNS.md).
- **Clint:** C06 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); fornecedores externos seguem não homologados.

### C07

- **Funcional:** [`email.spec.ts`](../tests/e2e/email.spec.ts), [`telephony.spec.ts`](../tests/e2e/telephony.spec.ts), [`calendar.spec.ts`](../tests/e2e/calendar.spec.ts) e [`meetings-agenda.spec.ts`](../tests/e2e/meetings-agenda.spec.ts).
- **Integração:** [`stage09-channels.integration.test.ts`](../tests/integration/stage09-channels.integration.test.ts).
- **Falha/retry:** timeout, falha transitória/permanente, evento fora de ordem e conflito de calendário nas integrações específicas.
- **RBAC/privacidade:** consentimento, gravação bloqueada, acesso a transcrição e escopo por workspace.
- **Acessibilidade/mobile:** atalhos governados de conta/contato e agenda em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** contagens locais declaram `externalEgress=false`, `externalValidation=false` e `homologated=false` em [`STAGE09_CHANNELS_MEETINGS.md`](./STAGE09_CHANNELS_MEETINGS.md).
- **Clint:** C07 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); provider e transcrição reais continuam pendentes.

### C08

- **Funcional:** [`ai-governance.spec.ts`](../tests/e2e/ai-governance.spec.ts).
- **Integração:** [`stage12-governed-agents.integration.test.ts`](../tests/integration/stage12-governed-agents.integration.test.ts) e [`ai-governance.integration.test.ts`](../tests/integration/ai-governance.integration.test.ts).
- **Falha/retry:** baixa confiança, oferta futura, PII, prompt injection, ausência de fonte, pausa e rollback.
- **RBAC/privacidade:** publicação/evaluação separadas, minimização e isolamento de workspace.
- **Acessibilidade/mobile:** construtor de agentes responsivo em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** versões de agente/base, avaliações, fontes, custo e decisão humana em [`STAGE12_GOVERNED_AGENTS.md`](./STAGE12_GOVERNED_AGENTS.md).
- **Clint:** C08 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); governança integral não é verificável publicamente.

### C09

- **Funcional:** conversa agente→humano na integração [`stage12-governed-agents.integration.test.ts`](../tests/integration/stage12-governed-agents.integration.test.ts).
- **Integração:** inbox e runtime governado combinados com [`omnichannel-inbox.integration.test.ts`](../tests/integration/omnichannel-inbox.integration.test.ts).
- **Falha/retry:** resposta humana pausa agente; retomada exige novo gatilho; mudança sensível permanece proposta.
- **RBAC/privacidade:** posse exclusiva, handoff e campos propostos sujeitos a decisão humana.
- **Acessibilidade/mobile:** inbox e agentes móveis em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** mensagens, fontes, propostas, handoff e decisões humanas persistidos.
- **Clint:** C09 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); agente Instagram permanece indisponível sem trial e provider.

### C10

- **Funcional:** [`manager-copilot.spec.ts`](../tests/e2e/manager-copilot.spec.ts).
- **Integração:** [`stage13-approval-assistant.integration.test.ts`](../tests/integration/stage13-approval-assistant.integration.test.ts).
- **Falha/retry:** `CANCEL`, `UNDO`, conflito de revisão e `PUBLISH_FAILED` sem replay automático.
- **RBAC/privacidade:** consulta aplica escopo da métrica; aprovação exige administrador e permissão do serviço alvo.
- **Acessibilidade/mobile:** shell, formulários e foco responsivos em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** pergunta, fórmula, fontes, diff, impacto, hash, versão e alvo persistidos em [`ETAPA13_ASSISTENTE_APROVACAO.md`](./ETAPA13_ASSISTENTE_APROVACAO.md).
- **Clint:** C10 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); voz e criação ampla seguem sem trial.

### C11

- **Funcional:** [`lifecycle-automations.spec.ts`](../tests/e2e/lifecycle-automations.spec.ts).
- **Integração:** [`automation-builder.integration.test.ts`](../tests/integration/automation-builder.integration.test.ts) e [`automation-engine.integration.test.ts`](../tests/integration/automation-engine.integration.test.ts).
- **Falha/retry:** backoff, falha terminal, lock expirado, replay e recibo idempotente de efeito.
- **RBAC/privacidade:** leitura, gestão e execução separadas; condições e ações revalidam workspace.
- **Acessibilidade/mobile:** navegação operacional móvel em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** grafo, versões, runs, attempts, jobs e effects persistidos em [`AUTOMATIONS.md`](./AUTOMATIONS.md).
- **Clint:** C11 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md).

### C12

- **Funcional:** [`lead-entry.spec.ts`](../tests/e2e/lead-entry.spec.ts) e [`integrations.spec.ts`](../tests/e2e/integrations.spec.ts).
- **Integração:** [`stage14-public-api.integration.test.ts`](../tests/integration/stage14-public-api.integration.test.ts) e [`stage14-acquisition.integration.test.ts`](../tests/integration/stage14-acquisition.integration.test.ts).
- **Falha/retry:** assinatura inválida, duplicata, evento fora de ordem, cursor, idempotência e rollback de mapping.
- **RBAC/privacidade:** token expirável/revogável, escopos `RECORDS_READ/WRITE`, consentimento allowlist e segredo apenas por referência.
- **Acessibilidade/mobile:** entrada e integrações sob shell responsivo em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** webhook inbox, mappings, cursor, attempts, audit e outbox em [`STAGE14_ACQUISITION_API.md`](./STAGE14_ACQUISITION_API.md).
- **Clint:** C12 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); plano e limites permanecem indisponíveis sem trial.

### C13

- **Funcional:** [`payments.spec.ts`](../tests/e2e/payments.spec.ts) e [`contracts.spec.ts`](../tests/e2e/contracts.spec.ts).
- **Integração:** [`stage15-checkout.integration.test.ts`](../tests/integration/stage15-checkout.integration.test.ts) e [`payments-sandbox.integration.test.ts`](../tests/integration/payments-sandbox.integration.test.ts).
- **Falha/retry:** HMAC/nonce/timestamp inválidos, replay, conflito de hash, sequência fora de ordem, reembolso e abandono.
- **RBAC/privacidade:** checkout interno aplica sessão/RBAC/same-origin; webhook público exige assinatura e limite.
- **Acessibilidade/mobile:** contratos e fluxo financeiro usam o shell responsivo validado em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** snapshot de produto, eventos append-only, bruto, reembolso e líquido em [`STAGE15_CHECKOUT_REVENUE.md`](./STAGE15_CHECKOUT_REVENUE.md).
- **Clint:** C13 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); checkout consultivo é deliberadamente não aplicável.

### C14

- **Funcional:** [`forecast.spec.ts`](../tests/e2e/forecast.spec.ts) e [`revenue-metrics.spec.ts`](../tests/e2e/revenue-metrics.spec.ts).
- **Integração:** [`stage16-analytics-builder.integration.test.ts`](../tests/integration/stage16-analytics-builder.integration.test.ts) e [`stage16-metrics-forecast.integration.test.ts`](../tests/integration/stage16-metrics-forecast.integration.test.ts).
- **Falha/retry:** revisão otimista, filtro inválido, métrica incompatível e oportunidade inelegível com motivo persistido.
- **RBAC/privacidade:** `metrics.read`, `operations.manage`, same-origin, workspace e CSV neutralizado.
- **Acessibilidade/mobile:** dashboard móvel em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** widget, coorte, base temporal, drilldown e CSV usam o mesmo conjunto em [`STAGE16_ANALYTICS_FORECAST.md`](./STAGE16_ANALYTICS_FORECAST.md).
- **Clint:** C14 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md).

### C15

- **Funcional:** [`marketing-attribution.spec.ts`](../tests/e2e/marketing-attribution.spec.ts).
- **Integração:** [`stage14-acquisition.integration.test.ts`](../tests/integration/stage14-acquisition.integration.test.ts), [`meta-ads.integration.test.ts`](../tests/integration/meta-ads.integration.test.ts) e [`google-ads.integration.test.ts`](../tests/integration/google-ads.integration.test.ts).
- **Falha/retry:** `event_id` determinístico, cancelamento pendente, duplicata, orçamento excedido e outbox recuperável.
- **RBAC/privacidade:** consentimento, escopo, permissão de conversão, minimização e kill switch.
- **Acessibilidade/mobile:** aquisição e dashboard no shell responsivo em [`stage17-mobile-ux.spec.ts`](../tests/e2e/stage17-mobile-ux.spec.ts).
- **Dados:** touchpoint, UTM, custo, conversão, crédito, outbox e reconciliação em [`ETAPA14_ATRIBUICAO_FEEDBACK.md`](./ETAPA14_ATRIBUICAO_FEEDBACK.md).
- **Clint:** C15 em [`ETAPA01_CLINT_FONTES.md`](./ETAPA01_CLINT_FONTES.md); Meta real é restrita e Google não possui procedimento público equivalente localizado.

## Jornadas integrais

As jornadas de release são compostas por fatos canônicos já cobertos pelas
suítes anexadas, sem usar mocks como prova de provider:

1. inbound → venda Mandato longa → contrato → onboarding → renovação: C01–C04,
   [`contracts-commercial.integration.test.ts`](../tests/integration/contracts-commercial.integration.test.ts),
   [`stage18-value-cycle.integration.test.ts`](../tests/integration/stage18-value-cycle.integration.test.ts);
2. campanha → resposta → handoff: C05–C06, limitada ao simulador local;
3. agente → humano: C08–C09, limitada ao runtime determinístico e inbox local;
4. checkout → pagamento → reembolso: C13, limitada ao emissor assinado sintético.

## Conclusão formal de T19.1/T19.3

A suíte e a matriz são completas para o código e para as fontes públicas
disponíveis. A decisão consolidada é **abaixo de 100% de paridade funcional**:
4 capacidades `PAR`, 5 `PARCIAL`, 5 `BLOQUEADO` e 1 `DIVERGENTE`. Os bloqueios
de canal/provedor e as lacunas que exigem trial continuam visíveis. T19.2 e a
decisão de go-live devem usar essa classificação sem convertê-la em aprovação.
