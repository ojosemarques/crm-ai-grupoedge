# 04 · Apurar NEW ACV, variável e calendário dos closers

## Dependências

Aceite da etapa 03 ou pendência factual isolada e bloqueada.

## Escopo e integração

Compartilhar cálculo entre fechamento, pagamento, worker e leituras. Auditar todos os chamadores de `reconcileCommissionsInTransaction` para excluir dupla geração. Separar projeção, obrigação e pagamento.

Pontos de integração confirmados no checkout: ganho em `opportunity-service.ts`, recebimento manual em `payment-service.ts`, evento do provedor em `payment-worker-service.ts` e dois comandos de reconciliação em `finance-service.ts`. A exclusão de vendas cobertas pela política nova precisa ocorrer na função compartilhada de reconciliação legada para valer em todos os chamadores. O cálculo novo deve usar a versão vigente da confirmação, os pagamentos e reversões canônicos, a política aplicável e o plano OTE na competência de D0. O fallback histórico de caixa bruto, usado para exibição financeira, não é prova de caixa líquido para elegibilidade.

## Contratos e permissões

D0 é o maior entre aceite, ativação e primeira liquidação. Novo anual compõe ACV após desconto. Parcelado cruza faixas de 6/8/10% nos limites 100/125%. Antecipado integral 8% do líquido, projeto 5%, expansão incremental 5%, renovação negociada 2%, automática e low-ticket 0%. Prospecção própria comprovada acrescenta 1 p.p. quando comissionável. Rampa comprovada sem meta/bônus/aceleração. Bônus a 100% no ciclo seguinte.

## Cenários e aceite

- [ ] Testar três faixas, mês de D0 diferente de fechamento, dados ausentes, corte, rampa, 25% e 1/3 exatos, feriado, saldo, replay e reversão. Calendário de modalidades sem regra documentada permanece em revisão.
- [ ] Com meta sintética de R$ 60.000 e acumulado de R$ 55.000, o próximo contrato de R$ 25.000 distribui R$ 5.000, R$ 15.000 e R$ 5.000 pelas três faixas. Gera R$ 2.000 antes do adicional de origem.
- [ ] Com ACV sintético de R$ 30.000, entrada líquida de R$ 7.500 em D+30 qualifica o marco D+90. Um centavo abaixo ou crédito em D+31 seleciona D+120. O caixa mínimo é R$ 10.000. Com R$ 600 já pagos sobre uma comissão total de R$ 1.800, o saldo máximo é R$ 1.200.
- [ ] Recebível de cartão não compõe caixa. Cobrança vencida com saldo bloqueia a liberação. Recebimento tardio após a quitação integral não cria obrigação adicional.

## Migração, reversão e verificação em produção

Manter legado segregado. Desativar writer em caso de divergência preservando baixas e aberturas auditadas.

## Progresso local

O cálculo de domínio cobre D0, faixas de parcelado, taxa padrão durante rampa comprovada, adicional por origem própria, modalidades de taxa fixa, limites de entrada e caixa em centavos, saldo liberável e quinto dia útil conforme a lista de feriados recebida. A projeção mensal separa ACV realizado e pendente, usa o fuso do workspace e inclui o anual antecipado na ordenação das vendas que formam o acumulado. Onze testes unitários passaram.

A conciliação escolhe a vigência pela conclusão comercial no fuso do workspace e o plano OTE pelo mês local de D0. Usa confirmação vigente, contrato, recebimentos efetivos, valor líquido explícito e estornos. A conciliação legada exclui o recorte da política ativa. Venda com comissão legada preexistente fica fora da geração de novo título até conciliação. A obrigação de venda é única por oportunidade. O bônus é uma linha mensal própria após o corte e somente quando a meta é atingida fora da rampa. Mudanças que invalidam uma base registrada entram em revisão com idempotência e preservação do valor original quando há baixa.

O fechamento, a confirmação comercial, o recebimento manual, o worker e os comandos de conciliação chamam o reconciliador compartilhado. A data de gravação do recebimento e a data efetiva são mantidas separadas para reprocessar evidência retroativa. O calendário por versão registra fonte, feriados e fim da cobertura. Sem cobertura até o vencimento, o título fica pendente. Com cobertura e critérios confirmados, a conciliação separa marco, dia de elegibilidade e quinto dia útil de vencimento. Evidência mensal registrada após o corte exige revisão. Se o sistema não observou os critérios no marco, agenda a primeira data útil após observar a regularização. O worker existente reavalia uma vez por dia local por workspace, com lock e trilha.

Para homologar o calendário operacional, confronte a [Portaria federal de 2026](https://legis.sigepe.gov.br/sigepe-bgp-ws-legis/legis-service/download/?id=0026440285-ALPDF%2F2025), o [decreto municipal de São Paulo de 2026](https://legislacao.prefeitura.sp.gov.br/decreto-64862-de-22-de-dezembro-de-2025) e a [norma do Banco Central sobre dias úteis financeiros](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=4880&tipo=RESOLU%C3%87%C3%83O+CMN). A abrangência da operação e a cobertura além de 2026 ainda precisam ser confirmadas. Permanecem a revalidação antes da baixa e a apresentação dos bloqueios no Financeiro e no Meu OTE.

Em PostgreSQL descartável, passaram 23 testes de fechamento e 19 testes de Financeiro e pagamentos em schemas separados. O cenário novo verificou vigência, recebimento retroativo, ausência de título legado, repetição sem mudar a revisão, bônus após o corte e revisão dos dois títulos após estorno. A execução conjunta das três suítes compartilhou fixtures de vendas e Financeiro e produziu conflitos de dados. A validação final isolou esses grupos.

A cadeia de 128 migrations e os 23 testes de fechamento passaram com o calendário versionado. Dois workers concorrentes produziram uma única execução no dia, o bônus passou de pendente para elegível com feriado sintético e a conciliação reteve os títulos quando a cobertura estava ausente.
