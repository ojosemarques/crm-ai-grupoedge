# Permissões, papéis e isolamento

> CRM-49 adiciona `revenue.read`, `revenue.manage`, `revenue.events.record` e `revenue.correct`: gestor em TEAM, closer em OWN, visualizador somente leitura e administrador em WORKSPACE.

## Princípio de segurança

Autorização é uma decisão do servidor. Ocultar botões melhora a experiência, mas
não concede nem revoga acesso. Toda Route Handler, Server Action, Server
Component ou job que alcance dados protegidos deve:

1. validar a sessão e obter `AuthenticatedContext` no servidor;
2. ignorar qualquer `workspaceId`, papel ou ator informado pelo cliente como
   fonte de identidade;
3. chamar o serviço de autorização com uma permissão e o escopo do recurso;
4. consultar ou alterar dados incluindo o `workspaceId` do contexto;
5. auditar a mutação relevante na mesma transação.

`proxy.ts` verifica somente a presença do cookie e não substitui esses passos.

## Identidade, papel, função e ator

| Conceito | Modelo | Exemplos | Pode iniciar sessão? |
|---|---|---|---|
| Identidade | `User` | pessoa e e-mail normalizado | Com credencial local |
| Acesso ao tenant | `WorkspaceMember` + `Role` | Administrador, Visualizador | Sim, se ativo |
| Função comercial | `TeamMember.function` | SDR, Closer, Manager | Não define acesso |
| Autoria | `Actor.type` | Humano, Sistema, Automação, Agente de IA | Somente `HUMAN` |

Uma pessoa pode ter papel de acesso diferente de sua função comercial. Por
exemplo, o papel Gestor comercial pode ter escopo de equipe enquanto sua função
é `MANAGER`. Sistema, Automação e Agente de IA têm atores próprios para
auditoria; não recebem senha, cookie ou papel humano.

## Escopos

- `WORKSPACE`: qualquer recurso pertencente ao workspace autenticado;
- `TEAM`: recurso de um membro da mesma equipe, da própria pessoa ou de uma fila
  ligada a uma de suas equipes;
- `OWN`: recurso atribuído à própria membership ou a uma fila ligada a uma de
  suas equipes, quando essa fila é a responsável operacional do recurso.

O acesso a uma fila não é inferido por `ownerMemberId = null`. Ele exige
`queueId` persistido, e o escopo de equipe exige que essa fila tenha `teamId`.
A Fila Geral continua sendo responsável explícito e pertence à equipe de
pré-vendas. Assim, gestor e SDR com concessão adequada podem alcançar seus itens
sem ampliar o acesso para outra equipe ou workspace.

## Catálogo inicial de permissões

| Chave | Finalidade |
|---|---|
| `workspace.manage` | Configurações gerais do workspace |
| `workspace.members.manage` | Membros e seus papéis |
| `workspace.permissions.manage` | Papéis e concessões |
| `leads.read` / `leads.write` | Leitura e alteração de leads |
| `leads.assign` | Distribuição entre membro e fila |
| `tasks.read` / `tasks.write` | Leitura e alteração de tarefas |
| `meetings.read` / `meetings.write` | Leitura e alteração de reuniões |
| `opportunities.read` / `opportunities.write` | Leitura e alteração de oportunidades |
| `metrics.read` | Consulta de métricas calculadas no escopo autorizado |
| `automations.read` | Consulta da observabilidade de jobs e execuções |
| `automations.execute` | Execução manual e reprocessamento de falhas |
| `automations.manage` | Ativação, pausa e cancelamento |
| `audit.read` | Consulta da auditoria |
| `audit.manage` | Varredura, reconhecimento e resolução de achados de processo |
| `ai.use` | Solicitar recomendação explicável sem aplicar mutações |
| `lifecycle.read` | Ler o ciclo de receita e sua origem |
| `lifecycle.transition` | Executar transições válidas do ciclo |
| `lifecycle.override` | Corrigir o ciclo fora da matriz com confirmação |
| `ownership.read` | Ler responsáveis funcionais e transferências |
| `ownership.assign` | Atribuir ou substituir responsável funcional |
| `ownership.transfer` | Solicitar ou cancelar transferência própria |
| `ownership.accept` | Aceitar ou rejeitar transferência destinada ao escopo |
| `ownership.admin` | Executar backfill e correções administrativas |
| `inbox.read` | Consultar conversas e métricas no escopo autorizado |
| `conversations.assign` | Assumir ou transferir responsabilidade da conversa |
| `conversations.manage` | Resolver, reabrir, arquivar e executar backfill controlado |
| `messages.compose` | Redigir mensagem no contexto permitido |
| `messages.send` | Submeter mensagem à decisão de privacidade e ao outbox |
| `messages.replay` | Reprocessar/simular evento local idempotente |
| `messages.viewSensitive` | Ler corpo não redigido da mensagem |
| `message_templates.manage` | Criar nova versão de template local |

O catálogo é centralizado no código para impedir chaves improvisadas, enquanto
as concessões e os escopos ficam em `RolePermission` no PostgreSQL. Novas
permissões devem ser específicas, migradas e adicionadas à matriz de testes.

## Matriz inicial do MVP

A tabela descreve a política materializada pelo seed local. As concessões ficam
persistidas e os testes verificam a matriz em schema isolado.

| Papel | Leitura | Mutação | Escopo padrão |
|---|---|---|---|
| Administrador | Todos os recursos do workspace | Configurações, membros, papéis e recursos | `WORKSPACE` |
| Gestor comercial | Leads, reuniões e oportunidades de sua equipe | Os mesmos recursos e distribuição da equipe | `TEAM` |
| SDR | Leads, tarefas e reuniões ligadas ao lead sob sua responsabilidade operacional | Leads e tarefas próprios e agendamento para seu lead | `OWN` |
| Closer | Reuniões e oportunidades atribuídas | Reuniões e oportunidades atribuídas | `OWN` |
| Visualizador | Leads, tarefas, reuniões e oportunidades | Nenhuma | `WORKSPACE` somente leitura |

Papéis configuráveis podem receber combinações diferentes, mas nunca podem
ultrapassar o workspace da membership. Alterar a URL, o corpo ou um ID não muda
o contexto autenticado.

## Pagamentos em sandbox — CRM-50

| Permissão | Uso |
|---|---|
| `payments.read` | Consultar cobranças, tentativas, pagamentos e divergências permitidos |
| `payments.manage` | Criar/emitir/anular cobrança e iniciar tentativa no sandbox |
| `payments.reprocess` | Reprocessar tentativa em dead-letter e acionar worker local |
| `payments.reconcile` | Vincular ou dispensar divergência com motivo e auditoria |

Administrador recebe todas em `WORKSPACE`. Gestor lê e opera em `TEAM`, com
reprocessamento/reconciliação autorizados no workspace. Closer lê e opera em
`OWN`; Visualizador possui somente leitura. SDR não recebe permissão de
pagamentos no seed. Cada serviço combina o ID com o `workspaceId` autenticado e
repete a decisão no servidor; ocultar a navegação não concede acesso.

No inbox da CRM-43, Administrador recebe todas as permissões em `WORKSPACE`;
Gestor opera em `TEAM` e faz replay local em `WORKSPACE`; SDR e Closer leem,
compõem, enviam e veem conteúdo apenas em `OWN`; Visualizador recebe somente
`inbox.read`. A API reconstrói conversa, fila, equipe e responsável do banco e
ignora qualquer workspace informado pelo cliente. Corpo de mensagem é
substituído por `Conteúdo protegido` sem `messages.viewSensitive`.

Na CRM-35, Administrador recebe todas as permissões de lifecycle/ownership em
`WORKSPACE`. Gestor lê, transiciona, corrige, atribui e transfere em `TEAM`;
backfill continua administrativo. SDR e Closer leem e operam transferências em
`OWN`, e o Closer também pode avançar lifecycle válido no próprio escopo.
Visualizador recebe apenas leitura em `WORKSPACE`. Cada endpoint reconstrói o
recurso a partir do banco e do contexto autenticado; `workspaceId` e ator não
são aceitos do cliente.

## Privacidade — CRM-36

| Permissão | Uso |
|---|---|
| `privacy.status.read` | Consultar a decisão prática e suas evidências |
| `privacy.consent.record` | Registrar concessão, negativa, revogação ou opt-out |
| `privacy.consent.correct` | Criar evento corretivo sem apagar o fato anterior |
| `privacy.purpose.manage` | Gerenciar finalidades e versões técnicas |
| `privacy.legal.approve` | Aprovar versão somente após revisão jurídica externa |
| `privacy.retention.manage` | Configurar e pré-visualizar retenção |
| `privacy.retention.execute` | Executar ação previamente aprovada |
| `privacy.dsr.read` / `privacy.dsr.manage` | Consultar e conduzir solicitações do titular |
| `privacy.dsr.export` | Gerar exportação mínima após verificação |
| `privacy.legal_hold.manage` | Criar ou liberar proteção jurídica limitada |
| `privacy.backfill` | Executar reconciliação local conservadora |

Administrador recebe o conjunto completo em `WORKSPACE`. Gestor recebe status,
registro de consentimento e gestão de DSR conforme o escopo operacional; SDR e
Closer consultam/registram somente em `OWN`; Visualizador possui apenas leitura
em `WORKSPACE`. Aprovação legal, execução de retenção e backfill não são
concedidos a papéis comerciais. Cada Route Handler autentica, aplica same-origin
nas mutações e repete o guard server-side; ocultar `/privacidade` não concede ou
revoga acesso.

Na CRM-24, Administrador e Gestor comercial recebem `audit.read` e
`audit.manage` com escopo `WORKSPACE`. A leitura, a contagem e todos os filtros
incluem o `workspaceId` do contexto. SDR, Closer e Visualizador não acessam
`/auditoria`, `GET /api/audit`, a varredura ou a alteração de estado por URL
direta. O botão oculto é somente conveniência visual; cada Route Handler repete
a autorização no servidor.

Reconhecer ou resolver um achado exige `audit.manage`, versão otimista e ator
humano autenticado. Resolver não autoriza editar o registro relacionado: a
correção continua sujeita à permissão do serviço de domínio correspondente.
Varreduras automáticas são registradas com o ator Sistema, preservando na
auditoria o ator humano que solicitou a execução.

Na distribuição, `leads.assign` é exigida no servidor para atribuição manual,
redistribuição entre SDRs ou retorno à Fila Geral. O Gestor comercial a recebe
com escopo `TEAM`; o SDR não a recebe. Um SDR pode pausar ou retomar apenas o
próprio recebimento por meio de `leads.write`/`OWN`; pausar outro membro exige
`leads.assign`. O destino ainda precisa ser SDR ativo, não pausado e da equipe de
roteamento, mesmo depois da autorização.

Na entrada da CRM-07, cadastro manual, preview/confirmação CSV, relatório de
erros, webhook local, simulador e consulta das opções exigem `leads.write`
contra a Fila Geral persistida. O serviço repete a decisão antes de acessar o
workspace, mesmo quando a página já foi autorizada. IDs de `ImportJob` são
sempre combinados com o `workspaceId` da sessão. Webhook e simulador ainda
exigem host loopback e ficam indisponíveis em produção.

Na CRM-08, carregar a timeline exige simultaneamente `leads.read` e
`tasks.read` sobre o lead. Registrar atividade ou correção exige `leads.write`;
criar e concluir tarefa exige `tasks.write`. O recurso inclui responsável,
fila e equipe de roteamento na decisão de escopo. Atores técnicos não usam
sessão humana: o serviço valida `workspaceId`, ID, chave e tipo persistidos antes
de aceitar Sistema, Automação ou Agente de IA como autor.

Na CRM-09, a lista resolve `leads.read` antes da consulta e converte o escopo em
filtro SQL, portanto registros fora do universo autorizado não entram na
contagem nem na paginação. `OWN` inclui somente leads atribuídos à própria
membership ou atualmente atribuídos a uma fila da equipe; `TEAM` inclui também
donos e filas da equipe. Visualizações salvas pertencem ao membro autenticado e
não aceitam `workspaceId` ou `ownerMemberId` do cliente.

A redistribuição em massa exige `leads.assign`, pré-valida o acesso a todos os
IDs e chama o serviço de distribuição para cada lead. Ocultar o painel para SDR
ou Visualizador é apenas UX: chamadas diretas ao endpoint continuam retornando
HTTP 403 e gerando a auditoria de negação já prevista.

Na CRM-10, `/meu-dia` exige `leads.read` antes de calcular qualquer seção ou
contagem. A consulta reutiliza o mesmo predicado `OWN`, `TEAM` ou `WORKSPACE` da
lista. No escopo `OWN`, o SDR não pode trocar o `memberId` para inspecionar outro
usuário; no escopo `TEAM`, o Gestor só seleciona SDRs de suas equipes; no escopo
`WORKSPACE`, a leitura continua limitada ao workspace autenticado. O parâmetro
de URL nunca contém nem substitui `workspaceId`.

Os botões recomendados da fila são navegação para o histórico operacional, não
autorizações implícitas. Registrar ligação, mensagem ou tarefa continua exigindo
`leads.write` ou `tasks.write` no servidor. As contagens clicáveis abrem
`/leads` e repetem a verificação de `leads.read` com o mesmo recorte.

Na CRM-14, quadro, lista e cartão exigem `leads.read` e aplicam o mesmo predicado
SQL de visibilidade da lista. Uma transição exige `leads.write` sobre o lead
concreto. O modo de correção gerencial, que pode atravessar uma aresta não
prevista pelo grafo normal, exige adicionalmente `leads.assign`, motivo e
confirmação explícita. Assim, um SDR pode movimentar somente leads do seu escopo
pelas transições normais, enquanto o Visualizador permanece em somente leitura.
Alterar URL, ID da etapa ou payload não amplia esses direitos.

Na CRM-15, a agenda exige `meetings.read`, aplica `WORKSPACE`, `TEAM` ou `OWN`
ao closer atribuído e nunca confia no filtro recebido. O Gestor filtra somente
closers de sua equipe; o Closer lê e altera apenas as próprias reuniões; o
Visualizador lê o workspace, mas não recebe `meetings.write`. O SDR possui
`meetings.read`/`meetings.write` com escopo `OWN` para agendar a reunião de um
lead sob sua responsabilidade, mesmo que o closer seja outra pessoa; essa
exceção é avaliada contra o lead concreto no servidor e não amplia a agenda do
SDR para as reuniões do closer.

Agendamento exige também acesso de escrita ao lead. Confirmação, remarcação,
cancelamento, show e no-show são novamente autorizados sobre a reunião ou o lead
permitido, usam revisão otimista e geram timeline e auditoria. O ID do closer é
validado como membership ativa, função comercial `CLOSER` e participante do
mesmo workspace; alterar URL ou payload não atravessa workspace ou equipe.

Na CRM-16, `/oportunidades` e suas rotas exigem `opportunities.read` ou
`opportunities.write` e aplicam o escopo ao closer responsável antes de contar,
filtrar ou alterar. O Gestor alcança somente oportunidades de closers de suas
equipes; o Closer acessa somente as próprias; o Visualizador possui leitura do
workspace sem mutação. Filtros recebidos nunca ampliam esse universo.

Criar uma oportunidade a partir do cartão exige escrita sobre o lead visível e
escrita de oportunidade para o closer escolhido, que deve ser membership ativa
com função comercial `CLOSER` no mesmo workspace. Transições, propostas, ganho
e perda voltam a autorizar a oportunidade concreta no servidor. Ganho e perda
exigem confirmação no payload, não apenas na interface. Reabertura exige ainda
`leads.assign`, motivo, confirmação e nova próxima ação, reservando a correção
gerencial a quem pode redistribuir. Alterar URL, IDs de produto/etapa/motivo ou
owner no corpo não atravessa tenant ou escopo.

Na CRM-17, `/configuracoes` e `GET`, `POST` ou `PATCH` de
`/api/settings/commercial` exigem `workspace.manage` com escopo `WORKSPACE`.
No seed atual somente o Administrador possui essa concessão. O workspace nunca
é aceito no payload; IDs de produto, plano, motivo, pipeline, etapa e transição
são novamente combinados com `context.workspaceId` no serviço. SDR, Closer,
Gestor e Visualizador recebem HTTP 403 mesmo por URL ou chamada direta.

O `POST` apenas calcula impacto. O `PATCH` exige confirmação explícita e grava
auditoria no mesmo commit. Ocultar o link na página inicial é somente UX, não a
barreira de autorização.

Na CRM-18, `/administracao` e `GET /api/administracao/workspace` aceitam o
Administrador com `workspace.members.manage` em `WORKSPACE` ou o Gestor com
`leads.assign` em `TEAM`. A consulta do Gestor inclui somente membros, equipes,
carga e indicadores das equipes às quais ele pertence. SDR, Closer e
Visualizador recebem negativa server-side mesmo por URL direta.

Criar usuário, editar identidade, mudar papel, alterar vínculos de equipe,
ativar/inativar membership e manter equipes exigem
`workspace.members.manage` em `WORKSPACE`. A própria conta não pode trocar o
próprio papel nem se inativar. Pausa e redistribuição exigem `leads.assign`
contra a membership de origem; no escopo `TEAM`, cada origem e destino é
revalidado contra a equipe da fila do lead.

Todos os comandos usam o `workspaceId`, `memberId` e `actorId` do contexto
autenticado. O payload não escolhe tenant nem identidade autora. A prévia não
concede autorização para a confirmação: o `PATCH` repete a decisão, valida a
revisão e gera auditoria no mesmo commit. Senha e hash não integram a resposta
nem o registro de auditoria.

Na CRM-19, `MetricsService` exige `metrics.read` antes de formar o universo da
consulta. Administrador e Visualizador recebem `WORKSPACE`, Gestor recebe
`TEAM`, e SDR e Closer recebem `OWN`. O escopo considera leads e seus vínculos
tipados com ciclos de SLA, reuniões, oportunidades e snapshots de fechamento;
assim, o Closer acessa métricas dos registros atribuídos sem ganhar leitura
geral de leads. Filtros enviados pelo cliente somente restringem o universo e
nenhum payload aceita `workspaceId`.

Na CRM-21, o Administrador recebe `automations.read`,
`automations.execute` e `automations.manage` em `WORKSPACE`. O Gestor comercial
recebe leitura e execução também em `WORKSPACE`, pois uma regra pode alcançar
mais de uma equipe; ele não recebe gestão. SDR, Closer e Visualizador não têm
essas permissões. Execução manual, reprocessamento, cancelamento, ativação,
pausa e observabilidade repetem a autorização no servidor e derivam o workspace
da sessão. O worker usa o ator técnico `AUTOMATION`, sem sessão ou papel humano.

Na CRM-25, `ai.use` é concedida ao Administrador em `WORKSPACE`, ao Gestor em
`TEAM` e a SDR/Closer em `OWN`; o Visualizador não recebe a permissão. Lead e
oportunidade são resolvidos dentro do tenant e autorizados com responsável,
fila e equipe persistidos. Uma análise de workspace pelo Gestor exige uma equipe
explícita de que ele participe. O DTO enviado ao provider não contém IDs de
workspace, registro, sessão ou ator. Gerar um insight não concede autorização
para aplicar a recomendação no domínio. Na CRM-26, cada item confirmado repete
a permissão do serviço de PACTO, scoring ou tarefas. Para leads atribuídos a uma
pessoa, o recurso não inclui equipe ou fila capazes de ampliar indevidamente um
grant `OWN`; um SDR diferente do responsável recebe `ACCESS_DENIED`.

Na CRM-27, `ai.manager.query` é independente de `ai.use`. Administrador recebe
`WORKSPACE` e Gestor comercial recebe `TEAM`; SDR, Closer e Visualizador não
recebem a permissão. O Route Handler deriva o workspace da sessão, o serviço de
métricas aplica novamente `metrics.read` e os filtros apenas restringem o
universo. A tentativa negada gera `authorization.denied`. Confirmar ou rejeitar
uma recomendação só é permitido ao ator humano que solicitou o `AIInsight` e
não autoriza redistribuição nem alteração comercial.

## Respostas e auditoria

- ausência de sessão: HTTP 401, código `AUTHENTICATION_REQUIRED`;
- sessão expirada, revogada ou invalidada: HTTP 401, código `SESSION_EXPIRED`;
- permissão ausente, recurso fora do escopo ou workspace divergente: HTTP 403,
  código `ACCESS_DENIED`;
- entrada de login inválida: HTTP 400, sem ecoar a senha;
- credencial incorreta: HTTP 401 com mensagem única para workspace, e-mail e
  senha, reduzindo enumeração de contas.

São auditados login bem-sucedido, falha relevante dentro de workspace existente,
logout, expiração/invalidação, negativa de autorização e alteração administrativa
de papel. Logs não incluem senha ou token aberto. Falha para slug inexistente não
é vinculada artificialmente a outro tenant e permanece somente no log técnico
seguro da requisição.

## Política da sessão local

- senha entre 12 e 128 caracteres ao ser criada;
- `scrypt` com sal aleatório e parâmetros versionados;
- cinco falhas consecutivas por padrão bloqueiam a credencial por 15 minutos;
- sessão de oito horas por padrão, configurável por ambiente;
- token aleatório de 256 bits; somente SHA-256 é persistido;
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção e caminho `/`;
- logout revoga no banco antes de apagar o cookie;
- alteração futura de senha deve incrementar `credentialVersion` para revogar
  sessões antigas;
- login e logout rejeitam origem cruzada quando o navegador fornece `Origin` ou
  `Sec-Fetch-Site`.

## Checklist para novos módulos

- o guard foi executado antes do caso de uso;
- a permissão tem uma chave do catálogo;
- o recurso informa `workspaceId` e responsável/equipe/fila quando aplicável;
- a consulta usa o workspace do contexto;
- leitura em lista aplica o mesmo escopo item a item ou em filtro SQL equivalente;
- a mutação não confia em papel, membership ou ator vindos do payload;
- negativa tem mensagem segura e auditoria quando há contexto válido;
- o teste cobre permitido, negado, outro escopo e outro workspace.

## Contas — CRM-34

- `accounts.read`: consulta de Conta 360 e listas dentro do escopo efetivo;
- `accounts.write`: criação, edição otimista e inativação;
- `accounts.link`: vínculo/desvínculo explícito de Lead ou Opportunity, sempre
  conferindo o owner do registro antes da autorização;
- `accounts.roles.manage`: inclusão, encerramento e substituição temporal de papéis;
- `buying-committee.manage`: criação e membros no escopo do owner da oportunidade;
- `accounts.review`: decisão humana sobre candidatos legados;
- `accounts.backfill`: dry-run e execução local da geração de reviews.

Administrador recebe workspace; gestor recebe leitura/escrita/review no
workspace e comitê na equipe; SDR e closer recebem somente contexto próprio;
visualizador recebe somente leitura. Botão oculto não substitui o guard do
serviço ou Route Handler.

## Integrações — CRM-37

`integrations.read`, `integrations.manage`, `integrations.secrets.manage`,
`integrations.execute`, `integrations.runs.read`, `integrations.replay` e
`integrations.mappings.manage` separam consulta, mutação e operações sensíveis.
Administrador recebe todas; Gestor recebe leitura, runs e execução local. Os
demais papéis não acessam a central. Toda rota repete o guard server-side.

## Aquisição e atribuição — CRM-38

- `marketing.journey.read`: consulta da jornada, cobertura, modelos e revisões;
- `marketing.definitions.manage`: versionamento de landing pages e formulários;
- `marketing.models.manage`: nova versão de algoritmo/janela;
- `marketing.attribution.execute`: cálculo e backfill local;
- `marketing.reviews.manage`: resolução humana de pendência de qualidade;
- `marketing.evidence.export`: capacidade separada para exportação futura; a
  CRM-38 não expõe download.

Administrador recebe as seis capacidades em `WORKSPACE`. Gestor recebe leitura,
gestão e execução no workspace para operar a fundação local. SDR, Closer e
Visualizador recebem somente `marketing.journey.read`; não calculam, não mudam
definições e não resolvem review. APIs e serviço derivam o workspace da sessão,
repetem o guard e rejeitam IDs de outro tenant.

## Mídia paga — CRM-39

- `marketing.media.read`: consulta hierarquia, métricas e pendências;
- `marketing.media.import`: prévia, confirmação, rollback e backfill exato;
- `marketing.media.reconcile`: reconciliação mídia × CRM.

Administrador recebe todas. Gestor recebe as três no workspace. Visualizador
recebe somente leitura. SDR e Closer possuem concessão `OWN`, mas a visão
agregada não declara owner e, portanto, é negada pelo guard de escopo. A API
repete a autorização; esconder botões não concede acesso.

## E-mail — CRM-45

| Permissão | Uso |
|---|---|
| `integrations.email.read` | Consultar profile, estado local e métricas do canal |
| `integrations.email.configure` | Versionar a configuração local |
| `integrations.email.pause` | Pausar ou retomar o sink |
| `integrations.email.test_local` | Simular entrada e status sem egress |
| `email.sender.manage` | Alterar o sender autorizado do workspace |
| `email.domain.read` | Ler observações de SPF, DKIM e DMARC |
| `email.suppression.read` | Consultar suppressions mascaradas |
| `email.suppression.manage` | Registrar evento de suppression autorizado |
| `email.event.replay` | Reservada ao replay controlado de evento |

Administrador recebe essas capacidades em `WORKSPACE`; Gestor recebe leitura,
domínio, suppressions e teste local no workspace, sem administrar sender. SDR e
Closer continuam usando as permissões canônicas do Inbox em `OWN`; Visualizador
não abre a central de e-mail. Toda rota reconstrói o workspace da sessão, e o
worker usa ator Sistema persistido. Nenhuma permissão habilita egress externo.

## Telefonia — CRM-46

| Permissão | Uso |
|---|---|
| `telephony.read` | Consultar profile, chamadas e métricas no escopo |
| `telephony.start` | Enfileirar chamada local autorizada |
| `telephony.cancel` | Cancelar chamada ainda aberta |
| `telephony.disposition` | Registrar resultado humano e próxima ação |
| `telephony.replay` | Reprocessar falha terminal autorizada |
| `telephony.configure` | Versionar, pausar e retomar o profile local |
| `telephony.view_sensitive` | Capacidade separada para leitura não mascarada; a UI atual não a expõe |

Administrador recebe `WORKSPACE`; Gestor opera no escopo `TEAM`; SDR e Closer
operam em `OWN`; Visualizador possui somente leitura sanitizada em `WORKSPACE`.
`OWN` exige owner explícito e não é ampliado por equipe ou fila. O serviço, a
API e o callback revalidam workspace/tenant; o worker usa ator Sistema. Nenhuma
permissão liga provider, PSTN, gravação ou transcrição.

## Calendário — CRM-47

| Permissão | Uso |
|---|---|
| `calendar.read` | Consultar perfil, links, eventos e estado de sync no escopo |
| `calendar.configure` | Versionar, pausar ou retomar o sandbox local |
| `calendar.sync` | Enfileirar projeção de Meeting autorizada |
| `calendar.replay` | Reprocessar falha terminal |
| `calendar.conflict.read` | Consultar evidências de conflitos |
| `calendar.conflict.resolve` | Resolver conflito com motivo explícito |

Administrador recebe todas em `WORKSPACE`. Gestor lê/configura/reprocessa e
resolve no workspace, com sync em `TEAM`. SDR e Closer leem/sincronizam em
`OWN`. Visualizador lê o estado e conflitos em `WORKSPACE`, sem mutação. API e
serviço revalidam tenant e owner; o worker usa ator Sistema e não ganha egress.

## Contratos comerciais — CRM-48

Administrador possui todas as capacidades no workspace. Gestor consulta, cria,
revisa, emite, registra envio/aceite/rejeição/anulação, cria versões e reconcilia
em `TEAM`. Closer opera contratos próprios em `OWN`, sem gerir templates ou
reconciliação. Visualizador possui apenas `contracts.read` em `WORKSPACE`. API e
serviço derivam o workspace da sessão; esconder controles não autoriza ação.

## Handoff e onboarding — CRM-51

| Permissão | Uso |
|---|---|
| `onboarding.read` | Consultar handoffs, casos, marcos e métricas no escopo |
| `onboarding.manage` | Criar, preparar e enviar handoff |
| `onboarding.accept` | Aceitar ou rejeitar responsabilidade |
| `onboarding.execute` | Iniciar, bloquear, concluir marcos e registrar ativação |
| `onboarding.assign` | Redistribuir caso para membro ativo |
| `onboarding.correct` | Cancelar e executar backfill conservador |

Administrador recebe workspace; gestor recebe equipe e correção no workspace;
closer recebe leitura, aceite e execução em OWN; visualizador recebe somente
leitura. Toda rota deriva o workspace da sessão e o serviço aplica novamente o
guard. Ocultar controles nunca substitui autorização.
## Home por função, Account/Contact 360 e busca global — CRM-58

Nenhuma permissão nova foi criada. As visões reutilizam as capacidades do
domínio que representam: `leads.read`, `opportunities.read`, `farmer.read`,
`customer_success.read`, `metrics.read` e `workspace.manage`. A alternância de
função é permitida somente quando o papel ou um `OwnershipAssignment` ativo
torna a função aplicável e a leitura correspondente é concedida.

Account 360 usa `accounts.read`; Contact 360 usa `contacts.read`. Ownership
funcional canônico, leads e oportunidades relacionados determinam o recurso
para `OWN` e `TEAM`. Um identificador sem relação elegível não é convertido no
usuário corrente e, portanto, não amplia acesso. IDs de outro workspace são
sempre descartados pelo predicado tenant e pelo guard do serviço.

## Governança de IA — CRM-59

`ai.governance.read` permite consultar metadados, versões, avaliações e
observabilidade sem payload sensível. `ai.evaluations.run` permite ao Gestor e
ao Administrador executar somente o dataset local determinístico.
`ai.governance.manage` é exclusivo do Administrador e protege aprovação,
desativação e rollback no servidor. `ai.use` continua controlando recomendações
no contexto do recurso. Nenhuma dessas permissões autoriza provider externo ou
mutação comercial automática.

A busca global resolve as quatro permissões separadamente. Cada consulta recebe
o predicado de escopo antes de executar e seleciona apenas contexto mínimo. A
interface nunca recebe resultados proibidos para depois escondê-los. Pontos de
contato são mascarados antes da resposta; a ausência de contato não é tratada
como consentimento ou autorização.

## Sandbox n8n — CRM-60

`integrations.n8n.read` abre metadados e observabilidade local;
`integrations.n8n.manage` cria, rotaciona, pausa/revoga identidades e administra
receitas; `integrations.n8n.review` aprova ou rejeita propostas sem executar a
ação. Administrador recebe as três em `WORKSPACE`. Gestor recebe leitura e
revisão; SDR, Closer e Visualizador permanecem negados por padrão.

As permissões da máquina não são papéis humanos: são escopos explícitos em
`N8nMachinePermission`, limitados ao workspace gravado na identidade. A API
local nunca aceita `workspaceId` do corpo e nunca concede acesso ao banco.

## Qualidade de dados — CRM-61

| Permissão | Uso |
|---|---|
| `data_quality.read` | Consultar ocorrências, regras e evidências permitidas |
| `data_quality.resolve` | Assumir, comentar, resolver ou descartar ocorrência |
| `data_quality.manage` | Executar dry-run/varredura e administrar a operação |
| `data_quality.merge` | Decidir duplicidade, criar plano e confirmar merge |
| `data_quality.rollback` | Reverter merge elegível pelo ledger imutável |

Administrador recebe todas em `WORKSPACE`; Gestor também opera no workspace.
SDR e Closer recebem leitura/resolução em `OWN`; Visualizador possui somente
leitura em `WORKSPACE`. O escopo é reaplicado no serviço e a rota nunca confia
em botão oculto ou workspace vindo do cliente.

## Operações, segurança e privacidade — CRM-62

| Permissão | Capacidade |
|---|---|
| `operations.read` | consultar SLOs, alertas e incidentes do workspace |
| `operations.manage` | avaliar regras e conduzir alertas/incidentes |
| `security.monitor.read` | consultar sinais agregados e integridade da auditoria |
| `privacy.operations.manage` | consultar inventário/DSR e executar dry-runs governados |

Administrador e Gestor recebem as quatro permissões no seed. Os sinais de
segurança e dados de titulares só são consultados quando a permissão específica
foi concedida; ocultar uma tab não substitui essa verificação no serviço.
