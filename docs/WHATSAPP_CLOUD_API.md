# WhatsApp Cloud API — fundação local e fronteira de homologação

## Decisão da Etapa 08 — 30 de setembro de 2026

**Decisão formal: `INELIGIBLE`.** A fonte oficial vigente da Meta proíbe o uso
da Plataforma do WhatsApp Business por entidades não governamentais que
prestam serviços relacionados a política, candidatos políticos, estratégia ou
serviços de campanha e soluções eleitorais. O escopo comercial documentado da
Politizai inclui gabinetes, mandatos, campanhas e serviços para o ecossistema
político, portanto está dentro dessa fronteira.

- **Fonte observada:** [Política de Mensagens do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR), seção “Política sobre Uso Governamental e Político”, observada em 30/09/2026.
- **Escopo:** CRM comercial e serviços da Politizai para gabinetes, mandatos,
  campanhas e demais participantes do ecossistema político.
- **Canal alternativo autorizado:** contato humano manual por telefone,
  registrado como atividade no CRM, sem automação ou provider externo
  implícito. Integração de telefonia continua sujeita à homologação própria.
- **Gatilho de revisão:** mudança publicada da política ou confirmação escrita
  da Meta/provedor que autorize explicitamente o escopo da Politizai.
- **Selo de paridade WhatsApp:** ausente. Não há WABA/número de teste,
  templates aprovados, rate limit, custo, coexistência ou evidência externa de
  ponta a ponta porque o gate de elegibilidade foi reprovado.

A decisão, fonte, data, ator, alternativa e gatilho ficam persistidos na
projeção `WhatsAppConnectionProfile`, no histórico append-only
`WhatsAppPolicyDecision` e no `AuditLog`. O serviço não oferece comando que
promova o profile para `ELIGIBLE` nem que rebaixe uma inelegibilidade formal
para revisão pendente; uma eventual revisão exige outro fluxo de homologação
com evidência externa. O simulador local pode continuar sendo usado para testar
inbox, janela, opt-out, falha, cancelamento e handoff, sempre com
`externalEgress=false`.

## Estado da CRM-44

A CRM-44 implementa e valida localmente o contrato do canal WhatsApp sobre a
fonte canônica da CRM-43. O modo executável padrão é `LOCAL_SIMULATOR`, sem
credencial e sem tráfego para a Meta. A fronteira HTTP oficial, o transporte,
os contratos, o worker e os estados de operação existem. A ativação externa
permanece bloqueada pela decisão formal de inelegibilidade. Por consequência,
WABA/número de teste, templates aprovados, segredos, rate limit, custo e
coexistência não foram contratados nem homologados.

Em 30 de setembro de 2026, a leitura da
[documentação oficial da Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
e da [Política de Mensagens do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR)
confirmou a janela de atendimento, o uso de templates aprovados fora dela, a
necessidade de opt-in e o dever de respeitar opt-out. A decisão formal acima
projeta `policyEligibility=INELIGIBLE`; não é permitido transformar esse estado
em `ELIGIBLE` por conveniência técnica.

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
- `WhatsAppPolicyDecision`: fato append-only com fonte, data observada, escopo,
  justificativa, ator, alternativa autorizada e gatilho de revisão;
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

## Validação externa bloqueada

Uma revisão futura separada só poderá alterar o estado após registrar:

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
