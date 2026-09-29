# Conector Google Ads somente leitura — CRM-41

## Estado e limite de validação

O conector `google-ads-read-v1` está implementado e validado localmente com
fixtures determinísticas e injeção controlada de falhas. A decisão desta task é
adiar a validação externa: nenhuma credencial foi solicitada, nenhum customer
real foi consultado e não houve egress. O estado de aceite é
`CONCLUÍDA E VALIDADA LOCALMENTE — VALIDAÇÃO EXTERNA ADIADA`.

A implementação usa Google Ads API `v25` por padrão, com `v24` e `v25` em
allowlist explícita. Antes de qualquer teste externo futuro, a versão deve ser
reconciliada com as [sunset dates oficiais](https://developers.google.com/google-ads/api/docs/sunset-dates).

## Segurança e autenticação

O servidor aceita duas estratégias referenciadas, nunca valores vindos da UI:

- OAuth com client ID, client secret e refresh token;
- service account com e-mail e chave privada PKCS#8.

Os valores ficam somente no ambiente server-side. O banco persiste alias,
nome fixo da variável e indicador de presença. `developer-token` existe apenas
como compatibilidade temporária: a [política oficial](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
informa que o token deixou de ser exigido em 9 de setembro de 2026 e que o
nível de acesso passou ao projeto Google Cloud proprietário da credencial.

O transporte aceita somente:

- `POST https://oauth2.googleapis.com/token`;
- `GET /v24|v25/customers:listAccessibleCustomers`;
- `POST /v24|v25/customers/{10 dígitos}/googleAds:search`.

O método Search usa GAQL somente de templates internos versionados; não existe
consulta livre nem rota Mutate. Há timeout, limite de resposta de 2 MiB,
paginação por token, detecção de loop, até três tentativas para rate limit ou
falha transitória, backoff com jitter e `Retry-After`. Request IDs seguros são
registrados para diagnóstico sem segredos.

## Descoberta e hierarquia

`ListAccessibleCustomers` retorna somente as contas diretamente acessíveis.
Quando existe uma conta administradora, `login-customer-id` é enviado sem
hífens e a hierarquia é consultada por `customer_client`, conforme a
[estrutura oficial de chamadas](https://developers.google.com/google-ads/api/docs/concepts/call-structure)
e o [procedimento de listagem de contas](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts).

Cada relação pai/filho é persistida em `IntegrationExternalAccountLink` com
nível, tipo de relação, indicador de manager, status e timestamps de descoberta.
Conta, campanha, grupo, anúncio e cada ativo recebem `ExternalObjectMapping` por
ID exato. Nome semelhante nunca cria vínculo.

## Coleta, métricas e idempotência

São coletados fatos diários de anúncio e ativos associados. Os templates GAQL
preservam, quando presentes: custo em micros, impressões, cliques, interações,
conversões, valor de conversões, todas as conversões, respectivos valores, CTR,
CPC médio e CPM médio. Custo em centavos deriva de micros com aritmética inteira.

Métricas reportadas pelo Google ficam em colunas `provider*`. Elas não são
convertidas em leads, compras ou receita do CRM. `reportedLeads`,
`reportedPurchases` e `reportedRevenueCents` permanecem zero e explicitamente
marcados como ausentes. Isso separa conversão configurada na plataforma de um
fato comercial observado no CRM.

O grão é:

```text
GOOGLE_ADS | customer | campanha | grupo | anúncio | data | moeda
```

Uma coleta idêntica é ignorada; uma mudança cria nova revisão append-only com
`supersedesFactId`. O cursor avança somente na mesma transação dos fatos,
mappings, ativos, tentativa e auditoria. Falha preserva o cursor e não deixa
hierarquia ou fatos parciais. Backfill exige prévia, confirmação literal e
janela máxima de 90 dias.

## Operação futura autorizada

1. escolher a estratégia e conceder acesso mínimo somente leitura;
2. configurar as referências no ambiente server-side não versionado;
3. confirmar o projeto Google Cloud e os customers de teste permitidos;
4. executar `Testar conexão` em `/integracoes/google-ads`;
5. selecionar explicitamente os customers descobertos;
6. executar sync inicial e reconciliar amostra com a interface Google Ads;
7. validar paginação, quotas, erro, revogação e rotação antes de homologação.

Até isso ocorrer, a UI deve mostrar “Validação externa adiada”. Não usar
`CONNECTED`, “sandbox validado” ou “dados reais reconciliados” em relatórios.

## Não implementado

- criação ou edição de campanhas, anúncios, budgets, conversões ou públicos;
- Customer Match, Enhanced Conversions ou upload de conversão offline;
- atribuição automática de pessoas ou receita;
- armazenamento de payload bruto ou segredo;
- schedule externo, deploy, banco remoto ou qualquer integração além de leitura.
