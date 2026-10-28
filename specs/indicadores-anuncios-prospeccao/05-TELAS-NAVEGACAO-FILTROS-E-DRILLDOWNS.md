# Telas e navegação

Reusar DashboardView, charts, filtros e estilos. `/dashboard` = Visão Geral; `/dashboard/anuncios` = Visão Geral — Anúncios; `/dashboard/prospeccao` = Visão Geral — Prospecção Ativa. Grupo Indicadores abre o primeiro item consolidado. Links filhos têm estado ativo específico; pai não fica selecionado junto. Manter demais entradas e atalhos existentes.

Modos fixados no servidor; formulários GET e links preservam período/equipe/pessoa/origem/campanha/criativo/produto/pipeline/etapa/canal. Campos disponíveis pelo contexto real; URLs não concedem acesso. Seleção de outro pipeline só restringe o modo. Drilldowns preservam frente e intervalo inclusive ao voltar. Não mostrar rótulo de Anúncios sobre população de prospecção.

Conteúdo: KPIs, série/comparação, funil, produção por pessoa/equipe, atividades/reuniões, qualidade/atualização e registros. Consolidado mostra contribuição por frente e sobreposição de identidades. Separar entradas, pessoas e estoque com texto inequívoco. Custos indisponíveis com texto explícito. Reusar empty/error states e componentes acessíveis; sem novo design system.

Abas Pipeline/Estoque/Atividades/Métricas preservadas. Atividades inclui tarefas e histórico de ocorrências com navegação para o lead, filtros de tipo/resultado/período e páginas estáveis. Ambas as frentes compartilham a mesma consulta de log. Histórico cruzado no lead não expõe pessoa restrita.

Tarefas: rotas e menu; propagação do modo; filtros/drilldowns; timeline; contribuição/cobertura. Aceite por E2E: três links/títulos; refresh e back preservam recorte; número abre evidência correspondente; navegação teclado/estados ativos e viewport mobile. Rollback: reverter UI/serviços juntos.
