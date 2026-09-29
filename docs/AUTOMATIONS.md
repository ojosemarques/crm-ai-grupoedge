# Motor local de automações

## Escopo atual

A CRM-21 entregou a infraestrutura persistente de execução, a CRM-22 adicionou
as cinco regras de entrada e a CRM-23 completa as sete regras predefinidas de
ciclo comercial. Há agora uma tela de operação, histórico filtrável e uma
central de notificações persistidas. A CRM continua
consistente sem o worker: normalização, deduplicação, score, distribuição,
`Ligar agora` e início do SLA permanecem nos serviços transacionais de domínio;
o worker acrescenta efeitos derivados e recuperáveis.

O motor usa PostgreSQL, sem Redis ou outro serviço. Ele oferece:

- publicação interna por gatilho;
- condições determinísticas e validadas;
- `AutomationRun` e `Job` com chave idempotente por workspace;
- agendamento, prioridade, tentativas, backoff e falha terminal;
- claim concorrente com `FOR UPDATE SKIP LOCKED`;
- lock com expiração e retomada após reinício;
- histórico de `AutomationAttempt`;
- recibo transacional de efeito em `AutomationEffect`;
- cancelamento, reprocessamento e execução manual autorizados;
- observabilidade local por logs estruturados e API protegida.

## Fluxo

```text
evento interno validado
        ↓
regras ACTIVE do mesmo workspace e gatilho
        ↓
condições `all` determinísticas
        ↓
AutomationRun + Job PENDING, com snapshots e chave única
        ↓
worker PostgreSQL: prioridade → runAt → criação → ID
        ↓
claim com SKIP LOCKED + lockExpiresAt + AutomationAttempt
        ↓
advisory lock do efeito + recibo idempotente
        ↓
adaptador chama serviço de domínio na mesma transação
        ↓
SUCCEEDED | retry PENDING | FAILED | CANCELLED
```

`publish` não aceita código executável. As condições têm no máximo 25 itens e
usam apenas caminho de dados e os operadores `EQUALS`, `NOT_EQUALS`, `IN` e
`EXISTS`. Payload, condições, configuração e resultado precisam ser JSON
serializável.

## Idempotência e atomicidade

A chave da execução é derivada de:

```text
<chave-do-evento>:rule:<id-da-regra>
```

O mesmo par workspace/chave retorna o `AutomationRun` e o `Job` já existentes.
O efeito usa uma segunda chave, com o tipo da ação. Antes de executar, o worker
adquire um advisory lock e procura `AutomationEffect` concluído. Quando não há
recibo, ele cria o recibo, chama o adaptador e confirma ambos na mesma transação.
Assim, se o processo cair depois do commit do efeito e antes de concluir o job,
o próximo worker lê o recibo e não repete a atividade, tarefa ou notificação.

Adaptadores recebem `Prisma.TransactionClient` e a chave do efeito. Eles devem
chamar serviços de domínio preparados para a mesma transação; escrita direta que
contorne invariantes do domínio não é permitida. O adaptador
`APPLY_ENTRY_AUTOMATION` valida os artefatos já confirmados pelo domínio e cria
somente notificações, fatos de automação, alertas e mensagens simuladas.
`APPLY_LIFECYCLE_AUTOMATION` revalida o estado corrente antes de cada efeito e
usa os mesmos serviços/transações de atividades, reuniões, tarefas, pipeline e
oportunidades. Retry reverte todo efeito parcial antes de reagendar.

## As 12 automações predefinidas

O seed cadastra as regras predefinidas abaixo como `ACTIVE`, com chave estável,
versão 1 e configuração preservada. Reexecutar o seed não altera status nem
customizações já persistidas. Administradores podem pausar/ativar cada regra
pela API protegida do motor.

| Regra | Gatilho persistido | Responsabilidade do domínio | Efeito da automação |
|---|---|---|---|
| 1. Lead recebido | conclusão `CREATED` da entrada | normalização, identidade, payload, score provisório, atribuição, tarefa e SLA | notifica o responsável, registra timeline/auditoria e grava mensagem exclusivamente simulada |
| 2. Duplicado | conclusão `ATTACHED` da entrada | nova submissão, conversão, preservação dos campos, revisão e recálculo autorizado | alerta o responsável, confirma a sinalização já feita ao gestor e explica que não houve merge automático |
| 3. P1 | prioridade vigente P1 | score e motivo versionados | alerta/destaque persistido, notificação ao SDR e checagem do gestor após 60 segundos |
| 4. SLA atrasado | checagens agendadas após 60 e após 180 segundos | ciclo de SLA e primeira tentativa | alerta atenção/crítico, notifica e informa que a redistribuição passa pelo fluxo autorizado |
| 5. Lead respondeu | atividade `MESSAGE_RECEIVED` confirmada | fato recebido e sinal `awaitingHumanResponse` | garante `Ligar agora` sem duplicá-la, notifica e cancela jobs de cadência incompatível |
| 6. Não atendeu | atividade `CALL_UNANSWERED` confirmada | tentativa, SLA e próxima ação permanecem no histórico operacional | agenda D0, D1, D3, D7, D14, D21 e D30 no horário local; cada passo cria tarefa e mensagem interna simulada sem repetir a data |
| 7. Qualificado | entrada válida na etapa `QUALIFIED` | PACTO mínimo, responsável e próxima ação são validados pelo pipeline | revalida os três requisitos, registra briefing determinístico, sugere agenda e notifica SDR/Closer/Gestor permitidos |
| 8. Reunião agendada | agendamento ou remarcação confirmada | reunião, fuso, closer, conflito e histórico pertencem ao serviço de agenda | agenda lembretes 24h, 2h e 15min antes; remarcação cancela a revisão anterior; mensagens são apenas simuladas |
| 9. No-show | status `NO_SHOW` confirmado | serviço de agenda cria a tarefa explícita de recuperação | notifica, registra sugestão de mensagem simulada e oferece remarcação sem alterar a agenda sozinho |
| 10. Lead parado | varredura determinística do intervalo aberto em `StageHistory` | limite vem da configuração comercial versionada | alerta responsável/gestor, registra evidência temporal e recomenda revisão; não muda etapa nem responsável |
| 11. Sem próxima ação | varredura determinística de lead aberto sem tarefa ativa | projeção e tarefas continuam sendo a fonte da próxima ação | registra erro operacional, notifica e exige correção humana sem inventar tarefa |
| 12. Ganho ou perda | fechamento confirmado da oportunidade | valor, produto, responsável e motivo de perda são validados pelo domínio | encerra cadências/tarefas incompatíveis; ganho cria somente um handoff de preparação futura e perda sinaliza nutrição futura sem iniciá-la |

As regras 6 a 12 usam chaves estáveis `crm23.*`, versão 1 e são inseridas de
forma idempotente pelo seed. O seed não reativa regra pausada nem sobrescreve
condições ou ações personalizadas já persistidas.

A publicação ocorre na mesma transação da entrada ou da atividade recebida. Um
rollback não deixa `AutomationRun` ou `Job` órfão. Cada run possui `leadId`
relacional para observabilidade e drilldown futuros; filtros operacionais não
dependem de extrair o lead de JSON.

Para cada submissão aceita, a entrada agenda checagens para o primeiro segundo
após 60 e após 180 segundos, respeitando as fronteiras 61/181. A tarefa continua
vencendo no próprio `receivedAt`: o nome e a
regra são **SLA imediato — 0 minutos**. As faixas são apenas classificação
visual/operacional, não tolerância adicional.

Mensagens automáticas usam canal interno, `isSimulated = true`, rótulo explícito
e texto iniciado por `SIMULAÇÃO LOCAL`. Nenhuma integração externa é acionada.
`DO_NOT_CONTACT` nunca é removido: a mensagem e a tarefa de chamada são
suprimidas, e as checagens de contato encerram sem produzir violação.

## Cadência, agenda e saúde do processo

A cadência usa os passos relacionais ativos da configuração comercial. Os dias
são adicionados no timezone do workspace, preservando o horário local mesmo em
mudanças de offset. Uma segunda ligação não atendida não cria outra cadência
enquanto houver passos pendentes ou em execução. `DO_NOT_CONTACT`, resposta,
ganho e perda cancelam runs ainda não executados; efeitos já confirmados não são
apagados.

Cada lembrete inclui `meetingId`, revisão, início esperado e antecedência. O
executor compara esses valores com a reunião persistida; revisão antiga,
remarcação, cancelamento, comparecimento ou no-show fazem o lembrete encerrar
sem contato indevido. O scanner do worker publica somente achados relacionais
de lead parado e sem próxima ação. A chave contém a evidência temporal, de modo
que repetir a mesma varredura não duplica o fato.

Briefing, recomendação de agenda e mensagens sugeridas são templates
determinísticos. Não são IA e não alteram PACTO, tarefas, reuniões ou
oportunidades sem o serviço responsável.

## Retry, lock e reinício

- cada claim incrementa `Job.attempts` e cria uma tentativa numerada;
- o backoff é `base × 2^(tentativa - 1)`, limitado a uma hora;
- antes de `runAt`, o job não pode ser reivindicado;
- `maxAttempts` fica entre 1 e 25;
- ao esgotar o limite, `Job` e `AutomationRun` terminam em `FAILED`;
- uma tentativa `RUNNING` cujo lock expirou é encerrada com
  `WORKER_LOCK_EXPIRED`, e outro worker pode continuar;
- `FOR UPDATE SKIP LOCKED` impede dois workers de reivindicarem o mesmo job;
- um recibo de efeito protege contra repetição mesmo quando o lock expira durante
  o intervalo entre o efeito e a finalização do job.

Falhas do adaptador são registradas sem stack ou segredo. Uma falha transacional
reverte tanto o efeito quanto as alterações de domínio; somente a tentativa e o
estado de retry/falha são gravados depois.

## Cancelamento e reprocessamento

Job pendente é cancelado imediatamente. Job em andamento recebe
`cancelRequestedAt`; o worker verifica o pedido dentro da transação anterior ao
efeito. Uma ação já confirmada não é desfeita. Regra pausada entre agendamento e
execução cancela o job com `RULE_INACTIVE`.

Somente falha terminal pode ser reprocessada. O comando preserva as tentativas
anteriores, acrescenta tentativas autorizadas ao limite e volta o mesmo job para
`PENDING`. Cancelamento e reprocessamento geram `AuditLog`.

## Versão e histórico

`AutomationRule.version` identifica a configuração vigente. Ao agendar, o run
copia versão, gatilho, ação, condições e configuração. Alterar ou inativar a
regra depois não reescreve a execução. `AutomationAttempt` preserva worker,
número, horários, estado e erro; delete e truncate das tentativas e recibos são
bloqueados no banco.

## Permissões e endpoints locais

- `automations.read`: observabilidade;
- `automations.execute`: execução manual e reprocessamento;
- `automations.manage`: ativação, pausa e cancelamento.

O Administrador recebe as três permissões. O Gestor comercial recebe leitura e
execução no workspace; não pode ativar, pausar ou cancelar regras. Os demais
papéis não recebem acesso nesta fase. Todas as rotas derivam o workspace da
sessão e repetem a autorização no servidor.

| Método | Rota | Finalidade |
|---|---|---|
| `GET` | `/api/automations/observability` | contagens, locks vencidos, runs e tentativas recentes |
| `POST` | `/api/automations/rules/{ruleId}/execute` | agendar execução manual |
| `PATCH` | `/api/automations/rules/{ruleId}/status` | ativar ou pausar |
| `PATCH` | `/api/automations/jobs/{jobId}` | cancelar ou reprocessar |
| `GET` | `/api/notifications` | listar somente as notificações do membro autenticado |
| `PATCH` | `/api/notifications/{notificationId}` | marcar como lida somente uma notificação própria |

`/automacoes` lista as 12 regras, mostra gatilho, condições e ações, permite
ativar/pausar conforme a permissão e filtra runs por status, regra, lead e
período. Tentativas e erros permanecem inspecionáveis. A página também mostra as
notificações do usuário atual. `/notificacoes` oferece a central individual com
filtros Todas/Não lidas/Lidas, baixa idempotente e link para lead, reunião ou
oportunidade relacionada. Logs do worker contêm IDs, tentativa, estado e código
de erro, sem payload completo.

## Execução local

Com PostgreSQL, migrations e seed ativos:

```bash
pnpm worker
```

Variáveis documentadas em `.env.example`:

- `AUTOMATION_WORKER_ID`;
- `AUTOMATION_POLL_INTERVAL_MS`;
- `AUTOMATION_BATCH_SIZE`;
- `AUTOMATION_LOCK_TIMEOUT_SECONDS`;
- `AUTOMATION_BACKOFF_BASE_SECONDS`.

O encerramento por `SIGINT` ou `SIGTERM` termina o lote atual e desconecta do
banco. Jobs pendentes ficam persistidos. O seed deixa 12 regras ativas; o
worker também varre leads parados e sem próxima ação antes de cada lote e fica
ocioso quando não existem eventos ou achados pendentes.

## Staging gratuito

A PROD-08 homologou este mesmo entrypoint contra o Neon de staging, sem criar
outro motor ou alterar a arquitetura do domínio. `pnpm
worker:staging:homologate` prepara/verifica um único job sintético, exige
confirmação literal, banco/schema/host esperados e adapters desabilitados. O job
é idempotente, a regra fica pausada ao final e o relatório não imprime
connection string.

Enquanto não houver autorização de custo, o processo roda somente em janelas
controladas e é encerrado por `SIGTERM`. Isso comprova processamento,
persistência e shutdown, mas não disponibilidade contínua nem auto-restart de
um host remoto. Consulte `STAGING_WORKER_REPORT.md` antes de repetir o ensaio.

## Fora do escopo

- editor visual livre de automações;
- Redis, filas externas ou execução distribuída entre hosts;
- integrações externas e mensagens reais;
- ações de IA;
- onboarding após o handoff e cadência real de nutrição;
- mover a importação CSV síncrona para o worker.
