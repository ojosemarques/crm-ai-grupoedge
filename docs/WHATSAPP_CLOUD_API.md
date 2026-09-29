# WhatsApp Cloud API — fundação local e fronteira de homologação

## Estado da CRM-44

A CRM-44 implementa e valida localmente o contrato do canal WhatsApp sobre a
fonte canônica da CRM-43. O modo executável padrão é `LOCAL_SIMULATOR`, sem
credencial e sem tráfego para a Meta. A fronteira HTTP oficial, o transporte,
os contratos, o worker e os estados de operação existem, mas a ativação externa
permanece bloqueada por duas dependências não satisfeitas:

1. revisão formal de elegibilidade conforme a Política de Mensagens do WhatsApp;
2. conta WABA/número de teste, templates aprovados e segredos de menor privilégio
   fornecidos em uma homologação futura explicitamente autorizada.

Em 12 de setembro de 2026, a leitura da
[documentação oficial da Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
e da [Política de Mensagens do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR)
confirmou a janela de atendimento, o uso de templates aprovados fora dela, a
necessidade de opt-in e o dever de respeitar opt-out. A mesma política restringe
partidos, políticos, candidatos, campanhas e entidades que oferecem serviços
relacionados a política. Como o enquadramento da Politizai não foi validado pelo
jurídico nem pelo provedor, `policyEligibility` permanece
`PENDING_POLICY_REVIEW`; não é permitido transformar essa pendência em
`ELIGIBLE` por conveniência técnica.

## Arquitetura

```text
Meta/fixture assinado
  -> GET challenge ou POST raw body
  -> limite e rate limit local
  -> X-Hub-Signature-256 antes do JSON
  -> tenant por webhookKey + phoneNumberId + businessAccountId
  -> WebhookInbox VERIFIED + Job PENDING (transação única)
  -> worker PostgreSQL com SKIP LOCKED
  -> normalização do evento
  -> Conversation/Message/MessageStatusEvent canônicos
  -> Activity, opt-out, revisão, auditoria
  -> PROCESSED | RETRY_PENDING | DEAD_LETTER
```

O recebimento não executa regra comercial inline. O receipt e o job são
atômicos e idempotentes por workspace, conexão e ID do evento. O worker usa
lock com expiração, retry limitado, backoff determinístico e dead-letter. Uma
reexecução manual exige `integrations.replay`, motivo e auditoria. O worker
local compartilhado processa primeiro os receipts WhatsApp e depois as
automações, sem Redis e sem chamadas externas.

## Modelo e estados

- `WhatsAppConnectionProfile`: tenant, versão allowlisted, modo, elegibilidade,
  locale/timezone e referências de conta; nunca contém segredo;
- `WebhookInbox` e `Job`: receipt assinado, processamento assíncrono, tentativa,
  lock, retry e falha terminal;
- `Conversation`: `lastCustomerInboundAt` e `serviceWindowExpiresAt` representam
  a janela de atendimento com timestamps `timestamptz`;
- `Message`: ID externo por provider e timestamps aceito/enviado/entregue/lido;
- `MessageStatusEvent`: fato append-only do status informado pelo provider;
- `WhatsAppEventReview`: evento desconhecido, status regressivo ou payload que
  exige revisão, sempre isolado por workspace;
- `AttachmentReference`: somente referência opaca e metadados de mídia. A
  CRM-44 não baixa nem armazena binários;
- `MessageTemplate`: estado local e estado do provider são diferentes. Um
  template `LOCAL_ONLY` nunca é promovido a `APPROVED` implicitamente.

Modos possíveis:

| Modo | Entrada | Saída | Egress | Uso atual |
|---|---|---|---|---|
| `LOCAL_SIMULATOR` | fixture local | fila local simulada | não | padrão validado |
| `EXTERNAL_DISABLED` | endpoint preparado | transporte bloqueado | não | somente fronteira de homologação |
| `PAUSED` | bloqueada | bloqueada | não | desligamento operacional |

O nível de capacidade permanece `VALIDATED_LOCALLY`. `CONNECTED`, `SANDBOX`,
`HOMOLOGATION` e `PRODUCTION` exigem evidência externa e não foram usados.

## Identidade, responsabilidade e privacidade

O endereço é normalizado como telefone. Uma correspondência exata de
`ContactPoint` reutiliza Contact/Lead e preserva owner ou fila do Lead. Ausência,
ambiguidade ou Contact sem Lead cria revisão e encaminha a conversa para a Fila
Geral; não cria Lead silenciosamente. Toda conversa acionável mantém owner ou
fila explícita.

Opt-out recebido é fato: marca o ponto como `doNotContact`, projeta
`DO_NOT_CONTACT` nos Leads relacionados e cancela saídas pendentes compatíveis
pelo serviço central de privacidade. Mensagens livres só são elegíveis até 24
horas após o último inbound do cliente. Fora da janela, somente template com
estado provider `APPROVED` é elegível. Mesmo dentro da janela, opt-out ou decisão
de privacidade bloqueia a saída.

## Segurança da fronteira

- rota opaca `/api/webhooks/whatsapp/[webhookKey]`;
- challenge compara verify token em tempo constante;
- POST lê bytes crus com limite de 256 KiB;
- assinatura HMAC SHA-256 é validada antes do parse;
- `phoneNumberId` e `businessAccountId` precisam pertencer ao profile resolvido;
- versão Graph API restrita à allowlist versionada;
- payload bruto não é escrito em log; o receipt persiste somente evento
  normalizado, hash, tamanho e classificação;
- segredos são referências server-side (`WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) e não aparecem na UI;
- transporte real exige opt-in construtivo `externalEgressEnabled`, URL fixa
  `graph.facebook.com`, IDs numéricos, timeout e redirect bloqueado. Nenhuma
  instância real é habilitada pelo runtime atual.

## Operação local

Depois do seed, `/integracoes/whatsapp` mostra o bloqueio externo, readiness,
referências de segredo, contagens persistidas, templates, falhas e simulador.
`/inbox?channels=WHATSAPP` abre as conversas do canal e mostra a janela de 24
horas. Falhas em retry/dead-letter podem ser inspecionadas; replay requer
confirmação, permissão e gera audit log.

O backfill é conservador: usa somente o último `Message.direction=INBOUND`
persistido para preencher uma janela ausente. Não inventa mensagem, contato,
owner, consentimento ou template. Comece pelo dry-run:

```bash
pnpm db:whatsapp:backfill -- --run-key=crm44:dry:v1
pnpm db:whatsapp:backfill -- --execute --run-key=crm44:execute:v1
```

A CLI recusa `NODE_ENV=production`, host remoto, banco diferente de
`politizai_crm` e schema diferente de `public`. A `runKey` torna o replay
idempotente.

## Validação externa pendente

Uma task futura separada só poderá alterar o estado após registrar:

- parecer de elegibilidade para o produto e casos de uso da Politizai;
- WABA e número exclusivamente de teste;
- app, system user, permissões e token de menor privilégio;
- webhook HTTPS sandbox, challenge e assinatura reais;
- templates aprovados, idioma/categoria e status reconciliados;
- opt-in rastreável e fluxo de opt-out/revogação;
- inbound, outbound, reply, delivery/read/failure e eventos fora de ordem;
- limites, retry-after, observabilidade, rotação e revogação de segredo;
- minimização/retenção de conteúdo e referência de mídia;
- reconciliação com o Inbox, sem duplicidade e sem violação de workspace.

Até lá, nenhum resultado local deve ser descrito como mensagem entregue pela
Meta, sandbox validado ou canal apto para uso real.
