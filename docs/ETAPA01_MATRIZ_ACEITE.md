# Etapa 01 — contrato de paridade e matriz de aceite documental

**Escopo:** contrato de paridade funcional C01–C15 para o CRM comercial interno da Politizai. Esta matriz transforma o [roadmap](./ROADMAP_CRM_POLITIZAI_PARIDADE_CLINT.md) em critérios verificáveis. A comparação de fontes e a linha de base técnica ficam, respectivamente, em [fontes da Clint](./ETAPA01_CLINT_FONTES.md) e [linha de base do CRM](./ETAPA01_CRM_BASELINE.md). Por instrução posterior do solicitante, a etapa 01 usa fontes públicas no lugar dos testes em conta de avaliação inexistente, e agentes fazem a revisão de produto, engenharia e operação. Esse aceite delegado se limita ao **inventário, critérios e linha de base**; não atesta paridade funcional, ICP validado ou liberação para dados reais.

## Regra de decisão

Cada capacidade recebe `PAR` somente com execução ponta a ponta no ambiente autorizado, comparação com a fonte oficial ou conta de avaliação, prova de RBAC e isolamento de workspace, histórico, privacidade, idempotência e reversão quando aplicável. `PARCIAL` registra comportamento comprovado incompleto; `BLOQUEADO` registra dependência externa ou gate; `DIVERGENTE` registra comportamento diferente do contrato comparado. Existência de tela, schema, mock ou documentação não equivale a execução. Produto, engenharia e operação devem registrar decisão, responsável, data e evidência por capacidade. Nenhum aceite dessa natureza foi presumido aqui.

| ID | Cenário mínimo de aceite | Evidência exigida | Decisor de negócio / verificador técnico | Situação do aceite |
|---|---|---|---|---|
| C01 | Pessoa vinculada a duas contas e duas oportunidades; importação e exportação CSV sem fusão incorreta. | IDs antes/depois, CSV de ida e volta, revisão de colisão e teste de escopo. Vínculo datado é requisito Politizai; a importação pública da Clint não o comprova. | Produto / engenharia e operação | Pendente |
| C02 | Modelo de etapas e atividades reutilizado, copiado e migrado com prévia e reversão. | Versões, mapa de etapas, cards afetados e histórico. | Produto / engenharia e operação | Pendente |
| C03 | Criar, filtrar, mover, redistribuir e fechar card com motivo, concorrência e visibilidade corretas. | Rastro do card, negativas de permissão e teste simultâneo. | Operação / engenharia e produto | Pendente |
| C04 | Oportunidade ativa mantém próximo compromisso; reentrada recalcula tarefa e espera pactuada não vira atraso. | Linha do tempo, prazos e configuração aplicada. | Operação / engenharia e produto | Pendente |
| C05 | Mensagem recebida liga identidade e negócio; transferência humana preserva contexto e impede resposta dupla. | IDs de conversa/mensagem, eventos, auditoria e teste concorrente. | Operação / engenharia e produto | Pendente |
| C06 | Campanha aprovada usa público previsto, opt-out, limite, canal autorizado e métricas conciliadas. | Prévia, recibos por destinatário, custo, supressões e reconciliação. | Produto / engenharia e operação | Pendente |
| C07 | Ligação, reunião e e-mail ficam no card; transcrição consentida tem acesso restrito; funções críticas cabem em tela móvel. | Evento real por canal, permissão, consentimento e roteiro móvel. | Operação / engenharia e produto | Pendente |
| C08 | Criar, avaliar, publicar, pausar e reverter agente/base; bloquear resposta sem fonte e oferta não ativa. | Versões, avaliações, logs e tentativa negativa. | Produto / engenharia e operação | Pendente |
| C09 | Agente coleta dados em conversa de teste e faz handoff sem resposta concorrente ou avanço sensível automático. | Transcrição, posse da conversa, campos propostos e decisão humana. Agente Instagram segue sem confirmação operacional na fonte pública. | Operação / engenharia e produto | Pendente |
| C10 | Consulta responde com dados e fontes; criação assistida mostra prévia, requer aprovação e permite reversão. | Consulta reproduzível, diff, auditoria e cancelamento sem efeito. Tutorial público detalha gráfico; criação ampla de funil/agente/automação segue anúncio. | Produto / engenharia e operação | Pendente |
| C11 | Operador publica fluxo visual versionado; execução antiga permanece íntegra e replay não duplica efeitos. | Grafo, versões, runs, replay e métricas por nó. | Operação / engenharia e produto | Pendente |
| C12 | Entrada repetida ou fora de ordem por canal/API cria um único efeito, com mapeamento e origem verificáveis. | Payloads sintéticos, assinaturas, IDs, cursor e trilha de deduplicação. API de atividades não consta na fonte Clint; plano elegível e limites seguem inconclusivos. | Engenharia / operação e produto | Pendente |
| C13 | Evento financeiro externo reconcilia compra, pendência, reembolso e assinatura sem duplicar receita. | Eventos assinados, ledger, contrato e teste de reenvio. | Produto / engenharia e operação | Pendente |
| C14 | Gráfico configurado, CSV e drilldown autorizado devolvem a mesma métrica no mesmo período. | Definição versionada, consultas, CSV e registros de origem. | Produto / engenharia e operação | Pendente |
| C15 | Origem, custo e receita conciliam; feedback de conversão sai só com permissão e orçamento controlado. | Proveniência, consentimento, recibo externo e reconciliação. Tutorial Clint de Meta CAPI restringe a Click to WhatsApp; Google consta como anúncio, sem tutorial equivalente localizado. | Produto / engenharia e operação | Pendente |

## Prioridade comercial proposta

**Primeiro experimento priorizado na revisão documental:** linha Politizai Mandato para gabinetes de vereadores, como hipótese de ICP. A escolha reduz a variação inicial em relação a misturar vereadores e deputados. Isto define a ordem de investigação, não valida o ICP nem confirma uma oferta pronta. Entrevistas com comprador, patrocinador e usuário, escopo demonstrável, capacidade de implantação e condições comerciais ainda precisam de validação antes de prometer funcionalidade, preço ou prazo. Politizai IA e Governo permanecem ideias/expansão futura conforme o [estudo de aplicação](./CLINT_APLICADA_A_POLITIZAI.md).

**Sequência proposta:** validar recorte, oferta e jornada consultiva; completar conta/contato e funil; fechar atividades e plano de conta; só então ampliar automação, canais, IA e campanha conforme gates externos. A priorização não altera a ordem de dependências das etapas 02–19.

## Registro de aceite e incógnitas

| Decisão pendente | Evidência para fechar | Responsável | Estado |
|---|---|---|---|
| Aura criando objetos, agente no Instagram, deduplicação e limites de API na Clint | Fontes públicas examinadas; roteiro autenticado só se houver conta no futuro | Produto/engenharia | `Indisponível` para confirmação operacional; incógnita aceita na etapa documental por instrução do solicitante |
| Primeiro recorte Mandato | Ordem do primeiro experimento definida; entrevistas, oferta e capacidade serão validadas antes de ativação comercial | Produto/operação | Priorizado como hipótese: gabinetes de vereadores |
| Revisão da matriz C01–C15 como contrato documental | Pareceres independentes registrados abaixo, com data, decisão e limites | Agentes delegados pelo solicitante | Aprovado para linha de base documental; aceites funcionais C01–C15 permanecem pendentes |

## Revisão delegada da etapa 01

| Frente | Revisor e data | Decisão e limite |
|---|---|---|
| Produto | Agente `clint_sources`, 29/09/2026 | Aprovou inventário público e matriz como contrato documental. Ressalvou os quatro testes sem trial e diferenças específicas C01, C09, C10, C12 e C15, incorporadas nesta matriz. |
| Engenharia | Agente `crm_baseline`, 29/09/2026 | Aprovou a linha de base estática C01–C15 após verificar rotas, serviços, schema, permissões, testes e incógnitas. Não atestou comportamento em produção. |
| Operação | Agente `production_readiness`, 29/09/2026 | Aprovou com ressalvas o contrato, os critérios e a linha de base para orientar as etapas seguintes, sem liberar uso com dados reais. Ressalvas sobre separação de aceites, priorização como experimento e evidência de UI foram incorporadas. |

**Decisão integrada:** a entrega **documental** da etapa 01 fica aceita no escopo ajustado pelo solicitante: C01–C15 inventariados, fontes públicas confrontadas, quatro incógnitas autenticadas registradas como `indisponível`, linha de base técnica e relato textual limitado da UI remota registrados, matriz aprovada por revisores agentes e primeiro experimento priorizado. Isto **não altera** os status funcionais pendentes na tabela nem equivale a 100% de paridade do CRM ou a go-live com dados reais.
