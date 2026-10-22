# 11 — Dados, APIs e atualização

## Schema mínimo

`RealtimeDashboardShare`: `id`, `workspaceId` único, `tokenHash` único `char(64)`, `revision`, created/updated/rotated/revoked timestamps e atores. Sem token claro, expiração ou múltiplos links. Migration aditiva, sem backfill e compatível com app anterior.

Índices existentes usados: `CommercialMetricFact(workspaceId, occurredAt)`, `(workspaceId,eventType,occurredAt)`, `(workspaceId,creditedMemberId,occurredAt)` e índices de metas. Novo lookup usa unique `tokenHash`.

## Operações

| Operação | Auth/scope | Input | Output | Side effect/cache |
|---|---|---|---|---|
| `GET /api/tempo-real` | sessão + `realtime.read` WORKSPACE | nenhum ID de tenant | snapshot + estado share/permissões | none/no-store |
| `POST /api/tempo-real` ROTATE | sessão + same-origin + manage WORKSPACE | action estrita | estado + URL uma vez | upsert serializável + audit |
| `POST /api/tempo-real` REVOKE | idem | action estrita | estado sem token | revoke + audit |
| `GET /api/public/tempo-real` | bearer ativo | Authorization estrito | snapshot público | read/no-store/rate limit |

## Query

1. Resolver workspace e timezone.
2. Calcular hoje e semana operacional no servidor.
3. Ler fatos `[segunda, agora)`; filtrar Hoje e Semana em memória no conjunto já limitado.
4. Resolver vendedores ativos + históricos creditados.
5. Agregar com funções determinísticas.
6. Resolver meta publicada cobrindo a semana.
7. Ler qualidade do último backfill/reconciliation.
8. Mapear DTO sem IDs.

## Polling

- primeira chamada imediata;
- sucesso: próxima em 5 s, consultando novamente os fatos persistidos de todos os usuários/dispositivos;
- retorno à aba, foco da janela e reconexão de rede disparam consulta imediata, sem reload da página;
- falha: 30/60/120 s + jitter até recuperação;
- aba oculta fora de fullscreen: 60 s;
- `AbortController` e flag in-flight impedem overlap;
- snapshot anterior permanece; erro só altera status;
- stale após 45 s sem sucesso;
- unmount aborta request e timeout.

## Idempotência e concorrência

GETs não mutam. REVOKE é idempotente. ROTATE sempre gera novo bearer e invalida o anterior; duas rotações são serializadas, sendo válido apenas o último token retornado pela última transação.

Correções de tarefas concluídas compensam tanto `TASK_COMPLETED` quanto os fatos de ligação/mensagem emitidos pela conclusão anterior. Novas conclusões usam chaves por atividade auditada; a primeira preserva as chaves legadas. Corrigir um resultado preserva o crédito do executor original; o editor permanece na auditoria. O painel lê o saldo líquido, inclusive após corrigir resultado, reabrir e concluir novamente. Movimentações e agendamentos continuam vindo dos produtores canônicos do CRM, sem inventar chamadas ou reuniões a partir de qualquer mudança de card.

## Orçamento

- intervalo máximo lido: segunda até agora (≤7 dias);
- nenhum fato bruto sai do servidor;
- p95 alvo <1 s e payload alvo <64 KiB;
- não introduzir cache compartilhado antes de medir; `no-store` evita vazamento e revogação tardia.
