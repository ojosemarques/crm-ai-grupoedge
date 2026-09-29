# Forecast humano e snapshots reproduzíveis

## Escopo e fonte oficial

A CRM-56 adiciona um forecast comercial local sobre oportunidades persistidas.
`ForecastCycle` define período, timezone, moeda e escopo; `ForecastSubmission`
registra uma leitura humana versionada; `ForecastSnapshot` congela a composição
exata de um corte. A página `/forecast`, a API e o comando de backfill chamam os
serviços de aplicação e nunca consultam o banco diretamente pela interface.

Forecast não altera `Opportunity`, não cria venda e não substitui meta. Meta é
alvo publicado; realizado é fato ganho; forecast é uma leitura humana do que
pode fechar dentro do ciclo.

## Categorias e ausência de dupla contagem

Cada oportunidade elegível recebe exatamente um bucket no snapshot:

- `PIPELINE`: oportunidade elegível ainda não promovida;
- `BEST_CASE`: possibilidade humana relevante, ainda sem compromisso;
- `COMMIT`: compromisso humano de fechamento no período.

Os totais são cumulativos sem duplicar oportunidades:

```text
pipeline = PIPELINE + BEST_CASE + COMMIT
best case = BEST_CASE + COMMIT
commit = COMMIT
```

O valor declarado pelo usuário é preservado na submissão. O valor consolidado é
recalculado pelos itens congelados do snapshot. Divergência permanece visível;
ela não é corrigida silenciosamente.

## Elegibilidade

Uma oportunidade entra no universo somente quando, no corte:

- está aberta;
- possui valor positivo em centavos;
- usa a moeda do ciclo (`BRL` no ambiente demonstrativo);
- possui data prevista de fechamento dentro do intervalo semiaberto do ciclo;
- pertence ao membro/equipe/função autorizados.

Ganha, perdida, cancelada, sem valor, sem data, fora do período, fora do escopo
ou em outra moeda permanece no detalhe com motivo explícito e não compõe os
totais. Ausência não é convertida em zero nem em categoria negativa.

## Período civil, corte e moeda

O ciclo congela `periodStart`, `periodEnd` e `timeZone`. Datas civis da interface
são representadas como intervalo `[início, próximo dia após o fim)` no timezone
do workspace. O corte `asOf` precisa pertencer ao ciclo. Valores monetários são
inteiros em centavos e a moeda faz parte de submissões, snapshots e itens.

## Submissões e override

SDR/closer submetem somente seu próprio recorte. Uma revisão cria nova linha,
aponta para `supersedesSubmissionId` e exige motivo; registros anteriores são
append-only. O gestor pode registrar um `MANAGER_OVERRIDE` de commit da equipe,
com comentário obrigatório. Esse valor fica separado de
`bottomUpCommitCents`: o override nunca apaga nem reclassifica a composição
bottom-up.

O visualizador pode consultar o agregado autorizado, mas não mutar. Um papel com
escopo `OWN` não recebe snapshots agregados da equipe; vê apenas oportunidades e
submissões próprias.

## Snapshot e reprodução

Ao publicar um corte, o serviço grava:

- período, timezone, moeda, escopo e filtros;
- realizado e meta aplicável naquele corte;
- pipeline, best case, commit e bottom-up;
- override gerencial separado;
- estado e percentual de cobertura de probabilidade;
- IDs das submissões-fonte;
- uma cópia exata dos campos relevantes de cada oportunidade;
- fingerprint SHA-256 canônico.

Snapshots e itens são imutáveis por trigger. Mudanças posteriores em valor,
responsável, etapa, data ou status da oportunidade não alteram um corte antigo.
Transações `Serializable`, advisory lock, retry limitado e chave idempotente
protegem submissões e publicação concorrentes.

## Weighted pipeline e cobertura

Weighted pipeline só é calculado quando 100% das oportunidades elegíveis têm
probabilidade manual válida, ator e timestamp. A fórmula é:

```text
weighted pipeline = soma(valor em centavos × probabilidade em bps / 10.000)
```

Sem cobertura total, o valor é `null`. `COMPLETE`, `PARTIAL` e `NOT_AVAILABLE`
são estados distintos; uma cobertura incompleta não produz precisão fictícia.

## Comparação e drilldown

Dois snapshots só podem ser comparados quando ciclo, escopo, moeda e timezone
coincidem. A comparação explica entrada no pipeline, avanço/recuo de categoria,
aumento/redução de valor, mudança de data, ganho, perda, remoção por regra e
troca de responsável. Cada grupo mantém IDs de oportunidades e link para o
drilldown. Percentual de variação fica ausente quando o denominador é zero.

## Seed e backfill

O seed demonstra dois cortes e três submissões com oportunidades fictícias já
existentes. É idempotente e não apaga registros manuais.

O backfill inicia em dry-run:

```bash
pnpm db:forecast:backfill -- --run-key=crm56:dry-run:manual
pnpm db:forecast:backfill -- --execute --run-key=crm56:execute:manual
```

O comando recusa banco remoto, outro banco e schema diferente de `public`.
Sinais legados sem corte, composição e evidência reproduzíveis viram apenas
`REVIEW_REQUIRED`. O processo nunca fabrica ciclo, submissão, categoria,
probabilidade ou snapshot histórico.

## Limitações

- não há previsão estatística ou IA preditiva;
- não há calendário de dias úteis, pace ou remuneração variável;
- acurácia e slippage serão métricas posteriores, calculadas sobre snapshots;
- não há provider, credencial, egress, banco remoto ou deploy;
- a CRM-57 e posteriores não fazem parte desta entrega.
