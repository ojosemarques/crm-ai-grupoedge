# Definições e consultas de métricas

> A camada transversal da CRM-57, da aquisição até retenção e forecast, está em
> `docs/REVENUE_METRICS.md`. Este documento continua normativo para o funil
> operacional; ambos reutilizam período, timezone, escopo e drilldown.

> CRM-49: MRR histórico soma `deltaMrrCents` com `effectiveAt` até o corte; ARR = MRR × 12. New, expansão, contração, churn, reativação e net new usam `[from,to)`, BRL e `America/Sao_Paulo`, com fórmula e intervalos explícitos.

## Contrato comum

Todas as métricas da CRM-19 são calculadas por `MetricsService` a partir do
PostgreSQL. A interface futura não deve reimplementar fórmulas. Cada resposta
informa:

- período UTC inclusivo no início e exclusivo no fim (`[from, to)`);
- fuso persistido do workspace, usado para formar períodos civis na interface;
- filtros normalizados e ordenados;
- escopo autorizado (`WORKSPACE`, `TEAM` ou `OWN`);
- instante de geração;
- numerador e denominador de toda taxa. Denominador zero produz taxa `null`,
  nunca zero por suposição.

Os valores monetários são inteiros em centavos e são serializados como texto
para não perder precisão. A moeda disponível no MVP é BRL.

## Filtros compartilhados

O contrato aceita SDR, closer, equipe, origem, campanha, criativo, prioridade e
produto. IDs são validados, deduplicados e ordenados. Origem, campanha e
criativo usam a identidade inicial do lead. Prioridade usa a última revisão
vigente de `LeadScore` anterior ao corte e, na ausência dela, a faixa do último
ciclo de SLA anterior ao corte.

SDR restringe ciclos atribuídos; closer restringe reuniões e snapshots de
fechamento; produto restringe oportunidades e snapshots; equipe restringe o
universo relacional associado aos seus membros e filas. Métricas de evento usam
a atribuição tipada do próprio evento quando ela existe. O filtro nunca amplia
o escopo RBAC: primeiro é calculado o universo `OWN`, `TEAM` ou `WORKSPACE`, e
depois os filtros são aplicados.

## Dicionário

| Nome | Definição | Numerador | Denominador | Filtros | Cancelados | Campo temporal | Timezone | Exemplo | Limitações |
|---|---|---|---|---|---|---|---|---|---|
| Leads recebidos | Identidades novas cuja submissão resultou em `CREATED` no período | quantidade de `leadId` distintos | não se aplica (`null`) | todos | submissão rejeitada ou duplicada não cria nova identidade | `LeadFormSubmission.submittedAt` | período formado no fuso do workspace e comparado como instante UTC | 3 identidades novas = 3 | conversões duplicadas são preservadas, mas não entram como novo lead |
| Taxa de tentativa | Leads recebidos que tiveram primeira tentativa humana até o corte | leads da coorte com `firstHumanAttemptAt < to` | leads recebidos | todos | não se aplica | `submittedAt` para coorte e `firstHumanAttemptAt` para resultado | workspace | 2/3 = 66,67% | tentativa posterior ao corte não reescreve o passado |
| Taxa de contato | Tentativas que alcançaram primeira conexão | leads com `firstConnectedAt < to` | leads com primeira tentativa | todos | não se aplica | `firstConnectedAt` | workspace | 2/2 = 100% | mede primeira conexão, não quantidade de conversas |
| Qualificação sobre contato | Contatados da coorte que entraram em Qualificado até o corte | contatados com evento `QUALIFIED` | contatados | todos | não se aplica | `StageHistory.enteredAt` | workspace | 2/2 = 100% | correção posterior é respeitada pelo intervalo histórico |
| Qualificação total | Leads recebidos que entraram em Qualificado até o corte | qualificados da coorte | leads recebidos | todos | não se aplica | `StageHistory.enteredAt` | workspace | 2/3 = 66,67% | não usa apenas `Lead.status` atual |
| Agendamento | Qualificados da coorte com reunião agendada até o corte | qualificados com `SCHEDULED` ou `RESCHEDULED` | qualificados da coorte | todos | cancelamento posterior não apaga o fato de agendamento | `MeetingHistory.occurredAt` | workspace | 2/2 = 100% | conta lead distinto, não número de remarcações |
| Show rate | Reuniões decididas no período que ocorreram | reuniões com último estado `COMPLETED` no corte | `COMPLETED + NO_SHOW` | closer/equipe e filtros do lead | `CANCELLED`, `SCHEDULED` e `CONFIRMED` não entram no denominador | `MeetingHistory.newStartsAt` | workspace | 1/(1+1) = 50% | reunião sem desfecho ainda não é classificada |
| No-show rate | Reuniões decididas no período marcadas como no-show | reuniões com último estado `NO_SHOW` no corte | `COMPLETED + NO_SHOW` | closer/equipe e filtros do lead | canceladas não viram no-show | `MeetingHistory.newStartsAt` | workspace | 1/(1+1) = 50% | mesma base decidida do show rate |
| Reunião → venda | Leads com reunião realizada no período e ganho vigente no corte | leads de reunião realizada com snapshot `WON` vigente | leads distintos com reunião `COMPLETED` | closer/produto/equipe e filtros do lead | canceladas e no-show não entram; ganho reaberto antes do corte deixa de ser vigente | `newStartsAt` e `OpportunityOutcomeSnapshot.occurredAt` | workspace | 1/1 = 100% | vários shows do mesmo lead contam uma vez |
| Lead → venda | Leads recebidos que possuem ganho vigente no corte | leads da coorte com snapshot `WON` vigente | leads recebidos | todos | ganho reaberto antes do corte deixa de ser vigente | `submittedAt`, `occurredAt` e saída do `StageHistory` | workspace | 1/3 = 33,33% | atribui conversão à coorte de entrada |
| SLA automático | Tempo entre recebimento e confirmação automática de cada entrada | amostras medidas | ciclos recebidos no período | SDR, equipe, origem, campanha, criativo e prioridade | não se aplica | `receivedAt` e `automaticAcknowledgedAt` | workspace | 2 s, 70 s e 200 s | inclui nova conversão de identidade existente, pois cada entrada possui ciclo próprio |
| SLA humano | Tempo até a primeira tentativa humana de cada entrada | amostras com tentativa | ciclos recebidos no período; ausentes são informados à parte | SDR, equipe, origem, campanha, criativo e prioridade | não se aplica | `receivedAt` e `firstHumanAttemptAt` | workspace | 30 s, 120 s e uma sem tentativa | conexão é uma métrica distinta da tentativa |
| Tempo por etapa | Tempo de interseção de cada intervalo de etapa com o período | soma/amostras dos segundos recortados | quantidade de intervalos por etapa | todos | não se aplica | `StageHistory.enteredAt/exitedAt` | workspace | intervalo de 8 dias = 691.200 s | responsabilidade de estágio sem ator próprio usa o universo relacional autorizado |
| Aging | Idade dos leads em etapa aberta no instante do corte | segundos desde entrada na etapa | leads abertos no corte | todos | registros excluídos antes do corte não entram | intervalo de `StageHistory` que contém `to` | workspace | entrada há 6 dias = 518.400 s | é fotografia no corte, não média de entradas do período |
| Receita | Valor dos ganhos ocorridos no período e vigentes no corte | soma de `amountCents` congelado | não se aplica (`null`); quantidade de ganhos acompanha o valor | closer, produto e demais filtros | ganho reaberto antes do corte é excluído | `OpportunityOutcomeSnapshot.occurredAt` e saída da etapa | workspace | R$ 1.000,00 = `100000` | não representa caixa, pagamento ou reconhecimento contábil |
| MRR | MRR congelado dos ganhos do período vigentes no corte | soma de `mrrCents` | não se aplica (`null`) | closer, produto e demais filtros | mesma regra de receita | snapshot de fechamento | workspace | R$ 100,00 = `10000` | valor comercial informado, sem integração financeira |
| TCV | TCV congelado dos ganhos do período vigentes no corte | soma de `tcvCents` | não se aplica (`null`) | closer, produto e demais filtros | mesma regra de receita | snapshot de fechamento | workspace | R$ 1.200,00 = `120000` | valor comercial informado |
| Ticket médio | Receita dividida pelos ganhos vigentes do período | receita em centavos | quantidade de ganhos | closer, produto e demais filtros | mesma regra de receita | snapshot de fechamento | workspace | `100000 / 1 = 100000` | retorna `null` quando não há ganho |
| Backlog | Leads em etapa aberta no instante do corte | leads distintos em intervalo aberto no corte | não se aplica (`null`) | todos | excluído antes do corte não entra | `StageHistory.enteredAt/exitedAt` | workspace | 3 leads abertos = 3 | não usa apenas o status corrente do lead |
| Leads parados | Backlog cuja permanência na etapa alcança o limite configurado | leads acima do limite | não se aplica (`null`) | todos | mesma regra do backlog | intervalo da etapa e versão de configuração anterior ao corte | workspace | 1 lead há pelo menos 7 dias = 1 | a versão mais recente anterior ao corte é usada; sem versão, usa configuração atual do workspace |
| Leads sem atividade | Backlog sem atividade humana dentro do limite configurado | leads sem atividade humana recente | não se aplica (`null`) | todos | atividades apagadas logicamente não entram | `Activity.occurredAt` e configuração | workspace | 2 leads sem atividade há 3 dias = 2 | ações técnicas não fingem contato humano |
| Leads sem próxima ação | Backlog sem tarefa ativa no instante do corte | leads sem tarefa aberta | não se aplica (`null`) | todos | tarefa cancelada antes do corte não conta | `Task.createdAt/completedAt/updatedAt/deletedAt` | workspace | 1 lead sem tarefa = 1 | cancelamento anterior à existência de histórico tipado de tarefas usa `updatedAt` como instante terminal |

## Estatísticas de SLA e duração

Cada conjunto retorna quantidade de amostras, média, mediana, P90 por posto mais
próximo, menor e maior valor. SLA também retorna contagens cumulativas até 60 s,
até 180 s e quantidade sem medição. Os limites 60/180 são as faixas operacionais
da política persistida `SLA imediato — 0 minutos`; não são tolerância nem mudam o
prazo, que continua zero.

Média e mediana são arredondadas para o segundo inteiro mais próximo. Durações
negativas são rejeitadas pelas constraints do banco e ainda são limitadas a zero
na projeção defensiva.

## Fontes históricas e retenção

`StageHistory`, `MeetingHistory`, `LeadScore` e
`OpportunityOutcomeSnapshot` são as fontes para consultas passadas. O snapshot
financeiro é gravado na mesma transação do ganho ou perda e é append-only no
banco. Reabrir encerra seu intervalo de etapa; consultar um corte anterior à
reabertura ainda reproduz o ganho daquele momento.

A migration da CRM-19 faz backfill conservador dos fechamentos existentes com
o melhor estado relacional disponível no momento da aplicação. Fechamentos
anteriores que já tinham sido reabertos podem não ter todos os atributos
originais recuperáveis; fechamentos posteriores são exatos. Essa limitação deve
ser exibida se dados anteriores à migration forem importados.

## Cancelamentos e corte temporal

- reunião: considera o evento de maior revisão anterior ao corte;
- oportunidade: considera o snapshot cujo intervalo de etapa ainda contém o
  corte;
- lead: soft delete posterior ao corte não apaga o passado;
- tarefa: conclusão, cancelamento e exclusão anteriores ao corte encerram a
  próxima ação; eventos exatamente em `to` pertencem ao período seguinte.

## Exemplo conhecido de teste

O teste de integração cria três leads numa fonte isolada: dois tentados, dois
conectados e qualificados, um show, um no-show, uma reunião cancelada e um ganho
de `100000` centavos. O resultado esperado é 2/3 de tentativa, 2/2 de contato,
1/2 de show, 1/2 de no-show, 1/3 de lead para venda, receita `100000`, MRR
`10000` e TCV `120000`. A reunião cancelada não altera o denominador.

Esse cenário é fixture de teste, não número decorativo da aplicação.

## Dashboard e drilldown reconciliável

A CRM-20 não cria uma segunda fonte de fórmulas. `DashboardMetricsService`
consome `MetricsOverview` e sua evidência tipada, acrescentando somente projeções
analíticas derivadas do mesmo universo autorizado. O dashboard nunca consulta o
banco diretamente e não calcula números em componentes React.

Os atalhos Hoje, Ontem, Semana e Mês são intervalos civis calculados no timezone
do workspace. Hoje, semana atual e mês atual terminam no instante de geração;
assim, um corte parcial não usa horas ou dias futuros como fotografia operacional.
Ontem é um dia civil completo. O período personalizado inclui integralmente a
data final e aceita no máximo 366 dias. A consulta normalizada é gravada na URL
com os filtros SDR, closer, equipe, origem, campanha, criativo, prioridade e
produto.

Cada KPI e cada segmento possui um `drilldownId`, fórmula legível e chaves dos
registros que formaram o resultado. Ao abrir `/dashboard/registros`, o servidor:

1. repete autorização, período e filtros;
2. recompõe o dashboard pela camada única de métricas;
3. seleciona apenas as chaves daquele `drilldownId`;
4. pagina o resultado sem ampliar o universo.

Assim, contagens e registros são reconciliáveis por construção. Indicadores de
valor ou duração abrem as amostras usadas, embora o total de linhas naturalmente
não seja igual ao valor em centavos ou segundos. Estado vazio mantém zeros e
denominadores reais e não cria séries para preencher gráficos.

As análises entregues são: funil da coorte, conversão e tempo por etapa,
performance de SDR e closer, origem, campanha, criativo, prioridade, motivos de
desqualificação/perda/no-show, qualidade PACTO, backlog e aging. Oportunidades
contam criação no período; propostas contam entrada histórica na etapa Proposta;
vendas e valores continuam usando snapshots de fechamento vigentes.

## Comparações do Dashboard (DESIGN-05)

`DashboardMetricsService` consulta o período atual e o anterior pela mesma
fronteira `MetricsService`. As duas consultas recebem exatamente os mesmos
filtros e passam novamente por `metrics.read`; o período anterior jamais amplia
o universo autorizado. O contrato expõe os dois intervalos civis, em datas
locais e instantes UTC, e retorna para cada indicador aplicável:

- valor, numerador, denominador e `drilldownId` do período atual;
- os mesmos quatro campos para o período anterior;
- diferença absoluta e percentual;
- direção `UP`, `DOWN`, `STABLE` ou `NOT_COMPARABLE`;
- interpretação semântica separada da direção.

As regras de pareamento são:

| Período atual | Período anterior |
|---|---|
| Hoje até o instante de geração | ontem até o mesmo horário civil |
| Ontem completo | dia civil imediatamente anterior |
| Semana atual até o instante de geração | mesmos dias e horário da semana anterior |
| Mês atual até o instante de geração | mesmos dias e horário do mês anterior, limitados ao último dia existente |
| Mês civil completo informado como personalizado | mês civil completo anterior |
| Outro período personalizado | intervalo civil imediatamente anterior com a mesma quantidade de dias |

Diferença percentual é `null` quando o valor anterior é zero ou quando algum
dos dois valores não existe. Isso evita afirmar crescimento infinito ou criar
uma porcentagem falsa. Zero continua sendo um valor válido para contagens e
dinheiro. Taxas e durações sem denominador/amostra permanecem `null`.

A direção matemática não determina sozinha se a mudança é boa. Aumento de
vendas, receita, MRR, TCV e conversão é favorável; aumento de SLA em segundos,
no-show, leads parados ou sem próxima ação é desfavorável. Volume de leads,
backlog, ticket, perdas e desqualificações exige contexto. A interpretação não
afirma causa: correlação temporal permanece explicitamente distinta de causa.

Os drilldowns `comparison.current.*` e `comparison.previous.*` são recompostos
com os mesmos filtros, escopo e evidências tipadas. Portanto o período anterior
é inspecionável sem reutilizar por engano as linhas do período atual.

## Séries históricas do Dashboard (DESIGN-05)

As séries são agregadas em memória a partir de uma única evidência relacional
por período, sem uma consulta ao banco para cada ponto. Os buckets sempre
cobrem exatamente `[from, to)` e usam:

- hora para intervalos de até 48 horas;
- dia para intervalos acima de 48 horas e até 120 dias;
- semana para intervalos acima de 120 dias, respeitado o limite de 366 dias.

Um bucket temporal real sem evento recebe zero em contagens e valores
monetários. Taxas sem denominador e SLA sem amostra recebem `null`. Nenhum ponto
é criado fora do intervalo solicitado. Semanas parciais no início ou fim são
mantidas como buckets reais e explicitam seus instantes `from` e `to`.

As séries disponíveis são: leads recebidos, primeiras tentativas, primeiras
conexões, qualificados, reuniões agendadas, reuniões realizadas, no-shows,
oportunidades, propostas, vendas, perdas, desqualificados, receita, MRR,
mediana do SLA humano, P90 do SLA humano e conversão lead → venda. Valores
monetários permanecem strings de centavos. A conversão por bucket informa
numerador e denominador; a soma dos denominadores reconcilia com a coorte do
KPI, enquanto percentuais não são somados.

Para tornar os eventos reproduzíveis, `MetricsOverview.evidence` agora inclui
IDs e timestamps de submissão, primeira tentativa, primeira conexão, primeira
qualificação, primeiro agendamento, criação de oportunidade, primeira entrada
em proposta, ganho, perda e desqualificação vigente no corte. Ganhos carregam também os valores
congelados de receita, MRR e TCV; ciclos de SLA carregam as durações medidas.

## Funil completo com desfechos

O contrato `fullFunnel` mantém o caminho principal de coorte — Lead recebido →
Tentativa → Conectado → Qualificado → Reunião → Oportunidade → Proposta — e
modela desfechos em ramos separados. Ganho e Perdido saem de Proposta;
Desqualificado sai da entrada. Ganho, perda e desqualificação precisam continuar
vigentes no corte de cada período. Cada nó declara `branchFrom`, tipo do nó,
denominador e drilldown. O funil operacional legado permanece disponível para
compatibilidade com as consultas gerenciais existentes.

Os nós do funil contam pessoas distintas da coorte, não somam oportunidades
repetidas do mesmo lead. Os KPIs de oportunidades e propostas continuam
contando entidades, conforme sua definição própria; essa diferença de unidade
é intencional e está declarada no contrato.

## Consumo visual e recortes acionáveis (DESIGN-06)

O Dashboard consome diretamente `DashboardMetricsScreen`. A série do período
anterior é produzida por uma segunda chamada autorizada ao `MetricsService`, com
os mesmos filtros do período atual, e é alinhada visualmente pelo índice do
bucket. Os tooltips e a tabela alternativa exibem os rótulos civis dos dois
períodos; o alinhamento não muda as datas nem combina eventos entre intervalos.

A conversão por origem usa a fonte inicial da coorte. Para cada origem, o
numerador é a quantidade de leads recebidos no período que possuem ganho vigente
no corte, e o denominador é a quantidade de leads recebidos daquela origem. O
resultado é uma atribuição inicial simples, não uma análise multitoque nem uma
afirmação causal.

Performance preserva unidade, escopo e denominador:

- SDR: leads atribuídos da coorte, qualificados distintos, conversão de
  qualificação, receita atribuída, SLA humano médio, reuniões e no-show rate;
- closer: oportunidades criadas, ganhos, conversão de oportunidade para ganho,
  receita, reuniões e show rate.

As linhas têm finalidade diagnóstica. A interface não produz ranking moral,
inferência de capacidade ou conclusão causal a partir desses recortes.

O painel “Precisa de atenção” expõe sete verificações derivadas do banco:

| Recorte | Definição | Corte temporal |
|---|---|---|
| Leads sem próxima ação | backlog aberto sem tarefa ativa que represente próxima ação | estado no fim do período |
| SLA crítico | ciclos do período com primeira tentativa humana medida acima de 180 segundos | `receivedAt` no período |
| Leads parados | backlog aberto cujo tempo na etapa atual alcançou `leadStagnationDays` do workspace | estado no fim do período |
| Reuniões sem PACTO | reunião agendada ou confirmada no período cujo lead não possui PACTO completo e humanamente validado | horário da reunião |
| Oportunidades paradas | oportunidade aberta cuja entrada na etapa atual excede o limite configurado de estagnação | estado no fim do período |
| No-shows | reunião decidida como `NO_SHOW`, excluídos cancelamentos | decisão no período |
| Automações com erro | `AutomationRun` em falha, ligado a lead autorizado | criação da execução no período |

Cada item carrega severidade textual, evidência curta, quantidade e drilldown.
Os links recompõem o recorte pelo serviço no servidor; um usuário não amplia seu
universo alterando URL. Reutilizar temporariamente `leadStagnationDays` para
oportunidades é uma limitação explícita até existir configuração própria.

No funil visual, entrada, tentativa, contato, qualificação, reunião,
oportunidade e proposta formam o caminho principal. Ganho e perdido aparecem
como saídas de proposta; desqualificado aparece como saída da entrada. Quantidade,
conversão e perda são exibidas junto do nó e abrem o respectivo conjunto de
registros. Nenhum desfecho é tratado como avanço positivo apenas porque cresceu.

## Consultas gerenciais da CRM-27

`ManagerAnalyticsService` reutiliza o mesmo `MetricsOverview`, o dashboard e
seus filtros. Cada resposta registra período civil, timezone, filtros, fórmula,
numerador, denominador, comparação, limitações e grupos de registros. Os oito
contratos são:

| Pergunta | Fórmula e base | Limitação principal |
|---|---|---|
| Leads P1 sem tentativa | P1 recebidos menos P1 com `firstHumanAttemptAt` antes do corte | sem entradas P1, o denominador é zero |
| SDRs abaixo da média | taxa individual de tentativa comparada à taxa geral ponderada | exige ao menos dois SDRs com entradas para comparação útil |
| Maior perda do funil | maior diferença absoluta entre etapas sequenciais; desempate pela menor conversão | perda absoluta não é sinônimo de pior taxa |
| Reuniões de amanhã sem PACTO | reuniões ativas no dia civil seguinte sem qualificação `COMPLETED` e mínimo humano validado | mede o estado consultado, não histórico de completude |
| Oportunidades paradas | oportunidade `OPEN` cujo intervalo atual de `StageHistory` excede o limite persistido | o MVP reutiliza o limite de lead parado |
| Origem com mais reuniões qualificadas | qualificados da coorte com agendamento, agrupados pela origem inicial | não é atribuição multitoque nem prova causalidade |
| Leads que exigem ação hoje | união de tarefa ativa vencida/para hoje e backlog sem tarefa ativa | aponta a pendência, não a causa do atraso |
| Queda do show rate | `COMPLETED / (COMPLETED + NO_SHOW)` contra período anterior de igual duração | segmentos associados são correlações e amostras pequenas oscilam |

O número e o conjunto aberto pelo drilldown não precisam ter a mesma unidade:
uma taxa abre suas reuniões decididas, dias abrem as oportunidades medidas e a
quantidade de SDRs abre os leads usados em suas taxas. Toda chave do grupo,
porém, pertence ao universo autorizado e ao cálculo descrito. Resultado vazio
mantém zero ou `null`, declara a ausência de amostra e não cria registro.

## Saúde de lifecycle e ownership — CRM-35

`GET /api/lifecycle/metrics` é administrativo e retorna somente dados do
workspace autenticado: distribuição por estágio, cobertura sobre Contact e
Account ativos, ausência de owner obrigatório, transferências pendentes e
vencidas e o último run de backfill. Cobertura é
`projeções / (contacts + accounts) × 100`; denominador zero retorna `null`.
Esses números medem integridade operacional, não substituem o funil comercial
nem inferem causalidade. Datas usam timestamps UTC e são exibidas no fuso do
workspace pelas superfícies consumidoras.

## Mídia paga observada — CRM-39

O período usa `[periodStart, periodEnd)` em `America/Sao_Paulo`; o anterior é o
intervalo imediatamente precedente de mesma duração. Todos os valores abaixo
expõem numerador, denominador, moeda e datas. Denominador zero retorna `null` com
`SEM_BASE`, nunca zero percentual.

| Métrica | Numerador | Denominador | Unidade / interpretação |
|---|---:|---:|---|
| CPM | investimento em centavos × 1.000 | impressões | centavos; menor exige contexto |
| CTR | cliques × 10.000 | impressões | bps; maior tende a ser favorável |
| CPC | investimento | cliques | centavos; menor exige contexto |
| CPL observado | investimento | leads reportados | centavos; não prova aquisição causal |
| Custo por qualificado | investimento | PACTO validado no período | centavos |
| Custo por oportunidade | investimento | oportunidades criadas | centavos |
| CAC de mídia observado | investimento | ganhos fechados | centavos; não é CAC completo |
| ROAS observado | receita ganha no CRM × 10.000 | investimento | bps; correlação observada |

O funil separa mídia (impressão, clique e landing), identidade CRM (sessão,
submissão e lead) e receita (qualificado, oportunidade e ganho). Perdido,
desqualificado e compra reportada pela plataforma são saídas independentes.
Séries diárias só contêm buckets com fatos; nenhum ponto temporal é inventado.

## Recortes geográficos — CRM-42

Os recortes por UF e território reutilizam o mesmo `MetricsService`, período,
timezone, filtros e universo RBAC das métricas centrais. São disponibilizados:
leads, tentativas, contatos, qualificados, reuniões, reuniões realizadas,
no-shows, oportunidades, propostas, ganhos, perdas, desqualificados, receita,
conversão lead → venda e mediana do SLA humano. O período anterior tem duração
equivalente e nunca é interpretado como causa.

Grupos com menos de cinco leads são suprimidos: amostra, totais, comparação e
aquisição retornam `null`, sem revelar a contagem exata. Zero representa a
ausência de evento dentro de uma amostra publicável; `null` representa proteção
de privacidade, falta de denominador ou dado indisponível. CPL, CAC e ROAS não
são calculados sem custos reais reconciliados. Drilldowns preservam período e
UF e continuam sujeitos ao escopo do usuário.

## Atendimento ao cliente e satisfação — CRM-53

O período de solicitações usa `[from,to)` sobre `CustomerRequest.createdAt`; o
SLA resolvido usa `resolvedAt`. O universo passa primeiro por workspace e RBAC.
Cada indicador abre `/customer-service` com o recorte correspondente.

| Métrica | Numerador | Denominador / ausência | Interpretação |
|---|---:|---|---|
| Solicitações abertas | estados diferentes de `RESOLVED` e `CLOSED` | não se aplica | backlog corrente autorizado |
| Primeira resposta vencida | abertas, sem `firstRespondedAt`, com prazo anterior ao corte | não se aplica | exige ação; não inventa duração |
| Resolução vencida | abertas com `resolutionDueAt` anterior ao corte | não se aplica | exige ação |
| Dentro do SLA | resolvidas com `resolutionBreached=false` | resolvidas elegíveis; zero retorna `null` | maior tende a ser favorável |
| CSAT | soma das notas válidas | respostas CSAT válidas; zero retorna `null` | média da escala versionada |
| NPS | percentual de promotores menos percentual de detratores | respostas NPS válidas; zero retorna `null` | sinal relacional, não causa |
| Taxa de resposta | respostas válidas | convites elegíveis; sem convites retorna `null` | zero é legítimo quando houve convite |
| Baixa satisfação sem ação | última resposta ativa classificada como `DETRACTOR` ou `DISSATISFIED` e carteira sem `nextActionAt` | não se aplica | achado acionável, não previsão de churn |

Correções de pesquisa desconsideram o fato superseded no valor corrente, mas o
mantêm no histórico append-only. Política SLA, pergunta e escala são
versionadas. Datas são instantes UTC exibidos em `America/Sao_Paulo`.
## Métricas operacionais do inbox — CRM-43

As métricas abaixo são calculadas no `OmnichannelService`, sempre com
`workspaceId` e escopo `OWN`, `TEAM` ou `WORKSPACE` autorizado:

| Métrica | Definição | Campo temporal / denominador | Drilldown |
|---|---|---|---|
| Conversas abertas | `OPEN`, `PENDING_INTERNAL` ou `WAITING_CUSTOMER` | estado atual; sem denominador | `view=ALL` |
| Não lidas | conversas com `unreadCount > 0` | estado atual | `view=UNREAD` |
| SLA vencido | `PENDING_INTERNAL` com `waitingSince` há mais de 180 s | `waitingSince`, instante atual | `view=OVERDUE` |
| Aguardando contato | conversa em `WAITING_CUSTOMER` | estado atual | `view=WAITING_CUSTOMER` |
| Revisão de identidade | reviews `OPEN` em conversa permitida | `createdAt` | lista do inbox |
| Mensagens de entrada/saída | `Message.direction` no universo permitido | `occurredAt` | conversa canônica |
| Primeira resposta média | média de `Conversation.firstResponseSeconds` | somente conversas com valor persistido | inbox |

O timezone de exibição é `America/Sao_Paulo`; timestamps persistidos continuam
instantes `timestamptz`. Ausência de amostra retorna `null`, não zero. O SLA de
conversa não muda o SLA comercial imediato da entrada de Lead. Métricas
históricas e comparativas completas continuam responsabilidade da camada única
de métricas e não são inferidas do estado atual nesta fundação.

## Telefonia local — CRM-46

As métricas da central usam somente `PhoneCall`, `PhoneCallAttempt`,
`TelephonyEventReview` e `Job` do workspace autorizado:

| Métrica | Numerador | Denominador / ausência | Campo temporal |
|---|---:|---|---|
| Ligações | total de `PhoneCall` no escopo | não se aplica | `queuedAt` |
| Tentativas técnicas | total de `PhoneCallAttempt` | não se aplica | `startedAt` |
| Conectadas | chamadas com `answeredAt` | não se aplica | `answeredAt` |
| Taxa de conexão | conectadas | ligações; zero retorna `null` | `queuedAt`/`answeredAt` |
| Duração média | soma de `durationSeconds` | chamadas com duração; ausência retorna `null` | término técnico |
| Conversa média | soma de `talkSeconds` | chamadas com conversa; ausência retorna `null` | `answeredAt` até término |
| Reviews abertas | reviews `OPEN` | não se aplica | `createdAt` |
| Dead-letter | jobs de telefonia em `FAILED` | não se aplica | `finishedAt` |

Todos os instantes são persistidos em UTC e exibidos em
`America/Sao_Paulo`. Um atendimento atualiza `firstConnectedAt`; a primeira
tentativa atualiza `firstHumanAttemptAt` uma única vez. O simulador não autoriza
inferir qualidade de carrier, gravação, transcrição ou entrega PSTN.

## Contratos comerciais — CRM-48

| Métrica | Definição | Denominador/limite |
|---|---|---|
| Rascunhos | `DRAFT` ou `INTERNAL_REVIEW` | contratos visíveis |
| Aguardando aceite | `READY_TO_SEND` ou `SENT_SIMULATED` | contratos visíveis |
| Aceitos | `ACCEPTED` | contratos visíveis |
| Taxa de aceite | aceitos / (aceitos + rejeitados) | `null` sem decididos |
| Vencem em 30 dias | vigência final entre agora e +30 dias | UTC; timezone na exibição |
| Média de versões | versões / contratos | `null` sem contratos |
| Divergências | versão corrente inválida ou emitida sem hash/HTML | evidência por contrato |

Valores ficam em centavos. Proposta, ganho, aceite e vigência não são sinônimos.

## Razão comercial integrada — IND-001 a IND-055

O catálogo `indicators.1` amplia `MetricsService` sem substituir as fontes de
domínio. `CommercialMetricFact` é um read model interno, append-only e
reconstruível. Writers de entrada, pipeline, tarefa, telefonia, mensagens,
e-mail, PACTO, reunião, oportunidade, contrato, receita e pagamento persistem o
fato analítico na mesma transação da mutação operacional.

Regras comuns:

- período sempre semiaberto `[from,to)` no timezone persistido do workspace;
- crédito histórico usa IDs congelados no fato, nunca nomes ou owner atual;
- dinheiro usa centavos inteiros e reversão cria contrafato negativo;
- `ZERO` é valor disponível igual a zero; `NO_DENOMINATOR` não é zero;
- filtros e escopo `WORKSPACE`, `TEAM` ou `OWN` são aplicados no servidor;
- drilldown expõe apenas dimensões allowlisted, sem corpo de mensagem, telefone
  ou e-mail;
- origem de aquisição (`sourceId`) e canal do evento (`channel`) permanecem
  dimensões diferentes.

O backfill versionado percorre as fontes com cursor e registra cada candidato
como `CREATED`, `ALREADY_PRESENT`, `REVIEW_REQUIRED`, `SKIPPED` ou `FAILED`.
Use primeiro:

```bash
pnpm db:commercial-metrics:backfill -- --workspace=<slug> --run-key=<chave>
```

Para aplicar, acrescente `--apply`; banco remoto exige também
`--allow-production`. Depois execute:

```bash
pnpm db:commercial-metrics:reconcile -- --workspace=<slug> --run-key=<chave>
```

A reconciliação compara contagens por fonte e tipo de evento e persiste checks
`MATCHED`/`DIVERGENT`. O dashboard mostra cobertura, freshness e o estado do
último relatório. Divergência nunca é silenciosamente convertida em cobertura
total.

Rollback operacional: republicar a versão anterior do consumidor e manter as
tabelas aditivas. Os fatos não são apagados; uma reconstrução posterior pode
reutilizá-los ou gerar correções append-only. Não executar `DROP`, `TRUNCATE` ou
`DELETE` na razão comercial em produção.
