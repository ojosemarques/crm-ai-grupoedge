# 06 · Entregar leitura e baixa auditada do passivo

## Dependências

Aceite da etapa 05 ou pendência factual isolada e bloqueada.

## Escopo e integração

Ampliar `finance-workspace.tsx`, `/api/finance` e `finance-service.ts`. Filtrar vendedor, período, estado, tipo, cliente e venda. Exibir fontes, D0, marco, base, taxa, valores, vencimento e saldo.

## Contratos e permissões

Geradas por competência, A pagar por vencimento, Pagas por baixa real e Pendentes por motivo. Baixa autorizada revalida elegibilidade, registra conta/data/referência e vincula despesa existente quando conciliada. Aprovação e baixa são permissões distintas.

## Cenários e aceite

- [ ] Agregados batem em centavos com linhas e recortes. Baixas concorrentes vinculam só uma despesa. Estorno pós-baixa abre uma revisão. Caixa e DRE preservam resultados fora do escopo.

## Migração, reversão e verificação em produção

Reusar transação canônica. Reverter UI/writer sem excluir despesa ou baixa.

## Progresso local

A aba Comissões apresenta os títulos da política vigente e preserva a leitura de regras anteriores. Há filtros por vendedor, cliente, venda, tipo e estado. Os totais separam competência de geração, vencimento, data efetiva da baixa e saldo pendente. A API de Financeiro aplica os mesmos filtros aos títulos e exige permissão de comissões antes de entregar valores, fatos ou evidências.

A aprovação exige permissão de comissões. A baixa exige também gestão financeira. A operação reavalia o título antes de aceitar o comando. Um bloqueio detectado pela reavaliação permanece registrado após a rejeição da baixa. A despesa liquidada pode ser vinculada após conferir conta, data, moeda e saldo disponível. Quando o operador registra uma despesa nova, a referência identifica a transferência na conta. O comando registra baixas parciais, preserva evidência e impede que repetição ou concorrência dupliquem despesa ou alocação.

As integrações locais verificaram aprovação, acesso negado, baixa parcial de despesa existente, reenvio concorrente, conflito de chave, baixa do saldo exato, estorno pós-baixa e correção de Anúncios detectada antes da baixa. Etapas históricas ainda exigem o fluxo específico de conciliação da etapa 08.

Em PostgreSQL descartável, passaram 24 testes de fechamento e Anúncios na execução final e cinco testes de Financeiro na execução isolada. O build e o cenário Chromium passaram para consulta, filtro, saldo e abertura do formulário de baixa com referência e evidência obrigatórias.
