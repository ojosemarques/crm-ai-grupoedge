# Canais locais de entrada de leads

## Fronteira única

Cadastro manual, CSV, webhook local e simulador são adaptadores da mesma
operação: `LeadIntakeService.intake`. Nenhum canal escreve diretamente em
`Lead`, escolhe SDR, cria tarefa ou inicia SLA por conta própria.

O contexto de workspace e ator vem da sessão validada no servidor. Todos os
canais exigem `leads.write` no escopo da Fila Geral da equipe. Visualizadores,
closers e usuários fora do escopo recebem uma negativa segura; ocultar a tela
não é usado como autorização.

Uma entrada aceita aplica, na transação do serviço único:

1. validação e normalização conservadora do telefone;
2. criação da submissão com payload original;
3. criação ou anexação não destrutiva da identidade;
4. round-robin ou atribuição explícita à Fila Geral;
5. ciclo `SLA imediato — 0 minutos` e tarefa `Ligar agora`;
6. timeline, revisão de duplicidade, notificações e auditoria.

## Interface e rotas

A tela protegida está em `/leads/entrada`. As opções de origem, campanha,
criativo, faixas de prioridade, timezone e SLA são lidas do PostgreSQL e entregues pelo
serviço de consulta; não são números decorativos.

Desde a CRM-13, o campo P1/P2/P3 recebido pelos canais é fallback. Uma regra de
scoring ativa calcula a faixa efetiva pelos dados do formulário e persiste a
explicação no mesmo commit da entrada.

| Operação | Rota | Proteções |
|---|---|---|
| Opções persistidas | `GET /api/leads/entry-options` | Sessão + `leads.write` |
| Cadastro manual | `POST /api/leads/manual` | Sessão, mesma origem + `leads.write` |
| Preview CSV | `POST /api/leads/imports/preview` | Sessão, mesma origem + `leads.write` |
| Confirmar CSV | `POST /api/leads/imports` | Sessão, mesma origem + `leads.write` |
| Relatório CSV | `GET /api/leads/imports/:jobId/errors` | Sessão + workspace + `leads.write` |
| Webhook simulado | `POST /api/local/webhooks/leads` | Host local, fora de produção, sessão, mesma origem + `leads.write` |
| Gerador controlado | `POST /api/leads/simulator` | Host local, fora de produção, sessão, mesma origem + `leads.write` |

## Cadastro manual

O navegador gera uma chave idempotente por tentativa lógica. Erros de validação
mantêm os campos preenchidos. O orçamento é informado em reais (`6500,00`) e
convertido para centavos no servidor. A resposta discrimina `CREATED`,
`ATTACHED` ou `REJECTED` e inclui normalização, responsável operacional, ciclo
de SLA e tarefa criados.

## CSV

O upload é lido no navegador e enviado como texto ao servidor. O preview é
recalculado no servidor, valida estrutura, mapeamento, campos, telefone e
referências persistidas e classifica cada linha como:

- `VALID`: pode ser processada como nova identidade;
- `DUPLICATE`: telefone já conhecido no workspace ou repetido no arquivo;
- `INVALID`: não será enviado ao serviço de entrada.

A confirmação cria um `ImportJob`, atualiza contadores durante o processamento
e persiste o relatório de cada linha em `resultMetadata`. Linhas inválidas são
explicitamente contabilizadas; um arquivo parcial termina como
`PARTIALLY_SUCCEEDED`. O relatório de erros é gerado apenas a partir do job do
workspace autenticado.

A chave de cada linha deriva do SHA-256 do conteúdo, mapeamento, padrões e número
da linha. Reexecutar exatamente a mesma importação cria um novo registro de job
para rastreabilidade, mas o serviço único devolve o efeito anterior e não cria
outro lead ou submissão. Uma falha inesperada marca o job como `FAILED`; linhas
já concluídas podem ser reexecutadas com segurança.

Sem o worker da CRM-21, o processamento ocorre na própria requisição. Para não
bloquear indefinidamente a aplicação local, o limite atual é 2 MiB e 2.000
linhas. Processamento assíncrono não foi antecipado.

## Webhook local

O endpoint aceita somente o evento `lead.received`, persiste `WebhookEvent` e o
payload bruto e usa `eventId` como chave idempotente. Repetir o mesmo evento
retorna o resultado persistido sem duplicar efeito. Reutilizar a chave com outro
payload retorna conflito HTTP 409.

Esse endpoint não é uma integração real: ele exige sessão humana, requisição de
mesma origem, hostname loopback e deixa de existir logicamente em
`NODE_ENV=production` (HTTP 404). Assinatura pública, segredo de webhook e
provedores externos continuam fora do escopo.

## Simulador controlado

O simulador gera apenas dados explicitamente fictícios nos cenários P1, P2, P3
e duplicado. A semente torna telefone, idempotência e repetição previsíveis; o
limite é 20 cenários por execução. O cenário duplicado cria uma identidade e uma
segunda submissão pelo mesmo telefone. O resultado informa:

- telefone normalizado;
- membro ou Fila Geral responsável;
- prioridade persistida;
- política e faixas de SLA;
- `receivedAt`, `assignedAt` e `automaticAcknowledgedAt`;
- IDs do ciclo e da tarefa.

Não há dados pessoais reais, chamadas externas ou valores usados como métricas.
