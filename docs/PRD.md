# PRD — Politizai CRM

## Visão

O Politizai CRM é o sistema interno da operação comercial permanente e
pós-eleitoral da Politizai. Não é um CRM de eleitores, campanhas eleitorais ou
gestão de gabinete.

O sistema deverá organizar a entrada e o atendimento de leads, trabalho de SDRs
e closers, qualificação PACTO, atividades, reuniões, oportunidades, propostas,
métricas, automações simuladas, recomendações explicáveis, auditoria e
permissões.

## Resultado operacional esperado

Para todo lead aberto, o sistema deve conseguir responder:

1. quem deve atender agora;
2. por que o atendimento é prioritário;
3. qual é a próxima ação;
4. quais fatos sustentam a decisão.

Nenhum lead aberto poderá permanecer sem responsável ou fila explícita, etapa,
prioridade, SLA, última atividade e próxima ação.

## Princípios

- PostgreSQL como fonte única da verdade;
- interface sem acesso direto ao banco;
- regras em serviços e domínios reutilizáveis;
- histórico baseado em eventos;
- workspace em todas as fronteiras de dados;
- autorização também no servidor;
- auditoria append-only;
- dinheiro em centavos de BRL;
- instantes persistidos em UTC e exibidos em `America/Sao_Paulo`;
- separação explícita entre fato, inferência e ausência de dado;
- confirmação humana antes de ações sensíveis sugeridas;
- métricas exclusivamente derivadas de dados persistidos.

## Fundação inicial — CRM-01

- aplicação Next.js executável;
- TypeScript estrito;
- Tailwind e base shadcn/ui;
- PostgreSQL local em Docker;
- Prisma conectado por adapter PostgreSQL;
- configuração validada por Zod;
- Vitest e Playwright;
- monólito modular;
- logging e erro central;
- health check de aplicação e banco;
- página inicial mínima;
- documentação operacional.

## Fora da fundação inicial — histórico da CRM-01

- autenticação e autorização funcionais;
- modelos de usuários ou leads;
- entrada ou distribuição de leads;
- PACTO;
- atividades, tarefas e reuniões;
- oportunidades, propostas ou pipeline;
- métricas e dashboard;
- automações;
- recomendações ou LLM;
- qualquer integração externa;
- deploy.

## Escopo acumulado do MVP local — CRM-01 a CRM-30

O serviço único de entrada agora persiste, na mesma transação, o responsável
operacional, a atribuição histórica, a tarefa `Ligar agora` e um ciclo de SLA por
submissão. A distribuição usa round-robin entre SDRs ativos e não pausados; sem
candidato, usa a Fila Geral como responsável explícito e abre alerta operacional.

A política obrigatória é `SLA imediato — 0 minutos`. O vencimento coincide com
o recebimento. Até 60 segundos, 61–180 e acima de 180 são apenas classificações
de saúde. Gestores autorizados podem distribuir ou redistribuir; todas as
mutações relevantes geram timeline e auditoria no servidor.

A CRM-07 disponibiliza cadastro manual, importação CSV com preview e relatório,
webhook estritamente local e simulador fictício controlado. Os quatro canais
usam a mesma fronteira de entrada e, portanto, não contornam deduplicação,
distribuição, SLA ou auditoria. A tela é funcional e ainda não representa a
lista operacional ou o cartão do lead.

A CRM-08 implementa o histórico operacional: atividades tipadas e imutáveis,
tarefas com resultado, próxima ação derivada de tarefa ativa, sinal persistido
de resposta recebida e timeline cronológica paginada. Concluir uma tarefa pode
criar a seguinte somente quando ela é informada explicitamente. Correções geram
novo evento, e eventos comerciais continuam distintos do `AuditLog`. Leitura e
mutação respeitam workspace e RBAC no servidor.

A CRM-09 acrescenta uma tabela operacional de alta densidade baseada somente
nos dados persistidos. Busca, paginação, filtros combinados, ordenação, colunas
e visualizações salvas são processados no servidor e refletidos na URL. A ordem
padrão prioriza resposta recente, novos P1/P2/P3, retornos vencidos e demais
pendências. A redistribuição em massa exige motivo, confirmação e
`leads.assign`, reutilizando o domínio de distribuição para gerar timeline e
auditoria por lead.

A CRM-10 implementa a fila Meu Dia nas seções Agora, Novos, P1, Aguardando
ligação, Responderam, Retorno para hoje, Atrasados, Reuniões de hoje e Sem
próxima ação. Cada item mostra o responsável, a prioridade e seu motivo, score
quando existir, SLA em segundos, fatos recentes, próxima ação e uma recomendação
determinística explicada. As contagens abrem a lista com exatamente o recorte
que as originou. Gestores podem selecionar SDRs dentro do seu escopo; SDRs não
veem leads fora da política OWN e das filas explicitamente autorizadas.

O cartão 360 da CRM-11 centraliza cabeçalho operacional, dados de contato,
contexto, respostas da última submissão, prioridade explicada quando persistida,
alertas, campos faltantes, tarefas e timeline paginada. Ligações, mensagens,
notas, tarefas e redistribuição usam os serviços existentes. A edição explícita
do resumo pode limpar campos opcionais e é protegida por versão otimista, lock,
timeline e auditoria. Telefone não é editado nesse formulário por compor a
identidade deduplicada. A visibilidade de dados e ações deriva de RBAC no
servidor; a aba Auditoria aparece apenas para quem possui `audit.read`.

O PACTO da CRM-12 estrutura Político/contexto, Aflição, Capacidade, Tomada de
decisão e Oportunidade agora. Cada dimensão distingue Não investigado,
Favorável, Parcial, Desfavorável e Desqualificante e registra nota, evidência,
data, responsável e origem. Formulário e IA permanecem como sinais separados;
somente uma pessoa autorizada salva o rascunho e valida explicitamente.

O mínimo inicial é cinco dimensões investigadas, persistido por workspace e
capturado em cada revisão para preservar a regra histórica. PACTO completo com
dimensão desqualificante pode ser validado como fato, mas não fica apto à
qualificação. A CRM-12 não altera estágio ou status do lead; a aplicação dessa
decisão ao pipeline pertence à CRM-14.

A CRM-13 implementa score determinístico de 0 a 100 com pesos iniciais de 25
para dor, 30 para capacidade, 15 para decisão, 20 para intenção em até 30 dias e
10 para contexto. As faixas são P1 70–100, P2 40–69 e P3 0–39. Ausência de dado
gera lacuna explicada, não sinal negativo; penalidades só decorrem de sinal
explícito ou regra determinística documentada.

Cada cálculo fotografa regra, versão, entrada, componentes, motivos positivos,
negativos e ausentes. Formulário, validação do SDR, sugestão da IA e override
humano são fontes separadas. A pontuação vigente é uma projeção relacional
explícita; IA nunca a promove e override exige motivo, permissão e auditoria.
Validar PACTO atualiza o score vigente, mas ainda não altera o pipeline.

A CRM-14 materializa o pipeline de pré-vendas em oito etapas: Novo, Tentando
contato, Conectado, Em qualificação, Qualificado, Reunião agendada, Nutrição e
Desqualificado. Toda alteração passa pelo mesmo serviço de domínio, fecha o
intervalo anterior de `StageHistory`, abre o seguinte e registra timeline e
auditoria com ator, origem e motivo.

Etapas abertas exigem tarefa ativa como próxima ação. Qualificado e Reunião
agendada exigem PACTO validado e apto; Desqualificado exige motivo persistido e
confirmação. Correções fora do grafo normal são exclusivas de quem também pode
redistribuir leads, exigem motivo e confirmação e ficam diferenciadas no
histórico. Quadro, lista e cartão usam a mesma autorização no servidor.

A CRM-15 implementa a agenda interna diária e semanal, com filtro por closer,
reuniões de 30 ou 40 minutos, detecção de conflito, confirmação, remarcação,
cancelamento, comparecimento e no-show. O agendamento válido atualiza o pipeline
para Reunião agendada e cria tarefa, timeline, histórico de reunião e auditoria
atomicamente. Remarcações mantêm revisões anteriores; cancelamento não conta
como show/no-show; horário passado sem resultado vira pendência operacional.

O closer recebe briefing calculado somente de dados persistidos: formulário,
PACTO humano validado, dor, decisão, capacidade, urgência, histórico, perguntas
sem resposta e próxima ação. O cartão 360 exibe o histórico de reuniões.

A CRM-16 implementa um pipeline de vendas separado em sete etapas: Reunião
agendada, Reunião realizada, Oportunidade confirmada, Proposta, Negociação,
Ganho e Perdido. A oportunidade nasce vinculada a lead, reunião, closer e
produto ou interesse explícito. Valor estimado, MRR e TCV ficam em centavos; a
probabilidade é manual e não se apresenta como previsão.

Toda etapa aberta exige tarefa vinculada como próxima ação. Proposta exige valor
ou justificativa; ganho exige valor, produto, responsável, data e confirmação;
perda exige motivo e confirmação. Fechamento cancela somente tarefas
incompatíveis da oportunidade por serviço controlado. Reabertura é correção
gerencial autorizada, motivada e confirmada. Projeção atual, `StageHistory`,
timeline e auditoria permanecem consistentes na mesma transação.

A aba Oportunidade do cartão e `/oportunidades` oferecem criação, registro de
proposta, transições e filtros por closer, produto, etapa e período. O fluxo de
comparecimento da agenda avança a oportunidade vinculada para Reunião realizada
sem duplicar o histórico.

A CRM-17 disponibiliza configurações comerciais protegidas para produtos,
ofertas, motivos, pipelines, SLA, scoring, PACTO, cadência, duração de reuniões,
distribuição e limites de lead parado. Alterações sensíveis mostram impacto e
exigem confirmação. Regras que afetam história criam versão nova; itens em uso
são inativados sem quebrar seus vínculos.

O SLA continua sendo **SLA imediato — 0 minutos**. Os limites de 60 e 180
segundos são faixas visuais configuráveis, não prazos alternativos. O
round-robin e as transições de pipeline consomem a configuração persistida no
servidor. Não há editor de automações nem integração externa nesta entrega.

A CRM-18 adiciona a administração operacional de usuários e equipes. O
Administrador cria identidades locais, altera papel e função comercial, mantém
equipes, pausa o recebimento e ativa ou inativa memberships após revisar o
impacto. O Gestor visualiza carga e permissões efetivas e redistribui apenas nas
próprias equipes.

Inativação preserva a autoria, revoga sessões e move leads e tarefas abertas no
mesmo commit para um SDR elegível ou para a Fila Geral explícita. Usuários
inativos ou pausados ficam fora do round-robin. Todos os indicadores da tela são
calculados do banco, e toda mutação exige confirmação, autorização server-side
e auditoria.

Continuam fora do escopo acumulado: recuperação de senha, convites externos,
MFA, SSO, onboarding externo/provisionamento e integrações externas, inclusive
Google Calendar. O runtime padrão de IA continua inteiramente local e
determinístico; nenhum provider externo está configurado.

A CRM-51 implementa a passagem comercial e o onboarding operacional local.
Oportunidade ganha, contrato aceito, handoff enviado, aceite do responsável,
ativação e conclusão são fatos separados. Templates versionados geram marcos
históricos com evidência, responsável, próxima ação e prazo. A ativação nunca é
inferida por ganho, contrato, assinatura ou pagamento.

A CRM-19 e a CRM-20 adicionam definições únicas de métricas e dashboard com
drilldowns reconciliáveis. A CRM-21 até a CRM-23 implementam o worker local e as
12 automações predefinidas, mantendo mensagens e lembretes explicitamente
simulados.

A CRM-24 disponibiliza auditoria administrativa pesquisável e saúde
determinística do processo. Gestores autorizados filtram ator, tipo de ator,
ação, entidade, origem, período e texto; valores anteriores e posteriores são
legíveis com minimização de dados sensíveis. Achados persistidos cobrem as nove
violações exigidas e também o erro operacional de lead sem próxima ação usado no
dashboard.

Cada achado expõe severidade, evidência concreta, link para o registro e estado
aberto, reconhecido ou resolvido. A correção ocorre no fluxo normal e gera novo
log; reconhecer ou resolver nunca apaga o fato. A detecção é relacional,
reproduzível e independente de IA. Exportação administrativa permanece futura
até uma revisão específica de segurança.

A CRM-25 acrescenta a camada desacoplada de IA sem chave obrigatória: seis
prompts versionados, contratos estritos, provider local determinístico,
adaptador HTTP compatível injetável, fallback controlado, `AIInsight`
rastreável, permissão `ai.use` e auditoria.

A CRM-26 integra à aba Inteligência do cartão a análise do lead, preparação da
ligação, extração de nota/transcrição por marcadores explícitos e próxima melhor
ação. Fatos, inferências e ausências aparecem separados. PACTO, score e tarefas
só mudam após seleção e confirmação humana, inclusive parcial; edição e rejeição
ficam na timeline e auditoria. Opt-out impede sugestão ou envio de mensagem.

O Copilot gerencial da CRM-27 acrescenta oito perguntas fechadas sobre fila,
equipe, funil, PACTO, oportunidades, origem, ações do dia e show rate. Cada
resposta apresenta período, filtros, fórmula, numerador, denominador,
comparação quando aplicável, evidências, registros e limitações. Causas
possíveis são identificadas como correlações; confirmar a recomendação registra
a decisão, mas não redistribui nem altera o domínio automaticamente.

A CRM-28 consolida a experiência operacional em um shell responsivo com
navegação lateral, densidade adequada a notebook, foco visível e estados
consistentes. Meu Dia destaca por texto quem atender agora; lista, cartão,
PACTO, pipelines, agenda, dashboard e Copilot mantêm suas informações
persistidas e regras anteriores. Cor nunca é o único sinal de prioridade, etapa,
SLA ou erro.

A CRM-29 adiciona uma base fictícia, temporalmente coerente e idempotente de 320
leads ao longo de 30 dias. Conversões, PACTO, reuniões, no-shows, oportunidades,
ganhos, perdas, automações, insights e auditoria formam narrativas relacionais
reproduzíveis. O namespace demonstrativo é explícito, usa apenas contatos
reservados e não apaga registros manuais.

A CRM-30 consolida as suítes unitária, relacional e E2E, endurece validação de
entrada, autorização, rate limit local, logs, CSV e headers HTTP e executa o
fluxo principal em build otimizado. Isso é um gate de MVP local, não uma
certificação de segurança, escala ou disponibilidade de produção.

## Critérios de aceite do MVP local

- um desenvolvedor inicia o sistema seguindo somente o README;
- banco local inicia e fica saudável;
- health check diferencia banco disponível e indisponível;
- configuração inválida falha de forma explícita e segura;
- os fluxos comerciais usam exclusivamente dados persistidos e serviços de
  domínio autorizados;
- métricas e drilldowns reconciliam sobre o mesmo universo;
- IA local separa fatos, inferências e ausências e não altera o domínio sem
  confirmação humana;
- testes unitários, relacionais, de seed e E2E passam em schemas locais
  descartáveis;
- lint, tipos e build passam;
- nenhuma integração simulada é apresentada como real;
- riscos de produção e itens não validados permanecem explícitos.
