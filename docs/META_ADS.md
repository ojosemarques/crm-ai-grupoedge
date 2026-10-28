# Conector Meta Ads somente leitura — CRM-40

## Estado real

O conector possui testes locais e validação externa iniciada. Em 28/10/2026,
o teste da credencial existente identificou um nome de perfil ausente na
identidade de sistema; o contrato foi corrigido. A chamada seguinte recebeu
403 da Meta por falta de permissão de anúncios. Isso não comprova conexão nem
importação de métricas: uma credencial com `ads_read` ainda precisa ser
autorizada e validada no workspace e na conta escolhida.

O conector usa a Graph API `v26.0` por padrão e aceita apenas as versões
explicitamente allowlisted `v25.0` e `v26.0`. A versão deve ser revista antes do
sunset publicado pela Meta. As referências consultadas na implementação foram a
[coleção oficial da Marketing API no Postman](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
e o [Meta Business SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk).
Foi escolhido `fetch` server-side em vez do SDK para manter uma superfície
menor e impor allowlist de host/rotas, limite de resposta, timeout e paginação
sem URL arbitrária.

## Limite e segurança

- somente `GET` para `https://graph.facebook.com`;
- rotas internas allowlisted: identidade, contas de anúncios, campanhas,
  conjuntos, anúncios e insights;
- token e app secret são resolvidos apenas no servidor a partir de referências
  fixas; o banco guarda alias, nome da variável, versão e presença, nunca valor;
- `appsecret_proof` é calculado em memória quando o app secret existe;
- respostas têm limite de 2 MiB e timeout configurável entre 1 e 30 segundos;
- redirects externos, URL fornecida pelo usuário e paginação por `paging.next`
  são rejeitados; a próxima página é reconstruída com o cursor `after`;
- payload bruto não é persistido; evidência guarda somente IDs externos,
  versão, cobertura de métricas e ID da execução;
- logs, respostas, auditoria e tentativas não incluem token ou app secret;
- a interface nunca recebe campo para colar credencial.

Para relatórios, prefira `META_ADS_REPORTING_ACCESS_TOKEN`, separado do
`META_ADS_ACCESS_TOKEN` usado pela Conversions API. A credencial de relatórios
exige `META_ADS_REPORTING_WORKSPACE_ID` com o UUID exato do workspace; o serviço
recusa configuração e uso em outro workspace. Os valores ficam somente como
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
4. salve a versão da API e a janela inicial;
5. execute **Testar conexão**;
6. selecione explicitamente as contas retornadas;
7. salve a nova versão da configuração;
8. execute a sincronização inicial;
9. use a incremental nas execuções seguintes.

O campo Business Manager aceita o ID do portfólio escolhido. A descoberta
filtra as contas pelo `business.id` informado pela Meta, e a coleta verifica
novamente essa propriedade antes de ler campanhas e métricas. Uma conta que
mudou de BM é recusada.

Ative **Atualizar métricas automaticamente a cada 15 minutos** e salve/teste a
conexão para optar pela coleta periódica. O worker existente revalida o membro
humano que autorizou a conexão e suas permissões de executar integrações e
importar mídia. Suspensão ou perda de permissão interrompe a coleta. Conexões
pausadas ou sem essa opção não são coletadas automaticamente.

Marketing > Aquisição mostra os mesmos fatos de mídia de `/aquisicao/midia`,
com seleção de datas locais inclusivas e botão Hoje. Os leads reportados pela
Meta permanecem separados dos leads observados no CRM. As ferramentas
`consultar_meta_ads`, `consultar_aquisicao`, `consultar_leads_anuncios` e
`consultar_metricas_anuncios` expõem essas leituras pelo MCP existente,
preservando escopos e RBAC; elas não acionam coleta nem alteram o CRM.

A credencial deve ter apenas leitura de anúncios e acesso explícito às contas
selecionadas. Se a identidade, a permissão ou a conta falhar, o estado muda para
`NEEDS_ATTENTION`; se não houver referência resolvível, permanece
`AWAITING_CREDENTIAL`.

## Sincronização e idempotência

`INITIAL` lê de `initialSince` até a data corrente de São Paulo.
`INCREMENTAL` relê a partir do último watermark menos `lookbackDays` (padrão 7)
para capturar ajustes tardios da plataforma. Cada execução possui correlação
única, janela, tentativas, contagens, erro classificado e auditoria.

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
Dinheiro é convertido de string decimal para centavos com aritmética inteira.

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

## Pendente para validação externa

- token real com escopo mínimo e conta de teste/sandbox acessível;
- confirmação dos IDs de conta permitidos;
- teste de paginação e rate limit contra a API real;
- reconciliação de uma amostra real com o Ads Manager;
- política operacional de rotação/revogação de credencial;
- evidência de que a versão da API continua suportada no momento da conexão.

Até esses itens ocorrerem, não usar `CONNECTED`, `SANDBOX` ou “validado na Meta”
em relatórios de aceite.
