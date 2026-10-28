# Auditoria e baseline

Baseline: `/Users/uscloser/Documents/ChatGPT/CRM`, `main`, `536c860dd21b81354692a544fa219ac8c14f594b`; origin `ojosemarques/crm-ai-grupoedge`. GitHub confirmou mesmo SHA, `protected=false`, regras vazias. Sete prompts não rastreados em docs são preexistentes e ficam fora dos commits. Node 22.23.1, pnpm 11.14.0, Next 16.3.8, React 19.3.0, Prisma 7.10.0. CI executa lint, typecheck, testes, integração, E2E e build. Cadeia canônica: `prisma/migrations`, conforme scripts oficiais. Banco local em localhost/politizai_crm; testes criam schemas efêmeros com guarda de host.

| Capacidade | Estado observado | Evidência | Reuso | Lacuna/risco | Spec |
|---|---|---|---|---|---|
| Navegação | PARCIAL | app-shell.tsx/navigationGroups | grupos e IntentLink | uma visão apenas | 05 |
| Dashboard | PARCIAL | dashboard-metrics-service.ts/getScreen | gráficos, séries, comparação, drilldowns | filtros de pipeline não propagados | 04/05 |
| Fatos | PRESENTE | CommercialMetricFact; fact-writer.ts | chave workspace/eventKey, fingerprint e correções | metadados históricos podem faltar | 03/08 |
| Autorização | PRESENTE | metrics-service.ts/resolveMetricsScope, integratedFactWhere | OWN/TEAM/WORKSPACE | não confundir crédito com acesso | 06 |
| Anúncios | PARCIAL | advertising-workspace-service.ts/getScreen | estoque e tarefas | log cronológico ausente na tela; lista ilimitada de IDs | 03/05 |
| Identidade | PARCIAL | lead-intake-service.ts/intake; contact-identity-service.ts | contato, pontos e reviews | dedup atual atravessa pipelines | 02 |
| Reuniões | PARCIAL | meeting-service.ts/schedule, act | bookedBy e owner nos fatos | regra SDR em Anúncios precisa guarda | 04/06 |
| Tarefas | PARCIAL | operational-history-service.ts; unified-activity-service.ts | activity/audit/fatos transacionais | bulk reassign/postpone só em auditoria | 03 |
| Custos | PARCIAL | módulos marketing e registry | contratos existentes | não presumir gastos disponíveis | 07 |
| Produção | NÃO CONFIRMADO | .vercel/project.json; status GitHub/Vercel no SHA | Git integration existente | MCP retorna 404 para projeto; outra listagem só mostra hub | 09 |

Fluxos observados: formulário → receipt idempotente → submission-service → intake → Lead/Contact + Activity + CommercialMetricFact → metrics-service → dashboard. Prospecção → operational-history → task-completion facts → ledger. Agenda → MeetingHistory → fato agendado com bookedBy → act → fato realizado com owner. StageHistory e atribuições preservam eventos; consultas devem separar snapshots de estoque. A mesma pessoa hoje pode ser anexada ao registro antigo por telefone+email: corrigir seleção pelo destino. Ações usam revalidatePath em suas fronteiras; não foi encontrado refresh periódico do dashboard. Adicionar um único refresh de rota, limitado e suspenso quando invisível/offline.

Baseline unitário dirigido: 19 arquivos, 71 testes passaram. Primeira integração bloqueada pelo socket tsx no sandbox; nova execução com permissão solicitada. Não considerar isso falha da aplicação nem integração aprovada.
