# Indicadores de Anúncios, Prospecção Ativa e consolidação

Objetivo: três visões auditáveis sobre os serviços existentes, preservando identidade, crédito histórico e autorização. Pedido de 28/10/2026: executar as specs na main e publicar após os gates. Não criar cadências, campanhas ou comunicação de teste.

## Índice e sequência

1. [Auditoria](00-AUDITORIA-ESTADO-ATUAL.md)
2. [Arquitetura e contratos](01-ARQUITETURA-E-CONTRATOS.md)
3. [Identidade](02-IDENTIDADE-ORIGEM-E-DOIS-PIPELINES.md)
4. [Eventos e logs](03-EVENTOS-ATIVIDADES-LOGS-E-TAREFAS.md)
5. [Métricas](04-METRICAS-FUNIS-E-CONSOLIDACAO.md)
6. [Telas](05-TELAS-NAVEGACAO-FILTROS-E-DRILLDOWNS.md)
7. [Permissões e atualização](06-PERMISSOES-E-ATUALIZACAO-AUTOMATICA.md)
8. [Marketing e custos](07-MARKETING-CUSTOS-E-INTEGRACOES.md)
9. [Dados e reconciliação](08-DADOS-MIGRATIONS-BACKFILL-E-RECONCILIACAO.md)
10. [Testes e produção](09-TESTES-ROLLOUT-E-OPERACAO.md)
11. [Plano e rastreabilidade](10-PLANO-EXECUTAVEL.md)
12. [Estado verificável](11-ESTADO-DA-EXECUCAO.md)

Decisões: `/dashboard` consolidado; rotas filhas fixam a frente no servidor; fatos classificam pelo pipeline histórico; estoque pelo atual. Pessoas confirmadas usam `contactId`; coincidências não confirmadas não são fundidas. Agendamento credita agendador e realização credita responsável no evento. Custo ausente é indisponível, nunca zero. Dependências: PostgreSQL local, cliente Prisma e autenticação existentes. Schema atual suficiente; qualquer descoberta que exija migration deve revisar a spec antes da execução.

Revisão do conjunto: períodos semiabertos; filtros apenas restringem; números históricos não usam owner atual; logs não são tarefas; crédito não cria outra reunião; nenhuma dependência de Meta Ads ou de tarefas futuras. Estado e limitações reais estão no documento 11.
