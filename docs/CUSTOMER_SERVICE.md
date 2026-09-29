# Solicitações do cliente, SLA e satisfação — CRM-53

## Limite do módulo

O módulo `customer-service` registra solicitações ligadas a uma `Account` já
existente e ao ciclo de receita. Ele não é um help desk/ITSM genérico, não cria
catálogo técnico, não chama canais externos e não substitui Inbox, Customer
Success, onboarding ou oportunidade comercial. Convites de pesquisa são sempre
locais e persistem `simulated=true`.

## Fonte única da verdade

- `CustomerRequest` guarda estado corrente, responsável ou fila explícita,
  próxima ação, versão congelada do SLA e fatos calculados de resposta/resolução;
- `CustomerRequestEvent` é a timeline append-only. Correções e reaberturas
  acrescentam fatos, nunca removem história;
- `CustomerServiceSlaPolicy` e suas versões separam configuração corrente do SLA
  usado historicamente. Alterar a política não recalcula solicitações anteriores;
- definições e versões de pesquisa preservam pergunta, escala e vigência;
- convite e resposta são fatos distintos. Uma correção de resposta referencia a
  anterior por `supersedesId` e permanece append-only;
- runs e itens de backfill registram apenas candidatos ambíguos para revisão.

Timestamps são `timestamptz`; a interface exibe `America/Sao_Paulo`. Tempos são
persistidos em segundos inteiros desde `createdAt`. Dinheiro não faz parte deste
módulo.

## Estados e transições

```text
OPEN -> IN_PROGRESS -> WAITING_CUSTOMER -> IN_PROGRESS
  |          |                |
  +----------+----------------+-> RESOLVED -> CLOSED
                                  |             |
                                  +-- REOPEN ---+
```

`FIRST_RESPONSE` e `UPDATE_NEXT_ACTION` preservam o estado. Resolver exige nota;
aguardar cliente ou reabrir exige próxima ação e prazo. Toda mutação usa revisão
otimista, chave idempotente, lock transacional, evento e `AuditLog`.

## Responsabilidade e RBAC

Toda solicitação tem exatamente um `ownerMemberId` ativo ou `queueId` válido.
Equipe, owner e fila são confirmados no mesmo workspace e a atribuição de destino
também passa pela policy server-side. O escopo efetivo é `OWN`, `TEAM` ou
`WORKSPACE`; mudar URL/payload não amplia acesso. Métricas e convites de
satisfação usam apenas contas visíveis e ficam mascarados sem a permissão
específica.

Permissões:

- `customer_service.read`;
- `customer_service.create`;
- `customer_service.respond`;
- `customer_service.assign`;
- `customer_service.resolve`;
- `customer_service.reopen`;
- `customer_service.config.manage`;
- `customer_service.satisfaction.read`.

## SLA

A versão publicada vigente é escolhida no instante da criação. A solicitação
grava `firstResponseDueAt` e `resolutionDueAt`; por isso a troca posterior da
configuração não altera o passado. A primeira resposta só pode ser registrada
uma vez. Resolução grava duração, violação e nota explícita. Ausência de fato
permanece `null`, não vira zero.

## CSAT e NPS

CSAT usa a média aritmética das respostas válidas na escala versionada. NPS usa
`% promotores - % detratores`, com detratores 0–6, neutros 7–8 e promotores 9–10.
Taxa de resposta é respostas válidas divididas pelos convites elegíveis. Sem
convites a taxa é `null`; com convites e nenhuma resposta é zero. NPS baixo é um
sinal para ação humana, não prova churn ou causa.

## Backfill conservador

O comando aceita somente `politizai_crm/public` em PostgreSQL local:

```bash
pnpm db:customer-service:backfill -- --run-key=crm53:dry-run:manual
pnpm db:customer-service:backfill -- --execute --run-key=crm53:execute:manual
```

O padrão é `DRY_RUN`. Conversa ligada à conta não é prova suficiente de uma
solicitação: tanto dry-run quanto execute registram `REVIEW_REQUIRED` e criam
zero solicitações. Repetir a mesma `runKey` devolve replay sem duplicar efeitos.

## Superfície local

`/customer-service` é um Server Component que carrega somente dados autorizados;
o componente cliente chama APIs autenticadas e same-origin. A página oferece
fila priorizada, filtros, detalhe/timeline, abertura, resposta, resolução,
reabertura, convites simulados e indicadores reconciliáveis. Loading, vazio,
erro e acesso negado reutilizam os padrões globais.

## Limitações deliberadas

- não há e-mail, WhatsApp, telefonia ou provider de pesquisa real;
- não há portal externo nem autenticação de respondente;
- não há roteamento omnichannel automático nem catálogo de suporte;
- satisfação não aciona churn, renovação ou expansão;
- operação com dados reais depende dos gates futuros de segurança, privacidade,
  homologação e deploy.
