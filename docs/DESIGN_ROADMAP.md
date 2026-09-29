# Roadmap de evolução visual

Este roadmap divide o redesenho solicitado em entregas pequenas e demonstráveis.
Cada etapa preserva serviços de domínio, permissões, auditoria e dados persistidos.
Nenhuma etapa posterior deve ser iniciada automaticamente.

## DESIGN-01 — Marca, shell e dashboard executivo

Status: concluída e validada em 11 de setembro de 2026.

- aplicar a marca e a paleta oficial da Politizai;
- substituir siglas da navegação por ícones consistentes;
- tornar o dashboard a primeira tela após o login;
- priorizar receita, vendas, oportunidades, leads, funil e pendências;
- recolher filtros avançados sem remover sua execução server-side;
- preservar numeradores, denominadores e drilldowns reconciliáveis;
- validar desktop, mobile, teclado, estados vazios e build.

## DESIGN-02 — Nova identidade visual, tipografia e tokens globais

Status: concluída e validada em 11 de setembro de 2026.

- substituir Inter por Plus Jakarta Sans variável e auto-hospedada pelo Next.js;
- centralizar a paleta Politizai e as cores semânticas em tokens globais;
- refinar pesos, raios, sombras, superfícies, foco e estados compartilhados;
- unificar sidebar, topbar, títulos, controles, tabelas, badges e feedback;
- validar as sete telas prioritárias em quatro resoluções sem alterar estruturas
  ou regras comerciais específicas.

## DESIGN-03 — Meu Dia orientado à próxima ação

Status: concluída e validada em 11 de setembro de 2026.

- destacar somente o lead mais urgente e a ação recomendada;
- preservar contagens e as nove filas em navegação acessível;
- compactar a lista e separar compromissos e riscos em painel lateral;
- manter ordenação, SLA vivo, escopo, atualização e drilldowns existentes;
- validar desktop, mobile, teclado, estado vazio e dados abundantes.

## DESIGN-04 — Redesign completo dos filtros da lista de Leads

Status: concluída e validada em 11 de setembro de 2026.

- concentrar busca, prioridade, etapa, responsável e SLA na barra principal;
- substituir multisseleções nativas altas por dialogs com checkboxes, busca e
  aplicação explícita;
- expor filtros ativos como chips removíveis e preservar query string e
  drilldowns;
- organizar filtros avançados por assunto em drawer responsivo;
- separar ordenação, paginação, colunas, visualizações salvas e ação em massa;
- manter consultas, permissões e mutações de domínio existentes;
- validar funcionalidade, acessibilidade e quatro resoluções sem overflow.

## DESIGN-05 — Dados comparativos e séries para o Dashboard

Status: concluída e validada em 11 de setembro de 2026.

- comparar período atual e anterior equivalente com intervalos civis exatos;
- fornecer séries históricas tipadas, granularidade documentada e zeros reais;
- modelar o funil até ganho, perda e desqualificação sem linearizar desfechos;
- preservar filtros, permissões, denominadores, drilldowns e valores em centavos;
- preparar dados sem antecipar o redesenho visual do Dashboard.

## DESIGN-06 — Dashboard executivo comparativo e acionável

Status: concluída e validada em 11 de setembro de 2026.

- organizar KPIs comparativos, evolução comercial, receita, funil, SLA,
  aquisição, performance e itens que exigem ação;
- usar gráficos responsivos com legenda, tooltip e alternativa tabular;
- preservar Server Component na página e isolar somente os gráficos no cliente;
- manter todos os números reconciliáveis com a camada de métricas e drilldowns;
- validar quatro resoluções, acessibilidade, hidratação e estados sem dados.

## DESIGN-07 — Revisão visual completa, consistência e QA

Status: concluída e validada em 11 de setembro de 2026.

- consolidar superfícies, cabeçalhos, indicadores, badges, vazios e tabelas onde
  havia repetição real;
- harmonizar telas operacionais, comerciais, administrativas e estados públicos
  sem alterar serviços ou regras de negócio;
- verificar hierarquia de ações, contraste, foco, teclado, movimento reduzido e
  refluxo em zoom equivalente a 200%;
- inspecionar 15 rotas em cinco resoluções, com capturas desktop e mobile;
- executar unitários, integração, E2E completo, lint, tipos e build sem deploy.

Nenhuma nova etapa visual está autorizada após a DESIGN-07.

## Critério de direção

O dashboard segue três princípios da skill `revenue-centric-design`: KPI principal
no topo esquerdo, hierarquia de atenção voltada ao trabalho mais valioso e
resposta explícita à pergunta “o que devo fazer agora?”. Componentes sem dado
persistido ou sem ação útil não são preenchidos com números decorativos.
