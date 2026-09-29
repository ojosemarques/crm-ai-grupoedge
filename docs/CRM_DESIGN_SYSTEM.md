# Design system do Politizai CRM

As referências visuais enviadas para o CRM combinam duas apresentações da mesma linguagem: superfícies escuras com acento violeta e superfícies claras em lavanda. O tema escuro é o padrão; o controle no cabeçalho alterna para o tema claro e guarda a escolha no navegador.

## Fundamentos

Os tokens vivem em [`src/app/crm-design-system.css`](../src/app/crm-design-system.css). Componentes e páginas devem usar as variáveis semânticas, nunca cores fixas para superfícies ou texto.

| Uso | Token | Escuro | Claro |
| --- | --- | --- | --- |
| Fundo da aplicação | `--background` | `#101014` | `#f7f8fd` |
| Texto principal | `--foreground` | `#f5f3fa` | `#2d2852` |
| Superfície principal | `--surface` | `#1a191f` | `#ffffff` |
| Área de trabalho / coluna | `--surface-subtle` | `#222128` | `#f0f2fd` |
| Seleção | `--surface-selected` | `#302741` | `#ece5fb` |
| Ação principal | `--primary` | `#8357ed` | `#6427d4` |
| Contorno | `--border` | `#34323b` | `#e4e2ee` |

Estados funcionais usam `--success`, `--warning`, `--danger` e `--info`, com as respectivas variáveis `*-surface`. O raio de campos, painéis e modais vem de `--radius-control`, `--radius-panel` e `--radius-modal`.

## Padrões de interface

- **Navegação:** menu lateral compacto por grupos, rota ativa com marcador violeta e cabeçalho de contexto com busca e ações.
- **Páginas:** título, contexto e ações no `PageHeader`; conteúdo sobre o fundo da aplicação com espaçamento uniforme.
- **Dados:** `Surface`, `StatCard`, `StatusBadge` e `DataTableShell` usam os mesmos tokens em todas as áreas.
- **Pipelines:** `.crm-kanban`, `.crm-kanban__lane` e `.crm-kanban__card` definem colunas, cards, avatar, prioridade, valor e próxima ação. A rolagem horizontal preserva a leitura em telas estreitas.
- **Conversas:** três áreas de lista, conversa e contexto; mensagens de saída recebem o acento violeta.
- **Modais e formulários:** superfícies com borda perceptível, foco visível e campos que acompanham o tema. Avisos preservam cores semânticas com contraste no tema escuro.

O conteúdo e as ações de cada tela continuam governados pelos dados e permissões existentes. As imagens orientam cor, densidade, formas e hierarquia, sem incorporar marcas ou dados fictícios de outros produtos.
