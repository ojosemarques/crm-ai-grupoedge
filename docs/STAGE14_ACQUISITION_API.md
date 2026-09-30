# Etapa 14 — aquisição e API CRM v1

## Entradas homologáveis

`POST /api/acquisition/connections` cria configuração versionada para `FORM`,
`LANDING_PAGE`, `TYPEFORM` e `META_LEAD_ADS`. A conexão nasce desativada em
`AWAITING_CREDENTIAL`: o banco guarda somente a referência do segredo. `PATCH`
permite ativar após resolução server-side, versionar/voltar o mapping e revogar.

O endpoint público é
`/api/acquisition/{workspaceSlug}/{connectionKey}/webhook`. Typeform valida
`Typeform-Signature`; Meta valida `X-Hub-Signature-256` e o challenge GET. Meta
aceita batches e processa cada `leadgen_id` de modo idempotente. Quando necessário,
enriquece o lead no host fixo `graph.facebook.com` e na versão vigente da API,
com Bearer específico da conexão, timeout e limite de resposta. Formulário e landing são adaptadores server-to-server
assinados; esta entrega não expõe segredo HMAC em JavaScript de navegador.

Todo evento passa por `WebhookInbox`, mapping ativo e `LeadIntakeService`. A chave
de intake é estável por conexão e objeto externo, duplicatas são replay seguro e
eventos anteriores ao cursor ficam `IGNORED`. O resultado atualiza mapping/cursor,
tentativa e outbox. Consentimento só aceita booleano ou valores explícitos da
allowlist; UTM, referrer, landing e versão do formulário seguem no bloco de
evidência de aquisição.

## API versionada

`/api/v1/{contacts|accounts|deals|sources|fields}` oferece GET/POST e
`/{id}` oferece GET/PATCH/DELETE. Listagens usam cursor opaco. Escritas exigem
`Idempotency-Key`, precondição de revisão/timestamp, audit log e outbox atômicos.

A API reutiliza a identidade de máquina governada já existente, com os escopos
`RECORDS_READ` e `RECORDS_WRITE`. O token é revogável, expira e nunca autoriza SQL.
n8n, Make e Zapier usam apenas HTTPS/Bearer nesta API. Os comandos assinados do
sandbox n8n permanecem com contrato e validação próprios; a API CRM não reduz a
confiança exigida por eles.

## Credenciais e rollback

Segredos ficam em variáveis allowlisted (`ACQUISITION_*`, `TYPEFORM_*`,
`META_ADS_*`). Para Meta, assinatura, challenge e enriquecimento usam três
referências diferentes. Revogar desativa a conexão e todas as referências. Rollback cria nova
versão do mapping a partir de uma versão anterior, preservando histórico e
auditoria. Meta só ativa localmente se as três referências resolverem; o estado
continua `ACTIVE_LOCAL` até existir comprovação externa do provider.
