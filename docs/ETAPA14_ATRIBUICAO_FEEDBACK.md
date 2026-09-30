# Etapa 14.2 — atribuição e feedback de conversão

- `GET /api/integrations/meta/conversions` reconcilia touchpoints com UTM, custo importado, conversões canônicas e estados da outbox, preservando provedor, versão, identificador externo e evidência.
- `POST /api/integrations/meta/conversions` aceita `QUEUE`, `CANCEL_PENDING` e `VALIDATE_WRITE_CAPABILITY`. A validação confirma acesso de leitura ao dataset e habilita `SYNC_PUSH`; a primeira entrega aceita continua sendo a prova externa de escrita. A chave idempotente e o `event_id` determinístico impedem sinais duplicados.
- Antes da fila e novamente antes do egress, o serviço exige conexão Meta ativa, finalidade `marketing-conversion-feedback`, base legal ativa e consentimento `GRANTED` no canal `OTHER`.
- E-mail e telefone são normalizados e convertidos em SHA-256 antes da persistência. O envio lê `META_ADS_ACCESS_TOKEN` e `META_ADS_DATASET_ID` somente no servidor.
- Falhas transitórias respeitam `Retry-After` e backoff; falhas permanentes, credencial revogada e consentimento revogado encerram em dead letter. `CANCEL_PENDING` exercita rollback antes do egress.
- `GET/POST /api/integrations/google-ads/conversions` responde `BLOCKED_NOT_VALIDATED_IN_TRIAL_OR_API`; nenhum upload Google é prometido sem conta autorizada e teste real.

O processador interno `getConversionFeedbackService().processNext(workerId)` está registrado no batch serverless com a chave `meta-conversions`. O aceite HTTP da Meta grava `DELIVERED_EXTERNAL` e `deliveredExternallyAt`; a tentativa registra `provider: META`, `eventsReceived` e presença de trace, sem armazenar o trace. Não existe operação pública para acionar o worker.
