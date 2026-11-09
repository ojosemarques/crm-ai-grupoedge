# 08 · Conferir o legado e ativar apenas fatos verificados

## Dependências

Aceite da etapa 07 ou pendência factual isolada e bloqueada.

## Escopo e integração

Consultar recorte real em leitura, reconciliar vínculo das duas oportunidades, parcelas, entrada, datas e eventual despesa. Manifesto restrito, importador idempotente, prévia antes de escrita.

## Contratos e permissões

Legado a 6% em três etapas 35/30/35 com datas individuais úteis. Informação de pagamento sem alocação fica em conciliação e bloqueia etapa potencialmente quitada. Não inferir liquidação do bruto, líquido, comissão gerada ou calendário.

## Cenários e aceite

- [ ] Reexecutar prévia e aplicação sem duplicatas. Confirmar lista real e condições desconhecidas bloqueadas. Comprovante, valor e alocação ausentes ficam explicitados.

## Migração, reversão e verificação em produção

Confirmar backup, SHA, migração e saúde antes de ativar. Reverter por ajuste auditado e desativação do writer.

## Evidência localizada

O demonstrativo individual confirma as etapas previstas e a regra de D0 individual. O recorte autorizado em produção foi consultado em leitura e encontrou as duas vendas e os contratos vinculados, com 21 cobranças. No recorte consultado, não apareceram recebimentos canônicos confirmados, baixas de comissão nem despesa liquidada candidata pelos filtros aplicados. Para concluir a baixa informada, ainda são necessários o registro financeiro da transferência, o valor efetivo e a discriminação das etapas quitadas. Para confirmar D0 e parcelas remanescentes, faltam as datas efetivas de liquidação do cartão, a confirmação de ativação e os vencimentos que o demonstrativo omite. Manter esses dados no manifesto restrito.

## Progresso local

O comando `pnpm exec tsx scripts/preview-legacy-compensation.ts --manifest=<arquivo-restrito>` confere workspace, venda, vendedor, contrato aceito, versão, cobranças e fatos efetivos. A saída contém somente contagens e a impressão digital da prévia. No banco remoto exige `--allow-production` e manifesto privado. A prévia não cria títulos, registros de caixa ou baixas. A projeção calcula 35/30/35, ajusta dias não úteis com calendário comprovado e isola etapas possivelmente pagas.

O mesmo comando aplica a prévia com `--apply --actor=<ator-administrador> --fingerprint=<impressão-digital>` após a política estar configurada. A transação impede coexistência com títulos antigos da venda, grava uma chave por etapa, confere o saldo da despesa existente e rejeita uma prévia alterada. Reenvio da aplicação não cria duplicatas. Etapas com saldo permanecem em revisão até validação da liberação histórica.

Dois testes unitários e 24 testes de fechamento passaram. A integração confirmou a impressão digital, o vínculo único de uma despesa sintética já liquidada e a ausência de baixa para as etapas com pagamento apenas informado. A prévia pelo manifesto real e a ativação em produção seguem pendentes.

Em leitura da produção, as duas vendas têm contrato aceito e versão vigente. Os valores batem entre pipeline, versão contratual, cobranças e demonstrativo. A discriminação das entradas e a composição das 21 cobranças também conferem. Em uma das vendas, o apelido do demonstrativo não aparece no cadastro, no lead, no contato ou na atividade consultada. A associação continua em revisão, assim como a liquidação informada. Nenhum dos dois casos tinha comissão no writer anterior.

Após a atualização do schema, a prévia oficial executou em produção para a venda cujo vínculo foi comprovado. Retornou uma venda, dez cobranças, D0 pendente, uma informação de pagamento e três etapas para revisão. A prévia não criou registros. O segundo vínculo, a comprovação bancária e a ativação continuam pendentes.

O responsável pelo CRM confirmou a identidade da segunda venda e o início da rampa do closer júnior em novembro de 2026. O vínculo foi conferido no CRM pelo cadastro associado, vendedor, valor e contrato aceito. A prévia atualizada do manifesto restrito retornou duas vendas, 21 cobranças, D0 pendente nas duas e seis etapas em revisão. Valor e alocação da baixa de 06/11 continuam sem comprovante. A praça e o calendário operacional ainda precisam ser confirmados antes da liberação.

A aplicação aceita uma nova prévia com evidência posterior para títulos históricos previamente importados. Confere as alocações existentes, rejeita remoção ou alteração de uma baixa e preserva títulos liquidados. A integração em PostgreSQL descartável validou importação em revisão, vinculação posterior da despesa comprovada, reenvio concorrente e rejeição de manifesto que omite uma baixa. Meu OTE lê os mesmos títulos históricos na competência anterior à vigência e soma o valor gerado separadamente do pago. A integração confirmou rampa sem meta ou bônus, pagamento na competência efetiva e isolamento por titular.

A prévia atualizada incluiu o calendário comum confirmado. As duas vendas continuaram com D0 pendente e as seis etapas em revisão. O responsável informou que apresentará o comprovante de 06/11 depois. A revisão preserva a informação do pagamento sem vincular despesa ou registrar valor pago antes de receber valor e alocação comprovados.

A política foi ativada em produção no release `284db0c`. A aplicação criou seis etapas em revisão para duas vendas. O replay criou zero títulos e zero alocações. A conferência posterior encontrou ativação registrada nos dois contratos, 21 cobranças sem pagamentos registrados e nenhuma despesa liquidada em 06/11 no workspace. Para o D0 falta comprovar a primeira liquidação de cada contrato. Para a baixa histórica faltam o comprovante, o valor efetivo e as etapas quitadas. A tela de Comissões de outubro, com sessão administrativa, exibiu os seis avisos de pagamento informado.
