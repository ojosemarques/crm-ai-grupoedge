# Arquitetura

## Estilo

O Politizai CRM é um monólito modular. A aplicação web e os futuros jobs usam a
mesma base de código, o mesmo domínio e o mesmo banco. Não serão criados
microserviços.

O CRM comercial ocupa um projeto Supabase dedicado e o schema privado `crm`.
Dados de cidadãos, atendimentos e demais operações de gabinete pertencem ao
Politizai OS e não entram neste domínio. O contrato completo de separação,
finalidade, RBAC, retenção e negação por padrão está em
[`CRM_COMMERCIAL_DATA_BOUNDARY.md`](./CRM_COMMERCIAL_DATA_BOUNDARY.md).

No aceite local após a CRM-30, aplicação web, worker PostgreSQL, seed
demonstrativo, métricas, automações simuladas e provider de IA determinístico
estão implementados no mesmo repositório. Publicação, integrações externas e
operação com dados reais permanecem fora do escopo; os gates futuros estão em
[`DEPLOYMENT_FUTURE.md`](./DEPLOYMENT_FUTURE.md).

A CRM-64 adiciona o módulo puro `readiness` como gate de configuração, sem
introduzir uma segunda fonte de verdade. A CLI `pnpm readiness:preflight` lê
somente nomes e estados necessários do ambiente, nunca serializa valores e
bloqueia produção, banco remoto, banco/schema inesperado, credencial externa e
adapter fora dos modos local/mock/simulado/desativado. O resultado
`READY_FOR_LOCAL_STAGING` não promove o sistema a produção; a matriz e os gates
externos estão em [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

## Fluxo de dependências

```text
app / components
       ↓
adaptadores de apresentação
       ↓
serviços de aplicação
       ↓
domínio
       ↓
interfaces de persistência
       ↓
adaptadores Prisma
       ↓
PostgreSQL
```

A interface nunca importa Prisma. Route Handlers e Server Actions devem ser
adaptadores finos: validam a entrada, obtêm o contexto do usuário e chamam um
caso de uso.

### Identidade canônica — CRM-33

`LeadIntakeService` continua sendo a fronteira única de entrada e, na mesma
transação, mantém os campos legados e chama o serviço de identidade para criar
ou ligar Contact, ContactPoint e submissão. Locks consultivos serializam Lead e
pontos normalizados; valores compartilhados entre pessoas abrem revisão e nunca
provocam merge automático. Leitura e decisão passam por serviços server-side e
pelas permissões `contacts.read` e `contacts.review`.

O backfill usa `ContactBackfillRun`/`ContactBackfillItem`, cursor, lote, chave
idempotente e lock por workspace. Dry-run não altera identidade; execute é
retomável, encerra cada lote atomicamente e mantém os campos antigos para
rollback. A CLI recusa produção, host remoto, banco diferente de
`politizai_crm` e schema diferente de `public`. Account e qualquer remoção de
campo legado não fazem parte desta task.

## Módulos

- `auth`: autenticação e sessões;
- `users`: usuários, memberships e permissões;
- `contacts`: identidade canônica, pontos de contato, colisões e backfill;
- `privacy`: finalidades, decisões de contato, consent events, DSR, retenção e
  backfill conservador;
- `leads`: entrada, normalização, deduplicação e lead;
- `qualification`: PACTO;
- `activities`: atividades e histórico operacional;
- `tasks`: tarefas e próximas ações;
- `meetings`: reuniões e resultados;
- `opportunities`: oportunidades, ganhos e perdas;
- `onboarding`: handoff comercial, aceite responsável, marcos e ativação;
- `pipelines`: etapas e transições;
- `metrics`: indicadores calculados;
- `automations`: regras e jobs idempotentes;
- `ai`: recomendações explicáveis;
- `audit`: auditoria append-only;
- `settings`: configurações do workspace;
- `shared/core`: infraestrutura transversal sem regras comerciais.

## Módulo onboarding — CRM-51

Server Components e Route Handlers autenticam e delegam ao OnboardingService; a
interface não acessa Prisma. O serviço valida oportunidade ganha, conta
canônica, contrato aceito, template publicado e owner ativo antes do handoff.
Aceite cria o caso e copia a versão dos marcos; ativação exige evidência em
todos os marcos obrigatórios.

Locks consultivos, revisões otimistas e chaves idempotentes protegem
concorrência. OnboardingEvent preserva o fato histórico e AuditLog registra a
ação administrativa. O backfill só cria quando todos os pré-requisitos são
persistidos e inequívocos; ausências viram revisão. Consulte
[HANDOFF_AND_ONBOARDING.md](./HANDOFF_AND_ONBOARDING.md).

## Módulo `privacy` — CRM-36

`src/modules/privacy` concentra a decisão determinística de contato. Entrada,
atividades, automações simuladas e IA consultam o mesmo serviço; nenhuma camada
de apresentação interpreta diretamente `Lead.contactPreference`. O resultado
tipado separa `ALLOW`, `DENY` e `REVIEW_REQUIRED`, inclui regra, fatos,
evidências e razão, e sempre deriva o workspace da sessão ou da transação de
domínio.

`ConsentEvent` é append-only; `ConsentState` é apenas projeção corrente por
Contact, finalidade, canal e ponto opcional. Finalidades, bases legais e
políticas de retenção possuem versões relacionais. A fundação seedada permanece
`PENDING_LEGAL`, portanto ausência de prova nunca vira autorização. DSRs têm
responsável ou fila explícita, verificação antes da análise e exportação mínima.
Retenção cria preview auditado; a versão atual não apaga dados nem contorna
legal hold ou confirmação humana.

O backfill preserva o sinal legado, usa lock por workspace e chave idempotente,
e registra run/item. A CLI aceita somente PostgreSQL local, banco
`politizai_crm`, schema `public` e ambiente não produtivo. Consulte
[`PRIVACY_AND_RETENTION.md`](./PRIVACY_AND_RETENTION.md).

## Auditoria administrativa e saúde do processo

A CRM-24 mantém duas responsabilidades relacionadas, mas distintas. `AuditLog`
é a trilha append-only das ações relevantes. `ProcessViolation` é um achado
operacional persistido, com evidência imutável e ciclo de reconhecimento e
resolução. Resolver o achado não altera o fato de auditoria nem corrige a
entidade de negócio diretamente.

```text
/auditoria ou /api/audit
          ↓
auth + audit.read / audit.manage + workspace do contexto
          ↓
AuditAdministrationService
       ↙                         ↘
AuditLog paginado e seguro   regras relacionais determinísticas
                                  ↓
                 ProcessViolation + AuditLog (uma transação)
```

A varredura serializa execuções do mesmo workspace com advisory lock e usa
fingerprints únicos para ser idempotente. Ela detecta responsável operacional
inválido, SLA zero violado, ausência de tentativa, PACTO incompleto, reunião
sem briefing mínimo, oportunidade ou lead sem próxima ação, lead parado,
divergência em `StageHistory` e perda sem motivo consultável. IA não participa
dessas decisões.

Achados correntes só podem ser resolvidos depois que uma nova avaliação comprova
que a condição deixou de existir; a correção deve passar pelo serviço de
leads, tarefas, PACTO, reuniões, pipeline ou oportunidades correspondente.
Violações históricas de SLA podem ser reconhecidas e encerradas após revisão,
mas seus timestamps e sua evidência permanecem preservados. Filtros de data são
interpretados no `Workspace.timeZone`, e a interface apresenta os instantes em
`America/Sao_Paulo` no workspace de demonstração.

Até a CRM-03, `shared/core` contém a infraestrutura executável, o Prisma contém
o modelo relacional compartilhado e `auth`/`users` implementam sessão, contexto
de workspace e autorização. Os diretórios comerciais continuam sendo limites
documentados: ainda não existem casos de uso, telas ou fluxos comerciais.

A CRM-04 adiciona um seed local transacional e idempotente. Ele materializa a
estrutura configurável necessária às próximas tasks sem criar leads,
oportunidades ou propostas transacionais.

A CRM-05 implementa o primeiro caso de uso comercial em `leads`: uma única
entrada para os canais manual, CSV, webhook local e simulador. O serviço valida
com Zod, deriva workspace e ator do contexto seguro, exige `leads.write` para
humanos e reutiliza atores técnicos persistidos. A CRM-06 estende essa mesma
transação com distribuição, tarefa e relógio de SLA; ela não cria uma segunda
fronteira de entrada. A CRM-07 adiciona adaptadores HTTP, tela e serviços de
orquestração, mantendo toda regra comercial nessa fronteira única.

A CRM-08 implementa `activities` e `tasks` como uma única unidade operacional.
`OperationalHistoryService` autoriza o recurso no servidor, usa o mesmo advisory
lock por lead da distribuição e grava tarefa, projeção da próxima ação,
atividade e auditoria na mesma transação. A apresentação usa Server Component
para a carga inicial e um Client Component apenas para formulários, feedback e
paginação; nenhum componente importa Prisma.

A CRM-09 mantém a leitura de alto volume em `LeadListService`. O query service
traduz o escopo `WORKSPACE`, `TEAM` ou `OWN` para predicados SQL antes de contar,
ordenar e paginar. Uma consulta relacional usa `LeadCurrentScore` para o score
vigente e joins laterais para ciclo de SLA, atividade e motivo de perda, evitando
N+1 e sem inferir score ausente. A interface importa apenas contratos puros de
`leads/domain`; Prisma e `pg` permanecem exclusivos do servidor.

```text
URL + contexto autenticado
          ↓
Zod + resolução do escopo persistido
          ↓
filtros relacionais + ordem operacional no PostgreSQL
          ↓
COUNT + LIMIT/OFFSET + projeções históricas mais recentes
          ↓
tabela, paginação e link para o lead
```

A CRM-14 implementa `pipelines` sem permitir mutação direta pela apresentação.
`PreSalesPipelineService` resolve escopo RBAC, bloqueia o lead com advisory lock,
valida o grafo e seus pré-requisitos e grava projeção atual, `StageHistory`,
atividade e auditoria na mesma transação. A versão `updatedAt` impede que dois
operadores confirmem estados antigos; o lock serializa tentativas concorrentes.

```text
quadro, lista ou cartão
          ↓
Route Handler autenticado + same-origin
          ↓
LEADS_WRITE no recurso e LEADS_ASSIGN se correção
          ↓
grafo + PACTO + próxima ação + motivo + confirmação
          ↓
StageHistory + Lead + Activity + AuditLog (uma transação)
```

O quadro limita a projeção a 20 cards por etapa, mas as contagens são consultas
independentes e exatas. Filtros e visibilidade são aplicados antes das contagens;
a lista completa continua disponível para recortes maiores. Arrastar um card é
apenas um adaptador do mesmo caso de uso e não contorna pré-requisitos.

A CRM-15 implementa `meetings` como módulo de aplicação isolado. A agenda e o
cartão chamam Route Handlers autenticados; nenhum Client Component acessa Prisma.
O serviço converte datas locais pelo fuso persistido do workspace e aplica
`meetings.read`/`meetings.write` junto ao escopo efetivo antes de consultar ou
alterar registros.

```text
agenda ou cartão do lead
          ↓
Route Handler autenticado + Zod
          ↓
RBAC da reunião ou do lead autorizado
          ↓
lock do lead + lock do closer + conflito de intervalo
          ↓
Meeting + MeetingHistory + Task + Activity + AuditLog
          ↓
transição da CRM-14 para Reunião agendada (mesma transação)
```

Conflitos de horários são rejeitados pela política atual; não há confirmação
para sobrepor agendas. Reuniões ativas do mesmo closer não podem se intersectar.
O lock transacional por closer torna a decisão estável sob concorrência, e a
revisão otimista da reunião evita que confirmar, remarcar ou encerrar uma versão
obsoleta sobrescreva trabalho recente. `MeetingHistory` é append-only e registra
cada agendamento, confirmação, remarcação, cancelamento, show ou no-show.

A agenda diária/semanal é uma projeção por intervalo e closer, com contagens
derivadas da própria consulta. O briefing agrega submissão mais recente, PACTO
validado, atividades e próxima tarefa; lacunas permanecem explícitas. Nenhum
resumo é inventado e nenhuma integração de calendário foi adicionada.

A CRM-16 implementa `opportunities` como fronteira única do pipeline comercial.
O `OpportunityService` autoriza a oportunidade ou o lead concreto, resolve os
catálogos do workspace, aplica o grafo tipado e grava estado atual, próxima
ação, proposta, `StageHistory`, timeline e auditoria em uma transação. Locks
transacionais por lead e oportunidade serializam criação e transições, enquanto
`revision` rejeita comandos baseados em uma versão antiga.

```text
pipeline de vendas ou cartão do lead
                 ↓
Route Handler autenticado + Zod + same-origin
                 ↓
opportunities.read/write com OWN, TEAM ou WORKSPACE
                 ↓
grafo + produto/interesse + valor/motivo + próxima ação
                 ↓
Opportunity + Offer + Task + StageHistory + Activity + AuditLog
```

O estado corrente da oportunidade é uma projeção consultável; os intervalos de
etapa são a fonte histórica para duração e conversão. Comparecimento em reunião
ligada chama a mesma transição comercial dentro da transação da agenda. Ganho e
perda encerram somente tarefas abertas da oportunidade, e reabertura é uma
correção gerencial confirmada que cria novo intervalo. A probabilidade é manual;
nenhuma previsão ou integração de pagamento foi introduzida.

`/oportunidades` possui consultas de quadro e lista com filtros relacionais por
closer, produto, etapa e previsão de fechamento. A aba do cartão usa os mesmos
contratos e serviços. Client Components não importam Prisma nem constroem uma
segunda regra de transição.

As visualizações salvas persistem filtros, ordenação e colunas validados em
`SavedView`; são sempre privadas nesta fase e limitadas ao membro/workspace.
Redistribuições em massa exigem confirmação na interface e `leads.assign` no
servidor. Cada item volta a passar pelo `LeadDistributionService`, preservando
lock, validação do SDR, tarefa imediata, timeline e auditoria. Um item já no
destino é explicitamente informado como não alterado.

A CRM-10 acrescenta `SdrQueueService`, uma projeção de leitura dedicada à fila
Meu Dia. Ela reutiliza o resolvedor e o predicado SQL de visibilidade da
CRM-09, aplica opcionalmente o SDR selecionado pelo gestor e consulta as nove
seções em operações limitadas, sem consulta por cartão. Cada consulta retorna
também `COUNT(*) OVER()`, permitindo mostrar poucos itens de alta densidade e
uma contagem completa reconciliável com o filtro `operationalBucket` da lista.

```text
contexto autenticado + SDR opcional
                 ↓
     leads.read + OWN/TEAM/WORKSPACE
                 ↓
 etapa + tarefa + resposta + reunião + ciclo SLA
                 ↓
 ordem: respondeu → P1 → P2 → P3 → vencido → demais
                 ↓
 seções limitadas + contagens → drilldown exato em /leads
```

O Server Component busca os dados diretamente pelo serviço. O Client Component
recebe somente contratos serializáveis, incrementa os relógios localmente a
cada segundo e chama `router.refresh()` uma vez a cada 30 segundos ou mediante
ação explícita. Assim, timers não criam uma requisição por lead. As ações
recomendadas são regras puras: elas explicam o fato determinante e encaminham
ao histórico operacional, onde qualquer mutação volta a passar pelos serviços
da CRM-08.

A CRM-11 amplia essa mesma fronteira para o cartão 360, sem criar acesso direto
ao banco na interface. `getLeadOperations` monta cabeçalho, submissão mais
recente, alertas, campos faltantes, SLA, tarefas e timeline após autorizar o
recurso concreto. As capacidades de escrita, tarefa, atribuição e auditoria são
calculadas separadamente no servidor; o Client Component recebe apenas o
contrato serializável de `leads/domain/lead-card-contracts.ts`.

```text
rota dinâmica /leads/[leadId]/historico
                  ↓
         sessão + workspace + leads.read
                  ↓
 cabeçalho + resumo + SLA + tarefas + timeline
                  ↓
  ações suportadas → serviços CRM-06/CRM-08
                  ↓
 lock por lead + versão updatedAt + evento + AuditLog
```

A edição de resumo usa controle otimista: o cliente envia o `updatedAt` lido,
e uma versão divergente retorna `409` antes de qualquer escrita. Campos vazios
são gravados como `NULL` somente após confirmação explícita. O telefone não é
editável nessa operação para preservar a identidade e a política não destrutiva
da CRM-05. Redistribuição continua no `LeadDistributionService`; na CRM-11,
transições, PACTO, reuniões, oportunidades e IA não ganharam serviços
antecipados.

A CRM-19 materializa `metrics` como camada única de consulta, sem criar uma
tela. O serviço recebe período e filtros compartilhados, resolve o escopo RBAC
e consulta um número fixo de conjuntos relacionais; não há consulta por card ou
por linha. A projeção retorna instantes ISO, timezone, filtros, numeradores,
denominadores e valores em centavos serializados.

```text
contexto + período + filtros
              ↓
       metrics.read + escopo
              ↓
submissões / SLA / StageHistory / MeetingHistory
              ↓
 snapshots financeiros append-only + tarefas/atividades
              ↓
 MetricsOverview reproduzível para dashboard e drilldown futuros
```

`OpportunityOutcomeSnapshot` corrige a lacuna entre o evento de ganho/perda e
os valores mutáveis da projeção de oportunidade. Ele é criado na mesma
transação da transição, possui relações tipadas para lead, oportunidade, etapa,
responsável, produto e motivo, e não permite update, delete ou truncate. A
vigência histórica é determinada pelo intervalo de `StageHistory`, portanto uma
reabertura não reescreve o resultado de um corte anterior.

A CRM-20 materializa o dashboard como consumidor server-side da camada de
métricas. A página usa `searchParams` assíncronos do App Router, normaliza o
período no fuso do workspace e entrega um contrato serializável ao componente de
apresentação. Não há acesso Prisma em Client Components nem fórmula duplicada no
browser.

```text
URL /dashboard + sessão
           ↓
 DashboardMetricsService → MetricsService
           ↓                    ↓
 opções autorizadas       eventos e snapshots
           ↓                    ↓
 KPIs + segmentos + evidências tipadas
           ↓
 /dashboard/registros recompõe e pagina o mesmo recorte
```

O serviço executa conjuntos relacionais fixos em paralelo e agrega em memória;
não faz consultas por card, barra ou linha. Gráficos compactos são HTML/CSS
acessível, evitando uma dependência de visualização antes do refinamento visual
da CRM-28. Todo número e segmento é um link focável; estados de loading, erro,
filtro inválido, vazio e sem permissão são explícitos.

A CRM-12 acrescenta a fronteira `PactoQualificationService`. A carga inicial do
cartão solicita histórico operacional e PACTO em paralelo; a aba cliente recebe
somente `PactoQualificationView` e chama um Route Handler fino. Leitura e
mutação repetem `leads.read`/`leads.write` sobre o recurso concreto no servidor.

```text
formulário ───────┐
                  ├→ PactoSuggestion (sinal separado, append-only)
IA futura ────────┘

SDR / Closer → rascunho → PactoAssessment (estado atual)
                         ├→ PactoRevision + 5 snapshots imutáveis
                         ├→ Activity na timeline
                         └→ AuditLog
                                ↓
                    validação humana explícita
```

O serviço usa o mesmo advisory lock transacional por lead das operações
anteriores e exige `expectedRevision`, evitando duas gravações concorrentes. O
estado legado de `LeadQualification` é mantido somente como projeção relacional
compatível; a história reproduzível fica nas revisões. O mínimo vigente é lido
de `Workspace.pactoMinimumInvestigatedDimensions` e copiado para cada revisão.
Validar PACTO não altera pipeline, tarefas ou responsável. Desde a CRM-13, a
validação produz uma nova revisão de score `SDR_VALIDATED` no mesmo commit.

```text
payload + contexto seguro
        ↓
validação e normalização E.164
        ↓
RBAC sobre a Fila Geral
        ↓
transação + locks de idempotência e telefone
        ↓
submissão bruta → criar ou anexar identidade
        ↓
lock do cursor → SDR disponível ou Fila Geral explícita
        ↓
atribuição + ciclo de SLA + tarefa `Ligar agora`
        ↓
etapa/timeline + revisão/notificação + AuditLog
        ↓
CREATED | ATTACHED | REJECTED
```

```text
formulário | CSV | webhook local | simulador
                    ↓
      validação específica do canal
                    ↓
           LeadIntakeService.intake
                    ↓
         transação comercial única
```

O preview CSV é somente leitura e consulta referências persistidas. A
confirmação mantém um `ImportJob` com contadores e relatório; cada linha recebe
chave derivada do conteúdo e número da linha. O worker da CRM-21 processa
exclusivamente jobs de automação; mover imports para ele não foi autorizado. O
CSV continua síncrono e limitado a 2 MiB/2.000 linhas. O webhook é
um simulador autenticado, restrito a loopback e indisponível em produção; não
antecipa assinatura ou provedor externo. Consulte
[`LEAD_ENTRY_CHANNELS.md`](./LEAD_ENTRY_CHANNELS.md).

```text
evento interno → regras ACTIVE no workspace → AutomationRun + Job
                                              ↓
                PostgreSQL / SKIP LOCKED / lock com expiração
                                              ↓
                         AutomationAttempt + recibo de efeito
                                              ↓
                    adaptador → serviço de domínio transacional
```

O motor de automações é parte do monólito. O processo `pnpm worker` reutiliza o
mesmo código, schema e banco; não é um microserviço. Jobs agendados e locks ficam
no PostgreSQL, e não há Redis. Snapshots no run preservam a versão da regra. O
recibo de efeito e a escrita de domínio compartilham uma transação, mantendo
retry idempotente. Nas 12 regras predefinidas, a publicação do run/job também
compartilha a transação da entrada, atividade, transição, reunião ou
oportunidade que a originou. O run mantém `leadId`, `meetingId` e
`opportunityId` relacionais; o adaptador revalida e reutiliza os artefatos do
domínio antes de criar efeitos derivados. Cadências e lembretes são cancelados
por revisão/estado persistido, e o worker faz a varredura determinística de
lead parado e sem próxima ação. Consulte [`AUTOMATIONS.md`](./AUTOMATIONS.md).

```text
atividade ou tarefa + contexto seguro
               ↓
     RBAC sobre o lead e tarefas
               ↓
      lock transacional por lead
               ↓
fato comercial + efeito de SLA/resposta
               ↓
tarefa seguinte explícita, quando informada
               ↓
projeção da tarefa ativa mais antiga
               ↓
      timeline append-only + AuditLog
```

“Próxima ação” tem uma definição única: a tarefa não excluída em `OPEN` ou
`IN_PROGRESS` com menor `dueAt`, desempate por `createdAt` e `id`. O lead mantém
`nextActionTaskId`, instante e descrição como projeção indexada. O query service
compara a projeção com as tarefas e sinaliza ausência ou inconsistência. A
timeline é ordenada por `occurredAt` e `id`, do fato mais recente ao mais antigo,
com cursor e limite máximo de 50.

`Activity` registra o fato comercial e o contexto útil ao atendimento.
`AuditLog` registra a ação de sistema, segurança e mudança para responsabilização;
um não substitui o outro. Triggers do PostgreSQL impedem update, delete e
truncate de atividades. Uma correção referencia o evento original em
`correctsActivityId` e acrescenta valores anteriores/posteriores, sem alterar o
fato preservado.

Cada conversão usa o pipeline de lead padrão e sua primeira etapa aberta. Com
uma regra de scoring ativa, os dados do formulário produzem score provisório e
faixa P1/P2/P3 explicáveis; a faixa informada pela fronteira permanece apenas
como fallback técnico para workspaces sem regra. Um advisory lock por workspace/fila serializa o cursor do
round-robin. Apenas memberships de função SDR, ativas, não pausadas, sem soft
delete e ligadas a usuários ativos participam. Sem candidato, a Fila Geral é o
responsável operacional explícito e gera alerta persistido.

Cada submissão aceita cria um `LeadSlaCycle` e uma tarefa `Ligar agora`, vencendo
no próprio `receivedAt`. `assignedAt` e `automaticAcknowledgedAt` também nascem
nesse instante. A política permanece **SLA imediato — 0 minutos**; os limites de
60 e 180 segundos classificam saúde visual e não concedem tolerância ao SLA.
Falha em qualquer artefato reverte submissão, lead, cursor, atribuição, timeline,
tarefa, ciclo, alerta e auditoria.

Uma conversão repetida não sobrescreve campos consolidados nem remove
`DO_NOT_CONTACT`; ela recebe novo ciclo operacional e nova tarefa, cancelada
quando o contato está bloqueado. Origem e interesse iniciais coexistem com os
dados da conversão mais recente. A política detalhada está em
[`LEAD_DUPLICATION_POLICY.md`](./LEAD_DUPLICATION_POLICY.md).

## Scoring explicável

`LeadScoringService` concentra cálculo, persistência, recálculo, override e
sugestão. `ScoringRuleVersion` guarda pesos, penalidades e limites em colunas
tipadas; uma mudança exige nova versão, e o banco impede reescrever uma versão
histórica. `LeadScore` e `LeadScoreComponent` são append-only.

```text
formulário ───────────→ FORM_PROVISIONAL ─┐
PACTO validado ───────→ SDR_VALIDATED ────┼→ LeadCurrentScore → lista / Meu Dia / cartão
override com motivo ─→ HUMAN_OVERRIDE ───┘
IA ──────────────────→ AI_SUGGESTED (não vigente)
```

O lock do lead serializa alterações e `expectedRevision` rejeita concorrência
obsoleta. Cada cálculo que já foi vigente conserva `currentRevision`; a regra e
o snapshot de entrada tornam o resultado reproduzível. Consulte
[`SCORING.md`](./SCORING.md).

## Autenticação, workspace e autorização

```text
requisição
   ↓
proxy: presença do cookie (checagem otimista, sem banco)
   ↓
guard server-side: token hash + sessão + usuário + membership + ator
   ↓
AuthenticatedContext obtido do servidor
   ↓
AuthorizationService: permissão persistida + WORKSPACE / TEAM / OWN
   ↓
serviço de aplicação: consulta ou mutação sempre filtrada pelo workspace
   ↓
PostgreSQL: FKs compostas + auditoria
```

O `proxy.ts` apenas evita navegação anônima óbvia. Ele nunca é a fronteira de
segurança porque não consulta o banco. Route Handlers, Server Components e
futuros Server Actions devem usar os guardas de `auth/http` e executar a decisão
de permissão no servidor, perto do serviço e dos dados.

O token da sessão é aleatório e opaco. Somente seu hash SHA-256 é persistido;
cookies são `HttpOnly`, `SameSite=Lax`, `Secure` em produção e expiram junto com
a sessão. Senhas usam `scrypt` com parâmetros versionados no próprio hash, sal
aleatório e comparação constante fornecida pela implementação criptográfica. A
troca futura de senha deve incrementar `credentialVersion`, invalidando sessões
anteriores.

O contexto autenticado contém IDs obtidos da sessão, nunca de campos de formulário.
O `AuthorizationService` volta a validar membership e ator e exige que o recurso
tenha o mesmo `workspaceId`. Permissões vêm de `RolePermission`, com escopo
`WORKSPACE`, `TEAM` ou `OWN`. Uma negação válida é auditada e retorna mensagem
genérica; IDs de outro workspace não são confirmados ao cliente.

Papel técnico (`Role`) e função comercial (`TeamMember.function`) não são
intercambiáveis. Os atores `SYSTEM`, `AUTOMATION` e `AI_AGENT` não autenticam com
senha e são resolvidos por contexto técnico explícito. A matriz completa está em
[`PERMISSIONS.md`](./PERMISSIONS.md).

## Configuração

### Fronteira de IA da CRM-25

`AIExecutionService` é a única porta de execução da fundação de IA. Ele valida
um DTO mínimo, resolve o alvo dentro do workspace, aplica `ai.use`, seleciona o
prompt versionado e valida a saída específica do agente. A aplicação usa
`MockAIProvider` por padrão; o `OpenAICompatibleProvider` é construído apenas
por injeção explícita e não lê chave ou endpoint do ambiente.

Falha, timeout ou contrato externo inválido acionam o fallback determinístico e
ficam identificados no `AIInsight`. Insight e `AuditLog` são gravados na mesma
transação com o ator `AI_AGENT`. O provider não recebe IDs de tenant, sessão,
lead, oportunidade ou ator. A fronteira cria recomendações, nunca mutações; os
serviços de PACTO, score, tarefas e oportunidades continuam sendo a única fonte
de alteração de domínio. Consulte [`AI_PROMPTS.md`](./AI_PROMPTS.md).

### Inteligência no fluxo do lead — CRM-26

`LeadIntelligenceService` é a camada de aplicação entre o cartão 360 e a
fronteira da CRM-25. Ela carrega somente campos autorizados do lead, monta o DTO
mínimo, chama `AIExecutionService` e expõe o histórico persistido. A rota
`/api/leads/[leadId]/intelligence` resolve sessão, workspace e origem antes de
permitir leitura, execução ou revisão.

```text
aba Inteligência → Route Handler → LeadIntelligenceService
                                      ↓
                       ai.use + escopo do responsável
                                      ↓
                            AIExecutionService
                                      ↓
                    AIInsight + timeline + AuditLog
                                      ↓
          revisão humana → PACTO | scoring | tarefa
                           serviços de domínio existentes
```

Análise, briefing, extração e próxima ação compartilham os contratos da
fundação, mas têm prompts e apresentação próprios. O modo local é determinístico:
texto livre só gera fatos quando usa marcadores documentados, e campos não
reconhecidos continuam ausentes. Nenhum telefone, e-mail, identificador de
tenant ou payload bruto integra o DTO do provider.

A revisão usa reserva otimista do `AIInsight` para impedir decisão duplicada.
Aceite total ou parcial, edição, rejeição e falha são auditados; toda mutação
passa novamente pelo serviço de domínio e pela permissão correspondente.

### Copilot gerencial rastreável — CRM-27

`ManagerAnalyticsService` pertence ao módulo de métricas e compõe somente as
oito perguntas fechadas da CRM-27 sobre o universo já autorizado por
`DashboardMetricsService`/`MetricsService`. Consultas adicionais a reuniões,
oportunidades e tarefas sempre restringem IDs ao universo retornado por essa
camada; não existe SQL livre, pergunta aberta nem acesso direto do componente ao
banco.

```text
/copilot → ai.manager.query → ManagerCopilotService
                                  ↓
                         ManagerAnalyticsService
                                  ↓
             DashboardMetricsService + MetricsService
                                  ↓
        resposta + grupos de registros autorizados e reconciliáveis
                                  ↓
             AIExecutionService (agregados minimizados)
                                  ↓
                   AIInsight + AuditLog correlacionado
                                  ↓
          confirmação humana sem mutação automática do domínio
```

O provider recebe somente pergunta, resposta agregada, período, fórmula,
numerador/denominador, recomendação e limitações. Nomes, IDs e textos dos leads
continuam exclusivamente no drilldown server-side. `ai.manager.query` é
separada de `ai.use`: Administrador recebe `WORKSPACE`, Gestor recebe `TEAM`, e
SDR, Closer e Visualizador não recebem o recurso gerencial. Cada número aponta
para um grupo explícito de registros; métricas de taxa, duração ou dimensão
podem naturalmente abrir amostras cuja quantidade difere do valor exibido.

Possíveis causas são apresentadas como correlações e a resposta declara falta de
amostra. Confirmar ou rejeitar atualiza somente o ciclo do `AIInsight`, usa
concorrência otimista e cria auditoria append-only com a afirmação explícita de
que nenhuma redistribuição ou mutação comercial foi executada.

### Shell e sistema visual — CRM-28

A interface autenticada usa um shell cliente somente para navegação e resumo da
sessão. Componentes de página continuam Server Components e são passados pelo
slot `children`, evitando mover consultas ou regras de negócio para a interface.
O item ativo usa `usePathname`, pois o layout persistente não é renderizado
novamente a cada navegação.

Tokens globais, estados, tabelas, formulários, dialogs e responsividade ficam em
`src/app/globals.css` e em componentes reutilizáveis de `src/components`. O
dialog gerencia foco e Escape; os limites `loading.tsx` e `error.tsx` das rotas
prioritárias usam estados compartilhados. Nenhum valor visual substitui dado
persistido. Consulte `docs/VISUAL_SYSTEM.md` para a especificação completa.

### Configurações comerciais da CRM-17

A CRM-17 centraliza configurações comerciais em `CommercialSettingsService`.
Leitura, prévia de impacto e alteração exigem `workspace.manage`; o serviço usa
o tenant do contexto, lock consultivo por workspace, revisão otimista e uma
transação que inclui `AuditLog`. `CommercialSettingsVersion`/`CadenceStep`,
`ScoringRuleVersion` e versões de `SlaPolicy` preservam as regras usadas no
passado. Catálogos usam inativação e mantêm as referências históricas.

```text
/configuracoes → prévia de impacto → confirmação humana
                         ↓
          workspace.manage + Zod + advisory lock
                         ↓
   nova versão ou catálogo inativado + AuditLog (um commit)
```

Distribuição, agenda, PACTO, scoring e ambos os pipelines leem as projeções
tipadas vigentes. As transições normais consultam `PipelineStageTransition` no
banco; correções gerenciais continuam sendo um fluxo excepcional e auditado.
Consulte `docs/SETTINGS.md` para invariantes e impactos.

## Administração de usuários e equipes

`WorkspaceAdministrationService` é a única fronteira de aplicação da CRM-18.
Server Component e Route Handler obtêm o contexto autenticado no servidor; a
interface cliente recebe contratos serializáveis e nunca importa o Prisma.

```text
/administracao → contexto autenticado → escopo WORKSPACE ou TEAM
                         ↓
                  prévia de impacto
                         ↓ confirmação explícita
        lock + serviço de domínio + AuditLog (uma transação)
```

Criação e manutenção preservam a separação entre identidade global (`User`),
membership/role (`WorkspaceMember`) e função comercial (`TeamMember`). Pausa
reutiliza o serviço de distribuição. Redistribuição e inativação reutilizam a
mesma primitiva transacional de atribuição da CRM-06, mantendo responsável,
tarefas, timeline e auditoria consistentes. A inativação também revoga sessões,
mas não apaga autoria nem altera reuniões e oportunidades silenciosamente.

Administradores operam no workspace; Gestores recebem somente os membros,
equipes, indicadores e ações autorizados pelas próprias equipes. Revisão
otimista e advisory locks evitam sobrescrita e redistribuição concorrente.
Detalhes estão em [`ADMINISTRATION.md`](./ADMINISTRATION.md).

Variáveis são lidas no servidor e validadas por Zod. A aplicação não mantém
fallback silencioso para `DATABASE_URL`. Valores inválidos produzem um erro de
configuração sem imprimir credenciais.

## Persistência

Prisma 7 usa `@prisma/adapter-pg` e o driver `pg`. A criação do cliente é lazy,
permitindo que o health check transforme ausência de configuração ou banco
indisponível em uma resposta controlada.

O cliente é reutilizado por todo o processo web e pelo hot reload local, com um
único pool limitado por processo. Consultas entram por repositórios ou query
services dos módulos; handlers e Server Components não criam pools próprios.

O adapter recebe explicitamente o schema extraído de `DATABASE_URL` e configura
o `search_path` da conexão. Isso é necessário para que consultas Prisma, SQL
bruto e triggers operem no mesmo schema. Os testes de integração usam
`politizai_crm30_integration_test` e foram verificados para não gravar no schema
`public`.

## Seed local

`prisma/seed.ts` é somente o adaptador de linha de comando. A lógica reside em
dois serviços de aplicação de `settings`: estrutura/configuração e conjunto
operacional CRM-29. Cada serviço usa sua própria transação `Serializable` e um
advisory lock para impedir duas execuções concorrentes.

O seed estrutural usa IDs determinísticos e também busca chaves naturais. Ele
cria somente o que falta: não restaura soft delete nem remove registros manuais.
Credenciais existentes não têm senha, versão, bloqueio ou hash alterados. Uma
entrada append-only registra a criação estrutural.

A base operacional usa IDs e chaves de idempotência determinísticos, tag de
namespace, auditoria com `requestId` próprio e cria o grafo completo no mesmo
commit. Se o marcador já existe, o serviço verifica as contagens e não reescreve
eventos. Datas são relativas ao instante da criação. A renovação é uma ação
separada e explícita, limitada a schemas locais `politizai_demo*`; o reset nunca
aceita `public` e reaplica migrations antes do seed.

Execução é recusada em produção ou quando o host PostgreSQL não é loopback. O
manifesto e o catálogo de cenários estão em [`SEED.md`](./SEED.md).

O schema relacional é a fonte única da verdade estrutural. Todas as tabelas de
negócio têm `workspaceId`; referências entre entidades do workspace usam chaves
estrangeiras compostas (`workspaceId`, `id`) para impedir vínculos cruzados mesmo
quando uma chamada ignora os serviços da aplicação.

As decisões de persistência da CRM-02 são:

- IDs UUID estáveis e gerados no banco;
- timestamps `timestamptz(3)`, persistidos como instantes e apresentados em
  `America/Sao_Paulo`;
- moeda BRL em colunas `bigint` com sufixo `Cents` e checks não negativos;
- estado atual em colunas tipadas e histórico temporal em tabelas próprias;
- deleção `Restrict` nas relações; entidades mutáveis usam `deletedAt` quando a
  exclusão lógica faz sentido;
- unicidade de negócio para registros ativos implementada por índices parciais;
- JSON limitado a payload bruto, configuração flexível, evidências e metadados;
- `AuditLog` protegido por triggers contra `UPDATE`, `DELETE` e `TRUNCATE`;
- atores humanos, Sistema, Automação e Agente de IA representados por `Actor`.

`User` representa identidade global, `WorkspaceMember` representa acesso ao
workspace, `Role`/`Permission` representam autorização e `TeamMember` representa
a função comercial. Esses conceitos não são intercambiáveis.

Leads abertos têm exatamente um responsável operacional: um
`WorkspaceMember` ou uma `Queue`. A fila geral é uma `Queue` persistida e
explícita; um índice parcial permite no máximo uma fila geral ativa por
workspace. O banco aplica a mesma regra XOR a tarefas e conversas.

O detalhamento de entidades, relações, índices, retenção e invariantes está em
[`DATA_MODEL.md`](./DATA_MODEL.md).

## Erros e logging

- erros esperados usam `ApplicationError` com código e status;
- respostas públicas não expõem causa, stack ou credenciais;
- erros inesperados retornam `INTERNAL_ERROR` com `requestId`;
- logging usa Pino em saída estruturada;
- senha, cookies, autorização e URL do banco são campos redigidos;
- a UI possui um limite global de erro.

## Health check

`GET /api/health` executa `SELECT 1` no PostgreSQL:

- HTTP 200 quando aplicação e banco estão disponíveis;
- HTTP 503 quando a conexão ou sua configuração está ausente;
- `Cache-Control: no-store`;
- execução dinâmica no runtime Node.js.

## Testes

- Vitest para configuração, serviços e regras determinísticas;
- Playwright para fluxos reais pelo navegador e HTTP;
- integrações com PostgreSQL devem usar o banco local/teste, nunca mocks como
  única validação de persistência;
- testes relacionais recriam somente o schema local fixo
  `politizai_crm30_integration_test`, recebem a mesma cadeia de migrations do
  banco principal e recusam hosts PostgreSQL remotos;
- o E2E principal usa `next start` sobre build otimizado e schema descartável;
  webhook/simulador rodam separadamente em `next dev` por contrato local;
- componentes de servidor assíncronos são cobertos preferencialmente por E2E.

## Bundler

Os scripts de desenvolvimento e build usam Webpack, opção suportada pelo Next.js.
Na validação da CRM-01, o Turbopack iniciou o servidor, mas não concluiu a primeira
compilação em 120 segundos neste filesystem; Webpack compilou a mesma rota em
aproximadamente 3,4 segundos. A decisão evita que o bootstrap dependa desse
comportamento local e pode ser reavaliada quando o ambiente ou o Turbopack mudar.

## Datas, dinheiro e isolamento

- timestamps são instantes em `timestamptz`; a conversão de exibição será feita
  para `America/Sao_Paulo`;
- valores BRL são inteiros em centavos;
- o isolamento relacional por workspace já existe no banco;
- serviços de autenticação e administração já exigem contexto de workspace e
  permissão; todos os futuros serviços deverão repetir o padrão — a integridade
  do banco não substitui autorização.

## Módulo `accounts`

O monólito modular agora possui `src/modules/accounts`: contratos de domínio,
normalização determinística e `AccountService` como único ponto de mutação.
Route Handlers apenas autenticam, verificam origem e delegam; componentes não
acessam Prisma. O serviço valida workspace, escopo, revisão otimista, hierarquia,
papéis temporais, comitê e decisões de review e grava `AuditLog` na mesma
transação das mudanças relevantes.

O backfill de organização legada é local, versionado e idempotente. Fato
(`organizationName`), inferência (possível Account) e ausência (documento e
domínio) permanecem separados. Nenhuma IA, integração ou efeito automático
decide o vínculo.

## Módulo `lifecycle`

`src/modules/lifecycle` concentra política versionada, projeção corrente,
histórico temporal, ownership por função, transferências e backfill. Route
Handlers autenticam e delegam; mutações usam transação serializável, lock por
agregado e idempotência. Lead routing e criação de Opportunity chamam um writer
interno na própria transação, mantendo os modelos legados como fontes válidas
de seus respectivos domínios. A interface lê `JourneySnapshot` e nunca acessa
Prisma diretamente.

## Módulo `integrations` — fundação local

`src/modules/integrations` separa adapters, plataforma, inbox, outbox, sync,
referências de segredo e mapeamentos. Route Handlers autenticam, validam
origem/tamanho e delegam; a UI recebe DTOs mínimos. O único adapter é local e
determinístico, com teto `VALIDATED_LOCALLY` e sem egress. A decisão central de
privacidade precede qualquer efeito associado a Lead. Consulte
[`INTEGRATIONS.md`](./INTEGRATIONS.md).

## Módulo `geography` — inteligência local

`src/modules/geography` separa normalização/evidência, aplicação e persistência.
Server Components consultam o serviço diretamente; o Route Handler autentica,
valida origem/tamanho e delega mutações. O serviço reutiliza `MetricsService`,
aplica RBAC/workspace, lock transacional e idempotência. Observações e
memberships são fatos append-only; perfil e status territorial são projeções
controladas. A UI recebe somente agregados e não acessa Prisma. O provider local
de geocoding retorna ausência deterministicamente e nenhum egress existe.

## Módulo `communications` — inbox omnichannel local

`src/modules/communications` concentra contratos de canal, identidade de
endereço, estados de conversa/mensagem, serviço do inbox e backfill. Server
Components e Route Handlers autenticam e delegam ao serviço; a UI nunca acessa
Prisma. Entrada e saída reutilizam `WebhookInbox`, `OutboxEvent` e `Job`, com
idempotência, locks e auditoria no mesmo workspace. `Message` é a fonte canônica
do conteúdo; `Activity` guarda apenas a referência e o resumo comercial.

Privacidade é avaliada pela CRM-36 antes do enqueue e do retry. A única entrega
executável é o simulador local, explicitamente marcado e sem egress. O desenho
completo está em [`OMNICHANNEL_INBOX.md`](./OMNICHANNEL_INBOX.md).

## Módulo `integrations/whatsapp` — CRM-44

A CRM-44 especializa a fronteira WhatsApp sem criar uma segunda fonte de
mensagens. `Conversation`, `Message` e `MessageStatusEvent` continuam canônicos;
`WhatsAppConnectionProfile` guarda somente identidade operacional, modo,
elegibilidade e referências de conta, nunca segredo. O modo executável é o
simulador local. A ativação externa permanece bloqueada por revisão de política,
credenciais e homologação futura.

O Route Handler público lê o corpo cru com limite, valida
`X-Hub-Signature-256` antes do parse, confirma o tenant pelo número/conta e
persiste `WebhookInbox` mais `Job` na mesma transação. O worker usa PostgreSQL
com `SKIP LOCKED`, lock com expiração, advisory lock por identidade ou mensagem,
retry limitado e dead-letter. Eventos repetidos são idempotentes e estados
atrasados viram revisão sem rebaixar a projeção corrente. Nenhum caminho do
worker chama o transporte externo.

A saída continua no `OmnichannelService`: privacidade, opt-out, janela de 24
horas e template aprovado são avaliados antes do outbox. O transporte real é
um adapter isolado e fail-closed, com host fixo, timeout, redirect bloqueado e
opt-in construtivo de egress; ele não é instanciado pelo runtime atual. Consulte
[`WHATSAPP_CLOUD_API.md`](./WHATSAPP_CLOUD_API.md).

## Módulo `integrations/email` — CRM-45

A CRM-45 mantém `Conversation` e `Message` como fontes canônicas e adiciona
somente fatos específicos de e-mail: profile de conexão/sender, headers e
destinatários, observações de domínio, suppressions e revisões. O
`OmnichannelService` continua sendo a porta de composição; o
`EmailMessageWorkerService` consome apenas jobs `OMNICHANNEL_MESSAGE` do canal
EMAIL e usa exclusivamente `LocalEmailSinkTransport`.

Threading usa `Message-ID`, `In-Reply-To` e `References`, nunca assunto. O worker
repete a política de supressão antes do efeito, usa lock PostgreSQL e registra
status/tentativa/auditoria. O adapter SMTP é fail-closed, sem implementação de
rede no runtime. Consulte [`EMAIL_CHANNEL.md`](./EMAIL_CHANNEL.md).

## Módulo `integrations/telephony` — CRM-46

A telefonia reutiliza `Conversation` e `Message` como contexto canônico e
adiciona `PhoneCall` como agregado técnico. `TelephonyService` resolve o alvo e
aplica workspace, RBAC, privacidade, telefone confiável, janela de contato e
owner/fila antes de gravar chamada, mensagem, outbox, job e auditoria na mesma
transação. Nenhuma rota acessa Prisma diretamente a partir da interface.

O worker consome `TELEPHONY_CALL` com `SKIP LOCKED`, lease, tentativa, backoff e
dead-letter. O único adapter ativo é determinístico e local; o adapter externo
é fail-closed. Status append-only alimentam a projeção sem regressão, e pernas
separadas preservam transferências. Resultado humano, atividade e próxima ação
passam por writer de domínio; o estado técnico não move pipeline. Consulte
[`TELEPHONY_CHANNEL.md`](./TELEPHONY_CHANNEL.md).

## Módulo `integrations/calendar` — CRM-47

O calendário mantém `Meeting` e `MeetingHistory` canônicos e acrescenta uma
projeção bidirecional somente no sandbox local. O serviço grava link,
`IntegrationSyncRun`, inbox/outbox, evento e job de forma transacional. O worker
PostgreSQL usa `SKIP LOCKED`, lease, retry/backoff, dead-letter e cursor
commit-safe. Entradas passam pelo `MeetingService`; conflitos nunca usam
last-write-wins e exigem resolução humana.

O adapter local é determinístico e declara `externalEgress: false`; a fronteira
externa falha fechada. Retomadas reconhecem o evento já gravado no histórico do
domínio, evitando repetir a mutação entre a aplicação comercial e a finalização
técnica. Consulte [`CALENDAR_CHANNEL.md`](./CALENDAR_CHANNEL.md).

## CRM-48 — contratos comerciais versionados

O módulo `contracts` fica entre negociação e receita. O serviço lê
`Opportunity`/`Offer`, cria snapshots em transação serializável e expõe comandos
com RBAC; páginas e rotas não acessam o banco. Eventos contratuais e auditoria
são separados. HTML é gerado no servidor com variáveis allowlisted e conteúdo
escapado. Não há transporte ou assinatura externa. Consulte
[`COMMERCIAL_CONTRACTS.md`](./COMMERCIAL_CONTRACTS.md).
# CRM-50 — pagamentos em sandbox local

O módulo `payments` separa quatro fatos: `Invoice` é a cobrança e seu snapshot;
`PaymentAttempt` é uma tentativa assíncrona; `Payment` existe apenas após
callback confirmado e reconciliado; `RevenueMovement` continua fora deste
fluxo. Eventos de pagamento e linhas da cobrança são append-only. Outbox e Job
PostgreSQL usam idempotency key, `SKIP LOCKED`, lease, retry/backoff e
dead-letter; o adaptador ativo é local, determinístico e declara
`externalEgress=false`.

O endpoint local recebe corpo limitado, timestamp, nonce e assinatura HMAC com
comparação timing-safe. A validação acontece antes da persistência. Eventos sem
referência exata, fora de ordem ou com valor/moeda divergente criam uma questão
de reconciliação; somente decisão humana autorizada vincula e reprocessa. O
worker nunca chama provider externo nem contorna serviços de domínio.
## CRM-58 — experiência operacional por função e entidades 360

A raiz autenticada é uma composição server-first. O route component resolve o
`AuthenticatedContext` e chama `WorkspaceExperienceService`; o componente
cliente recebe somente o contrato serializável e controla a troca de visão na
URL. A seleção disponível deriva de papel, permissões e assignments ativos. A
prioridade é ordenada de modo determinístico por severidade, prazo e ID; zero,
ausência e cobertura parcial permanecem estados distintos.

`Account 360` continua usando `AccountService`, enquanto `Contact 360` e a
busca global usam `WorkspaceExperienceService`. Nenhum componente consulta
Prisma. As telas agregam os fatos já canônicos — ownership, lifecycle, leads,
oportunidades, contratos, assinaturas, onboarding, CS, solicitações, renovações,
conversas, reuniões e atividades — sem duplicar a fonte da verdade. Timelines
são cronológicas, paginadas e identificam a tabela de proveniência.

A rota `GET /api/search` é `no-store`, exige sessão e aplica limite local por
workspace, membro e cliente. A busca exige dois caracteres, limita página e
tamanho e aplica os predicados `OWN`, `TEAM` ou `WORKSPACE` dentro de cada query
antes da projeção. Só campos de contexto seguros são selecionados; telefone ou
e-mail canônico é mascarado no serviço antes de chegar ao JSON. O modal cliente
usa debounce, cancelamento por `AbortController`, Escape, retorno de foco e
contenção de Tab. Não existe provider, indexador externo ou egress.

Esta task não exigiu migration: todas as projeções reutilizam tabelas e índices
canônicos existentes. Busca textual avançada, ranking por relevância e índice
dedicado permanecem evolução futura condicionada a evidência de escala.

## CRM-59 — IA governada

A execução continua dentro do monólito modular. O serviço autorizado seleciona
o caso de uso aprovado; a política aplica allowlist, redação e fingerprint; o
adapter governado impõe timeout, retry, circuit breaker, taxa e orçamento; o
provider local produz saída determinística; Zod rejeita contrato inválido.

```text
serviço autorizado + caso de uso aprovado
                 ↓
allowlist + redação + fingerprint
                 ↓
adapter governado → MockAIProvider local
                 ↓
Zod strict + AIInsight + AIExecutionTrace
                 ↓
proposta revisável + decisão humana append-only
```

`AIUseCaseVersion` é a fonte canônica da configuração publicada.
`AIGovernanceEvent`, `AIHumanDecision` e `AIEvaluationResult` preservam história
append-only. O adapter externo exige configuração explícita dupla e não é
instanciado pelo runtime padrão.

## CRM-60 — fronteira governada para n8n

O monólito expõe contratos locais v1 sobre o outbox e DTOs mínimos. Identidades
de máquina têm ator `AUTOMATION`, responsável humano, escopos, expiração,
rotação e kill switch. O token completo existe somente na resposta de criação ou
rotação; o banco guarda hash e fingerprint.

Comandos externos são estritos, assinados e idempotentes. Resultado técnico pode
ser registrado; rascunho ou ação consequencial cria proposta revisável e não
altera o domínio. O outbox mantém retry/dead-letter/replay e a profundidade de
causação limita loops. Consulte [`N8N_SANDBOX.md`](./N8N_SANDBOX.md).

## CRM-61 — qualidade de dados governada

`DataQualityService` é a única fronteira de aplicação para varredura,
tratamento de ocorrências, reconciliação, decisão de duplicidade e merge. A API
deriva workspace e ator da sessão, aplica RBAC no servidor e nunca aceita tenant
do payload. Regras publicadas são versionadas e imutáveis; ocorrências possuem
owner ou fila, SLA, evidência minimizada e histórico append-only.

O merge de Contact/Account é sempre humano, campo a campo e reversível enquanto
o fingerprint pós-merge permanecer intacto. Locks consultivos, revisão otimista,
idempotência e transação mantêm a entidade sobrevivente, relações e ledger
consistentes. Fatos contratuais/financeiros bloqueiam a operação. Consulte
[`DATA_QUALITY.md`](./DATA_QUALITY.md).

## CRM-62 — operação governada local

O módulo `operations` lê fatos canônicos de API, jobs, outbox, automações,
qualidade e privacidade; não mantém projeção comercial paralela. Contratos Zod
v1 entram pela rota dinâmica `/api/operations`, que deriva ator/workspace da
sessão, aplica same-origin, limite de corpo, rate limit e RBAC. O sink de
telemetria é local, append-only e desacoplado do commit comercial.

SLOs e regras são versionados. Alertas usam dedup/cooldown e incidentes possuem
timeline append-only, impacto, owner, runbook e revisão otimista. DSRs reutilizam
o domínio de privacidade; preview e checkpoint são idempotentes e sempre
`destructiveExecution=false`. Veja
[`OBSERVABILITY_SECURITY_PRIVACY.md`](./OBSERVABILITY_SECURITY_PRIVACY.md).
