# Design system do Politizai CRM

O padrão principal é claro, seguindo as referências de CRM fornecidas: navegação horizontal, menu contextual, colunas lavanda, cards brancos compactos, tipografia Poppins e ações roxas. O tema escuro continua disponível no menu da conta; a preferência é salva em `politizai-crm-theme-v2`.

## Fundamentos

Os tokens semânticos ficam em `src/app/crm-design-system.css`. `globals.css` contém o reset, utilitários e componentes compartilhados; os layouts de cada área usam CSS Modules próximos dos componentes.

| Uso | Token | Claro |
| --- | --- | --- |
| Fundo e superfície | `--background`, `--surface` | `#ffffff` |
| Texto | `--foreground` | `#322d59` |
| Colunas e áreas secundárias | `--surface-subtle` | `#f1f3fe` |
| Seleção | `--surface-selected` | `#eee8fc` |
| Ação principal | `--primary` | `#6826d9` |
| Borda | `--border` | `#ecebf3` |
| Raio: controle / painel / modal | `--radius-control`, `--radius-panel`, `--radius-modal` | 6 / 12 / 16 px |

Estados usam `--success`, `--warning`, `--danger`, `--info` e respectivas superfícies. As cores de séries e tags distinguem categorias; texto e superfícies gerais acompanham o tema. Animações respeitam `prefers-reduced-motion`.

A política CSP bloqueia atributos `style` enviados pelo servidor. Layouts usam classes e `data-*`; progresso usa `<progress>` ou atributos SVG. O dimensionamento dos containers Recharts é definido no CSS compartilhado para os gráficos aparecerem também no primeiro carregamento.

## Navegação e componentes

- **Navegação:** abas de módulos no topo; sidebar exibe apenas as rotas da área atual. Mais dá acesso ao catálogo de áreas permitido ao perfil. Sidebar recolhível no desktop e drawer no celular. Busca, criação e perfil ficam no topo.
- **Pipelines:** colunas permanecem visíveis mesmo vazias; cards compactos mostram prioridade, responsável e próxima atividade. Quadro/lista, arraste e transições conservam as regras de negócio.
- **Contatos e empresas:** tabelas com identificação e filtros; detalhes em perfil, atividades e contexto comercial. Iniciais derivam do registro quando não há foto disponível.
- **Atendimento:** lista, conversa e contexto em três painéis. Mensagens enviadas usam azul claro. A conversa rola de forma independente do composer.
- **Agenda:** mini calendário mensal, navegação por data, grades de dia/semana, lista, detalhe e agendamento em modais. A consulta suporta dia/semana; o mini calendário seleciona o período real.
- **Dashboard e indicadores:** contexto compacto, KPIs com comparação e séries reais, gráficos com acento laranja e controles roxos. Valores em centavos são convertidos somente na camada visual; valores exatos, bases e cobertura permanecem acessíveis.
- **Configurações:** navegação por seção, formulários de domínio preservados e prévia de impacto em modal antes de aplicar.
- **Automações:** seleção de fluxo, representação de gatilho e ação, configuração consultável e histórico em aba própria. A representação visual não acrescenta capacidade de editar o motor.
- **Modais:** `AccessibleDialog` mantém foco, restaura o foco de origem e permite Escape/cancelamento quando a ação não está em andamento. Formulários mantêm erros junto da ação correspondente.
- **Demais áreas:** pós-venda, finanças, administração, governança, integrações e copilot compartilham tokens, cards, tabelas, formulários compactos e detalhes progressivos.

A identidade visual não altera contratos, cálculos, permissões, integrações ou dados de produção. Estados vazios são explícitos; valores, fotos e mensagens demonstrativas não são inseridos na produção para preencher a interface.
