# 06 — Ingestão, CRM e atribuição

## Objetivo

Transformar receipt público aceito em `LeadFormSubmission` e Contact/Lead pelo serviço canônico, preservando versão, destino, dedupe e evidência.

## Mapping

- Mapping é validado no publish e novamente no submit.
- `fullName` e `phone` obrigatórios; email lower-case; stateCode 2 chars; budget inteiro não negativo em centavos.
- Campos não mapeados permanecem em `receipt.answers` e `rawPayload.formAnswers` com question/option keys.
- Labels são snapshot de exibição; identidade é stable key.

## Chamada canônica

`MarketingFormSubmissionService` resolve SYSTEM actor `key=system` e chama `getLeadIntakeService().intake()` com:

- `channel: FORM`;
- `idempotencyKey: form:{formId}:version:{versionId}:receipt:{receiptId}`;
- `formIdentifier: form.key`;
- `sourceKey`, `pipelineId`, novo `initialStageId`, priority;
- `requestedOwnerMemberId` ausente;
- `rawPayload` estruturado e minimizado;
- `acquisition`: `marketingFormKey`, versão, session, UTMs, landing URL/referrer/click IDs.

## Extensão do intake

Adicionar `initialStageId?: uuid` ao contrato. `findReferences()` deve exigir que a etapa seja ativa, `OPEN`, no mesmo workspace e no pipeline resolvido; sem campo, preserva primeira etapa aberta atual. Testes de todos os callers existentes garantem compatibilidade aditiva.

## Dedupe e divergência

O intake existente continua decidindo CREATED/ATTACHED e revisão de identidade. Replay retorna o mesmo resultado. O form runtime não faz upsert direto de Contact/Lead nem sobrescreve divergências.

## Tags, fila e prioridade

- Source/pipeline/stage/tag/queue IDs são validados server-side no publish e submit.
- Tags aplicadas por `LeadTag`/`CommercialEntityTag` com unique idempotente, sem reativação silenciosa indevida.
- Queue/owner continuam sob o routing canônico; form não escolhe owner client-side.
- Prioridade usa `P1/P2/P3` existente.

## Atribuição

O intake já chama `recordLeadIntakeAttributionInTransaction`; a evidence deve resolver form/version/session reais e preencher FKs de submission/touchpoint. `FORM_SUBMIT` é um touchpoint; `LEAD_RECEIVED` é conversion apenas conforme outcome/regra existente. Retry não duplica.

## Round-robin de WhatsApp

Não altera owner do CRM. Após intake aceito, lock da rotation state seleciona próximo endpoint ativo do snapshot, persiste `rotationTargetKey`, incrementa uma vez e deriva URL com mensagem encoded. Replay usa target persistido.

## Reprocessamento/reconciliação

- Só receipt `FAILED_RETRYABLE` sem submission pode reprocessar.
- A mesma chave é reutilizada; CREATED/ATTACHED terminal não reprocessa.
- Serviço de reconciliação lista receipt sem submission, submission sem form/version e status divergente.
- Ação admin exige motivo, permissão e audit.

## Falhas

- `INVALID_PAYLOAD` não cria receipt com PII além da política de abuso; conta rejection event.
- Configuração ausente gera `FAILED_RETRYABLE` ou `REJECTED_CONFIG` com safe code.
- Provider não participa da transação.
- Se tag/rotation falhar na transação, nenhum sucesso parcial é retornado.

## Testes/aceite

- Novo contato/lead e identidade existente.
- Divergência abre review existente.
- Pipeline/etapa/source/tags corretos e cross-tenant negado.
- Replay e concorrência: um receipt, submission, lead effect, rotação e conversion.
- UTMs/click IDs/form/version/session percorrem até touchpoint.
- Opportunity não é criada automaticamente.
