# Plataforma de integrações — CRM-37

## Limite desta entrega

A CRM-37 entrega somente a fundação local e agnóstica de provider. O teto de
capacidade é `VALIDATED_LOCALLY`: não há credencial real, egress, sandbox,
homologação, produção nem endpoint externo configurável. A CRM-38 usa a outbox
apenas para publicar localmente o fato `marketing.conversion.recorded`; não
ativa provider nem altera esse teto.

## Contratos persistidos

- `IntegrationConnection`: projeção atual por workspace, com configuração
  imutável em `IntegrationConnectionConfigVersion`;
- `IntegrationSecretReference`: somente alias, chave de referência, versão e
  presença; o valor existe apenas no resolver server-side;
- `WebhookInbox`: payload minimizado/redigido, hash, tamanho, nonce, assinatura,
  correlação e resultado idempotente;
- `OutboxEvent`: nasce com o fato de domínio por
  `createOutboxEventInTransaction`; o worker usa lease e `SKIP LOCKED`;
- `IntegrationDeliveryAttempt`: evidência append-only de inbox, outbox e sync;
- `IntegrationSyncRun` promove `IntegrationSyncCursor` somente no commit;
- `ExternalObjectMapping` e `ExternalMappingConflict`: identidade externa sem
  match fraco e com precedência humana;
- `IntegrationFieldMappingVersion`: contrato e política `HUMAN_WINS` versionados.

As FKs compostas isolam workspaces. `WebhookEvent` continua sendo o recibo
especializado da entrada de Leads da CRM-07; a inbox genérica não o substitui.
`Job` continua sendo fila interna/automação; a outbox é ledger de entrega, não
um segundo motor genérico de jobs.

## Webhook local assinado

`POST /api/local/integrations/{workspaceSlug}/{connectionKey}/webhook` aceita
somente host local, até 256 KiB, timestamp em `x-politizai-timestamp`,
HMAC-SHA256 em `x-politizai-signature` e nonce único. A assinatura cobre
`timestamp.corpo-bruto` e tolera 300 segundos. Event ID repetido com o mesmo hash
é idempotente; conteúdo divergente, nonce reutilizado e assinatura inválida ou
expirada são rejeitados sem efeito. Não existe URL arbitrária.

A referência `LOCAL_MOCK_WEBHOOK_SECRET` pode ser resolvida por variável local
não versionada. O valor nunca integra DTO, UI, log ou AuditLog.

## Falhas, privacidade e acesso

O adaptador `local-deterministic-v1` simula sucesso, timeout, rate limit, falha
transitória/permanente e quedas antes/depois de commit. Backoff é determinístico,
`Retry-After` é respeitado, lease vencido é retomável e o limite leva a
dead-letter. Queda pós-commit não duplica efeito entregue.

Payload com `leadId` passa pelo `PrivacyDecisionService`; `DENY` e
`REVIEW_REQUIRED` bloqueiam efeito, replay ou sync. Permissões distintas cobrem
leitura, configuração, referência de segredo, execução, runs, replay e
mapeamentos. Administrador possui o catálogo completo; Gestor lê e executa
localmente. SDR, Closer e Visualizador não acessam a central.

## Operação

Após `pnpm db:migrate:deploy` e `pnpm db:seed`, abra `/integracoes`. “Testar
localmente” é obrigatório antes de `ACTIVE_LOCAL`. Ativar provider real,
credencial real, egress ou estados de sandbox/conectado/homologação/produção
pertence a uma task posterior explicitamente autorizada.

## Consumidor local da CRM-38

A criação de uma conversão de aquisição grava o evento na mesma transação do
Lead e marca a entrega `DELIVERED_LOCAL`. O payload contém somente IDs internos,
tipo do fato e `externalEgress=false`. Não existe URL, token, conexão ativa ou
chamada de rede. Reprocessar a mesma submissão usa a mesma chave idempotente e
não duplica a outbox.

## Limite explícito da CRM-39

A importação de performance de mídia é um arquivo CSV local e não uma
integração externa. Ela não usa `IntegrationConnection`, segredo, provider,
webhook público ou egress. Os registros guardam hash, linha, ator e correlação;
uma conexão futura deverá alimentar o mesmo serviço e nunca gravar fatos
diretamente. CRM-39 não autoriza Meta Ads, Google Ads ou qualquer conta real.

## CRM-40 — Meta Ads read-only

A CRM-40 acrescenta o adaptador `meta-ads-read-v1`, isolado da fundação local.
Ele usa somente leitura, host e rotas allowlisted, configuração versionada,
referências server-side de segredo, cursor commit-safe, retry limitado e
mapeamento por ID externo exato. Hierarquia e insights diários alimentam os
mesmos fatos relacionais da CRM-39. Ações desconhecidas permanecem tipadas como
`UNKNOWN`; ausência de métrica não vira zero sem evidência.

Por decisão explícita, a implementação foi concluída e validada localmente com
fixtures, enquanto a validação externa permanece adiada. Não houve egress nem
validação de conta real. Operação, campos, falhas e pendências estão em
[`META_ADS.md`](./META_ADS.md).

## CRM-41 — Google Ads read-only

A CRM-41 acrescenta `google-ads-read-v1` sobre os mesmos contratos de conexão,
configuração, referências de segredo, sync, cursor, tentativas, mappings e fatos
da CRM-37/39. O transporte restringe OAuth e Google Ads a hosts/rotas fixos,
templates GAQL internos e operações de leitura. Hierarquia manager/customer,
campanha, grupo, anúncio e múltiplos ativos usam IDs exatos.

Custo original em micros e métricas de conversão do provider são preservados em
colunas próprias. Eles não viram leads, vendas ou receita CRM automaticamente.
Cursor e revisão são commit-safe; falhas ficam classificadas e não deixam fatos
parciais. A validação local usa fixtures determinísticas e injeção de falhas.
Credencial, egress e conta real foram deliberadamente adiados. Consulte
[`GOOGLE_ADS.md`](./GOOGLE_ADS.md) e
[`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md).

## CRM-45 — e-mail local

O canal de e-mail reutiliza a inbox, outbox, jobs, privacidade e auditoria da
plataforma. `EmailConnectionProfile` não armazena segredo. O transporte
executável é um sink determinístico sem rede; SMTP externo não possui
implementação ativa. Threading usa headers e suppressions são append-only. A
operação e as pendências de provider/DNS estão em
[`EMAIL_CHANNEL.md`](./EMAIL_CHANNEL.md).
