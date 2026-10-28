# Plano e matriz de rastreabilidade

Antes de cada marco, reler spec/dependências; após, atualizar 11 com comandos/resultados reais.

| Marco | Requisito → Spec | Alterações ordenadas | Teste → evidência exigida |
|---|---|---|---|
| M0 | auditoria/specs → 00–10 | baseline e revisão cruzada | docs/estado e SHA conferidos |
| M1 | três visões/filtros → 01/04/05 | mode, seleção servidor, filtros em metrics-service/dashboard, links/rotas/menu; períodos 7/30 | unidade + integração isolando pipeline, E2E das rotas |
| M2 | identidade/origem → 02/07 | intake por destino, vínculo Contact confirmado, histórico relacionado autorizado | mesma pessoa duas frentes, replay, ambiguidade, tenant/owner restrito |
| M3 | logs/tarefas → 03/05 | consulta cronológica comum, Anúncios/Prospecção, bulk Activity na transação | tarefa manual/conclusão/correção e bulk sem duplicar |
| M4 | crédito/consolidado → 04/06 | entradas/pessoas/contribuição, bookedBy/owner, guarda SDR; coortes e cobertura | Carlos/Jhon/Ede 30/10/5/5/3/4, datas cruzadas e transferência |
| M5 | atualização/dados → 06/08 | refresh 15s com retomada, backfill/reconciliação isolados | E2E entre sessões e consultas/saldos repetidos |
| M6 | validação/publicação → 09 | checks completos, diff, commit/main, deploy, smoke | saída real, SHA/READY/domínio, limitações autenticadas |

Cobertura transversal: canais/propostas/vendas/financeiro reutilizam registry/produtores e testes existentes (03/04/07); histórico autor/equipe/pipeline segue snapshots e correções (01/03/08); custo não configurado (07/M4); filtros de origem/campanha/formulário disponíveis preservados (05/M1), ausência de dimensão documentada; segurança e atualização em todos os marcos. Nenhum requisito depende de Meta Ads futuro ou de tarefas padrão.

Fora do escopo: campanhas, novos provedores, migração destrutiva, automação de contato, billing, refatoração geral, merge de identidades incertas. Dependência material não resolvida bloqueia apenas ação correspondente, não testes locais. Todos os gates são binários; teste não executado não equivale a aprovado.
