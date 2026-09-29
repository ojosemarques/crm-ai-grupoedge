# Sandbox governado do n8n — CRM-60

## Estado e fronteira

O recurso é identificado na interface como **“Sandbox local — n8n não conectado”**.
Não há n8n instalado ou conectado, URL pública, credencial externa, egress,
webhook público nem acesso direto ao PostgreSQL. A CRM-60 entrega uma fronteira
local para testar contratos, autoria técnica, idempotência e confirmação humana.

```text
OutboxEvent allowlisted ──GET──> API local v1 ──> simulador n8n
                                                   │
                 AuditLog <── recibo/proposta <──POST assinado
                                  │
                         decisão humana no CRM
                                  │
                    serviço de domínio normal (futuro)
```

O banco continua sendo fonte única. O cliente de máquina não recebe
`DATABASE_URL`, cookie humano, papel humano ou leitura SQL. Consultas de registro
retornam DTOs mínimos e sempre usam o `workspaceId` da identidade autenticada.

## Identidade de máquina e RBAC

Cada identidade possui um ator `AUTOMATION`, chave estável, responsável humano
ativo, propósito, expiração máxima de 90 dias, escopos explícitos, revisão
otimista, fingerprint e kill switch (`PAUSED`/`REVOKED`). O token completo é
exibido somente na criação ou rotação; persiste apenas SHA-256. Suspender o
workspace também bloqueia todas as identidades daquele workspace.

Escopos disponíveis:

- `EVENTS_READ`: consumir eventos allowlisted;
- `RECORDS_READ`: consultar DTO mínimo de lead, reunião, oportunidade ou conta;
- `ACTIVITY_DRAFT_CREATE`: propor rascunho de atividade;
- `NEXT_ACTION_DRAFT_CREATE`: propor rascunho de próxima ação;
- `AUTOMATION_RESULT_WRITE`: registrar resultado técnico sem mutação comercial;
- `ACTION_PROPOSAL_CREATE`: propor ação consequencial para revisão humana.

No acesso humano, `integrations.n8n.read`, `integrations.n8n.manage` e
`integrations.n8n.review` são verificadas no servidor. Administrador gerencia;
gestor lê e decide propostas; demais papéis são negados por padrão.

## Contrato local v1

O contrato OpenAPI versionado está em
[`contracts/n8n-local-v1.openapi.yaml`](./contracts/n8n-local-v1.openapi.yaml).

Endpoints, todos locais e sem cache:

- `GET /api/local/n8n/v1/events`: feed ordenado do outbox;
- `GET /api/local/n8n/v1/records/{type}/{id}`: DTO mínimo no workspace da máquina;
- `POST /api/local/n8n/v1/commands`: resultado técnico ou proposta governada;
- `GET|POST /api/integrations/n8n`: painel humano autenticado e same-origin.

Headers obrigatórios na escrita de máquina:

```text
Authorization: Bearer n8n_local_<token>
Idempotency-Key: crm60.command.001
X-Correlation-Id: crm60.command.001
X-Politizai-Timestamp: 2055-09-13T12:00:00.000Z
X-Politizai-Nonce: nonce_fixture_1234
X-Politizai-Signature: HMAC-SHA256(token, timestamp.nonce.idempotencyKey.rawBody)
X-Causation-Depth: 0
```

Exemplo sanitizado de evento:

```json
{
  "contractVersion": "1.0",
  "items": [{
    "eventId": "00000000-0000-4000-8000-000000000010",
    "type": "lead.assigned",
    "schemaVersion": "1.0",
    "workspace": { "id": "00000000-0000-4000-8000-000000000001" },
    "occurredAt": "2055-09-13T12:00:00.000Z",
    "timezone": "America/Sao_Paulo",
    "aggregateType": "Lead",
    "aggregateId": "00000000-0000-4000-8000-000000000020",
    "correlationId": "lead.assignment.001",
    "payload": { "priority": "P1" },
    "redaction": "MINIMIZED"
  }]
}
```

Dados com chaves como token, segredo, senha, cookie, telefone, e-mail ou
documento são removidos do envelope. Versões desconhecidas e tipos fora da
allowlist não são publicados ao cliente da CRM-60.

## Escrita, idempotência e loops

O corpo é validado por uma união discriminada estrita. SQL e comandos livres
são rejeitados. O endpoint limita o corpo a 64 KiB, aplica rate limit local,
janela de assinatura de cinco minutos e nonce único por identidade.

A chave idempotente é única por workspace e identidade. Repetição com o mesmo
corpo devolve o recibo original; a mesma chave com corpo diferente é conflito.
A cadeia carrega `correlationId`, `causationId` e profundidade máxima 4 para
impedir loops sem limite. Recibos e versões de receita são append-only no banco.

Rascunhos e ações consequenciais criam `N8nActionProposal` pendente. Aprovar ou
rejeitar registra ator, motivo e horário, mas **não executa a mutação**. A ação
aprovada deve seguir posteriormente o serviço normal do CRM, com autorização,
versão otimista, privacidade, eventos e auditoria próprios.

## Catálogo allowlisted

O painel expõe nove receitas versionadas cobrindo: lead atribuído; SLA/retorno
vencido; mudança de etapa; reunião agendada/cancelada; oportunidade ganha/perdida;
onboarding bloqueado; risco de renovação/churn; solicitação crítica de CS; e
decisão de sugestão de IA. Cada modelo declara gatilho, ação, confirmação,
limites, fallback e dados proibidos. Não existe editor visual livre.

## Observabilidade, retry e recuperação

O painel deriva do PostgreSQL: estado do outbox, último sucesso/falha, recibos,
correlation IDs e propostas pendentes. O outbox existente mantém lock, retry,
backoff, dead-letter e replay autorizado. O feed local é pull-based; o consumidor
deve manter checkpoint e repetir com a mesma chave. Falhas de validação retornam
erro canônico e não alteram o domínio.

## Limites e ativação futura

Para conectar n8n real ainda são obrigatórios: decisão de hospedagem, TLS/DNS,
secret manager, rotação operacional, IP/rate limits distribuídos, homologação de
workflows, DPA/LGPD, monitoramento, reconciliação, carga e runbook de incidente.
Nenhum desses itens foi inferido como concluído pela simulação local.
