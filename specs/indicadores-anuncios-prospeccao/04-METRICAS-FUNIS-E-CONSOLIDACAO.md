# Catálogo, funis e consolidação

Fonte autoritativa de eventos: integrated-metric-registry.ts (catálogo completo de IDs, fontes, fórmulas, agregação, canais e limitações). Fontes de estoque/coortes/duração: MetricsOverview e evidence; DashboardDrilldown identifica registros. Estender o catálogo existente para entradas/reentradas/pessoas/reuniões atribuídas quando necessário. Nenhum cálculo autoritativo por IA.

| Família/ID | Unidade/fonte/data | Fórmula/dedup/crédito | Drilldown e cobertura |
|---|---|---|---|
| entradas | quantidade; LEAD_CREATED + submission legítima; occurredAt | cada entrada comercial, chave técnica única | fatos e submission; separar nova participação/reentrada |
| pessoas únicas | Contact/Lead nas entradas | união de contactId confirmado; leadId como identidade não resolvida | evidências; não somar as parcelas com sobreposição |
| estoque/funil | Lead e StageHistory no corte | estágio vigente, pipeline atual para carteira | registros do dashboard, sem inferir eventos |
| tarefas | work.* no registry; occurredAt | quantidade com correções; pendência/atraso derivados de estado/prazo | fato/tarefa; sem fato diário |
| canais/contatos | outreach.* e email.* | evento específico; contato efetivo não é tentativa | fato + ocorrência; cobertura do provedor |
| qualificação/proposta | registry e StageHistory | marco real; ator histórico | fato/lead/oportunidade |
| reunião agendada | MEETING_SCHEDULED; data do booking | uma reunião, bookedBy, sem duplicar crédito do vendedor | MeetingHistory e fatos |
| reunião atribuída | booking + meetingOwner no evento | quantidade por responsável no booking | fato de booking, sem novo evento |
| realizada/no-show/cancelada/remarcada | respectivos eventos; data do marco | responsável no marco; não inferir estado pelo relógio | fatos/MeetingHistory |
| vendas/receita | sales.* e financial.* existentes | venda/correções por oportunidade; soma centavos BRL | mesma venda uma vez; separar contrato/fatura/pagamento |
| duração/primeira ação | evidence SLA | amostra com início/fim explícitos, média/mediana/P90 | missingCount não é zero |
| taxa/coorte | metric-cohort.ts e registry | recalcular numerador/base elegível, sem somar percentuais | bases e limitações explícitas |
| custos/ROAS/ROI | fonte de investimento real | indisponível sem cobertura compatível | spec 07 |

Regras transversais: fuso do workspace; [from,to); hoje/mês parcial compara intervalo equivalente; últimos 7/30 dias civis até agora; personalizado inclui último dia. Zero comprovado difere de ausência/parcial/indisponível. Filtro de pessoa é papel de crédito, não owner atual universal. Matrizes/rankings respeitam escopo servidor. Metas existentes só com a mesma base/intervalo.

Reconciliar separados com consolidado por eventKey/fato. Pessoas usam união, reuniões/vendas por identidade canônica, receita por saldo. Contribuições históricas não migram de frente com a pessoa. Para taxas de booking e realização, interseção da coorte; nunca dividir eventos de coortes distintas. Exibir volume de eventos de período separado de conversão por coorte.

Aceite sintético com datas fixas: 30 entradas hoje; Carlos agenda 10, owners Jhon/Ede 5 cada, completions 3/4, total 10/7. Restantes continuam agendadas, não no-show. Coorte única: 10/30 e 7/10. Datas diferentes: booking no dia A e completion no B preservam ambos os recortes. Transferência não recredita. Testes devem executar os serviços reais de consulta.

## Catálogo implementado e evidência

Registry `indicators.16`: `contacts.entries`, `conversion.entry_to_meeting`, `conversion.entry_to_sale`, `conversion.meeting_to_sale` adicionados aos IDs anteriores. Taxas comerciais usam interseção de leads das mesmas coortes; não dividem séries de períodos incompatíveis. Drilldowns de taxas limitam os numeradores à coorte e apresentam valor canônico além da quantidade de eventos. Resumo de frentes e créditos usa commercial-front-summary.ts; evidências usam /dashboard/evidencias com saldo, fatos e links.

Anúncios operacional passa por getIntegratedProduction com o mesmo escopo histórico, sem materializar todos os IDs de leads atuais. Atribuições concretas usam meetingId e responsável no booking; créditos de SDR continuam separados. Ausência de frente é reportada como cobertura parcial, não atribuída pelo owner/pipeline atual.

Filtro de canal: fatos usam o canal persistido no evento; gráficos baseados em entidades usam somente leads com saldo positivo de fatos autorizados desse canal no mesmo intervalo. A consulta de entidades reusa integratedFactWhere, respeita frente/escopo/correções e limita a 50 mil leads. Não manter a população geral quando um canal foi selecionado.
