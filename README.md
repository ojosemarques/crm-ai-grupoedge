# Politizai CRM

## Ambiente atual do CRM

Este checkout está vinculado ao repositório
[`ojosemarques/crm-ai-grupoedge`](https://github.com/ojosemarques/crm-ai-grupoedge),
ao projeto Supabase `zbzztpzviyjxpprqcegs` e ao projeto Vercel
`crm-ai-grupoedge` da equipe Grupo Edge. A configuração e os procedimentos
atuais estão em [`docs/SUPABASE_VERCEL_DEPLOYMENT.md`](docs/SUPABASE_VERCEL_DEPLOYMENT.md).
Os relatórios abaixo descrevem ambientes e datas anteriores e não representam
o estado deste novo projeto.

Ambiente web protegido de staging: <https://crm-politizai-staging.vercel.app>.
O acesso exige autenticação no team Vercel antes do login do CRM.
Use apenas dados sintéticos; limites, credenciais locais e evidências estão em
[`docs/STAGING_DEPLOYMENT.md`](./docs/STAGING_DEPLOYMENT.md) e
[`docs/STAGING_WORKER_REPORT.md`](./docs/STAGING_WORKER_REPORT.md) e
[`docs/FREE_STAGING_ENVIRONMENT.md`](./docs/FREE_STAGING_ENVIRONMENT.md). Esse
ambiente não é produção e não autoriza uso com dados reais.

CRM interno da operação comercial permanente e pós-eleitoral da Politizai.

Os ensaios locais de recuperação e capacidade da CRM-63 estão descritos em
[`docs/RESILIENCE_CAPACITY.md`](./docs/RESILIENCE_CAPACITY.md). Os comandos
`pnpm resilience:restore` e `pnpm resilience:load` iniciam em dry-run; execução
exige `--execute` e opera somente em alvo local descartável.

O gate final da CRM-64 aprovou a aplicação para homologação **local/isolada** e
a PROD-03 preparou o código, sem deploy, para configuração futura de staging e
produção. Execute `pnpm readiness:preflight` antes de uma
homologação local. A decisão, os blockers e as evidências estão em
[`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md),
[`docs/GO_LIVE_CHECKLIST.md`](./docs/GO_LIVE_CHECKLIST.md) e
[`docs/ACCEPTANCE_REPORT.md`](./docs/ACCEPTANCE_REPORT.md). Isso não autoriza
deploy, banco remoto, credencial externa nem dados reais.

O repositório contém a fundação executável, o modelo relacional, autenticação
local com autorização no servidor e o serviço transacional de entrada de leads.
Cada entrada recebe, no mesmo commit, responsável por round-robin ou Fila Geral,
tarefa `Ligar agora` e ciclo do SLA imediato. A tela de entrada oferece cadastro
manual, CSV, webhook local e simulador controlado. O histórico operacional do
lead permite registrar atividades, tarefas, resultados, correções e próxima
ação sobre uma timeline persistida. A lista operacional oferece busca,
paginação, filtros relacionais, colunas configuráveis, visualizações salvas e
redistribuição em massa autorizada. A fila Meu Dia apresenta as pendências por
ordem operacional, explica cada recomendação e mantém o relógio de SLA em
segundos. O pipeline de pré-vendas possui quadro e lista, oito etapas
semânticas e transições validadas no servidor. A agenda interna permite
agendar, confirmar, remarcar, cancelar e registrar show/no-show em reuniões de
30 ou 40 minutos, com conflitos, histórico e briefing persistido para o closer.
O pipeline de vendas separado conecta reunião, oportunidade, produto, proposta,
negociação, ganho e perda, preservando valores em centavos, próxima ação,
histórico e auditoria. O dashboard reconciliável e a infraestrutura local de
jobs/automações já existem. As 12 regras predefinidas cobrem entrada, cadências,
qualificação, lembretes, no-show, saúde do processo e encerramento. Efeitos de
contato são internos e explicitamente simulados. A fundação de IA possui
contratos, prompts versionados, provider local determinístico e fallback
auditável. O cartão do lead oferece análise, briefing, extração e próxima ação
com revisão humana; `/copilot` responde às oito consultas gerenciais
predefinidas usando a mesma camada de métricas e registros do dashboard.
Em `/metricas-receita`, o catálogo versionado cruza aquisição, bookings,
MRR/ARR, caixa, retenção, coortes, meta e forecast com comparação e drilldown
autorizado; as definições estão em `docs/REVENUE_METRICS.md`.

Em `/qualidade-dados`, regras determinísticas e versionadas geram ocorrências
com owner/fila, SLA e evidência mínima. A operação oferece diagnóstico sem
mutação, varredura idempotente, reconciliação e merge humano reversível de
contatos e contas. Consulte [`docs/DATA_QUALITY.md`](docs/DATA_QUALITY.md).

A área `/auditoria` oferece trilha append-only pesquisável e achados
determinísticos de saúde do processo. Administradores e gestores podem executar
a varredura, reconhecer evidências e resolver condições já corrigidas sem
apagar o fato original. Dados sensíveis são mascarados na resposta da tela.

O Administrador também possui `/configuracoes`, com produtos, ofertas, motivos,
pipelines, scoring, SLA, PACTO, cadência, reuniões e distribuição persistidos.
Alterações mostram impacto, exigem confirmação, respeitam o workspace e geram
auditoria; versões anteriores continuam reproduzíveis.

A interface autenticada possui navegação lateral única, cabeçalho compacto,
tabelas densas, foco visível, estados consistentes e comportamento responsivo.
Prioridade, etapa e saúde operacional usam semânticas visuais distintas e nunca
dependem apenas de cor. As decisões e os testes do sistema visual estão em
[`docs/VISUAL_SYSTEM.md`](docs/VISUAL_SYSTEM.md).

A página inicial é orientada ao papel ativo e apresenta uma única prioridade
determinística para SDR, Closer, Farmer, Customer Success, Gestão ou
Administração. Usuários multifunção podem alternar apenas entre visões
autorizadas. A busca global (`Ctrl/Cmd + K`) consulta contas, contatos, leads e
oportunidades no servidor, com escopo por workspace/equipe/owner e dados de
contato mascarados antes da serialização. Account 360 e Contact 360 agregam os
fatos canônicos relacionados sem criar cópias ou inferências destrutivas.

O cartão 360 também possui a qualificação PACTO estruturada. Rascunhos,
validação humana, evidências e revisões são persistidos; sinais do formulário e
sugestões de IA permanecem separados do estado vigente.

O scoring da CRM-13 calcula de 0 a 100 por uma regra versionada e mostra P1
(70–100), P2 (40–69) ou P3 (0–39). Formulário, PACTO validado, sugestão de IA e
override humano são registros distintos. Somente `LeadCurrentScore` é usado
como pontuação vigente; sugestões de IA nunca o substituem silenciosamente.

A área `/aquisicao` reúne jornada e atribuição local: landing pages e
formulários versionados, sessões minimizadas, touchpoints, conversões, modelos
first-touch/last-touch/linear, cobertura e revisões. Atribuição é apresentada
como correlação reproduzível, não causalidade. A finalidade permanece
`PENDING_LEGAL`; não há provider, credencial, pixel, custo de mídia ou egress.
Detalhes estão em
[`docs/MARKETING_ATTRIBUTION.md`](docs/MARKETING_ATTRIBUTION.md).

## Pré-requisitos

- Node.js 22.12 ou superior, dentro da linha 22;
- pnpm 11.14;
- Docker 28 ou compatível;
- Docker Compose 2.39 ou compatível.

Não é necessário instalar PostgreSQL na máquina. O banco roda em Docker.

## Início rápido

Na raiz do projeto:

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Acesse:

- aplicação: http://localhost:3000
- dashboard executivo: http://localhost:3000/dashboard
- login local: http://localhost:3000/login
- health check: http://localhost:3000/api/health
- entrada local de leads: http://localhost:3000/leads/entrada
- lista operacional de leads: http://localhost:3000/leads
- fila priorizada do SDR: http://localhost:3000/meu-dia
- pipeline de pré-vendas: http://localhost:3000/pipeline
- agenda interna: http://localhost:3000/agenda
- pipeline de vendas: http://localhost:3000/oportunidades
- metas e quotas: http://localhost:3000/metas
- forecast comercial: http://localhost:3000/forecast
- cobranças e pagamentos em sandbox: http://localhost:3000/pagamentos
- handoff e onboarding local: http://localhost:3000/onboarding
- configurações comerciais: http://localhost:3000/configuracoes
- auditoria e saúde do processo: http://localhost:3000/auditoria
- privacidade e retenção: http://localhost:3000/privacidade
- aquisição e atribuição local: http://localhost:3000/aquisicao
- integração Meta Ads read-only: http://localhost:3000/integracoes/meta-ads
- integração Google Ads read-only: http://localhost:3000/integracoes/google-ads
- telefonia local simulada: http://localhost:3000/integracoes/telefonia
- inteligência geográfica local: http://localhost:3000/inteligencia-geografica
- inbox omnichannel local: http://localhost:3000/inbox
- contas canônicas: http://localhost:3000/contas
- Account 360: `http://localhost:3000/contas/{accountId}`
- Contact 360: `http://localhost:3000/contatos/{contactId}`
- histórico de um lead: `http://localhost:3000/leads/{leadId}/historico`

Metas e quotas possuem período civil no timezone do workspace, versões
imutáveis após publicação, alvos por pessoa/equipe/função e progresso calculado
dos fatos persistidos. Veja [`docs/GOALS_AND_QUOTAS.md`](docs/GOALS_AND_QUOTAS.md).

Forecast usa submissões humanas versionadas e snapshots imutáveis de pipeline,
best case e commit, sem dupla contagem ou previsão fictícia. O override do gestor
fica separado do bottom-up. Veja [`docs/FORECAST.md`](docs/FORECAST.md). O
diagnóstico legado começa em dry-run com
`pnpm db:forecast:backfill -- --run-key=crm56:dry-run:manual`.

### Pagamentos em sandbox local

`/pagamentos` cria uma cobrança explícita a partir de assinatura ativa, preserva
o snapshot dos itens e permite executar cenários determinísticos de sucesso,
recusa, timeout, falha permanente, chargeback e divergência. O worker normal
(`pnpm worker`) processa as tentativas e os callbacks assinados. Não há egress,
provider real, credencial de produção, cartão, PIX, dados bancários, ERP,
contabilidade ou emissão fiscal. Confirmação de pagamento não cria
`RevenueMovement`; o ledger de receita mantém competência e fatos próprios.

O backfill é deliberadamente conservador e pode ser inspecionado com
`pnpm db:payments:backfill`; `--execute` apenas registra itens que exigem revisão
humana e nunca fabrica cobrança ou pagamento.

### Handoff e onboarding local

`/onboarding` separa ganho, contrato aceito, envio, aceite, ativação e conclusão.
Marcos versionados exigem evidência humana; todos os casos mantêm owner, próxima
ação e prazo. O backfill começa em dry-run com
`pnpm db:onboarding:backfill -- --run-key=<chave>`; use `--execute` somente
após revisar os candidatos. Ausências viram revisão, nunca ativação inferida.

### Customer Success local

`/customer-success` reúne carteira, próxima ação, plano de sucesso e saúde
versionada. O score mostra evidências e mantém ausência como dados insuficientes,
sem inferir nota negativa. O seed inclui quatro cenários fictícios identificados.
O backfill começa em dry-run com
`pnpm db:customer-success:backfill -- --run-key=<chave>`; adicione `--execute`
somente após revisar a prévia. Consulte `docs/CUSTOMER_SUCCESS.md`.

A página inicial é protegida e redireciona para o login. `pnpm db:seed` cria o
workspace, as contas fictícias e uma base operacional identificada com 320 leads
distribuídos pelos últimos 30 dias. O comando é idempotente, preserva registros
manuais e recusa execução com `NODE_ENV=production` ou host de banco não local.
Todos os contatos usam nomes explícitos de demonstração, e-mails
`example.invalid` e uma faixa telefônica não roteável; nenhuma identidade real é
incluída.

### Contas exclusivamente locais

Use o workspace `politizai`. Todas as contas abaixo usam a senha compartilhada
`Politizai#Local2026`:

| Papel | E-mail |
|---|---|
| Administrador | `admin@demo.politizai.local` |
| Gestor comercial | `gestor@demo.politizai.local` |
| SDR 1 | `sdr1@demo.politizai.local` |
| SDR 2 | `sdr2@demo.politizai.local` |
| SDR 3 | `sdr3@demo.politizai.local` |
| Closer 1 | `closer1@demo.politizai.local` |
| Closer 2 | `closer2@demo.politizai.local` |
| Visualizador | `viewer@demo.politizai.local` |

Essas credenciais são públicas por desenho e servem somente para o PostgreSQL
local. Não reutilize a senha e não execute o seed contra dados reais.

O liveness não consulta dependências e responde HTTP 200 em `/api/health`:

```json
{
  "service": "politizai-crm",
  "status": "ok"
}
```

O timestamp também é retornado. `/api/ready` consulta somente o PostgreSQL e
responde `ready: false`, HTTP 503 e `database: error` sem expor host, versão,
credencial ou causa interna quando essa dependência estiver indisponível.

### Meta Ads somente leitura (opcional)

A CRM funciona integralmente sem credencial Meta. Nesse modo, a página
`/integracoes/meta-ads` mostra `Aguardando credenciais` e nenhuma chamada externa
é executada. Para uma validação futura, configure `META_ADS_ACCESS_TOKEN` e,
opcionalmente, `META_ADS_APP_SECRET` apenas no `.env` local não versionado,
reinicie o servidor e siga o teste/seleção explícita de contas na interface.
Nunca cole esses valores na UI. O conector só consulta hierarquia e insights;
não altera campanhas, anúncios ou dados comerciais. Consulte
[`docs/META_ADS.md`](docs/META_ADS.md).

### Google Ads somente leitura (opcional)

A CRM funciona sem credencial Google. `/integracoes/google-ads` permite
versionar a configuração sem receber segredos e mostra “Validação externa
adiada”. OAuth/service account, projeto Google Cloud e customers reais não foram
testados nesta fase. Uma autorização futura deve configurar somente referências
server-side e seguir [`docs/GOOGLE_ADS.md`](docs/GOOGLE_ADS.md). O conector não
possui rota Mutate e não cria campanhas, anúncios, públicos ou conversões. As
pendências externas consolidadas estão em
[`docs/EXTERNAL_VALIDATIONS.md`](docs/EXTERNAL_VALIDATIONS.md).

### Inteligência geográfica local

`/inteligencia-geografica` apresenta mapa esquemático offline, tabela acessível,
métricas regionais e territórios versionados com os mesmos filtros, permissões e
dados do CRM. Não há tiles, geocoder, IP ou envio de localização a terceiros.
Grupos com menos de cinco leads são suprimidos e fatos, inferências e confirmações
humanas permanecem distintos.

Para reconciliar somente cidade/UF explicitamente persistidas, sempre comece
com o dry-run:

```bash
pnpm db:geography:backfill
pnpm db:geography:backfill -- --execute
```

A CLI recusa produção, banco remoto, banco diferente de `politizai_crm` e schema
diferente de `public`; o replay é idempotente e não altera owner, equipe ou
lifecycle. Consulte
[`docs/GEOGRAPHIC_INTELLIGENCE.md`](docs/GEOGRAPHIC_INTELLIGENCE.md).

### Inbox omnichannel local

`/inbox` reúne conversas, mensagens, responsabilidade explícita, SLA de resposta,
status de entrega e revisões de identidade. A CRM-43 funciona somente com o
simulador local: não existe conexão com WhatsApp, e-mail, telefonia, SMS ou
Instagram e nenhuma mensagem sai da máquina. As políticas jurídicas permanecem
pendentes, portanto a saída normal é bloqueada ou exige revisão conforme a
decisão central de privacidade.

Para reconciliar fatos legados, comece sempre pelo dry-run:

```bash
pnpm db:omnichannel:backfill
pnpm db:omnichannel:backfill -- --execute
```

O comando recusa produção e banco remoto; o replay é idempotente. Contratos,
estados e limitações estão em
[`docs/OMNICHANNEL_INBOX.md`](docs/OMNICHANNEL_INBOX.md).

### WhatsApp — fundação local da CRM-44

`/integracoes/whatsapp` disponibiliza configuração e simulação determinísticas,
janela de atendimento, templates locais, status, retries e falhas sobre o Inbox
canônico. O modo padrão não usa credencial nem acessa a Meta. A ativação externa
está bloqueada por revisão de elegibilidade da política do WhatsApp e por falta
de uma homologação autorizada com WABA/número/templates de teste.

Para reconciliar somente janelas ausentes a partir de mensagens inbound já
persistidas, execute primeiro o dry-run:

```bash
pnpm db:whatsapp:backfill -- --run-key=crm44:dry:v1
pnpm db:whatsapp:backfill -- --execute --run-key=crm44:execute:v1
```

O comando recusa produção, banco remoto e schema fora de `public`. Consulte
[`docs/WHATSAPP_CLOUD_API.md`](docs/WHATSAPP_CLOUD_API.md) para segurança,
política de 24 horas, opt-out, worker e checklist de validação externa.

### E-mail — sink local da CRM-45

`/integracoes/email` mostra o sender fictício, a prontidão de domínio, eventos,
suppressions e revisões; `/inbox?channels=EMAIL` reutiliza a inbox canônica. O
único transporte ativo é um sink determinístico dentro do processo: nenhum
SMTP, DNS, mailbox, webhook público ou provider é acessado e
`PROVIDER_ACCEPTED` não é apresentado como entrega.

Para reconciliar somente mensagens históricas já classificadas como `EMAIL`,
comece pelo dry-run e use uma chave explícita no modo efetivo:

```bash
pnpm db:email:backfill -- --run-key=crm45:dry:v1
pnpm db:email:backfill -- --execute --run-key=crm45:execute:v1
```

A CLI recusa produção, host remoto, banco diferente de `politizai_crm` e schema
diferente de `public`. A mesma chave é idempotente. Threading por `Message-ID`,
retry/dead-letter, bounce, complaint, unsubscribe e a lista completa de
pendências externas estão em [`docs/EMAIL_CHANNEL.md`](docs/EMAIL_CHANNEL.md).

### Telefonia — simulador local da CRM-46

`/integracoes/telefonia` permite iniciar, acompanhar, cancelar, reprocessar e
registrar o resultado de cenários determinísticos. A fila, os eventos, o SLA, a
timeline e a auditoria são persistidos; nenhuma chamada usa PSTN, SIP, áudio,
gravação, transcrição, provider ou credencial externa.

O backfill conservador deve começar em dry-run:

```bash
pnpm db:telephony:backfill -- --run-key=crm46:dry:v1
pnpm db:telephony:backfill -- --execute --run-key=crm46:execute:v1
```

A CLI é local-only e não fabrica duração, atendimento ou recording reference.
Arquitetura, privacidade, estados e pendências de homologação estão em
[`docs/TELEPHONY_CHANNEL.md`](docs/TELEPHONY_CHANNEL.md).

Para reconciliar submissões legadas sem fabricar evidência de navegação:

```bash
pnpm db:marketing:backfill -- --mode=dry-run --limit=2000
pnpm db:marketing:backfill -- --mode=execute --limit=2000
```

O comando opera somente no banco local `politizai_crm`, registra execução e
replay idempotentes e mantém os touchpoints derivados inelegíveis até revisão.

## Entrada local de leads

Após entrar como Administrador, Gestor comercial ou SDR, acesse
`/leads/entrada`. A tela permite:

- cadastrar um lead manualmente sem perder campos em caso de erro;
- enviar CSV, mapear colunas, revisar válidos/inválidos/duplicados e confirmar;
- baixar o relatório persistido das linhas rejeitadas;
- testar um webhook apenas local e idempotente;
- gerar cenários fictícios P1, P2, P3 e duplicado com semente reproduzível.

O webhook e o gerador são bloqueados fora de loopback e em produção. Não existe
integração real com plataformas externas. CSVs são limitados a 2 MiB e 2.000
linhas; o worker atual processa somente automações e não foi conectado ao import.
Consulte
[`docs/LEAD_ENTRY_CHANNELS.md`](docs/LEAD_ENTRY_CHANNELS.md) para contratos,
idempotência e respostas.

### Identidade canônica de contatos

Cada entrada aceita mantém os campos legados do Lead e cria/liga, na mesma
transação, um `Contact` com seus `ContactPoint`. Telefone ou e-mail compartilhado
entre pessoas abre revisão humana; o sistema não faz merge automático. No Lead
360, a aba **Identidade** mostra o vínculo, pontos e revisões conforme as
permissões `contacts.read` e `contacts.review`.

O backfill é exclusivamente local, limitado ao workspace autenticado e começa
em dry-run:

```bash
pnpm db:contacts:backfill -- --mode=dry-run --batch-size=100
pnpm db:contacts:backfill -- --mode=execute --batch-size=100
```

A CLI recusa produção, host remoto, banco diferente de `politizai_crm` e schema
diferente de `public`. A execução é persistida, retomável e idempotente; nunca
use o comando para ampliar o escopo a outros workspaces sem uma task explícita.

### Jornada de receita e responsáveis funcionais

Lead 360 e Account 360 mostram o lifecycle canônico separado de etapas e
status, os owners por função e transferências pendentes. Para migrar registros
legados, execute primeiro o dry-run e somente depois a confirmação local:

```bash
pnpm db:lifecycle:backfill -- --mode=dry-run
pnpm db:lifecycle:backfill -- --mode=execute
```

O backfill não infere ativação, renovação ou churn. A política, as constraints,
o dual write e o rollback estão em
[`docs/LIFECYCLE_AND_OWNERSHIP.md`](docs/LIFECYCLE_AND_OWNERSHIP.md).

## Histórico operacional

Depois de processar uma entrada, use o link **Abrir histórico operacional do
lead**. A tela permite registrar atividades, criar e concluir tarefas, informar
resultado e acrescentar uma próxima ação explícita. A primeira tentativa humana
é registrada por uma ligação; ela atualiza o ciclo de SLA uma única vez e
conclui a tarefa `Ligar agora` dentro da mesma transação.

A próxima ação é a tarefa ativa mais antiga por prazo, criação e ID. `Lead`
mantém apenas uma projeção vinculada a essa tarefa para consultas operacionais.
Leads abertos sem tarefa ativa são mostrados como erro operacional. Atividades
são fatos append-only: uma correção cria um novo evento e não reescreve o
original. A timeline identifica Pessoa, Sistema, Automação ou Agente de IA e é
carregada em páginas de 20 eventos.

## Qualificação PACTO

No cartão 360, abra a aba **PACTO** para investigar Político/contexto, Aflição,
Capacidade, Tomada de decisão e Oportunidade agora. Uma dimensão não preenchida
permanece **Não investigado**; ela não vira resposta negativa. Respostas
investigadas exigem evidência e origem, e podem ser salvas como rascunho antes
da validação humana explícita.

O mínimo inicial é cinco dimensões e pertence ao workspace. Cada salvamento
preserva uma revisão imutável com a regra usada. Formulário e IA aparecem em
áreas separadas e nunca substituem silenciosamente o estado humano. A validação
do PACTO não muda a etapa do lead nesta fase.

## Lista operacional de leads

Acesse `/leads` para buscar, paginar, combinar filtros, ordenar e escolher as
colunas da tabela. Filtros e ordenação ficam na URL; ao abrir um lead e voltar,
o recorte é preservado. Prioridade e pontuação usam a projeção vigente explícita
do scoring e recorrem à faixa histórica do ciclo de SLA somente para leads
anteriores sem score. Ausência aparece como ausência, sem valor inventado.

Visualizações salvas pertencem ao usuário e workspace autenticados. Gestores e
administradores com `leads.assign` podem selecionar até 100 registros e preparar
uma redistribuição, que exige motivo e confirmação. Cada lead é alterado pelos
serviços da distribuição e gera evento e auditoria próprios. O endpoint repete
a autorização mesmo quando a interface não mostra a ação.

## Meu Dia

Acesse `/meu-dia` para trabalhar a fila priorizada. A ordem é calculada no
PostgreSQL: respostas aguardando atendimento, novos P1, P2 e P3, retornos
vencidos e demais pendências. As seções Agora, Novos, P1, Aguardando ligação,
Responderam, Retorno para hoje, Atrasados, Reuniões de hoje e Sem próxima ação
usam somente tarefas, atividades, reuniões, etapas e ciclos de SLA persistidos.

Cada contagem abre `/leads` com o mesmo recorte operacional. O Gestor pode
selecionar um SDR de sua equipe; o SDR recebe apenas o escopo próprio e as filas
explicitamente autorizadas. O relógio visual avança no navegador a cada segundo,
mas há uma única atualização de dados a cada 30 segundos, além do botão
**Atualizar agora**. A ação recomendada é determinística e abre o fluxo
operacional já existente; não envia mensagens nem executa integrações externas.

## Agenda interna e briefing do closer

Acesse `/agenda` para alternar entre dia e semana e, quando o escopo permitir,
filtrar por closer. Reuniões usam o fuso do workspace (`America/Sao_Paulo` no
seed), aceitam 30 ou 40 minutos e rejeitam sobreposição com outro compromisso
ativo do mesmo closer. Agendamento e remarcação preservam histórico; cancelar
não é contabilizado como show ou no-show, e horários passados sem desfecho são
destacados como pendência operacional.

O agendamento cria a tarefa do closer, timeline, auditoria e transição válida
para **Reunião agendada** no mesmo commit. O cartão 360 mostra o histórico de
reuniões, enquanto `/agenda/reunioes/{meetingId}` reúne formulário, PACTO,
contexto, dor, decisão, capacidade, urgência, histórico, lacunas e próxima ação
persistida. `/integracoes/calendario` exercita projeção bidirecional em sandbox
determinístico local, preservando `Meeting` e `MeetingHistory` como fonte
oficial. Nenhum calendário externo, OAuth, credencial ou egress é acionado.

## Oportunidades, propostas, ganho e perda

Acesse `/oportunidades` para trabalhar o pipeline de vendas separado: Reunião
agendada, Reunião realizada, Oportunidade confirmada, Proposta, Negociação,
Ganho e Perdido. A visão alterna entre quadro e lista e filtra por closer,
produto, etapa e período previsto de fechamento. Contagens e cartões derivam
das oportunidades persistidas e do escopo permitido ao usuário.

Uma oportunidade nasce na aba **Oportunidade** do cartão 360, ligada a uma
reunião ativa e a um closer. Produto ou interesse explícito é obrigatório. Cada
etapa aberta exige uma tarefa de próxima ação vinculada; propostas exigem valor
ou justificativa. Valor estimado, MRR e TCV são armazenados em centavos e
exibidos em BRL, enquanto a probabilidade é exclusivamente manual nesta fase.

Ganho exige confirmação, valor, produto, responsável e data. Perda exige
confirmação e motivo do catálogo. O encerramento cancela somente tarefas abertas
da própria oportunidade por um serviço controlado. Reabertura é uma correção
gerencial: exige permissão adicional, motivo, confirmação e nova próxima ação.
Transições, propostas, encerramentos e reaberturas gravam `StageHistory`,
timeline e auditoria na mesma transação. A CRM-16 não adiciona pagamento,
assinatura, onboarding, previsão por IA ou integração externa.

## Autenticação e autorização

O login exige `workspace`, e-mail e senha. A senha é derivada com `scrypt` e sal
aleatório; a sessão usa um token opaco aleatório, enquanto o PostgreSQL recebe
somente o SHA-256 desse token. O cookie é `HttpOnly`, `SameSite=Lax`, limitado ao
caminho `/` e usa `Secure` em produção. Sessões expiram após 8 horas por padrão.

As seguintes variáveis locais podem ajustar a política sem conter segredos:

| Variável | Padrão | Regra |
|---|---:|---|
| `AUTH_SESSION_TTL_HOURS` | `8` | Entre 1 e 168 horas |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5` | Entre 3 e 20 falhas |
| `AUTH_LOCK_MINUTES` | `15` | Entre 1 e 1440 minutos |

Cinco papéis humanos formam a matriz inicial: Administrador, Gestor comercial,
SDR, Closer e Visualizador. Sistema, Automação e Agente de IA são atores
técnicos, sem senha e sem sessão humana. A função comercial no time é armazenada
separadamente do papel de acesso. Consulte [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)
para a matriz, os escopos e as regras obrigatórias para novas rotas.

## Administração de usuários e equipes

Acesse `/administracao` como Administrador para criar e editar usuários locais,
papéis, equipes, funções comerciais, disponibilidade e carga aberta. Toda
alteração mostra seu impacto antes da confirmação e é autorizada novamente no
servidor. Senhas são usadas somente para gerar hash e nunca são exibidas ou
registradas na auditoria.

O Gestor comercial acessa a mesma área com universo limitado às próprias
equipes. Ele pode pausar SDRs e redistribuir leads dentro do escopo permitido,
mas não cria identidades, não altera papéis e não edita equipes. Inativar uma
membership revoga sessões, preserva autoria e exige que leads abertos sejam
movidos atomicamente para outro SDR elegível ou para a Fila Geral. Consulte
[`docs/ADMINISTRATION.md`](docs/ADMINISTRATION.md) para as invariantes e limites.

## Modo local de IA

O CRM funciona sem chave e sem rede externa. `MockAIProvider` calcula sinais de
forma determinística, identifica campos ausentes, recomenda ação por estado e
produz resumos por template. O resultado separa fatos, inferências e ausências,
é validado por Zod e registrado com prompt, versão, provider, modo e auditoria.
Ele nunca altera PACTO, score, tarefa ou oportunidade.

A área protegida `/governanca-ia` mostra o registro versionado de casos de uso,
avaliações locais e observabilidade sem expor payloads. Gestores podem executar
o dataset determinístico; publicação, desativação e rollback exigem permissão
administrativa. Toda entrada passa por allowlist e redação antes do adapter.

`OpenAICompatibleProvider` existe apenas como adaptador injetável. Nenhuma
variável de chave foi adicionada ao `.env.example`, e o runtime padrão não o
instancia nem realiza chamadas externas. Consulte
[`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md).

## Scripts

| Comando | Finalidade |
|---|---|
| `pnpm dev` | Inicia o Next.js em desenvolvimento |
| `pnpm build` | Gera o Prisma Client e cria o build de produção |
| `pnpm start` | Executa o build de produção |
| `pnpm worker` | Executa o worker persistente quando o papel e a habilitação estão explícitos |
| `pnpm admin:bootstrap` | Executa bootstrap administrativo remoto protegido com variáveis efêmeras |
| `pnpm lint` | Executa ESLint |
| `pnpm typecheck` | Verifica tipos sem gerar arquivos |
| `pnpm test` | Executa testes unitários com Vitest |
| `pnpm test:ai:evals` | Executa o dataset local versionado de segurança e qualidade da IA |
| `pnpm test:integration` | Cria um schema local efêmero único, aplica migrations, testa e remove no `finally` |
| `pnpm test:crm29` | Cria um schema local efêmero único, valida a base demonstrativa e remove no `finally` |
| `pnpm test:watch` | Mantém Vitest observando mudanças |
| `pnpm test:e2e` | Recria um schema local, gera o build e executa E2E de produção + cenários locais |
| `pnpm audit` | Verifica vulnerabilidades conhecidas no lockfile |
| `pnpm db:up` | Sobe o PostgreSQL e aguarda o healthcheck |
| `pnpm db:down` | Para os containers sem apagar o volume |
| `pnpm db:logs` | Acompanha logs do PostgreSQL |
| `pnpm db:generate` | Gera o Prisma Client |
| `pnpm db:migrate` | Cria/aplica migrations durante desenvolvimento do schema |
| `pnpm db:migrate:deploy` | Aplica migrations já existentes |
| `pnpm db:seed` | Cria/preserva estrutura, contas e a base fictícia de 30 dias |
| `pnpm db:demo:reset` | Recria um schema local `politizai_demo*` após confirmação explícita |
| `pnpm db:test:migrate` | Aplica migrations no schema efêmero fornecido pelo executor seguro |
| `pnpm db:test:cleanup` | Lista, em dry-run, somente schemas locais comprovadamente descartáveis |
| `pnpm db:contacts:backfill` | Executa dry-run ou backfill local idempotente da identidade canônica |
| `pnpm db:lifecycle:backfill` | Executa dry-run ou backfill local conservador de lifecycle/ownership |
| `pnpm db:customer-success:backfill` | Pré-visualiza ou executa backfill conservador da carteira de CS |
| `pnpm db:status` | Exibe o estado das migrations |
| `pnpm readiness:preflight` | Valida local pelo contrato `prod03.1`; a CLI também aceita `--target=test|staging|production` |
| `pnpm db:studio` | Abre Prisma Studio |

Para executar o Playwright pela primeira vez, instale o Chromium gerenciado pela
ferramenta:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

O Playwright usa a porta 3100 para o build otimizado e a porta 3101 para o único
cenário `@local-only`, sem disputar a porta 3000 com uma execução manual. Cada
execução cria um nome único `politizai_test_e2e_*`, recusa PostgreSQL fora de
loopback e remove o schema mesmo quando o teste falha.

## Verificações antes de entregar uma mudança

Com o banco ativo:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:crm29
pnpm test:e2e
pnpm audit
pnpm build
```

## Worker local de automações

Depois de aplicar migrations e executar o seed, inicie o processo em outro
terminal:

```bash
PROCESS_ROLE=worker AUTOMATION_WORKER_ENABLED=true pnpm worker
```

Jobs ficam no PostgreSQL e são retomados após reinício. Retry usa backoff e
locks com expiração; a mesma chave não repete um efeito já confirmado. O seed
cria as 12 regras predefinidas ativas. A gestão e o histórico ficam em
`/automacoes`, e a central individual em `/notificacoes`. Mensagens geradas são registros locais
marcados como simulação; não há Redis, integração externa ou mensagem real.
Consulte [`docs/AUTOMATIONS.md`](docs/AUTOMATIONS.md).

## Banco local

O Compose usa PostgreSQL 17 e mantém dados no volume `postgres_data`. Os valores
de `.env.example` são exclusivamente locais. Use credenciais próprias fora do
ambiente de desenvolvimento e nunca versione `.env`.

Para confirmar a separação entre liveness e readiness:

```bash
docker compose stop db
curl -i http://localhost:3000/api/health
curl -i http://localhost:3000/api/ready
pnpm db:up
```

O liveness permanece HTTP 200; o readiness retorna HTTP 503 enquanto o banco
estiver parado.

## Preparação de ambientes remotos

`.env.staging.example` e `.env.production.example` são inventários sem valores.
Staging e produção exigem `APP_ENV`, URL canônica HTTPS, allowlists, cookies
seguros, logs JSON e `DATABASE_URL` pooled com expectativas explícitas de
host/banco/schema/TLS. Somente o papel isolado de migration recebe uma
`DIRECT_URL` distinta; web, worker e bootstrap recusam essa credencial para
aplicar menor privilégio. Não há fallback entre as URLs fora de local/test. O
build da Vercel usa Node 22, pnpm 11 e Webpack em `gru1`; isso é somente
configuração versionada, não um deployment.

O bootstrap inicial não possui rota HTTP. `pnpm admin:bootstrap` exige papel de
processo `bootstrap`, confirmação literal, segredo temporário, chave de
idempotência e senha forte; cria a fundação em uma única transação e grava o
marcador append-only sem e-mail ou senha. Use somente numa task de staging ou
produção explicitamente autorizada e remova todas as variáveis
`ADMIN_BOOTSTRAP_*` imediatamente após o sucesso.

`pnpm db:down` preserva o volume. O único reset disponível exige um schema
separado cujo nome comece com `politizai_demo` e confirmação textual exata; ele
nunca aceita `public`. Para atualizar as datas relativas da demonstração sem
tocar em registros manuais de outros schemas:

```bash
export DATABASE_URL="postgresql://politizai:politizai_local_only@localhost:5432/politizai_crm?schema=politizai_demo_local"
export DEMO_RESET_CONFIRM="RESET politizai_demo_local"
pnpm db:demo:reset
```

O reset remove somente o schema nomeado, reaplica migrations e executa o seed.
Não use esse schema para dados manuais que devam sobreviver ao reset. Reexecutar
apenas `pnpm db:seed` mantém IDs, contagens e datas, sem reescrever históricos
append-only.

Os testes relacionais derivam a conexão de `DATABASE_URL`, trocam apenas o
schema por um nome efêmero estritamente validado e executam as mesmas migrations.
O executor recusa banco remoto, banco diferente de `politizai_crm`, produção e
o schema `public`. O padrão sempre remove o schema em `finally`. Para depuração,
`KEEP_TEST_SCHEMA=1 pnpm test:integration` preserva somente aquela execução e
informa o comando seguro de limpeza.

Para inspecionar resíduos sem alterar o banco:

```bash
pnpm db:test:cleanup
```

A remoção exige a confirmação literal exibida pelo próprio dry-run. Consulte
[`docs/TEST_SCHEMA_LIFECYCLE.md`](docs/TEST_SCHEMA_LIFECYCLE.md). Backups locais
do schema `public`, restauração de ensaio e checksum estão documentados em
[`docs/LOCAL_DATABASE_BACKUP.md`](docs/LOCAL_DATABASE_BACKUP.md). O inventário
de armazenamento e o backup privado do código estão em
[`docs/STORAGE_AND_CLOUD_READINESS.md`](docs/STORAGE_AND_CLOUD_READINESS.md).
O comando cancela a limpeza se encontrar outra conexão cliente no banco. A
allowlist legada contém somente nomes comprovados pelo inventário forense; um
prefixo parecido nunca torna um schema removível.

A revalidação mais recente da PROD-01, após a CRM-41, confirmou o repositório
GitHub privado, restaurou em ensaio um backup exclusivo de `public`, encontrou
zero schema temporário residual e removeu somente artefatos regeneráveis dos
gates. O script `pnpm typecheck` executa `next typegen` antes do TypeScript,
como recomendado pelo Next.js 16 para clones limpos onde `next-env.d.ts` não é
versionado. Nenhum deploy, banco remoto, volume ou `node_modules` foi alterado.

## Solução de problemas

- **Docker não fica saudável:** execute `pnpm db:logs`, confirme que a porta
  `POSTGRES_PORT` não está ocupada e que Docker Desktop está em execução. Depois,
  rode `pnpm db:up` novamente.
- **Health check retorna 503:** confira se `.env` existe, se `DATABASE_URL`
  aponta para o PostgreSQL local e se `pnpm db:up` terminou com o serviço
  saudável. A resposta pública não mostra a credencial nem o erro interno.
- **Prisma informa migration pendente:** rode `pnpm db:migrate:deploy` e
  `pnpm db:generate`. Use `pnpm db:migrate` somente ao desenvolver uma nova
  migration, nunca como etapa de publicação.
- **Playwright não encontra o navegador:** rode
  `pnpm exec playwright install chromium` uma vez e repita `pnpm test:e2e`.
- **Porta da aplicação ocupada:** ajuste `PORT` para a execução manual. Preserve
  as portas 3100 e 3101 enquanto a suíte E2E estiver ativa.
- **Leitura de dependências trava em pasta sincronizada do macOS:** confirme se
  os arquivos de `node_modules` foram baixados pelo provedor de arquivos ou mova
  uma cópia do checkout para um volume local e execute `pnpm install` ali.

## Limitações do MVP local

- a validação é local e não certifica segurança, disponibilidade ou desempenho
  de produção;
- autenticação não possui recuperação de senha, convite, MFA, SSO ou rotação
  administrativa de credenciais;
- agenda, mensagens, lembretes e canais externos são internos ou simulados;
  nenhum WhatsApp, Instagram, anúncio, telefonia, e-mail, SMS ou provider de
  calendário externo é chamado;
- a IA padrão é determinística e local; o adaptador compatível externo não é
  configurado nem acionado pelo runtime padrão;
- rate limit é mantido em memória e serve apenas ao monólito local;
- CSV é processado de forma síncrona e limitado a 2 MiB/2.000 linhas;
- a suíte automatizada usa Chromium; outros navegadores e dispositivos exigem
  validação futura;
- o volume de 320 leads detecta regressões do MVP, mas não substitui teste de
  carga com volume real;
- o driver `pg` emite aviso de depreciação para consultas concorrentes no mesmo
  client; não há falha atual, mas a migração futura para `pg` 9 exige ajuste.

Antes de usar dados reais ou publicar, siga
[`docs/DEPLOYMENT_FUTURE.md`](docs/DEPLOYMENT_FUTURE.md). Nenhum deploy faz
parte deste repositório ou desta entrega.

## Documentação

- `docs/PRD.md`: objetivo e limites do produto;
- `docs/ARCHITECTURE.md`: arquitetura e regras de dependência;
- `docs/DATA_MODEL.md`: entidades, relações, invariantes e retenção;
- `docs/PRIVACY_AND_RETENTION.md`: consentimento, decisão prática, DSR,
  retenção e pendências jurídicas;
- `docs/INTEGRATIONS.md`: adapters locais, inbox/outbox, sync, referências de
  segredo e limites sem provider externo;
- `docs/OMNICHANNEL_INBOX.md`: conversas, mensagens, identidade, estados,
  privacidade, SLA, templates, backfill e canais futuros;
- `docs/CUSTOMER_SERVICE.md`: solicitações do cliente, SLA versionado, CSAT/NPS,
  RBAC, backfill conservador e limites sem help desk ou canal externo;
- `docs/FARMER.md`: renovação, expansão, contração e churn confirmados,
  métricas, RBAC, ledger e backfill conservador;
- `docs/GEOGRAPHIC_INTELLIGENCE.md`: dimensões geográficas, evidência,
  territórios, backfill, privacidade e limites sem geocoding externo;
- `docs/SEED.md`: conteúdo, segurança e estratégia idempotente do seed;
- `docs/PERMISSIONS.md`: matriz RBAC persistida;
- `docs/ADMINISTRATION.md`: usuários, equipes, disponibilidade e redistribuição;
- `docs/AUTOMATIONS.md`: jobs, worker, retry, idempotência e limites;
- `docs/STAGING_WORKER_REPORT.md`: smoke transitório do worker no Neon de staging
  e gates ainda necessários para runtime persistente;
- `docs/AI_PROMPTS.md`: providers, contratos, prompts e fallback local de IA;
- `docs/AI_GOVERNANCE.md`: versões, allowlist, avaliações, proveniência e revisão humana;
- `docs/VISUAL_SYSTEM.md`: tokens, padrões, acessibilidade e responsividade;
- `docs/TEST_PLAN.md`: matriz crítica, isolamento, E2E, segurança e performance;
- `docs/DEPLOYMENT_FUTURE.md`: gates de segurança, infraestrutura, release e
  rollback ainda necessários para uma publicação;
- `docs/MVP_READINESS.md`: evidências, limites e resultado do aceite local;
- `src/modules/audit/README.md`: auditoria administrativa, achados e limites;
- `docs/LEAD_DUPLICATION_POLICY.md`: contrato de entrada, normalização e
  deduplicação não destrutiva;
- `docs/LEAD_ENTRY_CHANNELS.md`: adaptadores manual, CSV, webhook local e
  simulador;
- `src/modules/meetings/README.md`: regras da agenda, conflitos e histórico;
- `docs/EXECUTION_STATUS.md`: estado comprovado de cada task e próximo gate;
- `docs/SETTINGS.md`: políticas configuráveis, versionamento e validações;
- `docs/BACKLOG.md`: prioridades e sequência de evolução.

## Contas e organização canônica

Contas ficam em `/contas`; a visão 360 usa `/contas/[accountId]` e a fila de
revisão humana usa `/contas/revisoes`. O texto livre legado de organização é
preservado e nunca vira vínculo automático.

Para inspecionar candidatos no banco local:

```bash
pnpm db:accounts:backfill -- --mode=dry-run
pnpm db:accounts:backfill -- --mode=execute
```

O comando recusa produção, host remoto, outro banco e schema diferente de
`public`. A execução cria reviews idempotentes; a decisão final continua na UI
e gera auditoria.

## Privacidade e retenção

A fundação local distingue preferência operacional, consentimento por
finalidade/canal/ponto de contato, base legal, retenção, legal hold e direitos
do titular. As políticas iniciais são deliberadamente `PENDING_LEGAL`: não
autorizam contato real nem afirmam conformidade jurídica. Opt-out e revogação
prevalecem; ausência de prova retorna revisão necessária, nunca consentimento.

Para reconciliar os sinais legados no banco local, sempre execute primeiro o
dry-run:

```bash
pnpm db:privacy:backfill -- --mode=dry-run
pnpm db:privacy:backfill -- --mode=execute
```

A CLI recusa produção, host remoto, outro banco e schema diferente de `public`.
O replay é idempotente e não rebaixa opt-out. Consulte
[`docs/PRIVACY_AND_RETENTION.md`](docs/PRIVACY_AND_RETENTION.md) antes de usar
qualquer fluxo de contato.

### Performance de mídia local

Abra `/aquisicao/midia` como Administrador ou Gestor. O fluxo aceita somente
CSV local (até 512 KiB/2.000 linhas), exige prévia e confirmação, grava valores
monetários em centavos e permite reconciliação observada com o CRM. Não há
conexão com Meta/Google, segredo, egress ou banco remoto nesta versão.

## Contratos comerciais locais

Acesse `/contratos` para criar snapshot versionado a partir de oportunidade,
conta, contato e oferta existentes. Emissão, envio e aceite são locais; nenhum
documento é enviado ou assinado externamente. O backfill começa em dry-run com
`pnpm db:contracts:backfill`. Leia
[`docs/COMMERCIAL_CONTRACTS.md`](docs/COMMERCIAL_CONTRACTS.md).

## Atendimento ao cliente e satisfação

Acesse `/customer-service` para registrar e acompanhar solicitações de contas
da carteira. Cada registro possui responsável ou fila explícita, próxima ação,
SLA congelado por versão, timeline e auditoria. CSAT e NPS são calculados apenas
de convites e respostas persistidos; convites são exclusivamente simulados.

O backfill é local-only e conservador. Execute primeiro o dry-run:

```bash
pnpm db:customer-service:backfill -- --run-key=crm53:dry-run:manual
pnpm db:customer-service:backfill -- --execute --run-key=crm53:execute:manual
```

Mesmo em `EXECUTE`, uma conversa ambígua vira revisão e nunca uma solicitação
inventada. Consulte [`docs/CUSTOMER_SERVICE.md`](docs/CUSTOMER_SERVICE.md).

## Farmer, renovação e expansão

Acesse `/farmer` para trabalhar renovações e sinais de expansão de contas com
assinatura e carteira explícitas. Contração e churn exigem confirmação humana,
motivo e evidência; correções geram movimento reversor no ledger.

O backfill local é conservador e começa sempre em dry-run:

```bash
pnpm db:farmer:backfill -- --run-key=crm54:dry-run:manual
pnpm db:farmer:backfill -- --execute --run-key=crm54:execute:manual
```

Ele nunca infere renovação, risco ou churn. Consulte
[`docs/FARMER.md`](docs/FARMER.md).

## Operações, segurança e privacidade

Acesse `/operacoes` como Administrador ou Gestor para consultar SLOs locais,
alertas deduplicados, incidentes, sinais agregados de segurança, inventário de
dados e solicitações de titulares. A avaliação é determinística e não envia
notificações externas. Destruição e anonimização permanecem desabilitadas.

O readiness seguro está em `/api/ready`. Para conferir DSRs históricos sem
timeline, execute primeiro `pnpm db:operations:backfill`; somente após revisar o
resultado use `pnpm db:operations:backfill -- --execute`. Consulte
[`docs/OBSERVABILITY_SECURITY_PRIVACY.md`](docs/OBSERVABILITY_SECURITY_PRIVACY.md).
