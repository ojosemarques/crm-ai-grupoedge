# Conector Meta Ads somente leitura — CRM-40

## Estado real

Em 28/10/2026, a credencial dedicada do aplicativo POLITIZAI ADS foi autorizada
com apenas `ads_read`. A leitura real da Conta8 e dos insights do dia respondeu
HTTP 200 na Graph API. O vínculo da conta com a BM foi conferido no Meta
Business Suite. O estado e a cobertura da importação no CRM são consultáveis
em `/integracoes/meta-ads`; uma leitura direta da API não comprova importação.

O conector usa a Graph API `v26.0` por padrão e aceita apenas as versões
explicitamente allowlisted `v25.0` e `v26.0`. A versão deve ser revista antes do
sunset publicado pela Meta. As referências consultadas na implementação foram a
[coleção oficial da Marketing API no Postman](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
e o [Meta Business SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk).
Foi escolhido `fetch` server-side em vez do SDK para manter uma superfície
menor e impor allowlist de host/rotas, limite de resposta, timeout e paginação
sem URL arbitrária.

## Limite e segurança

- somente operações de leitura para `https://graph.facebook.com`: `GET` direto
  e envelope `POST` do Graph Batch contendo exclusivamente suboperações `GET`;
- rotas internas allowlisted: identidade, contas de anúncios e insights;
  a leitura múltipla de objetos aceita apenas IDs numéricos obtidos dos
  insights da conta selecionada, em lotes de até 50;
- token e app secret são resolvidos apenas no servidor a partir de referências
  fixas; o banco guarda alias, nome da variável, versão e presença, nunca valor;
- `appsecret_proof` é calculado em memória quando o app secret existe;
- respostas têm limite de 2 MiB e timeout configurável entre 1 e 30 segundos;
- redirects externos, URL fornecida pelo usuário e paginação por `paging.next`
  não são seguidos; a presença de `paging.next` sinaliza continuação e a próxima
  página é reconstruída com o cursor `after`, com detecção de ciclos;
- payload bruto não é persistido; evidência guarda somente IDs externos,
  versão, cobertura de métricas e ID da execução;
- logs, respostas, auditoria e tentativas não incluem token ou app secret;
- a interface nunca recebe campo para colar credencial.

Para relatórios, prefira `META_ADS_REPORTING_ACCESS_TOKEN`, separado do
`META_ADS_ACCESS_TOKEN` usado pela Conversions API. A credencial de relatórios
exige `META_ADS_REPORTING_WORKSPACE_ID` com o UUID exato do workspace; o serviço
também exige `META_ADS_REPORTING_BUSINESS_ID` e `META_ADS_REPORTING_ACCOUNT_IDS`
(IDs `act_...` separados por vírgula). Configuração e coleta recusam outro
workspace, outra BM ou contas fora dessa lista. Os valores ficam somente como
Secrets do servidor. A configuração troca a referência versionada, sem copiar
o token para o banco. Conexões legadas continuam usando a referência anterior
até serem reconfiguradas.

Não existem comandos de escrita em campanhas, conjuntos, anúncios, criativos,
leads ou conversões. O conector não cria públicos, não envia eventos e não
altera dados comerciais do CRM.

## Configuração local

1. configure as variáveis somente no ambiente não versionado do processo;
2. reinicie a aplicação;
3. entre como Administrador e abra `/integracoes/meta-ads`;
4. salve a versão da API, a BM, os IDs de contas autorizados e a janela inicial;
5. execute **Testar conexão**;
6. selecione explicitamente as contas retornadas;
7. salve a nova versão da configuração;
8. execute a sincronização inicial;
9. use a incremental nas execuções seguintes.

O campo Business Manager deve corresponder ao portfólio aprovado no servidor.
A descoberta retorna as contas selecionadas acessíveis à credencial. A coleta
revalida a lista aprovada antes de consultar a API. O campo Graph `business`
exige `business_management`; ele não é solicitado para preservar o escopo
`ads_read`. O vínculo BM/conta deve ser conferido no Meta Business Suite ao
provisionar ou alterar a lista aprovada. Mudança de propriedade que preserve
o acesso do token não é detectada automaticamente pela Graph API.

Ative **Atualizar métricas automaticamente a cada 15 minutos** e salve/teste a
conexão para optar pela coleta periódica. O worker existente revalida o membro
humano que autorizou a conexão e suas permissões de executar integrações e
importar mídia. Suspensão ou perda de permissão interrompe a coleta. Conexões
pausadas ou sem essa opção não são coletadas automaticamente.

Falhas transitórias, limites da API e falhas internas preservam a coleta habilitada por até três falhas consecutivas desde o último sucesso. O worker tenta novamente após cinco minutos, respeitando um `Retry-After` maior informado pela Meta. Sucesso limpa o erro e restaura o intervalo normal de 15 minutos. Ao atingir o limite, a conexão é desabilitada e exige revalidação. Erros de autenticação, permissão, conta, configuração ou contrato interrompem imediatamente; uma pausa manual nunca é desfeita por uma tentativa com falha. Os erros e a decisão de tentar novamente ficam auditados, sem payloads nem credenciais.

Aquisição e Anúncios e funil atualizam a rota a cada 15 segundos enquanto a aba está visível e online, e ao recuperar foco/conexão. A atualização fica suspensa durante a importação manual. A tela mostra a última coleta realmente concluída (testar a credencial não altera essa data), o estado automático e falhas de sincronização. Atualizar a tela não dispara outra consulta à Graph API; os valores dependem da coleta periódica e do processamento de relatórios da Meta.

Marketing > Aquisição mostra os mesmos fatos de mídia de `/aquisicao/midia`,
com seleção de datas locais inclusivas e botão Hoje. Os leads reportados pela
Meta permanecem separados dos leads observados no CRM. As ferramentas
`consultar_meta_ads`, `consultar_aquisicao`, `consultar_leads_anuncios` e
`consultar_metricas_anuncios` expõem essas leituras pelo MCP existente,
preservando escopos e RBAC; elas não acionam coleta nem alteram o CRM.

O resumo mostra as entradas de Anúncios no período escolhido e seu funil de
agendamento, reunião realizada e compra. Respostas incompletas salvas de
formulários destinados a Anúncios também contam como recebidas. A interface
separa cadastros de respostas incompletas. A primeira resposta salva define
a chegada quando anterior ao cadastro; concluir o formulário substitui a
parcial sem duplicar a entrada nem mudar sua data para o dia da conclusão.
Visitas sem resposta e respostas excluídas não entram nessa contagem. A leitura
não cria cadastros, atividades ou conversões; etapas comerciais e valores
dependem dos registros efetivos. Outros pipelines, inclusive Prospecção Ativa,
ficam fora do resumo de Anúncios.
O funil geral por origem/campanha continua disponível separadamente. Custos
e volumes sem fatos coletados aparecem como “Sem dados”, sem assumir zero.

A credencial deve ter apenas leitura de anúncios e acesso explícito às contas
selecionadas. Se a identidade, a permissão ou a conta falhar, o estado muda para
`NEEDS_ATTENTION`; se não houver referência resolvível, permanece
`AWAITING_CREDENTIAL`.

Tokens de sistema podem ser emitidos sem expiração quando a Meta permitir.
Isso não impede revogação, suspensão do usuário de sistema ou perda de acesso
ao ativo. A rotação exige substituir o Secret no servidor, publicar o ambiente
atualizado e testar novamente a conexão; o valor nunca vai para o MCP.

## Sincronização e idempotência

`INITIAL` aceita `date: YYYY-MM-DD` para importar um dia entre `initialSince`
e hoje. A interface usa essa opção para manter o histórico em janelas pequenas.
Pela API, omitir `date` solicita toda a janela até hoje e pode exceder o tempo
de execução em contas grandes; prefira importar cada dia com correlação própria.
Importar um dia antigo não regride o watermark da coleta incremental.
`INCREMENTAL` relê a partir do último watermark menos `lookbackDays` (padrão 7)
para capturar ajustes tardios da plataforma. Cada execução possui correlação
única, janela, tentativas, contagens, erro classificado e auditoria.

A hierarquia importada corresponde aos IDs que tiveram insights na janela.
O conector consulta primeiro esses insights e depois os objetos por ID, usando
Graph Batch (a API v26 removeu o parâmetro de leitura múltipla `ids`); não
varre todo o catálogo histórico de campanhas da conta a cada sincronização.
Datas Graph com offset `-0300` são normalizadas para `-03:00` antes da validação.

O cursor só avança na mesma transação que persiste hierarquia, fatos, ações e
tentativa de sucesso. Falha de rede ou contrato mantém o cursor anterior. Repetir
a mesma correlação concluída não duplica efeitos. O grão do fato é:

```text
META_ADS | conta | campanha | conjunto | anúncio | data | moeda
```

Valor diferente cria nova revisão com `supersedesFactId`; valor idêntico é
ignorado. Conta, campanha, conjunto, anúncio e criativo usam IDs exatos em
`ExternalObjectMapping`, sem correspondência por nome.

## Métricas e ausência de dado

São coletados, quando retornados: investimento, impressões, alcance, cliques,
cliques em link, visualizações de landing, leads, compras e valor de compra.
O alcance dos fatos é por anúncio e dia. `totals.reach` soma esse grão e não
representa pessoas únicas na conta ou no período; não deve ser comparado ao
alcance deduplicado do Ads Manager. Essa definição acompanha a resposta MCP.
Dinheiro é convertido de string decimal para centavos com aritmética inteira.
Leads usam o agregado `lead`; somente quando ausente, somam os componentes
onsite/offsite. Compras e valor usam o primeiro agregado disponível entre
`purchase`, `omni_purchase` e pixel purchase. Agregado e componentes nunca são
somados entre si, pois representam conversões sobrepostas. As ações originais
permanecem preservadas para auditoria.

`availableMetrics` e `missingMetrics` distinguem explicitamente `0` reportado de
campo ausente. Ações conhecidas são marcadas `RECOGNIZED`; ações novas ou não
mapeadas são preservadas como `UNKNOWN` em registros relacionais, sem serem
silenciosamente transformadas em conversões. Isso permite revisar mudanças de
taxonomia da Meta sem perder evidência.

Dados da mídia alimentam `MarketingPerformanceFact`. Eles não criam touchpoint,
não vinculam pessoa e não atribuem receita automaticamente. Reconciliação com o
CRM continua dependendo de ponte relacional exata e é apresentada como
correlação, nunca causalidade.

## Falhas e operação

As classes são: autenticação, permissão, conta inacessível, rate limit,
transitória, permanente, payload inválido, configuração e erro interno. Rate
limit e falha transitória recebem até três tentativas com backoff e jitter;
`Retry-After` é respeitado até o limite de 300 segundos. Os demais erros não são
repetidos automaticamente.

Pausar a conexão impede novas coletas. Retomar exige teste real aprovado
anteriormente. Runs e erros ficam em `/integracoes/meta-ads`, enquanto os fatos
normalizados aparecem em `/aquisicao/midia`.

Paginação e rate limit têm testes controlados; a validação real não provoca
limites da plataforma. Ao conferir totais, compare a mesma janela, moeda,
fuso e horário de coleta: métricas do dia e ações atribuídas podem mudar.
