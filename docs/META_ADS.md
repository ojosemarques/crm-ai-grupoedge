# Conector Meta Ads somente leitura — CRM-40

## Estado real

O conector está implementado e validado localmente com fixtures determinísticas.
Por decisão explícita, a validação externa foi adiada: nenhuma chamada externa,
conta real ou dado da Meta foi validado. O checkpoint correto é
`CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA`; as pendências
externas permanecem registradas em [`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md).

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
