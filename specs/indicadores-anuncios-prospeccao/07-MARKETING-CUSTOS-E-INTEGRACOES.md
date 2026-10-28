# Marketing e custos

Anúncios significa inbound geral, não mídia paga. Observado: marketing-form-submission-service persiste receipt/submission, destino, campos/campanhas e outbox existente de conversão Meta. Intake mantém fonte inicial e fonte mais recente, campanha/criativo e rawPayload minimizado. Não instalar MCP novo nem ativar campanhas/automação.

Preservar IDs do formulário/receipt/campanha/criativo, UTMs e referência externa já recebidos. Front comercial vem do pipeline no evento; aquisição da fonte; canal da interação; campanha é dimensão independente. Desconhecido permanece desconhecido. Form-advertising-sync é operação explícita antiga: não executar movimentação em massa nesta entrega.

Contrato futuro mínimo de custos: provedor/conta/campaignId externo, data local de referência, moeda, fuso, quantia em centavos, updatedAt, chave idempotente provider+account+campaign+date+currency, estado/intervalo de cobertura e erro seguro. Reprocessamento substitui versão do mesmo custo, sem somar retries. Só unir campanhas por IDs mapeados; divergência fica pendente. Dados da plataforma e resultados CRM são séries distintas.

Sem investimento real elegível, exibir “Integração de custos não configurada” ou “Dados de investimento indisponíveis”; não computar CPL/ROAS/ROI como zero. CPL=investimento/entradas atribuídas cobertas; demais custos usam qualificação/reunião/aquisição da mesma coorte, moeda e período; ROAS=receita atribuída/investimento; ROI exige definição de custos que esta entrega não inventa. Não somar moedas.

Aceite: formulário existente segue destino, replay preserva receipt, lead da outra frente permanece; UI honesta sem investimento. Testar sem serviços externos nem comunicações reais. Dependência futura documentada, sem infraestrutura ou migration especulativa.

## Fonte de investimento existente

marketing_performance_facts já contém revisões por grainKey, status e moeda. marketing-cost-status.tsx usa apenas a revisão mais recente confirmada, soma moedas separadamente e exige marketing.media.read WORKSPACE. Em recortes de pessoa/equipe/origem sem vínculo de custo comprovado, informa indisponibilidade de atribuição e liga ao módulo existente. Não afirma integração desconfigurada quando há dados; período sem fatos é indisponível, não gasto zero. Custos/ROAS detalhados continuam no módulo de mídia autorizado.
