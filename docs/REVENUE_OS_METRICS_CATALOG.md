# Catálogo planejado de métricas — Revenue OS

## Contrato comum

Toda métrica futura deve declarar: nome, objetivo, unidade, fonte oficial,
numerador, denominador, filtros, timestamp do fato, timezone, cancelamentos,
cobertura, limitações e drilldown. Valores monetários são centavos; percentuais
usam basis points internamente. Zero, denominador ausente e dado indisponível
são estados diferentes.

Comparações usam período anterior equivalente conforme `docs/METRICS.md`. O
mesmo escopo de workspace, permissão e filtros é aplicado aos dois períodos.
Correlação não é apresentada como causa.

## Marcos do ciclo

| Marco | Fato temporal oficial |
|---|---|
| aquisição | `MarketingTouchpoint.occurredAt` ou fato de mídia |
| lead recebido | `Lead.receivedAt` |
| primeira tentativa/conexão | `LeadSlaCycle` |
| qualificação | evento/StageHistory de qualificado |
| reunião | `Meeting.scheduledStartAt` e resultado em histórico |
| oportunidade/proposta | criação e StageHistory/Offer |
| venda | snapshot de ganho da Opportunity |
| contrato | `Contract.signedAt` |
| ativação | `CustomerOnboarding.activatedAt` |
| movimento de receita | `RevenueMovement.effectiveAt` |
| pagamento | `Payment.paidAt` |
| renovação/churn | evento confirmado e `effectiveAt` |

## Aquisição e marketing

| Métrica | Fórmula | Fonte/limitação |
|---|---|---|
| Investimento | soma do custo em centavos | `MarketingPerformanceFact`; informar moeda e cobertura de sync |
| Impressões | soma de impressões | fato do provider, deduplicado por chave/granularidade |
| Cliques | soma de cliques | provider; não equivale a sessão |
| CTR | cliques / impressões | nulo se impressões = 0 |
| CPC | investimento / cliques | nulo se cliques = 0 |
| CPM | investimento × 1.000 / impressões | nulo se impressões = 0 |
| Sessões atribuíveis | sessões com touchpoint válido | cobertura e janela explícitas |
| Conversão de formulário | submissões válidas / sessões elegíveis | bots/inválidos conforme regra versionada |
| Leads por canal | leads recebidos com dimensão | Lead + touchpoint; “desconhecido” permanece visível |
| CPL | investimento / leads atribuídos | modelo/janela/versionamento obrigatórios |
| Custo por qualificado | investimento / qualificados atribuídos | qualificado histórico, não estado atual |
| Custo por oportunidade | investimento / oportunidades atribuídas | atribuição versionada |
| CAC de aquisição | investimento elegível / novos clientes | escopo de custos declarado; não chamar CAC completo sem custos comerciais |
| Receita atribuída | crédito × receita definida | `AttributionResult`; não é causalidade |
| ROAS | receita atribuída / investimento | declarar receita vendida, contratada ou recebida |
| Cobertura de atribuição | conversões com crédito válido / conversões elegíveis | nunca ocultar “desconhecido” |

## SDR e conversão

As métricas atuais de leads, tentativa, contato, qualificação, SLA, backlog,
aging, parado e sem próxima ação permanecem definidas em `docs/METRICS.md`.
Contact, Account e touchpoint permanecem dimensões de expansão; território e UF
já possuem recortes locais na CRM-42 com supressão de grupos pequenos. Um Contact
com vários Leads não pode ser contado como várias pessoas quando a métrica for
“contatos únicos”; o nome do KPI deve explicitar a unidade.

| Métrica | Fórmula | Observação |
|---|---|---|
| Contatos únicos recebidos | Contacts distintos com primeiro lead no período | separado de leads/conversões |
| Velocidade de qualificação | mediana/P90 entre recebido e qualificado | somente coorte elegível; censura explícita |
| Conversão por conta/perfil | qualificados ou oportunidades / leads elegíveis | dimensão normalizada, desconhecido visível |
| Cobertura de comitê | oportunidades com papéis mínimos / oportunidades abertas | regra versionada por produto/segmento |

## Vendas e contratos

| Métrica | Fórmula | Fonte/limitação |
|---|---|---|
| Pipeline aberto | soma do valor estimado de oportunidades abertas | snapshot na data de corte para histórico |
| Win rate | oportunidades ganhas / (ganhas + perdidas) | coorte e timestamp declarados |
| Ciclo de vendas | mediana/P90 de oportunidade criada a ganho/perda | canceladas tratadas separadamente |
| Conversão por etapa | entradas na etapa seguinte / entradas na anterior | StageHistory; desfechos ramificados |
| Bookings | valor de contratos assinados no período | não equivale a pagamento/receita reconhecida |
| TCV contratado | soma do TCV da versão assinada | ContractVersion oficial |
| MRR contratado | soma do MRR de novas assinaturas | separado de MRR ativo |
| Taxa proposta → contrato | contratos assinados / propostas elegíveis | versão e cancelamentos explícitos |
| Tempo ganho → assinatura | duração entre snapshot de ganho e assinatura | ausência de contrato fica no denominador de pendência |

## Receita, retenção e expansão

| Métrica | Fórmula | Fonte/limitação |
|---|---|---|
| MRR ativo final | soma dos movimentos de MRR até a data de corte | ledger; não somar snapshots atuais para passado |
| ARR | MRR ativo × 12 | apenas recorrência mensal normalizada |
| New MRR | soma `NEW` positiva | `RevenueMovement` |
| Expansion MRR | soma `EXPANSION` positiva | expansão efetiva |
| Contraction MRR | valor absoluto de `CONTRACTION` | mostrar como redução |
| Churned MRR | valor absoluto de `CHURN` | data efetiva confirmada |
| Net New MRR | New + Expansion + Reactivation − Contraction − Churn | mesma moeda/período |
| Logo churn | contas encerradas / contas ativas no início | não inferir de falta de atividade |
| GRR | (MRR inicial − contraction − churn) / MRR inicial | excluir expansão; nulo se inicial = 0 |
| NRR | (MRR inicial + expansion + reactivation − contraction − churn) / MRR inicial | coorte inicial explícita |
| Taxa de renovação | renovações concluídas / renovações decididas | pendentes não entram em decididas, mas aparecem |
| Receita recebida | soma de pagamentos confirmados | não é faturamento contábil |
| Inadimplência operacional | valor vencido não pago / valor vencido | regra de tolerância versionada |
| Tempo de recebimento | mediana/P90 entre vencimento/emissão e pagamento | definição escolhida visível |

Na CRM-54, a tela Farmer implementa os drilldowns operacionais de 30/60/90 dias,
MRR em revisão, decisões, ausência de próxima ação e expansão pendente. A taxa de
renovação usa apenas `RENEWED / (RENEWED + NOT_RENEWED + CANCELLED)` e retorna
ausência, não zero, quando não há decisão. GRR, NRR e coortes históricas
consolidadas permanecem para a CRM-57; os fatos necessários já são persistidos
em `effectiveAt` no ledger e nos eventos confirmados.

## Onboarding e Customer Success

| Métrica | Fórmula | Fonte/limitação |
|---|---|---|
| Tempo até handoff aceito | aceito − ganho | CustomerHandoff/histórico |
| Tempo até ativação | ativação − início do onboarding | critério versionado |
| Onboarding no prazo | onboardings concluídos no prazo / concluídos elegíveis | cancelados separados |
| Backlog de marcos | marcos abertos vencidos | estado persistido |
| Contas por faixa de saúde | contagem por snapshot vigente | regra/versão e sinais ausentes visíveis |
| Cobertura de plano de sucesso | contas ativas com plano válido / contas ativas | plano vazio não conta |
| CSAT | média e distribuição das respostas válidas | pergunta/escala/período declarados |
| NPS | % promotores − % detratores | nulo sem respostas; taxa de resposta ao lado |
| Solicitações no SLA | resolvidas no SLA / resolvidas elegíveis | não transformar módulo em help desk geral |
| Risco sem ação | contas em risco sem próxima ação / contas em risco | drilldown obrigatório |

Sinais de uso/adoption só entram quando existir integração de produto com
cobertura confiável. Ausência de telemetria não pode reduzir health score.

## Metas, quotas e forecast

Na CRM-55, metas são calculadas diretamente dos fatos persistidos até um corte
`asOf`. O período civil inclusivo da interface é consultado como intervalo
semiaberto no timezone congelado do plano. O catálogo implementado cobre leads
recebidos, tentativas humanas, reuniões realizadas, vendas, receita ganha, novo
MRR, MRR de expansão, renovações decididas e conversão lead→venda. Resultado
zero, ausência de denominador, cobertura parcial e não aplicabilidade permanecem
estados distintos. Cada resultado traz drilldown; forecast e pace continuam
fora desta task.

| Métrica | Fórmula | Fonte/limitação |
|---|---|---|
| Atingimento | realizado / quota | quota versionada e período civil |
| Pace | realizado até hoje / alvo proporcional até hoje | calendário e dias úteis configurados |
| Pipeline coverage | pipeline elegível / quota restante | definição de pipeline visível |
| Forecast pipeline | soma de cada oportunidade elegível uma única vez | `PIPELINE + BEST_CASE + COMMIT` |
| Forecast best case | soma dos buckets `BEST_CASE + COMMIT` | cumulativo sem dupla contagem |
| Forecast commit | soma somente do bucket `COMMIT` no snapshot | override gerencial é exibido separadamente |
| Weighted pipeline | soma valor × probabilidade manual / 10.000 | somente com cobertura manual completa; senão ausente |
| Forecast gap | quota − forecast selecionado | pode ser negativo; meta ausente não vira zero |
| Forecast accuracy | 1 − abs(forecast − realizado) / max(realizado, base mínima) | regra de zero documentada |
| Slippage | oportunidades previstas que passaram da data / previstas | usa snapshot da data de corte |

## Operação, integração e qualidade

| Métrica | Fórmula | Interpretação |
|---|---|---|
| Sync success rate | runs concluídos / runs terminados | maior é melhor |
| Sync lag | agora − último cursor/fato confirmado | maior é pior |
| Webhook backlog | inbox pendente/retry | separar idade e volume |
| Outbox lag | agora − evento publicável mais antigo | maior é pior |
| Mapping coverage | objetos mapeados / objetos válidos recebidos | desconhecido não some |
| Duplicate review backlog | reviews abertos por idade/severidade | não auto-merge |
| Data completeness | campos válidos presentes / campos exigidos | regra/versionamento por lifecycle |
| Consent unknown | Contacts sem base/finalidade verificável | não significa opt-in |
| Automation failure rate | runs com falha terminal / runs terminados | já usa infraestrutura atual |
| AI acceptance rate | insights aceitos total/parcial / revisados | não mede “verdade” da IA |

## Funil completo e ramificações

```text
Touchpoint → Contact/Lead → Tentativa → Contato → Qualificado
                                         ├─ Desqualificado
                                         └─ Reunião → Oportunidade → Proposta
                                                                     ├─ Perdido
                                                                     └─ Ganho → Contrato → Ativação
                                                                                          ├─ Renovação/Expansão
                                                                                          └─ Contração/Churn
```

Desqualificação, perda e churn são saídas, não etapas positivas. Cada conversão
usa a população que realmente entrou na etapa anterior dentro da coorte/tempo
definido.

## Regras de drilldown e permissão

O drilldown recebe um `MetricQuery` canônico serializado e assinado pelo
servidor: definição/versão, período, timezone, filtros, escopo e conjunto de
eventos. Usuários veem somente registros autorizados; agregados pequenos podem
ser suprimidos quando houver risco de reidentificação. Exportação exige
permissão específica e auditoria.

## Estado na CRM-32

Somente o catálogo foi definido. As métricas atuais continuam sendo as únicas
implementadas; nenhuma série, KPI ou causa nova foi adicionada ao produto.
