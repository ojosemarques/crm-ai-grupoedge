# 02 — Design técnico

## ADRs resumidas

1. **Agregação sob demanda sobre fatos canônicos.** Rejeitados tabela agregada e Redis: índices atuais cobrem workspace/evento/membro/tempo e o intervalo máximo é uma semana.
2. **Polling 15 s.** Rejeitados websocket/SSE: não há infraestrutura push reutilizável; polling cumpre SLA com menor superfície.
3. **Módulo dedicado com DTO mínimo.** O dashboard existente é amplo, traz drilldowns/IDs e não serve ao público.
4. **Capabilities próprias.** `metrics.read` de gestor é TEAM; o placar “geral” não pode fingir ser workspace. `realtime.read` e `realtime.share.manage` são WORKSPACE para admin/gestor.
5. **Bearer no fragmento.** O fragmento não chega ao servidor/referrer; o browser o envia em `Authorization` para endpoint fixo.
6. **Uma linha por workspace.** Upsert sob advisory lock torna gerar/rotacionar/revogar serializável e imediatamente revogável.

## Componentes

```mermaid
flowchart TB
  AP[Authenticated Page] --> AC[Authenticated Client]
  PP[Public Page] --> PC[Public Client]
  AC --> AA[/api/tempo-real]
  PC --> PA[/api/public/tempo-real]
  AA --> RS[RealtimeDashboardService]
  PA --> TS[Token resolver + rate limit]
  TS --> RS
  RS --> CF[CommercialMetricFact]
  RS --> GP[GoalPlan/GoalQuota]
  RS --> WM[Workspace/Member]
```

## Contrato do snapshot

```ts
type RealtimeSnapshot = {
  workspaceName: string;
  generatedAt: string;
  freshnessAt: string | null;
  timeZone: string;
  quality: { state: "LIVE" | "PARTIAL" | "UNAVAILABLE"; reason: string };
  periods: { today: Period; week: Period & { businessDays: "MONDAY_TO_FRIDAY" } };
  today: Totals;
  week: Totals;
  weeklySalesGoal: { target: string | null; actual: string; unit: "COUNT"; progressPercent: number | null };
  ranking: Array<{ position: number; name: string; initials: string; actions: number; metrics: Totals }>;
  definitions: { contacts: string; calls: string; messages: string; ranking: string };
};
```

Nenhum campo público usa ID interno. O endpoint autenticado acrescenta apenas `sharing` e `permissions`, fora do snapshot público.

## Consistência e concorrência

- `generatedAt` e todas as fronteiras vêm do relógio do servidor.
- Leitura não abre transação longa; pequenas diferenças entre fatos concorrentes são aceitáveis no próximo polling.
- Rotação/revogação usam transação `Serializable` + advisory lock por workspace.
- Hash único impede colisão de token; uma linha única por workspace impede dois links ativos.
- Aplicação antiga ignora tabela nova; aplicação nova só publica depois da migration (expand-contract).

## Performance

- Uma consulta de fatos entre segunda e agora, filtrada por `workspaceId`/`occurredAt`.
- Queries pequenas paralelas para workspace, membros, meta e qualidade.
- Payload contém apenas seis totais por período e ranking; nenhum fato bruto.
- Rate limit público: 120 req/min por hash do token + cliente, suficiente para 15 s e várias abas controladas.

## Falhas

- Banco/timeout: API retorna erro seguro; cliente mantém snapshot e aumenta backoff.
- Revogação durante polling: próxima chamada recebe 404 e remove dados da tela pública.
- Virada de dia/semana: próximo polling recebe períodos recalculados pelo servidor.
- Clock do browser só mede idade desde `generatedAt`; não decide intervalos de negócio.

## Reuso versus novo

- Reuso: `workspace-time`, `summarizeDashboardSellerActivity`, `commercialMetricQuality`, `commercialMemberWhere`, `AuthorizationService`, `RequestRateLimit`, `AuditLog`, security headers e design tokens.
- Novo: `realtime-dashboard` domain/application, tabela do share, duas páginas, duas APIs e UI/CSS específicos.
