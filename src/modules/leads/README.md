# leads

O módulo implementa a fronteira única de entrada da CRM-05, sua extensão
transacional de distribuição/SLA da CRM-06, os adaptadores locais da CRM-07, a
consulta operacional da CRM-09, a fila priorizada da CRM-10 e os contratos do
cartão 360 da CRM-11:

- `domain/phone-normalizer.ts`: normalização conservadora para E.164;
- `application/lead-intake-service.ts`: validação, RBAC, idempotência,
  deduplicação não destrutiva, timeline, revisão, notificação e auditoria;
- `application/lead-routing.ts`: round-robin serializado, fallback explícito na
  Fila Geral e criação atômica de atribuição, ciclo e tarefa;
- `application/lead-distribution-service.ts`: pausa de recebimento,
  distribuição manual, redistribuição autorizada e compatibilidade da primeira
  tentativa humana com o serviço de histórico da CRM-08;
- `domain/immediate-sla.ts`: faixas determinísticas de 60 e 180 segundos.
- `domain/csv-parser.ts` e `domain/lead-entry-contracts.ts`: parsing e contratos
  validados dos canais;
- `application/lead-entry-service.ts`: cadastro manual, opções persistidas e
  simulador controlado;
- `application/lead-csv-import-service.ts`: preview, processamento,
  rastreabilidade e relatório do `ImportJob`;
- `application/local-lead-webhook-service.ts`: `WebhookEvent` local e
  idempotente;
- `domain/lead-list-contracts.ts`: contratos serializáveis compartilhados com a
  interface, sem dependências de servidor;
- `application/lead-list-service.ts`: escopo de acesso, filtros relacionais,
  ordem operacional, paginação, visualizações salvas e orquestração de ações em
  massa;
- `domain/sdr-queue-contracts.ts`: ordem, faixas e recomendações determinísticas
  serializáveis;
- `application/sdr-queue-service.ts`: seções, contagens, filtro por SDR e
  projeções persistidas da fila Meu Dia;
- `domain/lead-card-contracts.ts`: contrato serializável do cabeçalho, resumo,
  capacidades, tarefas e timeline do cartão do lead;
- `http`: respostas e bloqueio dos endpoints disponíveis somente em loopback.

Toda entrada aceita recebe responsável operacional, `LeadSlaCycle` e tarefa
`Ligar agora` vencendo em `receivedAt`. A política continua sendo zero minutos.
O vínculo `nextActionTaskId` é preenchido no mesmo commit; para opt-out, a tarefa
de contato é cancelada e uma tarefa explícita de revisão permanece ativa.

A tela `/leads/entrada` oferece cadastro manual, upload/preview de CSV, envio de
webhook local e geração fictícia P1/P2/P3/duplicado. Todos chamam o serviço
único; nenhum replica regras comerciais. A política completa está em
[`docs/LEAD_DUPLICATION_POLICY.md`](../../../docs/LEAD_DUPLICATION_POLICY.md) e
os contratos dos canais em
[`docs/LEAD_ENTRY_CHANNELS.md`](../../../docs/LEAD_ENTRY_CHANNELS.md).

A rota `/leads` nunca carrega o conjunto completo para filtrar no navegador.
Contagem, filtro e ordenação acontecem no PostgreSQL; score e prioridade usam a
projeção explícita `LeadCurrentScore`, enquanto SLA e atividade vêm do histórico.
A lista mantém seus parâmetros
na URL e abre o cartão 360 em `/leads/[leadId]/historico`.

A rota `/meu-dia` reutiliza a mesma visibilidade da lista e materializa nove
recortes operacionais com contagem completa e itens limitados. O relógio de SLA
usa o ciclo mais recente e avança localmente; o servidor é atualizado uma vez a
cada 30 segundos ou sob comando do usuário. Cada contagem aponta para
`/leads?operationalBucket=...`, garantindo um drilldown reconciliável.

O cartão 360 apresenta telefone e demais dados sensíveis somente após a
autorização `leads.read` no recurso concreto. A edição do resumo exige
`leads.write`, usa `updatedAt` como versão otimista e cria atividade e auditoria
sem sobrescrever alterações concorrentes. O telefone permanece fora desse
formulário porque é a identidade usada na política de deduplicação. A troca de
responsável reutiliza o serviço transacional da CRM-06 e exige `leads.assign`.
