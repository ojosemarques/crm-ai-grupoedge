# Aplicação dos mecanismos da Clint à operação comercial da Politizai

**Natureza:** estudo de aplicação e desenho operacional, não descrição de uma implantação concluída. **Base:** [benchmark público da Clint](./BENCHMARK_CLINT.md), [resumo fornecido da Politizai](</Users/uscloser/.codex/attachments/6b506a7d-e845-4662-81a5-4a65f2e70a4c/Texto colado.txt>) e documentação do CRM neste repositório. **Data da análise:** 29 de setembro de 2026.

## 1. Leitura executiva e limites

A Clint oferece um mecanismo comercial integrado: captura uma pessoa ou evento, cria e organiza negócios, atribui dono, coloca tarefas e conversas no mesmo contexto, executa automações e agentes de IA, registra ganho/perda e mede o resultado. A aplicação de maior valor para a Politizai é transformar esse mecanismo em uma **operação de venda consultiva, com várias pessoas na decisão e trabalho entre reuniões**, seguida de implantação, prestação de serviços e renovação. O fluxo não termina em um checkout nem se resume a uma sequência fixa de mensagens. [Benchmark, seções 3–10](./BENCHMARK_CLINT.md).

O resumo da Politizai descreve mercados e ofertas em diferentes graus de maturidade. O gabinete de vereador ou deputado é **ICP inicial proposto**, não validado. Politizai Mandato é **linha comercial proposta**; o escopo do Politizai OS ainda precisa de validação. Politizai IA é ideia, Governo é expansão futura e Presença Pública Operada é candidata a serviço inicial. Nada disso deve aparecer em um agente ou proposta como funcionalidade, preço ou entrega já confirmados. O resumo **não informa duração real das etapas, equipe, volume, preço ou conversões**. A cadência longa vem do pedido atual; as etapas e métricas adiante são recomendações a testar. [Resumo Politizai, seções 3–6](</Users/uscloser/.codex/attachments/6b506a7d-e845-4662-81a5-4a65f2e70a4c/Texto colado.txt>).

Há três domínios distintos:

1. **CRM comercial interno da Politizai:** vende software, software com serviços, serviços recorrentes e projetos; acompanha da origem à renovação.
2. **Relacionamento do Mandato, no Politizai OS:** produto usado pelo gabinete para suas relações institucionais, lideranças e demais contatos, conforme escopo que vier a ser validado.
3. **Atendimento Resolvido, no Politizai OS:** produto usado pelo gabinete para receber e acompanhar solicitações.

Os dados de cidadãos ou de atendimento do gabinete **não são leads comerciais da Politizai**. Não há motivo para copiar automaticamente etapas de proposta, venda e receita para os módulos do OS. O próprio [PRD do Revenue OS](./REVENUE_OS_PRD.md) delimita o CRM interno como sistema comercial, não como CRM eleitoral ou de gabinete.

### Como ler os status deste documento

| Marcador | Significado |
|---|---|
| **Clint documenta** | Função descrita em material público da Clint; o benchmark não comprova configuração de uma conta autenticada nem adequação contratual à Politizai. |
| **Politizai informa** | Fato ou hipótese do resumo recebido, com o status indicado nele. |
| **Existe localmente** | Implementação ou contrato do repositório; não significa uso em produção nem integração externa ativa. |
| **Proposta** | Aplicação recomendada neste estudo, a validar com cliente, equipe e produto. |

## 2. O que a Politizai vende e por que o CRM precisa refletir isso

O portfólio exige que **tipo de oferta**, **produto/módulo**, **plano comercial** e **tipo de receita** sejam campos diferentes. Um módulo do OS pode ser usado sem serviço operado; serviço prestado pela Politizai tem capacidade, responsáveis, aprovações e marcos próprios. Um projeto Lab tem começo, escopo e aceite; uma assinatura de software tem implantação e renovação. A assinatura não prova que o serviço foi entregue, e o aceite de um projeto não prova adoção de software. [Resumo Politizai, seções 3 e 6](</Users/uscloser/.codex/attachments/6b506a7d-e845-4662-81a5-4a65f2e70a4c/Texto colado.txt>).

| Oferta ou família | Estado informado | Consequência para o CRM comercial |
|---|---|---|
| Politizai OS / Mandato | Produto central com escopo a validar; Mandato é primeira linha proposta | Descobrir rotinas do gabinete, usuários, patrocínio e condições de implantação antes de precificar e prometer módulos. |
| Software com serviços | Tipo de oferta possível | Proposta com parcelas de licença, implantação e serviço discriminadas; handoff duplo para produto e operação. |
| Presença Pública Operada | Serviço inicial candidato | Vender capacidade, frequência, responsabilidades, insumos e aprovação editorial; medir entregas e qualidade, não apenas login. |
| Politizai Lab | Estrutura de projetos sob medida | Qualificar problema, escopo, esforço, dependências e aceite; separar eventual produto repetível de projeto customizado. |
| Politizai Campanha, SMS eleitoral e Tracking | Linha a revisar; formato/status das ofertas específicas a conferir | Funil e material próprios somente após definição de escopo e condições; sem transferir promessa de Mandato para contexto eleitoral. |
| Politizai IA individual e Governo | Ideia e expansão futura | Registrar sinal de demanda e pesquisa; não tratá-los como oferta pronta ou receita provável. Governo exige definição comercial e de contratação própria. |
| Blog/canal de informação | Canal da marca | Registrar como fonte e influência de aquisição, não como produto vendido. |

**Proposta de foco inicial:** testar a linha Mandato com um recorte explícito de gabinete, por exemplo vereador **ou** deputado, sem assumir de saída que ambos têm ciclo e dores idênticos. Em cada venda, distinguir comprador/orçamento, patrocinador da implantação (como chefe de gabinete) e usuários da rotina. Uma reunião com um assessor interessado não equivale a patrocínio ou decisão financeira. [Resumo Politizai, seção 5](</Users/uscloser/.codex/attachments/6b506a7d-e845-4662-81a5-4a65f2e70a4c/Texto colado.txt>).

## 3. Tradução completa dos mecanismos da Clint

| Mecanismo documentado na Clint | Utilidade para a Politizai | Adaptação necessária e limite |
|---|---|---|
| **Contato, organização e negócio** | Guardar pessoas, instituição e uma decisão comercial específica. | Elevar a **conta institucional** e seus papéis ao centro. Um contato pode mudar de gabinete; uma conta pode ter várias oportunidades, contratos e ciclos. Não fundir duas contas só por telefone compartilhado. |
| **Origem e agrupador de origens** | Saber se a entrada veio de indicação, blog, evento, formulário, prospecção ou parceria e organizar filas. | Origem é **como entrou**; oferta é **o que se vende**. Evitar usar uma origem como substituto de linha comercial ou atribuir toda receita ao último toque. |
| **Campos, tags e obrigatoriedade por etapa** | Registrar segmento, dor, papel do contato, oferta, orçamento, prioridade e decisão. | Exigir apenas os campos que fazem sentido naquela passagem de etapa; dados incertos recebem status e fonte, não valores inventados. |
| **Modelos de etapas e atividades** | Criar roteiro repetível e próxima ação por fase. | Modelos separados por Mandato, serviço e projeto; etapas dependem de evidência e entregável. Mudanças de modelo devem ser versionadas, porque afetam oportunidades em andamento. |
| **Kanban, filtros e visão consolidada** | Permitir carteira do vendedor e revisão gerencial por oferta, dono e estágio. | Visão executiva cruza ofertas; cada funil mantém suas condições de passagem. Valor do card precisa separar recorrência, implantação e projeto. |
| **Dono, distribuição e permissões** | Definir quem responde e quem decide a próxima ação. | Atribuição automática pode criar **dono inicial**; vendas complexas precisam de líder da conta, especialista, aprovador de proposta, implantação e CS sem confundir responsabilidade. |
| **Atividades, cadências e alertas de tempo** | Evitar oportunidade esquecida entre reuniões. | Próximo compromisso, responsável, prazo, bloqueio e artefato devem existir em toda fase ativa. Alertas distinguem espera planejada de abandono. Cadência longa é programa de trabalho, não só contatos D0–D30. |
| **Inbox, conversas, ligação, e-mail e agenda** | Manter histórico e contextualizar contato. | Definir canal permitido por público, finalidade e consentimento; registrar também reuniões presenciais, documentos e decisões. WhatsApp e demais canais externos não estão homologados no projeto. |
| **Campanhas, respostas rápidas e templates** | Distribuir material educativo e padronizar partes seguras da resposta. | Conteúdo por oferta e maturidade; aprovação humana para contato direcionado, valores, afirmações eleitorais e condições contratuais. Descadastro e supressão precisam interromper campanhas. |
| **Agente conversacional e base de conhecimento** | Triar dúvidas e agendar passagem ao humano. | Só responder com ofertas e políticas aprovadas, registrar fonte/versão e transferir quando houver decisão sensível. Não prometer módulos futuros ou assumir negociação autônoma. |
| **Aura/assistente do operador** | Ajudar equipe a preparar reuniões, consultar indicadores, resumir histórico e configurar rotina. | Copiloto interno com acesso limitado e confirmação humana. Uma sugestão da IA não é qualificação, mudança de etapa ou mensagem enviada. |
| **Construtor de automações** | Ligar evento, condição, espera e ação: entrada, etapa, reunião, proposta, handoff, renovação. | Fluxos idempotentes, versionados e auditáveis; preferência por tarefas e alertas internos em situações de ciclo longo. Mensagens externas dependem de elegibilidade e revisão. |
| **Integrações, API, webhooks e importação/exportação** | Alimentar CRM com formulários, blog, eventos, agenda, contratos e analytics. | Identidade e deduplicação por conta/pessoa/oportunidade; registrar proveniência; homologar cada fornecedor e não tratar integração local como ativação real. |
| **Checkout e eventos de pagamento** | Útil para eventual oferta individual de compra direta e para eventos financeiros posteriores. | Venda de gabinete, serviço e projeto exige proposta/contrato/aceite. Carrinho abandonado não é estágio natural de Mandato. Diferenciar ganho, faturado e recebido. |
| **Indicadores, metas e dashboards** | Ver fonte, atividades, estágio, conversão e ganho/perda. | Medir coortes e marcos intermediários do ciclo longo; separar receita por tipo e qualidade do pós-venda. Não exigir ganho no mês de criação do lead. |
| **Onboarding, carteira e materiais comerciais** | Preservar promessa e contexto na entrega; apoiar adoção e expansão. | Checklists por oferta, aceite de handoff, resultados de implantação e capacidade de serviço. Depoimentos da Clint demonstram contexto de clientes dela, não resultado esperado da Politizai. |

Essa tabela aplica as funções descritas no [benchmark da Clint](./BENCHMARK_CLINT.md), sobretudo seções 3, 5–10 e 12–13. Ela **não afirma** que a Clint já fornece o modelo de conta institucional, campos ou regras específicas da Politizai sem configuração ou desenvolvimento.

## 4. Modelo de dados comercial proposto

O menor modelo capaz de sustentar a venda consultiva é:

```text
fonte/campanha/parceria
        ↓
conta institucional ── contatos com papéis e vínculos datados
        ↓
lead/consulta ── qualificação e hipótese de oferta
        ↓
oportunidade por decisão de compra ── etapas, participantes, compromissos e evidências
        ↓
proposta/versionamento ── contrato/aceite ── implantação/serviço/projeto
        ↓
adoção/resultado ── renovação, expansão ou encerramento
```

**Conta** representa gabinete, mandato, campanha, partido, órgão ou empresa profissional, conforme o mercado. Deve guardar tipo, território/esfera quando pertinente, momento institucional, responsável interno e relações entre contas, sem pressupor que nomes parecidos sejam a mesma pessoa jurídica. **Contato** representa pessoa e seus vínculos datados com contas: decisor, patrocinador, usuário, influenciador, jurídico/compras ou interlocutor técnico. Dados de papel e poder de decisão devem registrar fonte e data, porque mudam. **Oportunidade** representa **uma decisão comercial**, não cada contato ou mensagem; tem oferta, escopo, responsável, hipótese de valor, data de decisão estimada, próxima ação e razão de ganho/perda/adiamento. Uma mesma conta pode ter oportunidade de OS e outra de serviço, com contratos e receitas separados. [Benchmark, seção 5.1](./BENCHMARK_CLINT.md); [resumo Politizai, seções 3–5](</Users/uscloser/.codex/attachments/6b506a7d-e845-4662-81a5-4a65f2e70a4c/Texto colado.txt>).

**Interação/compromisso** guarda reunião, ligação, e-mail, demonstração, documento, objeção, decisão, próximo responsável e prazo combinado. **Artefato** guarda diagnóstico, mapa de stakeholders, roteiro de demo, estimativa, proposta versionada, análise de segurança/contratação, plano de implantação e aceite. **Contrato/entrega** só nasce de desfecho confirmado e separa licença, implantação, serviço e projeto. **Origem** e **influências posteriores** ficam separadas da oferta. Para cada atributo relevante, manter autor, data, versão e evidência consultável; o CRM não deve transformar hipótese de um agente em fato confirmado por um humano.

### Regras de identidade e qualidade

- Identificar pessoa por dados normalizados e revisar colisões; telefone do gabinete pode ser compartilhado. Não usar similaridade de nome para fundir contatos ou contas automaticamente.
- Preservar histórico quando um assessor muda de gabinete, encerrando o vínculo anterior e criando outro; não mover a oportunidade do mandato antigo junto com a pessoa.
- Uma nova consulta da mesma conta pode atualizar a oportunidade aberta **quando a decisão comercial for a mesma**. Nova compra, período ou escopo material abre oportunidade relacionada.
- Registrar se o contato é comercialmente acionável e por qual canal. Consentimento/opt-out e finalidade prevalecem sobre score e automação.
- Dados recebidos de cliente do Politizai OS para operação do gabinete ficam em domínio/tenant e finalidade distintos do CRM comercial interno.

## 5. Jornada comercial longa, etapa por etapa

O desenho abaixo é **proposta**, não descrição do funil vigente da Politizai. Ele complementa o pipeline técnico atual e deve ser reduzido/ajustado após observar vendas reais. Cada etapa só avança mediante uma evidência e deixa um compromisso. A oportunidade pode ficar **ativa**, **em espera com motivo e data de revisão**, **ganha** ou **perdida**. Espera planejada não é abandono; ausência de próxima ação em oportunidade ativa é falha operacional.

| Etapa proposta | Trabalho que consome tempo | Evidência para avançar | Dono e próxima ação |
|---|---|---|---|
| 1. Seleção de contas e entrada | Pesquisar recorte, fontes, mandato, equipe, contexto; captar indicação, formulário, conteúdo ou contato espontâneo. | Conta e pessoa identificadas, fonte registrada, finalidade comercial clara; oportunidade só se houver decisão potencial concreta. | Marketing/SDR verifica dados e registra motivo do contato. |
| 2. Triagem de adequação | Verificar tipo de gabinete, problema, equipe, momento, interesse e se a oferta de fato existe. | Adequado, nutrição ou descarte com razão; pergunta de qualificação não presume orçamento. | SDR agenda descoberta ou revisão futura. |
| 3. Descoberta com usuários | Entender fluxo de atendimento, comunicação, agenda, documentos, ferramentas, gargalos, volume e critérios de sucesso. | Diagnóstico escrito com problemas priorizados pelo cliente e lacunas ainda abertas. | Vendedor agenda validação com patrocinador e usuários-chave. |
| 4. Mapa de decisão e patrocínio | Identificar quem compra, patrocina implantação, opera, aprova contratos e pode bloquear a adoção. | Papéis confirmados e caminho de decisão conhecido; reunião com comprador ou plano explícito para alcançá-lo. | Líder da conta cria plano de stakeholders e ações específicas. |
| 5. Desenho da solução e demonstração | Preparar cenário do gabinete, delimitar módulos ativos, serviço, responsabilidades e integrações; demonstrar problema concreto. | Caso de uso validado, critérios de sucesso aceitos e objeções registradas. | Especialista/vendedor produz escopo preliminar e próximo marco. |
| 6. Prova, avaliação e viabilidade | Quando fizer sentido, executar piloto ou avaliação com objetivo, participantes, duração e aceite definidos; verificar segurança e contratação. | Resultado documentado, pendências resolvidas ou riscos aceitos; capacidade de entrega checada. | Vendedor e especialista seguem plano, sem piloto indefinido. |
| 7. Proposta e decisão | Discriminar licença, implantação, serviço/projeto, preço, responsabilidades, limites, prazo e forma de aceite; negociar com autoridade adequada. | Proposta versionada recebida por decisor, prazo/rito de decisão combinado; resposta formal de ganho, perda ou adiamento. | Closer revisa no dia pactuado; versões anteriores preservadas. |
| 8. Contrato e handoff | Confirmar assinatura/condições, promessas, requisitos, responsáveis, acessos e agenda de kickoff. | Contrato e aceite confirmados; implantação/serviço assume contexto e plano. | Closer transfere; CS/entrega aceita o handoff. |
| 9. Implantação, adoção e entrega | Configurar, treinar usuários, executar serviço contratado, resolver bloqueios e medir o primeiro resultado. | Marcos de ativação e entrega aceitos; riscos com dono, prazo e plano. | CS/entrega conduz; Comercial acompanha exceções de escopo. |
| 10. Valor, renovação e expansão | Rever resultados, uso, satisfação, capacidade contratada e necessidades novas. | Renovação decidida ou nova oportunidade criada com escopo e decisão próprios. | Farmer/CS registra resultado e próxima revisão. |

Na triagem e qualificação, o CRM local já possui pipeline de pré-vendas `NEW → TRYING_CONTACT → CONNECTED → IN_QUALIFICATION → QUALIFIED → MEETING_SCHEDULED`, com `NURTURING` e `DISQUALIFIED` como saídas. `QUALIFIED` exige PACTO validado por humano, tarefa ativa e confirmação. O pipeline de oportunidades local passa por reunião agendada/realizada, oportunidade confirmada, proposta, negociação e ganho/perda. Essas etapas são **contratos técnicos existentes**; a jornada acima acrescenta trabalho e evidências, sem afirmar que as telas atuais já suportam cada campo, piloto ou comitê de decisão. [Pipelines](./PIPELINES.md); [política de etapas](../src/modules/opportunities/domain/opportunity-stage-policy.ts); [ciclo e ownership](./LIFECYCLE_AND_OWNERSHIP.md).

### Quatro tipos de desfecho que não devem ser confundidos

- **Ganho comercial:** decisão de contratar confirmada, oferta e valor aprovados; não significa que cliente usou ou recebeu tudo.
- **Contrato/aceite:** instrumento, escopo e condições confirmados; não significa pagamento recebido.
- **Ativação/entrega:** software implantado ou serviço/projeto com marcos cumpridos; mede execução.
- **Recebimento financeiro:** valor efetivamente recebido e conciliado; mede caixa. Receita recorrente, implantação e projeto precisam de medidas próprias.

## 6. Cadência longa como programa de trabalho

A cadência de contato existente no projeto é configurável em até 15 passos entre D0 e D90, e a regra predefinida usa D0, D1, D3, D7, D14, D21 e D30 **depois de uma ligação não atendida**. Ela cria tarefas e mensagens **simuladas internas**. Isso resolve tentativas iniciais, mas não representa uma negociação que passa por diagnóstico, aprovação do chefe de gabinete, demonstração, viabilidade, proposta e contratação ao longo de meses. [Automações](./AUTOMATIONS.md); [configuração](../src/modules/settings/application/commercial-settings-service.ts); [scheduler](../src/modules/automations/application/lifecycle-automation-scheduler.ts).

**Proposta:** cada oportunidade tem um *plano de conta* com trilhas paralelas: relacionamento com decisor/patrocinador/usuários; trabalho de solução; requisitos de contratação; e plano de implantação. Cada trilha possui marco, responsável, artefato, data alvo, dependência e estado. A próxima mensagem é consequência de compromisso ou informação útil, não de um contador de dias. Não basta ampliar o limite D90: uma oportunidade pode esperar autorização ou janela orçamentária e continuar exigindo pesquisa, material, alinhamento interno e revisão de risco.

| Episódio | Gatilho de entrada | Ações úteis e verificáveis | Encerramento ou pausa |
|---|---|---|---|
| Sem contato inicial | Conta elegível e canal permitido | Personalizar hipótese de dor, tentar contato conforme política, registrar resposta ou recusa. | Resposta, limite de tentativas, opt-out ou revisão humana; sem insistência indefinida. |
| Descoberta em curso | Reunião aceita | Preparar briefing, ouvir usuários, validar diagnóstico, mapear decisão. | Problema validado ou inadequação registrada. |
| Aguardando trabalho da Politizai | Cliente pede demo, proposta, segurança ou caso | Criar responsável interno e prazo de entrega; revisar qualidade. | Entregável enviado e recebido. Não cobrar cliente enquanto a pendência é nossa. |
| Aguardando ação do cliente | Próximo passo aceito com data | Lembrar o responsável humano na data, fornecer informação combinada, confirmar se prioridade mudou. | Resposta, nova data, recusa ou nutrição justificada. |
| Avaliação/piloto | Critérios e escopo aprovados | Acompanhar uso, incidentes, resultados e decisão de continuidade. | Aceite ou rejeição documentado; piloto sem critério não vira previsão. |
| Contratação | Proposta aceita em princípio | Acompanhar documento, aprovação e responsáveis; separar impeditivos jurídicos, financeiros ou de capacidade. | Contrato/aceite formal ou perda/adiamento. |
| Nutrição institucional | Momento de compra ainda não existe | Registrar motivo e data de revisão; produzir conteúdo pertinente quando autorizado. | Novo sinal e nova qualificação; oportunidade não infla pipeline ativo. |
| Renovação | Contrato e revisão futura conhecidos | Revisar adoção, entregas, satisfação, escopo e decisão. | Renovação, mudança contratual, expansão ou encerramento. |

**Regras da cadência proposta:** (1) toda oportunidade ativa tem próxima ação real, dono e data; (2) uma espera planejada tem motivo, responsável por reabrir e data de revisão; (3) resposta do cliente, opt-out, perda ou ganho cancela ações incompatíveis; (4) mudança de interlocutor reabre mapa de decisão, não zera o histórico; (5) fase parada aciona revisão interna com contexto; (6) envio externo usa canal autorizado e conteúdo aprovado; (7) o gestor revisa qualidade do plano, não só contagem de tarefas. Qualquer prazo numérico futuro deve ser calibrado por evidência de coortes, oferta e segmento; o resumo da Politizai não traz tempos atuais.

### Exemplo ilustrativo de uma oportunidade Mandato

Este cenário mostra sequência de trabalho, **não cronograma ou resultado já observado**. Uma indicação de gabinete chega; SDR registra fonte, identifica chefe de gabinete e descobre que demandas e aprovações estão espalhadas. Após duas conversas com assessores, o vendedor escreve diagnóstico e valida com o chefe. O político pede visão do impacto e das responsabilidades da equipe. O especialista monta demonstração apenas com funções disponíveis e levanta requisitos de segurança e implantação. A equipe apresenta escopo de licença e eventual serviço separadamente; a primeira versão de proposta gera objeções de capacidade e orçamento. O vendedor revisa o plano, registra a data de nova decisão e mantém oportunidade em espera justificada durante a análise do gabinete. Com aceite e contrato, o handoff carrega diagnóstico, usuários, promessas e limites. A primeira revisão de CS mede se os fluxos acordados entraram na rotina; eventual novo módulo ou serviço abre oportunidade de expansão, não altera retroativamente o ganho original.

## 7. Agentes e subagentes para a Politizai

Na Clint, a pesquisa pública diferencia o agente que conversa em um fluxo da assistente do usuário da plataforma (Aura), além de base de conhecimento, automações e passagem para atendente. Isso inspira a arquitetura abaixo, mas **não comprova** que a Clint tenha esses especialistas prontos ou que o CRM local já execute agentes autônomos. [Benchmark, seção 7](./BENCHMARK_CLINT.md); [governança de IA local](./AI_GOVERNANCE.md).

**Proposta de orquestração:** um agente interno recebe pedido do vendedor e estado da oportunidade, consulta apenas fontes permitidas, divide trabalho entre subagentes especializados, agrega rascunhos com evidência e encaminha para aprovação humana. Cada subagente tem tarefa delimitada, saída estruturada e acesso mínimo. O vendedor/gestor conserva decisão sobre qualificação, compromisso externo, preço, proposta, mudança de etapa e envio. A IA local atual usa `MockAIProvider`, portanto a tabela é **desenho futuro**, não funcionalidade já ativa com modelo/provedor real. [Governança](./AI_GOVERNANCE.md).

| Agente ou subagente proposto | Disparo e entrada mínima | Saída útil | Limite e revisão humana |
|---|---|---|---|
| **Orquestrador comercial interno** | Solicitação do dono, oportunidade, papéis e documentos autorizados. | Plano de trabalho com pendências, agentes acionados, fontes e incertezas. | Não muda estado nem envia mensagens; dono aprova. |
| **Pesquisa de conta** | Conta e finalidade comercial. | Ficha institucional, contexto e perguntas a confirmar, com fonte/data. | Informação pública é hipótese até validação; nada de enriquecer dados pessoais sem base apropriada. |
| **Higiene de dados e identidade** | Novo lead/importação/alteração de vínculo. | Possíveis duplicidades, conflito de papéis, campos sem fonte. | Sugere; humano resolve fusões e vínculos. |
| **Triagem e adequação** | Primeira conversa ou formulário permitido. | Público, dor, oferta plausível, urgência, lacunas e rota de handoff. | Não declara ICP validado nem vende oferta futura. Qualificação PACTO permanece humana. |
| **Preparação de reunião** | Reunião agendada, histórico e objetivo. | Briefing, mapa de interlocutores e perguntas de descoberta. | Não usa dados de cidadãos do OS; vendedor revisa. |
| **Síntese de descoberta** | Notas/transcrição autorizada. | Diagnóstico com fatos, hipóteses, citações e pendências. | Humano confirma antes de registrar como evidência de etapa. |
| **Desenho de solução/demo** | Diagnóstico e catálogo versionado de funções ativas. | Roteiro de demonstração e matriz dor → capacidade → lacuna. | Produto valida disponibilidade e limites. |
| **Risco, contratação e compliance** | Escopo, canais, tratamento de dados e minuta. | Checklist de dúvidas de segurança, elegibilidade, procurement e privacidade. | Encaminha a especialista; não emite parecer legal nem aprova contrato. |
| **Redação de proposta** | Escopo aprovado, catálogo/preço vigente e capacidade. | Rascunho versionado com itens separados, premissas e exclusões. | Comercial e responsáveis aprovam valores, prazo e promessas. |
| **Acompanhamento contextual** | Compromisso vencendo, resposta nova, silêncio ou objeção. | Sugestão de próxima ação e rascunho personalizado. | Nenhum disparo automático externo; dono verifica canal, consentimento e contexto. |
| **Qualidade de conversa** | Interações e critérios de processo. | Fatos ausentes, compromissos não cumpridos, objeções recorrentes. | Apoia coaching; não altera score/pessoa/etapa sozinho. |
| **Handoff e implantação** | Ganho + proposta e contrato aprovados. | Checklist de promessas, acessos, configuração, marcos e riscos. | CS/entrega aceita e corrige lacunas antes de iniciar. |
| **Saúde, renovação e expansão** | Uso, entregas, incidentes e calendário contratual. | Resumo de valor, riscos e hipótese de necessidade nova. | CS/Farmer valida; expansão exige nova decisão comercial. |
| **Analista RevOps** | Dados agregados por oferta/coorte. | Gargalos, qualidade de dados, experimentos e limites amostrais. | Não inventa causalidade a partir de correlação; gestor decide mudança de processo. |

### Como criar e governar cada agente proposto

1. **Definir propósito e fronteira:** usuário humano, gatilho, tarefa única, canais/dados acessíveis, ações proibidas e critério de passagem.
2. **Preparar conhecimento versionado:** catálogo de ofertas ativas, escopo demonstrável, FAQ, políticas comerciais aprovadas, limites de serviço, roteiros e critérios de qualificação. Marcar ideia/futuro/a validar para que não sejam apresentados como disponíveis.
3. **Especificar contrato de saída:** campos, fonte, confiança, lacuna, responsável pela aprovação e referência à oportunidade. Preferir saída estruturada para diagnóstico, proposta e handoff.
4. **Configurar ferramentas mínimas:** leitura contextual do CRM e base aprovada; escrita só em rascunho ou fila de aprovação. Dados de clientes do OS fora do escopo do CRM comercial.
5. **Testar cenários:** gabinete elegível, contato com papel incerto, oferta futura solicitada, opt-out, duas contas com telefone comum, objeção sensível, dado ausente, handoff incompleto. Falhas bloqueiam publicação.
6. **Publicar com versão e observabilidade:** registrar base/prompt/fluxo, fontes consultadas, saídas, correções humanas e motivo de transferência. Um novo release não altera silenciosamente conclusões antigas.
7. **Medir e revisar:** taxa de correção, tempo economizado, falsas afirmações, handoffs, problemas por oferta e incidentes. Suspender a especialidade se a qualidade ficar abaixo do critério definido pela equipe.

**Agente externo de conversa:** se um dia for adotado, limitar a perguntas iniciais e agenda com informação aprovada. Ele deve identificar quando o tema exige humano, evitar promessas de resultado político/eleitoral, não receber lista de cidadãos do gabinete e respeitar o estado de contato permitido. A elegibilidade de canais, sobretudo WhatsApp para entidades políticas, é uma decisão prévia ainda não resolvida no projeto. [Validações externas](./EXTERNAL_VALIDATIONS.md).

## 8. Automações propostas, com evento, condição e efeito

O motor local já implementa 12 regras determinísticas, persistência, execução idempotente, histórico e mensagens internas simuladas. Ele não é prova de automação externa ativa. O CRM deve manter o serviço de domínio como autoridade: fluxo reage a evento validado e revalida estado antes de produzir efeito. [Automações](./AUTOMATIONS.md).

| Evento | Condição necessária | Efeito recomendado | Cancelamento/controle |
|---|---|---|---|
| Lead recebido | Identidade e finalidade comercial aceitáveis. | Deduplicar, atribuir dono, iniciar SLA, criar tarefa de triagem e registrar fonte. | Opt-out e bloqueios de contato suprimem ação externa. |
| Conta adequada, sem comprador conhecido | Oferta ativa e diagnóstico iniciado. | Abrir checklist de papéis, marcar lacuna e tarefa de mapear decisão. | Fechar ao confirmar comprador ou descartar oportunidade. |
| Reunião marcada/remarcada | Agenda confirmada e participantes corretos. | Briefing e lembretes internos; convite externo só por canal homologado. | Remarcação invalida lembretes antigos. |
| Descoberta concluída | Notas e confirmação humana. | Pedir diagnóstico, critérios de sucesso, stakeholders e próxima reunião. | Não avançar etapa automaticamente por resumo de IA. |
| Pedido de demo/piloto | Escopo e responsável aceitos. | Gerar checklist de preparo, critérios de aceite e capacidade de entrega. | Encerrar piloto por decisão documentada; alertar se faltar marco. |
| Proposta pronta | Catálogo, preço, risco e escopo revisados. | Solicitar aprovação e registrar versão/validade. | Envio só após aprovação do responsável. |
| Proposta entregue | Recebimento e data de decisão combinados. | Criar tarefa para data pactuada e material de objeções. | Nova resposta, alteração ou perda substitui tarefas anteriores. |
| Etapa sem próxima ação | Oportunidade ativa, sem espera planejada. | Alertar dono e gestor; exigir correção. | Não inventar data ou mandar mensagem ao cliente. |
| Espera planejada perto da revisão | Motivo, data e dono registrados. | Pedir revisão do contexto e requalificação. | Se decisão adiou de novo, registrar nova razão e data. |
| Silêncio após interação | Política de contato e canal permitidos; contexto recente. | Sugerir texto útil ou decisão de pausa ao vendedor. | Resposta, opt-out, perda e limite de tentativas cancelam. |
| Ganho confirmado | Oferta, valor, contrato/aceite e dono validados. | Encerrar cadência incompatível; preparar handoff e kickoff. | Evitar dupla criação por chave idempotente. |
| Marco de implantação/serviço atrasado | Entregável devido e cliente ativo. | Alertar CS/entrega, registrar bloqueio e plano; comercial recebe risco. | Resolver por aceite real, não por fechamento de tarefa vazio. |
| Renovação se aproxima | Contrato vigente, data e dono. | Pedir revisão de resultados, adoção, capacidade e proposta de continuidade. | Cancelar se contrato encerrado ou data alterada. |
| Perda | Motivo confirmado. | Fechar tarefas de venda; avaliar aprendizado e eventual nutrição permitida. | Não criar campanha automaticamente para quem recusou contato. |

Automações de **conteúdo em escala** e de **atendimento individual** devem ter filas, consentimento e métricas próprios. Um blog pode gerar inbound e educação; a sequência de decisão de um gabinete depende de perguntas, entregáveis e autorização humana. O projeto registra que WhatsApp, e-mail, telefonia e calendário têm somente implementação/validação local ou simulada; a ativação com terceiros exige homologação separada. O registro de WhatsApp aponta decisão formal de elegibilidade **antes** da homologação. [Validações externas](./EXTERNAL_VALIDATIONS.md); [inbox local](./OMNICHANNEL_INBOX.md).

## 9. Métricas para ciclo longo e quatro modelos de oferta

Um painel só de cards ganhos no mês esconderia o trabalho e atribuiria receita às coortes erradas. Registrar datas de **entrada, primeira resposta, descoberta, diagnóstico, primeira proposta, decisão, contrato, ativação e recebimento**. Filtrar por oferta, ICP, origem, coorte, dono e estágio; mostrar denominador e tamanho da amostra. As funções de indicadores da Clint motivam essa leitura, mas os indicadores abaixo são **proposta para a Politizai**. [Benchmark, seção 10](./BENCHMARK_CLINT.md); [métricas locais](./REVENUE_METRICS.md).

| Pergunta de gestão | Indicadores propostos | Interpretação cuidadosa |
|---|---|---|
| Chegamos às contas certas? | Contas no recorte, origem, taxa de identificação de papel, adequação por oferta. | ICP ainda é hipótese; comparar subsegmentos sem proclamar vencedor com amostra pequena. |
| Estamos conduzindo a decisão? | Descobertas concluídas, diagnósticos aceitos, cobertura de comprador/patrocinador/usuários, oportunidades com próxima ação e artefato. | Contagem de mensagens não substitui avanço real. |
| Onde a venda trava? | Idade por etapa, espera planejada versus atraso, motivo de adiamento, proposta sem decisor, taxa de piloto com decisão. | Separar tempo de trabalho interno de tempo de espera do cliente. |
| Qual oferta converte? | Conversão por linha, coorte de entrada e estágio; ganho/perda e motivo. | Não comparar assinatura, serviço e projeto como se fossem o mesmo ticket ou ciclo. |
| Quanto foi contratado e entregue? | Valor contratado por tipo, implantação concluída, marcos de serviço/projeto aceitos, faturado e recebido. | Ganho comercial e caixa não são sinônimos. |
| O cliente percebe valor? | Tempo até primeira rotina ativa, usuários operantes, problemas resolvidos no escopo, entregáveis aprovados, risco de renovação. | Uso do software e qualidade do serviço têm evidências distintas. |
| A operação está sustentável? | Capacidade vendida versus disponível, retrabalho de proposta, handoff incompleto, correções de IA, tarefas vencidas. | Crescer conversão sem capacidade de entrega pode prejudicar retenção. |

**Forecast proposto:** classificar oportunidade por evidência de comprador, problema, critério de decisão, escopo, processo de contratação e próxima data; manter faixa de valor e data provável explicitamente incertas. Não usar percentual fixo por etapa como única previsão, nem contar receita de ideias/ofertas futuras. A renovação deve ter forecast próprio, ligado a contrato e uso, e expansão deve ser oportunidade separada.

## 10. Playbooks por oferta e mercado

| Playbook | O que descobrir antes de propor | Demonstração/entregável de pré-venda | Gate de ganho e pós-venda |
|---|---|---|---|
| **Mandato com Politizai OS** (primeira linha proposta) | Rotinas do gabinete, usuários, dor, patrocinador, orçamento, prontidão de implantação, capacidade real do produto. | Diagnóstico do fluxo e demonstração dos módulos disponíveis ligados a caso de uso. | Licença/escopo e implantação aceitos; CS verifica adoção por equipe. |
| **OS + serviço** (tipo de oferta) | Que trabalho ficará com o gabinete e que trabalho a Politizai executará. | Matriz de responsabilidades, frequência, aprovações, limite de volume e capacidade. | Contrato separa software, implantação e serviço; CS mede ambas as entregas. |
| **Presença Pública Operada** (candidata) | Fontes de pauta, processo de aprovação, frequência, responsável do cliente, risco de retrabalho. | Exemplo de calendário/fluxo e escopo operacional revisados. | Acordo sobre entregáveis e aceite; medir prazo e qualidade, não só quantidade de peças. |
| **Lab / projeto especializado** | Problema, dependências, acesso, critério de aceite, esforço, manutenção posterior. | Descoberta técnica e proposta de marcos. | Aceite de escopo e capacidade; projeto acompanha marcos e mudanças. |
| **Campanha, SMS e Tracking** (a revisar) | Produto ativo, período eleitoral, autorização, dados/canais, volume, resultado pretendido e limites. | Somente material específico aprovado depois de confirmar status da oferta. | Contrato, medição e controles próprios; não herdar script de Mandato. |
| **Governo** (futuro) | Público institucional, processo de contratação, requisitos técnicos, dados e responsáveis. | Pesquisa e validação de oferta antes de criar funil de venda como se já existisse. | Gate comercial e de contratação a definir; sem copiar caminho de gabinete. |
| **IA individual** (ideia) | Público, tarefa concreta, disposição de uso/pagamento e separação de dados. | Entrevistas/protótipo quando autorizado, não proposta de produto inexistente. | Só abrir playbook de venda depois de oferta validada. |

## 11. O que já existe no repositório e o que falta

O repositório possui um Revenue OS amplo, com implementação **local** de entrada de leads, identidade, score, distribuição, PACTO, pipelines, contratos, handoff, CS, Farmer, métricas, inbox e automações. O estado consolidado permanece **produção NO-GO**; não há prova de operação da Politizai com dados reais nem provedores externos homologados. [Estado de execução](./EXECUTION_STATUS.md); [Go/No-Go](./PROD13_FINAL_GO_NO_GO.md).

| Bloco | Evidência local | Trabalho para a proposta deste estudo |
|---|---|---|
| Entrada e qualificação | [Canais de entrada](./LEAD_ENTRY_CHANNELS.md), [pipelines](./PIPELINES.md) e [ownership](./LIFECYCLE_AND_OWNERSHIP.md). | Validar ICP/roteiro real, modelar papéis de conta e fontes por oportunidade. |
| Oportunidades | [Política de etapas](../src/modules/opportunities/domain/opportunity-stage-policy.ts). | Adicionar plano de conta, evidências por gate, trilhas paralelas, espera justificada e artefatos; verificar encaixe nas telas existentes. |
| Cadência e regras | [Motor local](./AUTOMATIONS.md) e configuração D0–D90. | Modelar episódios de ciclo longo, condições por oferta/compromisso, cancelamento e escalonamento interno. |
| IA | [Governança e provedor mock](./AI_GOVERNANCE.md). | Definir catálogo versionado, contratos de agentes, avaliações, acesso mínimo e aprovações; escolher/homologar provedor apenas depois. |
| Comunicação | [Inbox](./OMNICHANNEL_INBOX.md) e [validações externas](./EXTERNAL_VALIDATIONS.md). | Decidir canal elegível, finalidade e política de contato; homologar terceiros separadamente antes de egress. |
| Fechamento e entrega | [Contratos](./COMMERCIAL_CONTRACTS.md), [handoff](./HANDOFF_AND_ONBOARDING.md), [CS](./CUSTOMER_SUCCESS.md), [Farmer](./FARMER.md). | Especializar checklists por licença, serviço e projeto; conciliar promessa, capacidade e resultado. |
| Gestão | [Métricas](./REVENUE_METRICS.md) e [status](./EXECUTION_STATUS.md). | Relatórios por coorte/ICP/oferta, comprometimento de stakeholders, espera planejada e receita por tipo. |

### Ordem de implantação recomendada

1. **P0 — validar a venda antes de automatizar:** escolher primeiro recorte de Mandato, entrevistar compradores/patrocinadores/usuários, definir oferta ativa e capacidade, registrar estágio atual de vendas e critérios de passagem. Configurar manualmente os campos e tarefas indispensáveis; testar o fluxo em oportunidades reais apenas quando ambiente, dados e autorização operacional estiverem prontos.
2. **P1 — organizar ciclo longo:** criar plano de conta, papéis, diagnóstico, proposta versionada, próxima ação e espera justificada; ajustar funis por tipo de oferta e painéis de qualidade. Provar que vendedores e entrega conseguem completar handoff sem perder promessa.
3. **P2 — automação interna e IA assistiva:** usar gatilhos de tarefas/alertas e subagentes de briefing, síntese e proposta em rascunho, com avaliação e aprovação. Começar pelos pontos onde há retrabalho medido.
4. **P3 — canais e escala:** só após decisão de elegibilidade, homologação de provedores, base de contato e controles de opt-out, ativar comunicação externa apropriada; expandir playbooks para ofertas validadas e, depois, novos mercados.

**Critério para passar de uma fase à seguinte:** evidência de uso, qualidade de dados, capacidade de entrega e resultado por coorte. Mais automações ou agentes não compensam oferta incerta, decisão não mapeada ou ausência de responsável.

## 12. Decisões abertas para pesquisa e validação

1. Qual recorte de gabinete será o primeiro experimento de Mandato, e quais critérios observáveis confirmam ou rejeitam o ICP?
2. Quais módulos do OS estão realmente demonstráveis e contratáveis hoje? Qual pacote mínimo e qual capacidade de implantação existe?
3. Quem hoje faz marketing, SDR, closer, especialista, implantação, CS e Farmer? Uma pessoa pode acumular papéis, mas a transição de responsabilidade precisa ser explícita.
4. Qual é o funil praticado, quais artefatos já são produzidos, quanto tempo cada espera leva e por que negócios perdem ou adiam?
5. Como distinguir comercialmente licença, implantação, serviço recorrente e projeto no contrato, forecast e relatório financeiro?
6. Quais dados institucionais/pessoais podem entrar no CRM interno e quais devem permanecer no tenant do cliente no OS?
7. Quais canais de contato são permitidos por público e finalidade? O projeto já sinaliza uma decisão formal pendente sobre elegibilidade de WhatsApp para entidades/serviços políticos. [Validações externas](./EXTERNAL_VALIDATIONS.md).
8. Qual o status real de Campanha, SMS eleitoral e Tracking, e quais materiais têm aprovação para venda? Como será definido o processo próprio de Governo?
9. Qual é a taxa de conversão por coorte, oferta, interlocutor e origem após as primeiras oportunidades documentadas? Esses números determinarão prazos e metas, não o contrário.

## 13. Síntese operacional

O mecanismo da Clint mais útil para a Politizai é **unir aquisição, histórico, dono, etapa, próxima ação, automação, IA e indicadores**. A tradução para a realidade da empresa exige uma camada adicional de **conta institucional, vários participantes, trabalho de diagnóstico/solução, compromisso por marco e execução pós-venda por tipo de oferta**. A cadência longa precisa dizer **o que a equipe deve produzir e quem decide o próximo passo**, além de quando voltar a falar. Agentes e subagentes aceleram preparação e consistência se trabalharem com conhecimento aprovado, fontes rastreáveis e aprovação humana nas decisões sensíveis.

Este documento propõe o modelo; a validação do ICP, do portfólio, do processo praticado e dos canais externos é o passo necessário para convertê-lo em configuração e implementação concreta.
