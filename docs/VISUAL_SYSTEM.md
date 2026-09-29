# Sistema visual e experiência operacional

## Objetivo

O sistema visual do Politizai CRM foi desenhado para operação comercial de alta
densidade em desktop, sem perder legibilidade em notebooks ou acesso funcional
em telas menores. Ele não altera regras de domínio: prioridade, SLA, contagens,
alertas e recomendações continuam vindo dos serviços e dos dados persistidos.

## Fundamentos

- tipografia: `Plus Jakarta Sans` variável, carregada por `next/font/google` e
  auto-hospedada no build, com números tabulares para SLA, moeda, datas,
  durações, tabelas e indicadores;
- escala base: texto de 15 px, títulos fluidos e entrelinha de 1,5;
- espaçamento: intervalos de 4 px, painéis entre 16 e 24 px e controles com área
  mínima de 40 px no mobile;
- superfícies: fundo `#F6FAFD`, painéis pontualmente brancos, seleção azul-clara,
  borda discreta e sombra curta somente quando ajuda a separar planos;
- raio: 11 px nos controles, 16 px nos painéis, 20 px nos modais e formato pill
  somente para chips e badges;
- decoração: não há gradientes nem glassmorphism; a hierarquia depende de
  contraste, espaçamento, tipografia e bordas.

A identidade usa o azul-marinho da Politizai na navegação, azul institucional
escuro nas ações primárias e azul médio somente em acentos de tamanho adequado.
O símbolo oficial otimizado está em
`public/brand/politizai-mark.png` e é importado estaticamente pelo Next.js para
evitar que o otimizador de imagem atravesse a proteção de autenticação.

Os tokens vivem em `src/app/globals.css` e são expostos ao Tailwind por
`@theme inline`. Componentes devem consumir os tokens sem introduzir cores
decorativas isoladas.

## Tipografia

Plus Jakarta Sans foi comparada localmente com Manrope em textos de navegação,
títulos, formulário, KPI, moeda, SLA e tabela. A primeira foi escolhida por
preservar densidade e legibilidade com desenho mais amigável e geométrico; a
Manrope ficou mais estreita e utilitária no mesmo recorte. Ambas possuem licença
SIL Open Font License 1.1, mas apenas uma família principal foi adicionada.

A integração em `src/app/layout.tsx` usa a versão variável de
`Plus_Jakarta_Sans`, `display: swap`, subset latino e fallback local. O Next.js
baixa o arquivo no build e o publica junto da aplicação; não há chamada aos
servidores do Google durante o uso. A variável `--font-politizai-sans` é aplicada
globalmente no `body`.

Escala de pesos:

- corpo: 400;
- labels e navegação: 500;
- botões e títulos de seção: 600;
- título principal e KPI: no máximo 700.

Pesos 800 ou superiores não fazem parte do padrão. Caixa alta fica restrita a
eyebrows curtos com espaçamento moderado.

## Tokens de identidade

| Token | Valor | Papel |
|---|---:|---|
| `--brand-navy` | `#0A1931` | sidebar, áreas escuras e texto principal |
| `--brand-sky` | `#B3CFE5` | divisões e seleção suave |
| `--brand-steel` | `#4A7FA7` | ícones, gráficos e acentos secundários |
| `--brand-blue` | `#1A3D63` | ações primárias e navegação ativa |
| `--brand-ice` | `#F6FAFD` | fundo geral da aplicação |

`#4A7FA7` sobre branco fica abaixo de 4,5:1 para texto pequeno. Por isso o token
é reservado a acentos; botões e links textuais usam `#1A3D63`, que supera AA
com branco. Os tokens derivados separam fundo, superfície comum, superfície
discreta, seleção e prioridade, sem hexadecimais decorativos por componente.

## Semântica de cores

| Papel | Cor | Uso permitido |
|---|---|---|
| Informação | `#4A7FA7` / `#1A3D63` | contexto, ação, seleção e navegação |
| Saudável ou concluído | `#217A52` | SLA saudável e sucesso confirmado |
| Atenção | `#8A5600` | pendência, limiar e confirmação sensível |
| Atraso ou risco | `#B42318` | erro, SLA crítico e bloqueio |
| Inativo ou indefinido | `#68798A` | ausência, indisponibilidade e somente leitura |

A cor nunca é a única evidência. Badges e alertas sempre mostram texto como
“Saudável”, “Atenção”, “Crítico”, “Não investigado” ou “Status: Cancelada”.
Prioridade usa badge violeta com `P1`, `P2` ou `P3`; etapa usa contorno neutro
tracejado e seu nome. Assim, os dois conceitos não compartilham o mesmo código
visual.

## Estrutura de navegação

Rotas autenticadas usam um único shell com sidebar `#0A1931`:

- barra lateral persistente no desktop, agrupada em Operação, Análise e Gestão;
- cabeçalho superior compacto com contexto, ambiente local, workspace e logout;
- drawer no mobile, aberto por botão com estado `aria-expanded`, fechado por
  link, fundo ou `Escape`;
- link “Pular para o conteúdo” como primeiro atalho funcional;
- item atual identificado por texto, fundo, borda e `aria-current="page"`.

A rota `/` é o dashboard autenticado. O item “Dashboard” ocupa a primeira
posição, usa o símbolo visual correspondente e também permanece ativo nos deep
links `/dashboard` e `/dashboard/registros`. A barra superior oferece somente
ações reais: nova entrada de lead quando autorizada, notificações, contexto do
workspace e logout.

O conteúdo de servidor é intercalado no shell cliente; o shell não acessa o
banco e obtém somente o resumo autorizado da sessão.

## Componentes e padrões

- `PageHeader`: título único com peso 700 no máximo, contexto curto, descrição,
  metadado e retorno;
- `Surface`: painel base com tons comum, discreto, informativo, prioritário e
  escuro, sem criar card dentro de card por padrão;
- `SectionHeader`: eyebrow, título, descrição e ação com a mesma hierarquia em
  módulos operacionais e administrativos;
- `StatCard`: valor tabular, rótulo e contexto com tons semânticos, usado apenas
  quando a comparação numérica é relevante;
- `StatusBadge`: combina texto, ponto e cor semântica para não comunicar estado
  somente por cor;
- `EmptyState`: título e orientação honestos, em versão comum ou compacta, sem
  preencher ausência de dados com ilustração decorativa;
- `DataTableShell`: contém largura e rolagem de tabelas sem provocar overflow na
  página;
- `Button`: ações primária, secundária, fantasma e destrutiva, todas com foco
  visível e estado desabilitado;
- `AccessibleDialog`: nome acessível, foco inicial, ciclo de Tab, fechamento por
  `Escape` ou fundo e retorno do foco ao acionador;
- `PageLoading`: estado anunciado, sem números ou conteúdo simulado;
- `PageError`: mensagem segura e nova tentativa com a API estável do Next.js 16;
- tabelas: cabeçalho persistente, números tabulares, hover discreto e rolagem
  horizontal contida;
- formulários: rótulos explícitos, foco reforçado, desabilitado distinguível e
  controles compatíveis com teclado;
- feedback: `status` para sucesso e atualização, `alert` para erro; confirmações
  sensíveis permanecem explícitas nos fluxos existentes.

Desfazer só é oferecido quando o serviço de domínio puder revertê-lo com
segurança e auditoria. Nesta entrega nenhuma mutação recebeu um “desfazer”
visual que pudesse reescrever fatos ou contornar confirmações.

## Telas prioritárias

- **Meu Dia:** um único lead ocupa o bloco “Atenda agora”, com identidade,
  motivo, SLA vivo, próxima ação, consequência esperada e ação primária. As
  nove filas permanecem em tabs acessíveis, mas somente uma lista é expandida
  por vez; resumo e painel lateral levam aos recortes persistidos.
- **Lista:** filtros densos, cabeçalho da tabela fixo dentro da rolagem e badges
  distintos para prioridade e etapa.
- **Lead 360:** cabeçalho de contexto, SLA, ações rápidas e tabs fixas; setas,
  Home e End navegam entre tabs.
- **PACTO:** progresso calculado das cinco dimensões e barra lateral por estado,
  sempre acompanhada pelo rótulo do status.
- **Pipelines:** colunas compactas com snap horizontal; qualquer transição segue
  o serviço de domínio, inclusive pelo drag and drop existente.
- **Agenda:** filtros e agendamento fixos no desktop e lista cronológica com
  status por texto.
- **Dashboard:** receita ocupa o ponto principal do padrão F; vendas, conversão
  lead → venda e SLA humano completam o primeiro bloco comparativo. A evolução
  comercial é a maior visualização, enquanto alertas operacionais, funil,
  velocidade, aquisição e performance permanecem imediatamente acessíveis.
  Datas, valores anteriores, numeradores, denominadores e drilldowns continuam
  preservados.
- **Copilot:** perguntas em grade compacta, fatos, hipóteses e limitações
  separados; confirmação continua sem mutação automática.

## Meu Dia orientado à próxima ação

A hierarquia da fila do SDR segue uma sequência operacional deliberada:

1. contexto compacto do turno, escopo selecionado e atualização;
2. um único lead mais urgente, obtido do primeiro item da fila `NOW` sem nova
   ordenação no cliente;
3. resumo clicável de novos, respondidos, atrasados, reuniões do dia e leads
   sem próxima ação;
4. nove tabs com uma única fila visível e estado preservado em `?queue=`;
5. linhas densas com identidade, dor, prioridade, score, SLA, próxima ação e
   botão recomendado;
6. painel lateral para reuniões, retornos vencidos, SLA crítico visível e
   ausência de próxima ação.

O lead em “Atenda agora” é removido somente da representação da lista aberta
para não aparecer duas vezes na mesma tela; ele continua contabilizado e o
drilldown permanece reconciliável. Itens do painel lateral também são
desduplicados visualmente. Nada disso muda os contratos do `SdrQueueService`,
a consulta, as permissões, a recomendação determinística ou a ordenação
persistida.

As tabs usam o padrão ARIA `tablist`/`tab`/`tabpanel`, aceitam setas, Home e End
e integram a URL pela History API suportada pelo App Router. Em telas a partir
de 1280 px, riscos e compromissos ficam em coluna lateral; abaixo disso vão
para depois da fila. No mobile, a ação principal aparece antes da explicação
longa, mantendo nome, SLA e ação no primeiro recorte visual.

## Filtros progressivos da lista de Leads

A lista preserva todos os critérios relacionais existentes, mas deixa de
apresentá-los como um formulário técnico permanentemente aberto. A hierarquia
segue o princípio de reduzir esforço percebido sem remover capacidade:

1. busca, prioridade, etapa, responsável e SLA ficam na barra principal;
2. prioridade, etapa e responsável usam dialogs com checkboxes, contagem,
   busca interna quando necessária e ações explícitas de aplicar e limpar;
3. cada filtro aplicado aparece como chip removível, inclusive recortes vindos
   de drilldowns por query string;
4. critérios avançados ficam em um drawer agrupado por responsabilidade,
   funil, aquisição, perfil, atividade, encerramento e pontuação;
5. ordenação, direção, tamanho da página e colunas usam controles próprios e
   não são apagados ao limpar apenas os filtros;
6. visualizações salvas ocupam uma faixa compacta, com criação em dialog e
   exclusão confirmada;
7. a redistribuição em massa surge em barra contextual sticky somente quando
   existem linhas selecionadas e a permissão server-side a autoriza.

Não existe `<select multiple>` na superfície. Multisseleção não depende de
Ctrl ou Command; dialogs fecham por `Escape`, prendem o foco enquanto abertos e
o devolvem ao acionador. A tabela mantém rolagem horizontal interna, sem
provocar overflow da página, e recebe mais altura útil em todos os breakpoints.
Serialização, nomes dos parâmetros e contratos de `LeadListQuery` não foram
alterados.

## Dashboard executivo comparativo

A DESIGN-06 reorganiza o Dashboard sem criar uma segunda fonte de dados. A
página permanece um Server Component; somente os dois gráficos Recharts vivem
em uma ilha cliente. Comparações, séries, funil, atenção, aquisição e performance
chegam prontos e autorizados pelo `DashboardMetricsService`.

A hierarquia segue o padrão de leitura em F para priorizar decisão e ação:

1. cabeçalho compacto com período atual, intervalo anterior exato, filtros,
   atualização e ação permitida pelo papel;
2. receita em superfície azul-marinho e três KPIs comparativos — vendas,
   conversão lead → venda e SLA humano — com interpretação semântica;
3. evolução comercial como visualização dominante e “Precisa de atenção” ao
   lado, com sete recortes operacionais clicáveis;
4. receita/vendas, funil principal com desfechos, velocidade e SLA;
5. aquisição, prioridade, qualidade PACTO e performance por papel;
6. análises complementares existentes em divulgação progressiva.

Os gráficos usam `#0A1931`, `#1A3D63`, `#4A7FA7` e `#B3CFE5`; verde, âmbar e
vermelho continuam exclusivos de significado operacional. Período atual usa
linha contínua e anterior usa linha tracejada, além do texto da legenda. A série
de receita e a quantidade de vendas são alternadas por controle próprio para
não misturar escalas incompatíveis. Animações foram desativadas para estabilidade
e respeito à redução de movimento.

Cada gráfico possui nome acessível, descrição para leitor de tela, legenda,
tooltip, estado vazio honesto e alternativa tabular recolhível. O contêiner tem
altura explícita para o `ResponsiveContainer`. Tabelas, tabs e conteúdo largo
rolam internamente; a página não cria overflow horizontal. A grade passa de duas
colunas para uma em notebook/tablet e mantém a ordem operacional no mobile.

## Responsividade e movimento

O breakpoint estrutural é 1100 px: acima dele a lateral ocupa 264 px; abaixo,
vira drawer e o conteúdo usa toda a largura. Isso preserva a densidade em
notebooks de 1024 px sem comprimir a fila do SDR. Tabelas e pipelines mantêm rolagem
no próprio componente para não criar overflow na página. Em telas de até 639 px,
controles recebem área mínima maior e dialogs reduzem o padding.

`prefers-reduced-motion: reduce` reduz animações e transições para 0,01 ms,
remove repetição e mantém rolagem automática. Não existem animações essenciais
para compreender estado ou concluir um fluxo.

## Validação

`tests/e2e/visual-system.spec.ts` verifica automaticamente landmarks, um único
`h1`, IDs duplicados, nomes de botões, rótulos de campos, overflow da página,
drawer, `Escape`, movimento reduzido, navegação das tabs e foco do dialog. A
suíte `tests/e2e/design-02-visual.spec.ts` valida fonte, tokens, contrastes AA,
ausência de chamada externa para fontes e overflow; também renderiza Dashboard,
Meu Dia, Leads, Lead 360, Agenda, Pipeline e Login em 1440×900, 1280×800,
1024×768 e 390×844. A suíte E2E existente continua sendo a regressão dos fluxos
principais. A inspeção visual deve cobrir desktop e mobile antes de cada release.

Para a DESIGN-03, `tests/e2e/sdr-queue.spec.ts` valida foco único, nove tabs,
uma lista expandida, P1 respondido, SLA crítico, ação, drilldown, atualização
após atividade, escopo próprio, filtro do gestor, teclado, URL, atualização
automática e ausência de overflow nas quatro resoluções. O teste visual acima
renderiza os quatro snapshots do Meu Dia; a inspeção confirmou ação prioritária
visível no primeiro recorte de 390×844 e painel lateral reposicionado sem
overflow.

Para a DESIGN-04, `tests/e2e/lead-list.spec.ts` valida busca, um e múltiplos
filtros, chips, limpeza individual e total, query string, drilldown,
visualizações salvas, confirmação de exclusão, colunas e ação em massa com
RBAC. `tests/e2e/design-04-lead-filters.spec.ts` renderiza a lista em 1440×900,
1280×800, 1024×768 e 390×844, verifica ausência de overflow e multisseleção
nativa, e inspeciona os sete grupos do drawer e o retorno de foco por `Escape`.

Para a DESIGN-06, `tests/e2e/design-06-dashboard.spec.ts` valida os intervalos
comparados, os quatro KPIs, gráficos com dados e estado vazio, seleção de série,
legenda, tooltip, alternativa tabular, funil ramificado, SLA, atenção,
aquisição, performance, drilldowns, escopo próprio, hidratação e ausência de
overflow. A inspeção visual cobre 1440×900, 1280×800, 1024×768 e 390×844.

## Revisão transversal da DESIGN-07

A revisão final eliminou a divergência entre as telas prioritárias e o restante
do produto. Entrada de leads, Lead 360 e suas abas, pipelines, agenda, briefing,
oportunidades, Copilot, notificações, administração, automações, auditoria e
configurações passaram a compartilhar superfícies, cabeçalhos, indicadores,
badges, tabelas e estados vazios. Login, Dashboard, Meu Dia e Leads foram
reinspecionados como referências da identidade já validada.

Loading, erro, acesso negado, sessão expirada, inexistência e ausência de dados
usam o mesmo vocabulário visual e landmarks previsíveis. Filtros, tabs e ações
continuam específicos quando possuem contratos ou comportamentos de domínio
diferentes; não foi criada uma abstração apenas para uniformizar aparência.

`tests/e2e/design-07-visual-qa.spec.ts` percorre 15 rotas autenticadas em
1440×900, 1280×800, 1024×768, 768×1024 e 390×844, totalizando 75 combinações.
Em cada uma verifica um único título principal e `main`, controles rotulados,
botões nomeados, ausência de IDs duplicados e ausência de overflow horizontal
da página. A suíte ainda verifica PACTO e Inteligência em desktop/mobile, Login,
Acesso negado, Sessão expirada e refluxo equivalente a zoom de 200%. Capturas
de 1440×900 e 390×844 são geradas para as 15 rotas e foram inspecionadas
visualmente.
