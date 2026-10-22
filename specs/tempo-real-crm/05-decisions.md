# 05 — Decisões

| Data | Decisão | Alternativas | Evidência/trade-off | Revisar quando |
|---|---|---|---|---|
| 2026-10-22 | `CommercialMetricFact` é a única fonte de atividade | dashboard amplo, logs, snapshots | evita dupla contagem; fatos têm idempotência/correções | registry mudar |
| 2026-10-22 | Hoje civil + semana operacional Mon–Sex | semana calendário inteira | requisito expresso; fim de semana preserva semana até sexta | calendário de feriados existir |
| 2026-10-22 | Polling 15 s | SSE/websocket | cumpre SLA ≤20 s sem nova infraestrutura | p95/carga falhar |
| 2026-10-22 | Capabilities `realtime.*` WORKSPACE | reutilizar `metrics.read` TEAM | “geral” precisa ser workspace e share é mais sensível | produto aprovar escopo de time |
| 2026-10-22 | Meta apenas de `GoalPlan/GoalQuota` publicado | somar `DailyGoalProfile` | não inventa cinco dias nem mistura valor com contagem | meta semanal canônica nova |
| 2026-10-22 | Ranking sem pesos | pesos configuráveis/IA | fórmula simples e auditável | requisito de produto explícito |
| 2026-10-22 | Token no fragmento e header | token em path/query/cookie | reduz vazamento em access log/referrer; refresh depende do fragmento | browser/app mudar |
| 2026-10-22 | SHA-256 de 256-bit token | token claro/criptografado | lookup simples, segredo irrecuperável | múltiplos links forem exigidos |
| 2026-10-22 | Uma linha por workspace | tabela histórica de tokens ativos | rotação simples e atômica; histórico fica em AuditLog | múltiplas TVs com lifecycle próprio |
| 2026-10-22 | Iniciais sem avatar | URL externa | schema não possui avatar; evita fetch/PII | avatar corporativo existir |
| 2026-10-22 | Publicar software sem declarar go-live de dados reais | contornar checklist | docs históricas mantêm NO-GO para operação real | gates humanos fecharem |
