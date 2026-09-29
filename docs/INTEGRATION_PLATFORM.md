# Plataforma de integrações — arquitetura planejada

## Objetivo e limite

Fornecer uma fronteira comum para Meta Ads, Google Ads, WhatsApp, e-mail,
telefonia, calendário, pagamentos, IA e n8n sem colocar regras comerciais nos
connectors. A CRM-32 não conecta provider nem cria credencial.

## Componentes

```text
Provider → assinatura/autenticação → WebhookInbox ou SyncRun
                                      ↓ validação + mapping
                              adapter normalizado
                                      ↓ comando tipado
                              serviço de domínio
                                      ↓ mesma transação
                         estado oficial + OutboxEvent + AuditLog
                                      ↓ publisher/consumer
                         provider, n8n ou automação interna
```

- `IntegrationConnection`: estado, ambiente, escopos e referência do segredo;
- adapter: tradução isolada do contrato externo;
- `WebhookInbox`: recebimento imutável, deduplicado e reprocessável;
- `SyncRun`/`SyncCursor`: polling incremental e checkpoint;
- `ExternalObjectMapping`: identidade externa ↔ interna;
- `OutboxEvent`/delivery: publicação confiável de eventos internos;
- `Job`: execução persistida, lock, retry e dead-letter;
- painel de observabilidade: conexão, lag, erros, backlog e replay autorizado.

## Contrato de conexão

Estados planejados: `DRAFT`, `PENDING_AUTH`, `CONNECTED`, `DEGRADED`, `REVOKED`
e `DISABLED`. Ambiente é obrigatório: `SANDBOX`, `HOMOLOGATION` ou `PRODUCTION`.
“Conectado” significa handshake e escopos confirmados; não significa sync
completo, homologação ou produção.

Credenciais entram por fluxo server-side, são armazenadas em secret manager
futuro e referenciadas por ID opaco. Token, refresh token, cookie, chave e
payload sensível não aparecem em resposta, log, auditoria ou banco em claro.

## Entrada por webhook

1. limitar tamanho e content type antes de parsear;
2. identificar conexão e versão do endpoint;
3. validar timestamp, nonce e assinatura sobre bytes brutos;
4. persistir inbox com chave idempotente;
5. responder rapidamente e processar por job;
6. validar schema do evento e resolver mapping;
7. chamar serviço de domínio com ator técnico;
8. registrar resultado, erro controlado e auditoria;
9. reter/apagar payload conforme finalidade.

Eventos fora de ordem usam versão/timestamp do provider; cursor não retrocede.
Replay não duplica efeito. Evento inválido não é descartado silenciosamente.

## Sincronização incremental

- cursor por conexão, stream e versão;
- janela com overlap controlado para eventos atrasados;
- paginação e rate limit do provider;
- chave de fato independente da página;
- cursor avança somente após commit;
- retry com jitter/backoff e limite;
- reconciliação periódica por amostra/contagem;
- full sync apenas com autorização e impacto calculado.

## Saída para providers

Comandos são tipados e idempotentes (`send_message`, `create_calendar_event`,
`create_charge`). Um `OutboxEvent` não contém segredo nem dado desnecessário. O
adapter registra external ID e callbacks; entrega confirmada não é inferida por
HTTP 202.

Opt-out, finalidade, template, horário e permissão são verificados antes de
enfileirar e novamente antes de enviar. Cancelamento válido impede retry futuro.

## Resolução de conflitos

Cada campo sincronizável tem política versionada:

- `CRM_AUTHORITATIVE`: externo não sobrescreve;
- `PROVIDER_AUTHORITATIVE`: fato externo versionado prevalece;
- `LATEST_VERIFIED`: somente valor verificado e com versão maior;
- `MANUAL_REVIEW`: divergência abre issue.

Dados humanos confiáveis e opt-out nunca são substituídos por payload novo sem
regra explícita. Exclusão externa não apaga histórico interno; marca mapping e
aciona política de retenção.

## n8n

n8n é um consumidor/produtor governado:

- recebe eventos permitidos por webhook/outbox;
- chama APIs versionadas com credencial própria e escopo mínimo;
- envia idempotency key, correlation ID e versão do contrato;
- consulta status do comando;
- respeita rate limit e replay.

É proibido:

- DATABASE_URL ou acesso direto a tabelas;
- uso de credencial humana;
- transição de pipeline fora do serviço;
- leitura ampla para montar métricas;
- envio sem consentimento;
- armazenar segredo do Revenue OS no workflow em texto aberto.

Workflows terão registro, owner, propósito, versão, eventos permitidos e estado.
Desativar a conexão invalida novas chamadas sem apagar auditoria.

## Contratos por provider planejado

| Provider | Entrada | Saída | Fonte oficial resultante | Dependência externa |
|---|---|---|---|---|
| Meta Ads | campanhas, anúncios, insights, leads | opcionalmente nenhuma no MVP | fatos de mídia normalizados | app/conta sandbox e revisão Meta |
| Google Ads | campanhas, grupos, anúncios, custo | nenhuma inicialmente | fatos de mídia normalizados | developer token/conta teste |
| WhatsApp | mensagens/status | templates/mensagens aprovadas | Message + delivery | WABA sandbox, templates e consentimento |
| E-mail | inbound/status | envio aprovado | Message + delivery | domínio sandbox e provider |
| Telefonia | eventos locais assinados; provider futuro | chamada simulada local | PhoneCall + Conversation/Message + Activity | provider/PSTN e política de gravação adiados; ver `TELEPHONY_CHANNEL.md` |
| Calendário | eventos/cancelamentos | criar/atualizar evento | Meeting continua oficial | OAuth sandbox |
| Pagamentos | cobrança/pagamento/estorno | criar cobrança quando autorizado | Payment reconciliado | conta sandbox/webhook |
| LLM | resposta estruturada | prompt mínimo | AIInsight, nunca domínio direto | contrato, DPA, chave e eval |

## Observabilidade e suporte

Por conexão: health, último sucesso, último erro, lag, cursor, rate-limit,
backlog, dead-letter e versão do adapter. Logs usam IDs e códigos, não payload.
Replay exige permissão, preview e auditoria. Alertas distinguem indisponibilidade
do provider, erro de contrato, credencial revogada, limite e erro interno.

## Evolução de status

1. `IMPLEMENTADO`: adapter e contratos existem;
2. `VALIDADO_LOCALMENTE`: mocks/fixtures e falhas testados;
3. `VALIDADO_EM_SANDBOX`: provider real de teste comprovado;
4. `CONECTADO`: handshake e escopos ativos;
5. `ATIVO_EM_HOMOLOGACAO`: dados/processo piloto reconciliados;
6. `ATIVO_EM_PRODUCAO`: ativação explícita, monitorada e reversível.

Meta, Google, WhatsApp e e-mail possuem fundações locais documentadas. Telefonia
está `VALIDADO_LOCALMENTE` na CRM-46 com simulador determinístico; nenhum desses
estados comprova provider externo, credencial, egress ou produção.

## Implementação local da CRM-60

O planejamento de n8n foi materializado em `/integracoes/n8n` e em três
endpoints locais v1. Identidade, escopos, receitas, recibos e propostas são
persistidos; eventos vêm exclusivamente do `OutboxEvent`; comandos usam HMAC,
timestamp, nonce, idempotência e correlação. Ações consequenciais param em
confirmação humana e não contornam serviços de domínio.

O status é `VALIDADO_LOCALMENTE`, sob o rótulo obrigatório “Sandbox local — n8n
não conectado”. Contrato, exemplos, allowlists e limites estão em
[`N8N_SANDBOX.md`](./N8N_SANDBOX.md). Não há n8n/provider, credencial externa,
egress, webhook público, banco remoto ou deploy.
