# 02 · Transformar venda ganha em fila operacional

## Dependências

Aceite da etapa 01 ou pendência factual isolada e bloqueada.

## Escopo e integração

Reusar `sale-completion-service.ts`, `/api/opportunities/close-sale`, `account-service.ts` e `/contas`. Exibir A confirmar, Aguardando primeiro recebimento e Clientes confirmados por venda qualificada. Preservar busca e vínculo genéricos.

## Contratos e permissões

Confirmar vendedor, modalidade, origem, valor após desconto, aceite efetivo com evidência e ativação real. Distinguir confirmação no CRM e data efetiva. Escopos OWN/TEAM/workspace e papel operacional no servidor.

O servidor de `/contas` chama `AccountService.list`. A busca genérica de `GET /api/accounts` chama o mesmo método. A fila deve ter leitura própria para que a qualificação comercial não limite busca e vínculo de contas em outros fluxos. Aplique escopo da venda antes de paginar e carregar dados sensíveis. Uma conta visível por outro lead não torna visível a venda de outro dono. Use a oportunidade como chave da fila e a conta como vínculo de navegação.

O caminho atual de fechamento pode registrar recebimento quando chamado por perfil com permissão financeira. O card Vendido deve continuar criando a oportunidade, conta, contrato e cronograma canônicos, com o recebimento como comando operacional separado. O aceite usado para D0 vem da revisão confirmada e não pode ser preenchido a partir da data prevista de início do contrato. Uma revisão enviada novamente com a mesma chave retorna o mesmo resultado. A mesma chave com conteúdo diferente produz conflito.

## Cenários e aceite

- [ ] Replay e concorrência sem duplicatas. Duas vendas na mesma conta permanecem distintas. Conta sem venda some apenas da fila. Confirmação sem baixa segue aguardando.

## Migração, reversão e verificação em produção

Usar schema da etapa 01. Validar navegação, fila e detalhe em leitura em produção.

## Progresso local

A leitura da fila foi ligada a `/contas`, com busca e filtro de situação. A consulta usa os escopos de contas, de oportunidades e de origem antes da paginação. Apenas vendas ganhas com conta vinculada são candidatas. A situação de cliente confirmado exige revisão comercial e baixa positiva, confirmada e sem reversão, fora do sandbox. O cadastro geral permanece em `/contas?view=empresas` e a API genérica de contas não mudou.

A suíte isolada de fechamento passou com 21 testes, incluindo conta sem venda, venda ganha, confirmação registrada pelo serviço, recebimento pelo serviço canônico, reversão simulada e negação de outro workspace. A confirmação pela interface ainda não é coberta. TypeScript e ESLint direcionado passaram.

O detalhe em `/contas/[accountId]/vendas/[opportunityId]` agora registra confirmação pela API autenticada, com auditoria, controle de revisão e idempotência. A lista de parcelas lê cobranças canônicas e só oferece detalhe de pagamento após checar sua permissão. A condição e o valor vêm da versão vigente do contrato. A confirmação pode corrigir vendedor autorizado, modalidade, origem, entrada informada, aceite e ativação. A etapa 03 acrescenta o reagendamento, a redistribuição de valores e a correção do total antes da primeira confirmação para contratos e recebíveis elegíveis. O endpoint do card Vendido rejeita baixa junto do fechamento e encaminha o operador ao detalhe da venda.

Build local de produção e cenário Chromium de venda nova pelo administrador passaram no PostgreSQL descartável. O navegador percorreu card Vendido, detalhe das parcelas, envio do formulário e volta à fila em Aguardando primeiro recebimento. O servidor registrou um stream encerrado antecipadamente durante o cenário, sem falhar as asserções. Os demais perfis e a suíte E2E completa ainda precisam ser exercitados.
