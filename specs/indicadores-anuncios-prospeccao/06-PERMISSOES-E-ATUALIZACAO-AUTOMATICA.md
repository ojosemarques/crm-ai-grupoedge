# Permissões e atualização

Reusar authorization-service e `resolveMetricsScope`; contexto autenticado é a autoridade. Filtros só intersectam o conjunto autorizado. WorkspaceId nunca vem da URL. Ranking, metadados, histórico cruzado e cursores obedecem ao mesmo escopo da consulta.

| Perfil | Indicadores | Histórico/identidade | Agendar em Anúncios |
|---|---|---|---|
| administrador | workspace permitido | leads autorizados | exceção administrativa auditada |
| gestor | equipes atuais autorizadas | leads do escopo atual | exceção administrativa já permitida, auditada |
| SDR | contribuição própria autorizada | visibilidade de Lead existente | sim conforme MEETINGS_WRITE |
| vendedor | contribuição própria autorizada | visibilidade de Lead existente | negar; realiza reuniões atribuídas |

Exceção existente de scheduler do workspace (meeting-scheduler-policy.ts) é preservada e auditada. Guardar schedule no servidor após verificar pipeline atual dentro da transação; não restringir prospecção nem sincronização externa autorizada. Atribuição histórica não concede acesso a equipes antigas: usar equipes atuais do solicitante, não memberships do passado. Não ampliar políticas gerais.

Atualização: um componente de rota, 15s com aba visível/online, focus/retomada, useTransition para não sobrepor refresh; limpeza de listeners/timer; path/query nas dependências; Next mantém estado e descarta navegação antiga. Sem polling por cartão e sem cache global de usuário. Última atualização vem de generatedAt. Erro da rota mantém tratamento existente; sem loop de retries de escrita. Meta de convergência = 15s + duração da consulta, medir no E2E local; latência de produção depende de acesso autenticado e será relatada.

Testes negativos: workspace alheio, pessoa/equipe na URL, cursor de outro recorte, histórico restrito, closer agendando em Anúncios. Validar OWN/TEAM/WORKSPACE com serviços e revogação/transferência sem reescrever crédito. Custo de consulta: não carregar todos os IDs no advertising; paginação de logs e índices existentes por workspace/pipeline/occurredAt. Rollback componente/guardas com commit, sem enfraquecer auth.

## Lacuna de papel confirmada

A definição default e a role closer em produção não tinham metrics.read. Acrescentar somente OWN ao default e, no rollout, grant persistido idempotente para a role closer do workspace verificado, com auditoria; não alterar outras permissões. As consultas OWN/TEAM continuam restringidas no servidor. O ensaio de acesso deve provar 5 atribuídas/3 realizadas de Jhon e zero evidências atribuídas a Ede quando consultadas por Jhon.

Guarda compartilhada de agendamento em Anúncios: advertising-scheduling-access.ts, usada pela agenda e por transitionLeadStageInTransaction. Confere ator/membership atuais, função SDR ou exceção nominal/admin já legítima. Serviços autorizados e origem MEETING preservam sincronizações. Agenda audita schedulingPolicy. Backfill exige WORKSPACE_MANAGE com escopo WORKSPACE, não um grant OWN.
