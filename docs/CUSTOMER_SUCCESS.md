# Customer Success — CRM-52

## Limite do domínio

A CRM-52 começa após o onboarding e mantém três fatos distintos: atribuição da
carteira, execução do plano de sucesso e avaliação de saúde. Ela não implementa
help desk, CSAT/NPS, renovação, expansão, churn, provider externo ou IA.

## Carteira e próxima ação

Cada conta tem no máximo uma atribuição corrente. O responsável operacional é
exatamente um membro ou uma fila; conta ativa exige descrição e prazo da próxima
ação. Reatribuir encerra a linha anterior, cria outra linha e preserva evento e
auditoria. `priority` usa 1, 2 ou 3 e não substitui o score do lead.

A escrita usa transação serializável, lock consultivo por workspace/conta,
índice parcial de atribuição corrente e retry limitado. Chaves idempotentes
impedem efeito repetido.

## Plano de sucesso

O seed publica `Plano de resultado inicial` v1, com objetivo e três marcos
ordenados: objetivo confirmado, adoção observada e resultado documentado. Cada
plano copia um snapshot da versão; editar versões futuras não reescreve planos
históricos. Marcos dependentes só concluem após o anterior e exigem evidência.

Estados: `DRAFT`, `ACTIVE`, `BLOCKED`, `COMPLETED` e `CANCELLED`. Bloqueio pede
motivo; conclusão exige todos os marcos obrigatórios. Transições inválidas ou
revisões concorrentes são rejeitadas de forma compreensível.

## Saúde versionada e explicável

A versão publicada v1 usa sinais tipados: onboarding concluído, plano ativo,
próxima ação no prazo, ausência de bloqueio e assinatura ativa. Cada sinal possui
peso, direção, obrigatoriedade e janela de atualidade.

Fórmula: média ponderada dos sinais atuais, normalizada entre 0 e 100. Um sinal
negativo tem sua contribuição invertida. Faixas v1: saudável a partir de 75,
atenção de 45 a 74 e risco abaixo de 45.

Se qualquer sinal obrigatório estiver ausente ou vencido, o resultado é
`INSUFFICIENT` e `score = null`. Ausência nunca vira zero silenciosamente. Cada
avaliação grava versão, corte, fórmula, explicação e evidências; uma nova
avaliação aponta para a anterior sem modificá-la. Assessment, evidence e eventos
são append-only no banco.

O seed demonstrativo contém quatro cenários fictícios claramente marcados:
saudável, atenção, risco e dados insuficientes. Esses snapshots servem para a
demonstração visual; avaliações novas usam somente coletores determinísticos de
registros locais.

## Permissões

- `customer_success.read`: carteira autorizada;
- `customer_success.portfolio.manage`: atribuir ou reatribuir;
- `customer_success.plan.manage`: criar e conduzir plano;
- `customer_success.evidence.record`: registrar evidência;
- `customer_success.health.evaluate`: recalcular saúde;
- `customer_success.correct`: backfill e correção governada.

Administrador atua no workspace; gestor no escopo de equipe; closer nos próprios
clientes; visualizador somente lê. API e serviço repetem a autorização.

## Backfill

`pnpm db:customer-success:backfill` executa dry-run por padrão. `--execute`
habilita escrita e `--run-key=<chave>` controla replay. Só onboarding `ACTIVATED`
ou `COMPLETED`, com conta, exatamente um responsável/fila e próxima ação
persistida, pode originar atribuição. Ausência vira `REVIEW_REQUIRED`; nenhum
responsável ou prazo é inventado. O CLI recusa host, banco ou schema não local.

## Métricas e drilldown

A tela `/customer-success` calcula da base: carteira ativa, saudável, atenção,
risco, dados insuficientes e próxima ação vencida. Filtros de responsável,
equipe, estado e saúde usam o mesmo serviço e preservam o escopo de permissão.
Cada item apresenta o registro que forma o indicador; nenhuma contagem é
decorativa. Datas são retornadas com o corte e exibidas em
`America/Sao_Paulo`.
