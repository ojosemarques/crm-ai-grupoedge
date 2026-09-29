# Canal de calendário — CRM-47

## Estado e limite da entrega

A CRM-47 implementa somente um sandbox determinístico e local. Nenhum provider,
OAuth, conta, credencial, webhook público, egress, calendário remoto ou banco
remoto foi configurado. O campo `externalEgress` é sempre `false`; o adapter
externo existe apenas como fronteira fail-closed.

`Meeting` e `MeetingHistory` continuam sendo as fontes canônicas de reunião e
histórico. O calendário não altera pipeline, PACTO, oportunidade ou owner por
conta própria. Entradas aceitas passam pelo `MeetingService`, com regras,
concorrência otimista, timeline e auditoria já existentes.

## Fluxos locais

### CRM para calendário

1. Um usuário autorizado escolhe uma reunião persistida do seu escopo.
2. `CalendarService.enqueueMeetingSync` adquire advisory lock por
   workspace/reunião e grava, na mesma transação, link, `IntegrationSyncRun`,
   outbox, evento de calendário, job e auditoria.
3. Repetir a mesma revisão produz o mesmo evento; não cria novo efeito.
4. O worker PostgreSQL consome o job com `FOR UPDATE SKIP LOCKED`, lease,
   tentativas e backoff.
5. `LocalCalendarSandboxAdapter` devolve uma projeção determinística de criação,
   atualização, remarcação ou cancelamento, sempre sem egress.
6. Link, evento, outbox, mapping, run, cursor e tentativa são concluídos juntos.

### Calendário para CRM

1. O endpoint local recebe corpo cru limitado a 64 KiB.
2. A origem precisa ser loopback; timestamp (tolerância de 300 segundos) e HMAC
   são validados antes do parse.
3. `WebhookInbox`, `IntegrationSyncRun`, evento, job e auditoria nascem na mesma
   transação. `providerEventId` e nonce impedem repetição.
4. O worker resolve exclusivamente IDs já conhecidos. Uma criação exige Lead e
   Closer válidos; remarcação, atualização e cancelamento exigem Meeting e link.
5. O efeito comercial usa `MeetingService`. A conclusão atualiza link, mapping,
   run e cursor somente depois de o domínio aceitar a mudança.

Se o processo for interrompido depois do efeito de domínio e antes da
finalização técnica, a retomada reconhece o `eventId` persistido na observação ou
no `MeetingHistory` e finaliza sem repetir a mudança.

## Idempotência, loops e concorrência

- PUSH: `eventKey` contém Meeting, revisão e operação; uniques por workspace
  protegem evento, outbox e job.
- PULL: `providerEventId`, `eventId`, nonce hash, versão externa e link explícito
  protegem reentrega e replay.
- Um callback aplicado não gera automaticamente novo callback. Eventos CRM e
  eventos locais possuem origem e direção próprias, evitando eco.
- Uma versão externa já aplicada vira `DUPLICATE`, sem regressão da projeção.
- Alteração concorrente, identidade desconhecida, transição inválida e conflito
  de horário produzem `CalendarSyncConflict`; nenhum last-write-wins é usado.
- “Manter CRM” cria uma nova projeção PUSH da revisão canônica. “Aplicar externo”
  exige decisão humana e reprocessa o inbox com `forceExternal` controlado.

## Retry, dead-letter e replay

O job permite três tentativas. Falhas transitórias usam backoff calculado e
permanecem retomáveis após reinício. Falha permanente ou esgotamento produz
`FAILED_PERMANENT`/`DEAD_LETTER`, tentativa append-only e erro seguro. Replay é
permitido somente para evento e job terminais, por usuário com
`calendar.replay`.

Os cenários locais são `SUCCESS`, `TRANSIENT_FAILURE`, `PERMANENT_FAILURE` e
`TIMEOUT`. Eles não representam comportamento de um provider real.

## Modelo relacional

- `CalendarConnectionProfile`: modo, janela, timezone e estado operacional;
- `CalendarEventLink`: identidade Meeting/evento e projeção de versões;
- `CalendarSyncEvent`: fato imutável de entrada ou saída;
- `CalendarSyncConflict`: evidência e resolução humana;
- `CalendarBackfillRun` e `CalendarBackfillItem`: migração conservadora;
- `IntegrationSyncRun` e `IntegrationSyncCursor`: execução/cursor commit-safe;
- `WebhookInbox`, `OutboxEvent`, `ExternalObjectMapping`,
  `IntegrationDeliveryAttempt` e `Job`: infraestrutura genérica reutilizada.

FKs compostas preservam workspace. Links, runs e projeções podem evoluir;
identidade/causalidade dos eventos, evidência dos conflitos e itens de backfill
são protegidos por triggers.

## Backfill e reconciliação

O comando padrão é dry-run:

```bash
pnpm db:calendar:backfill -- --run-key=crm47:calendar:dry:manual
```

Aplicação exige `--execute` e uma chave estável:

```bash
pnpm db:calendar:backfill -- --execute --run-key=crm47:calendar:execute:manual
```

O backfill não inventa ID externo. Meeting sem evidência vira
`REVIEW_REQUIRED` com `NOT_LINKED_NO_EXTERNAL_EVIDENCE`. Repetir a mesma chave
retorna a execução existente. Reconciliação compara contagens/IDs de Meeting e
MeetingHistory antes/depois e confirma que todo link aponta para fatos do mesmo
workspace.

## RBAC

- Administrador: todas as capacidades no workspace;
- Gestor: leitura e configuração no workspace; sync por equipe; replay e
  resolução de conflito no workspace;
- SDR e Closer: leitura/sync somente de Meeting próprio;
- Visualizador: leitura e conflitos no workspace, sem mutação;
- worker/callback: ator Sistema persistido, com principal humano autorizado
  apenas para atravessar os serviços canônicos.

Ocultar controles não substitui autorização: página, API e serviços validam o
workspace e o escopo novamente.

## Ativação externa futura

Antes de qualquer provider real ainda são obrigatórios: seleção e homologação
do provider, OAuth com escopos mínimos, armazenamento externo de secrets,
política de calendários/participantes, webhook público assinado, limites e
quotas, reconciliação real, sandbox do fornecedor, revisão de privacidade,
observabilidade e plano de rollback. Nada disso foi executado na CRM-47.
