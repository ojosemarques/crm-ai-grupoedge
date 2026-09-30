# Design system do Politizai CRM

O padrão principal é claro, seguindo as referências de CRM e analytics fornecidas: fundo cinza suave, navegação horizontal em cápsula, menu lateral compacto, cards brancos arredondados e tipografia Inter. Ações principais usam neutro escuro; criação e gráficos recebem acentos em laranja, azul e violeta. O tema escuro está disponível no menu lateral e no menu da conta; a preferência é salva em `politizai-crm-theme-v2`.

## Fundamentos

Os tokens semânticos ficam em `src/app/crm-design-system.css`. `globals.css` contém o reset, utilitários e componentes compartilhados; os layouts de cada área usam CSS Modules próximos dos componentes.

| Uso | Token | Claro |
| --- | --- | --- |
| Fundo / superfície | `--background`, `--surface` | `#f4f5f3` / `#ffffff` |
| Texto | `--foreground` | `#242620` |
| Áreas secundárias | `--surface-subtle` | `#f5f6f4` |
| Seleção | `--surface-selected` | `#f0f1ee` |
| Ação principal / destaque | `--primary`, `--accent` | `#242620` / `#f87335` |
| Borda | `--border` | `#eceee9` |
| Raio: controle / painel / modal | `--radius-control`, `--radius-panel`, `--radius-modal` | 10 / 20 / 22 px |

Estados usam `--success`, `--warning`, `--danger`, `--info` e respectivas superfícies. As cores de séries e tags distinguem categorias; texto e superfícies gerais acompanham o tema. Animações respeitam `prefers-reduced-motion`.

A política CSP bloqueia atributos `style` enviados pelo servidor. Layouts usam classes e `data-*`; progresso usa `<progress>` ou atributos SVG. O dimensionamento dos containers Recharts é definido no CSS compartilhado para os gráficos aparecerem também no primeiro carregamento.

## Navegação e componentes

- **Navegação:** barra flutuante com abas de módulos em cápsula; sidebar exibe apenas as rotas da área atual. Mais dá acesso ao catálogo de áreas permitido ao perfil. O menu começa compacto no desktop e pode ser expandido; no celular vira drawer, com foco contido quando aberto e conteúdo inerte quando fechado. Busca, criação e perfil ficam no topo.
- **Pipelines:** colunas permanecem visíveis mesmo vazias; cards compactos mostram prioridade, responsável e próxima atividade. Quadro/lista, arraste e transições conservam as regras de negócio.
- **Contatos e empresas:** tabelas com identificação e filtros; detalhes em perfil, atividades e contexto comercial. Iniciais derivam do registro quando não há foto disponível.
- **Atendimento:** lista, conversa e contexto em três painéis. Mensagens enviadas usam azul claro. A conversa rola de forma independente do composer.
- **Agenda:** mini calendário mensal, navegação por data, grades de dia/semana, lista, detalhe e agendamento em modais. A consulta suporta dia/semana; o mini calendário seleciona o período real.
- **Dashboard:** KPIs com minigráficos, evolução comercial em área, distribuição de leads em donut, funil conectado, receita, prioridades e desempenho por equipe. Filtros e drilldowns preservam o recorte. As tabelas expõem valores exatos, bases, cobertura e denominadores; a distribuição descreve apenas os leads com etapa registrada.
- **Indicadores de receita:** resumo assimétrico, comparação entre vendas e recebimentos, MRR, retenção por coorte, cenários de previsão, qualidade e catálogo. Gráficos têm estados vazios, detalhes por teclado e acesso aos registros. Valores monetários exatos permanecem em centavos; a conversão numérica é restrita à apresentação dos gráficos.
- **Metas, previsão, aquisição e geografia:** cards de desempenho, gráficos comparativos e detalhamento utilizam os dados já disponíveis. Cenários de previsão são independentes e coortes representam o corte consultado; a interface não inventa séries históricas.
- **Configurações:** navegação por seção, formulários de domínio preservados e prévia de impacto em modal antes de aplicar.
- **Automações:** seleção de fluxo, representação de gatilho e ação, configuração consultável e histórico em aba própria. A representação visual não acrescenta capacidade de editar o motor.
- **Modais:** `AccessibleDialog` mantém foco, restaura o foco de origem e permite Escape/cancelamento quando a ação não está em andamento. Formulários mantêm erros junto da ação correspondente.
- **Demais áreas:** pós-venda, finanças, administração, governança, integrações e copilot compartilham tokens, cards, tabelas, formulários compactos e detalhes progressivos.

A identidade visual não altera contratos, cálculos, permissões, integrações ou dados de produção. Estados vazios são explícitos; valores, fotos e mensagens demonstrativas não são inseridos na produção para preencher a interface.
