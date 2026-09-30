# Roadmap de paridade funcional Clint para o CRM comercial da Politizai

**Uso:** plano de implementação e aceite, organizado em 19 etapas com tasks e subtasks. **Base auditada em 29/09/2026:** [estudo da Clint](./BENCHMARK_CLINT.md), [aplicação à Politizai](./CLINT_APLICADA_A_POLITIZAI.md), documentação e amostra do código deste repositório, além das fontes oficiais da Clint citadas ao final. Os dois estudos originais permanecem íntegros.

## 1. Objetivo, definição de pronto e limite da auditoria

O objetivo é fazer o **CRM comercial interno da Politizai** cobrir o conjunto de comportamentos públicos documentados da Clint — CRM, funis, atendimento, campanhas, automações, agentes, assistente, integrações, checkout, dashboards e operação — e adaptá-los à venda consultiva e ao pós-venda da Politizai. O CRM acompanha contas, contatos, ofertas, oportunidades, contratos, implantação, serviços e renovação. **Relacionamento do Mandato** e **Atendimento Resolvido** são módulos do Politizai OS para o cliente final; dados de cidadãos do gabinete não viram leads comerciais da Politizai. [Aplicação à Politizai, seções 1–2](./CLINT_APLICADA_A_POLITIZAI.md).

**“100% igual e funcional” neste plano significa paridade funcional demonstrada**, não cópia de interface, marca ou arquitetura proprietária. Para cada uma das 15 capacidades da seção 2, o aceite exige: comportamento executável na interface e API quando cabível; fluxo ponta a ponta com dados de teste; RBAC, privacidade, isolamento de workspace, histórico, reversão e idempotência; comparação com tutorial/fonte oficial; evidência de teste e responsável pelo aceite. Função apenas desenhada, mockada ou bloqueada por provedor **não conta como paridade operacional**. Recursos comerciais da Clint sem tutorial público detalhado só podem receber aceite de paridade após teste em conta de avaliação e registro de limites. Se um canal for legalmente indisponível, o produto pode oferecer alternativa útil, mas **não poderá declarar 100% de paridade com aquele canal**.

**Limite honesto da auditoria atual:** houve leitura documental e inspeção dirigida de código, mas não acesso a uma conta autenticada da Clint, nem testes atuais de produção da Politizai ou homologação de provedores. Portanto, este documento é um roadmap auditável e pronto para execução; **o CRM ainda não tem 100% de paridade**. WhatsApp para entidade/serviço ligado à política permanece sujeito à decisão formal de elegibilidade indicada no próprio projeto; se a resposta for negativa, o aceite desse canal precisa registrar impossibilidade e canal alternativo autorizado, sem simular paridade. [WhatsApp local](./WHATSAPP_CLOUD_API.md); [Go/No-Go](./PROD13_FINAL_GO_NO_GO.md).

**Status usados:** **Local** = código executável em ambiente local, sem provar produção; **Parcial** = parte do comportamento existe; **Ausente** = não há implementação equivalente encontrada na amostra auditada; **Externo pendente** = adaptador/contrato local existe, mas não foi homologado com provedor real; **A validar Clint** = promessa comercial ou detalhe sem prova pública completa. O [estado consolidado do projeto](./EXECUTION_STATUS.md) declara produção **NO-GO**.

### Regra de execução

Cada etapa pode virar uma issue/épico. Dentro dela, `Txx.y` é a task e os itens recuados são subtasks executáveis. **Aceite** é a condição mínima de fechamento; não substitui testes específicos. A ordem mostra dependências, mas frentes independentes podem andar em paralelo. Não criar novo banco/motor/CRM quando o serviço atual já é a fonte de verdade. Alterações em produção, dados reais, canais externos, credenciais, migrations e deploy passam pelos gates do projeto e por autorização de escopo quando necessários.

## 2. Matriz de paridade e lacunas auditadas

| ID | Capacidade Clint e aplicação Politizai | Hoje no CRM | Etapas que fecham a lacuna | Prova mínima de paridade |
|---|---|---|---|---|
| C01 | **Contato, empresa, negócio, campos/tags, CSV e exportação.** Pessoa pode participar de várias vendas; Politizai precisa de conta institucional e vínculos datados. [Clint 3, 5.1, 5.4](./BENCHMARK_CLINT.md) | **Parcial/Local:** `Contact`, `Account`, papéis e qualidade de identidade; importação CSV de leads e redistribuição em massa, mas exportação/edição em massa equivalente não foi comprovada. [Schema](../prisma/schema.prisma), [entrada](./LEAD_ENTRY_CHANNELS.md) | 02–03 | Um contato em duas contas e duas oportunidades; CSV import/export consistente; conflito revisado sem fusão indevida. |
| C02 | **Origens, agrupadores e modelos reutilizáveis de etapas/atividades.** Origem informa aquisição; oferta informa o que se vende. [Clint 4.1, 5.2](./BENCHMARK_CLINT.md) | **Parcial:** `Pipeline` e `PipelineStage` existem; editor de agrupadores e central de modelos com propagação/isolamento não foram comprovados. [Schema](../prisma/schema.prisma), [pipelines](./PIPELINES.md) | 02, 04 | Criar/reutilizar modelo, editar global ou localmente e migrar cards com mapa de etapas e prévia. |
| C03 | **Pipeline Kanban, filtros, dono, status, valor, ganho/perda, ações em massa, distribuição e visibilidade.** [Clint 4.3, 5.2–5.4](./BENCHMARK_CLINT.md) | **Local/Parcial:** dois pipelines, regras de transição, owner, lista/Kanban, redistribuição de leads; superfície e ações em massa completas da Clint ainda precisam de comparação. [Pipelines](./PIPELINES.md), [oportunidades](../src/modules/opportunities/domain/opportunity-stage-policy.ts) | 04–05 | Criar, mover, filtrar, redistribuir e fechar com motivo; escopo de acesso e histórico corretos. |
| C04 | **Atividades, cadências, scripts, prazos relativos e alerta de estagnação.** Na Politizai, também plano de conta e espera pactuada. [Clint 5.3](./BENCHMARK_CLINT.md) | **Parcial:** tarefas/SLA e cadência de ligação não atendida D0–D30; configuração aceita até 15 passos D0–D90. Não modela sozinha ciclo consultivo de meses. [Automações](./AUTOMATIONS.md) | 05–06 | Toda oportunidade ativa tem próximo compromisso; reentrada recalcula tarefa quando previsto; espera planejada não vira atraso falso. |
| C05 | **Inbox WhatsApp/Instagram com busca, estados, setor, transferência, respostas rápidas e negócio ao lado.** [Clint 6.1](./BENCHMARK_CLINT.md) | **Local/Externo pendente:** conversa e mensagem canônicas, filas e templates locais; WhatsApp simulado, Instagram futuro. [Inbox](./OMNICHANNEL_INBOX.md) | 07–09 | Conversa recebida → identidade → negócio → atendimento → handoff, sem perda de histórico ou resposta dupla. |
| C06 | **Campanhas WhatsApp Oficial, SMS/Flash/voz, segmentos/CSV, agendamento, templates e ações após envio.** [Clint 6.2](./BENCHMARK_CLINT.md) | **Ausente como disparo:** há campanhas de *mídia/aquisição*, não orquestrador de envio comercial em lote; SMS/Instagram externos futuros. [Marketing](./MARKETING_ATTRIBUTION.md), [inbox](./OMNICHANNEL_INBOX.md) | 10 | Prévia de público e custo, aprovação, supressão/opt-out, envio no canal autorizado e métricas reconciliadas. |
| C07 | **VoIP, gravação, Meet/transcrição, e-mail/agenda Google/Microsoft, app móvel e carteira/consumo.** [Clint 6.3–6.4](./BENCHMARK_CLINT.md) | **Parcial/Externo pendente:** e-mail, telefonia e calendário locais/simulados; não foi encontrado app móvel ou transcrição integrada equivalente. [Validações](./EXTERNAL_VALIDATIONS.md) | 09, 17 | Ligação/reunião/e-mail ligados ao card, transcrição consentida e controlada; funções essenciais utilizáveis em tela móvel. |
| C08 | **Construtor de agente com instruções e base de conhecimento versionada.** [Clint 7.1–7.3](./BENCHMARK_CLINT.md) | **Parcial:** governança de casos de uso e `MockAIProvider`; não há criação de agente conversacional com base própria. [IA](./AI_GOVERNANCE.md) | 12 | Criar, avaliar, publicar, pausar e reverter agente/base; recusar oferta não ativa e resposta sem fonte. |
| C09 | **Conversação de IA em fluxo, coleta de campos, transições, sem resposta, pausa e handoff humano.** [Clint 7.4–7.5](./BENCHMARK_CLINT.md) | **Ausente como conversa autônoma;** sugestões internas locais não enviam nem mudam etapa. [IA](./AI_GOVERNANCE.md) | 11–12 | Agente qualifica em sandbox; humano assume; nenhuma mensagem concorrente; dados coletados exigem validação. |
| C10 | **Aura/copiloto por texto/voz para análise e criação assistida de agente, funil, automação e gráfico.** Detalhes de criação ampla são promessa comercial a validar. [Clint 7.1, 10](./BENCHMARK_CLINT.md) | **Parcial:** copiloto gerencial de perguntas predefinidas e IA mock; sem criação por linguagem natural/voz. [Tela](../src/app/copilot/page.tsx), [IA](./AI_GOVERNANCE.md) | 13 | Pergunta responde com dados/fonte; geração oferece prévia, aprovação, publicação auditada e reversão. |
| C11 | **Construtor visual de automação com gatilhos, E/OU, atrasos, ações, versões, insights.** [Clint 8](./BENCHMARK_CLINT.md) | **Parcial:** motor robusto e 12 regras predefinidas, mas UI explicita ausência de editor visual e ações externas. [Motor](./AUTOMATIONS.md), [tela](../src/app/automacoes/automations-workspace.tsx) | 11 | Usuário monta/publica fluxo sem código; versão em execução não muda; replay não duplica efeito; insights por nó. |
| C12 | **Entrada manual/CSV/formulário/anúncio, webhooks, API e n8n/Make/Zapier.** [Clint 4.2, 9](./BENCHMARK_CLINT.md) | **Parcial/Externo pendente:** intake unificado e plataforma de integrações locais, Meta/Google Ads somente fixtures; n8n sandbox. [Integrações](./INTEGRATIONS.md), [n8n](./N8N_SANDBOX.md) | 03, 14 | Reenvio, ordem invertida, mapeamento e duplicata produzem um efeito correto; conectores homologados no ambiente permitido. |
| C13 | **Eventos de checkout/pagamento/assinatura: abandono, pendência, recusa, aprovação, reembolso, atraso/cancelamento.** [Clint 4.2, 9.1](./BENCHMARK_CLINT.md) | **Parcial:** contratos, assinatura, fatura e sandbox de pagamentos; não há checkout externo transacional com todas as origens de evento da Clint. [Pagamentos](./PAYMENTS_SANDBOX.md), [contratos](./COMMERCIAL_CONTRACTS.md) | 15 | Evento financeiro cria trilha correta, concilia e não duplica; venda consultiva não vira carrinho artificial. |
| C14 | **Dashboards prontos/customizáveis, gráficos, exportação, metas e projeções.** [Clint 10](./BENCHMARK_CLINT.md) | **Parcial:** dashboard, métricas canônicas, metas e forecast existem; construtor livre de gráficos/dashboards e exportação equivalente não foram comprovados. [Métricas](./REVENUE_METRICS.md) | 16 | Usuário monta gráfico com métrica, período, dimensão, filtro e tipo; CSV bate com drilldown autorizado. |
| C15 | **UTM, feedback de conversão à mídia, permissões e consumo.** Meta CAPI documentado; Google anunciado sem tutorial equivalente. [Clint 9–10](./BENCHMARK_CLINT.md) | **Parcial/Externo pendente:** touchpoints/atribuição e Meta/Google read-only local; feedback externo, custo por canal e governança de consumo precisam homologação. [Atribuição](./MARKETING_ATTRIBUTION.md), [validações](./EXTERNAL_VALIDATIONS.md) | 14, 17–19 | Origem/custo/receita reconciliados; sinal enviado só quando permitido; limite de gasto e permissões testados. |

**Resultado da auditoria dirigida:** a base de dados, serviços de domínio e telas já são extensos; o maior esforço de paridade está nas **superfícies configuráveis pelo usuário**, **canais/provedores reais**, **agentes conversacionais**, **campanhas de envio**, **checkout externo**, **criação assistida** e **aceite produtivo**. A ausência indicada significa “não encontrada na documentação/código amostrado”, não prova matemática de inexistência. Antes de implementar cada lacuna, confirmar por busca dirigida no código e preservar contratos já existentes.

## 3. Estratégia de substituição e arquitetura

| Hoje | Decisão | Estado alvo |
|---|---|---|
| `Contact`, `Account`, `Lead`, `Opportunity`, contratos, receita e auditoria | **Preservar e estender** | Acrescentar campos/papéis/artefatos por migrations aditivas e APIs de domínio; manter IDs, histórico e isolamento. |
| Pipelines fixos e política de etapas | **Estender** | Templates reutilizáveis, origem/agrupador, ações por etapa e plano de conta; transição segue serviço e gates humanos. |
| Motor de 12 automações com worker PostgreSQL | **Preservar motor; substituir superfície estática** | Editor visual gera grafo validado/versão imutável executada pelo motor; nada de execução arbitrária ou SQL. |
| Inbox e templates locais | **Preservar fonte canônica; trocar adaptadores simulados quando homologados** | Canais autorizados com recebimento/envio/status reais, mesma timeline e supressão central. |
| `MockAIProvider` e governança de casos de uso | **Preservar controles; acrescentar agente/base/runtime** | Provider aprovado por caso, avaliações, limite de gasto, rascunho e handoff; mock continua em testes. |
| Dashboard e métricas canônicas | **Preservar fórmulas; acrescentar construtor** | Gráficos salvos consultam catálogo tipado e drilldowns; nenhum cálculo divergente no frontend. |
| Contratos/assinaturas/faturas e sandbox | **Preservar verdade comercial; acrescentar checkout externo quando aplicável** | Eventos externos reconciliados; ganho, contratado, faturado e recebido continuam distintos. |
| Integrações locais e n8n sandbox | **Preservar inbox/outbox; homologar conectores e ampliar API** | Mapeamento, assinatura, idempotência, sync e rollback por provedor. |

**Sequência de valor Politizai:** aquisição → conta e contato → lead → qualificação humana → oportunidade por decisão de compra → diagnóstico e mapa de stakeholders → demonstração/piloto → proposta versionada → contrato → implantação/serviço → CS → renovação/expansão. O funil de contato inicial D0–D30 e o plano consultivo de meses são mecanismos separados. Software, software+serviço, serviço recorrente e projeto têm preço, marcos e pós-venda distintos. [Aplicação à Politizai, seções 2, 5–10](./CLINT_APLICADA_A_POLITIZAI.md).

## 4. Roadmap de execução — 19 etapas

### Etapa 01 — Contrato de paridade e linha de base

- [ ] **T01.1 — Fechar o inventário de 15 capacidades.**
  - [ ] Comparar cada item C01–C15 com a versão atual dos tutoriais oficiais e registrar URL, data, comportamento e divergência.
  - [ ] Testar em conta de avaliação os pontos sem tutorial suficiente: Aura criando objetos, agente no Instagram, deduplicação e limites de API; registrar `confirmado`, `diferente` ou `indisponível`.
- [ ] **T01.2 — Congelar linha de base do CRM.**
  - [ ] Mapear rota, serviço, tabela, permissão, teste e status `local/mock/externo/ausente` de cada capacidade; anexar amostras de código e evidência de UI.
  - [ ] Aprovar matriz de aceites e priorizar o primeiro ICP/linha Mandato sem declarar hipótese como produto pronto.

**Aceite:** matriz C01–C15 revisada por produto, engenharia e operação, com incógnitas explícitas; nenhum item é marcado “par” só por existir tela ou schema.

### Etapa 02 — Catálogo comercial e fronteiras de dados

- [x] **T02.1 — Modelar ofertas e tipos de receita.**
  - [x] Versionar produto, módulo, linha, plano, licença, implantação, serviço recorrente e projeto, com disponibilidade, capacidade e condições aprovadas.
  - [x] Vincular oportunidade/proposta/contrato a uma versão do catálogo; bloquear promessa de IA individual, Governo ou serviço futuro como ativo.
- [x] **T02.2 — Definir domínio e finalidade.**
  - [x] Formalizar conta institucional, vínculo datado da pessoa, papel de comprador/patrocinador/usuário, oferta e decisão de compra.
  - [x] Separar fisicamente e em RBAC/finalidade o CRM comercial dos tenants/dados de cidadão do Politizai OS; registrar regra de retenção e acesso.

**Aceite:** proposta discrimina software, implantação, serviço e projeto; usuário do CRM não consulta dados operacionais de um gabinete por essa via. **Dependência:** 01.

### Etapa 03 — Contatos, contas, entrada e portabilidade

- [x] **T03.1 — Completar identidade comercial.**
  - [x] Preservar `Contact`/`Account` e implementar vínculo datado, múltiplos negócios, tags e campos customizáveis por entidade com revisão humana de colisão.
  - [x] Garantir histórico quando assessor muda de gabinete e impedir fusão por telefone compartilhado.
- [x] **T03.2 — Unificar entrada e saída.**
  - [x] Reutilizar intake manual/CSV/webhook para formulário, landing e anúncio; mapear origem/UTM, oferta e consentimento sem criar oportunidade para toda mensagem.
  - [x] Acrescentar prévia de importação, exportação CSV autorizada de contatos/negócios e ações em massa com dry-run, motivo e auditoria.

**Aceite:** um contato com dois vínculos e dois negócios mantém históricos separados; CSV import/export faz roundtrip sem duplicação nem vazamento entre workspaces. [Contrato funcional e matriz de evidências](./CONTACTS_ACCOUNTS_PORTABILITY.md). **Dependência:** 02.

### Etapa 04 — Origens, modelos e pipelines configuráveis

- [x] **T04.1 — Criar configuração reutilizável.**
  - [x] Implementar origem, agrupador, modelo de etapas/atividades e campos obrigatórios por oferta/etapa, distinguindo edição compartilhada de cópia local.
  - [x] Criar prévia de migração de modelo com mapeamento de etapas, cards afetados, rollback e histórico imutável.
- [x] **T04.2 — Completar operação do funil.**
  - [x] Reusar Kanban, filtros, valor, dono, ganho/perda e motivo; adicionar visões consolidadas e ações em massa seguras onde faltarem.
  - [x] Testar permissões por origem/equipe, distribuição, reatribuição e atualização simultânea no servidor.

**Aceite:** gestor reutiliza e altera um modelo sem mover card incorretamente; vendedor só vê e move o que sua permissão permite. [Matriz de evidências e aceite](./PIPELINE_TEMPLATES_CONFIGURATION.md). **Dependência:** 02–03.

### Etapa 05 — Atividades e gates de venda consultiva

- [x] **T05.1 — Fazer a etapa representar evidência.**
  - [x] Anexar diagnóstico, comprador/patrocinador, caso de uso, critério de piloto, proposta e decisão às transições relevantes de Mandato.
  - [x] Criar atividades de etapa com tipo, script, prazo relativo e reentrada definida; manter tarefas avulsas e fila diária.
- [x] **T05.2 — Proteger avanço e fechamento.**
  - [x] Reusar validação humana de PACTO e oportunidade; exigir próximo compromisso, responsável e motivo de perda/adiamento.
  - [x] Criar revisão de cards sem ação, tempo excessivo ou valor/decisor incerto sem avanço automático por IA.

**Aceite:** card não chega a proposta sem escopo/decisor/evidência exigidos; tarefa de etapa vence corretamente após reentrada; ganho não equivale a pagamento. [Contrato, matriz e cenários de aceite](./CONSULTATIVE_SALES_GATES.md). **Dependência:** 04.

### Etapa 06 — Cadência longa e plano de conta

- [ ] **T06.1 — Separar tentativa de contato do programa consultivo.**
  - [ ] Manter cadência D0–D30 de “não atendeu” e criar episódios de descoberta, solução, piloto, espera do cliente, contratação e nutrição institucional.
  - [ ] Modelar trilhas paralelas por stakeholder, entrega da Politizai, impedimento e decisão, cada qual com marco, artefato, dono e prazo.
- [ ] **T06.2 — Controlar pausas e retorno.**
  - [ ] Criar espera planejada com motivo/data de revisão e distinguir de estagnação; resposta, ganho, perda e opt-out cancelam ações incompatíveis.
  - [ ] Exibir plano de conta na oportunidade e fila “Meu dia”, com compromissos vencidos e sem dono.

**Aceite:** simular uma venda de meses com troca de chefe de gabinete, proposta revisada e espera pactuada sem mensagens duplicadas nem pipeline artificialmente inflado. **Dependência:** 05.

### Etapa 07 — Inbox e atendimento unificado

- [ ] **T07.1 — Evoluir a fonte canônica existente.**
  - [ ] Completar busca, filtros, estados, setores, transferência, notas, respostas rápidas e edição contextual do negócio no inbox.
  - [ ] Preservar `Conversation`/`Message`, identidade por canal, timeline, eventos de entrega e revisão de correspondência ambígua.
- [ ] **T07.2 — Governar atendimento humano.**
  - [ ] Definir owner/fila e SLA por tipo; handoff entre vendedor, especialista e CS sem trocar dono do lead silenciosamente.
  - [ ] Exercitar concorrência, opt-out, anexo e retorno de mensagem fora de ordem.

**Aceite:** conversa, card e atividade mostram a mesma história; duas pessoas não enviam resposta concorrente; transferência mantém contexto e auditoria. **Dependência:** 03–05.

### Etapa 08 — WhatsApp Oficial e templates

- [ ] **T08.1 — Decidir elegibilidade e homologar canal.**
  - [ ] Obter decisão formal sobre uso pela Politizai e pelo público pretendido; se inelegível, registrar bloqueio e definir canal alternativo autorizado.
  - [ ] Se elegível, validar WABA/número de teste, webhook assinado, janela, opt-in/opt-out, templates aprovados, rate limit, custo e reconciliação de status.
- [ ] **T08.2 — Ativar sobre inbox existente.**
  - [ ] Trocar simulador por adaptador homologado apenas no ambiente autorizado; manter kill switch, replay idempotente e revisão de identidade.
  - [ ] Testar recebimento, resposta livre dentro da janela, template fora dela, eventual coexistência documentada pelo provedor, falha, cancelamento e handoff.

**Aceite:** evidência externa real de ponta a ponta e decisão de elegibilidade anexadas; se canal for vedado, etapa não recebe selo de paridade WhatsApp. **Dependência:** 07; gate externo obrigatório.

### Etapa 09 — Instagram, e-mail, telefonia, agenda e reunião

- [ ] **T09.1 — Conectar canais de conversa permitidos.**
  - [ ] Implementar Instagram Direct/comentários/menções/stories e suas transições para inbox; confirmar no trial o alcance real do agente da Clint nesse canal.
  - [ ] Homologar e-mail Google/Microsoft com replies, bounces e descadastro, e telefonia com chamadas/status; gravação só com política e retenção aprovadas.
- [ ] **T09.2 — Ligar encontro ao negócio.**
  - [ ] Homologar Google/Microsoft Calendar e videoconferência, anexar convite/resultado; criar transcrição/resumo somente com consentimento e controle de acesso.
  - [ ] Ligar e-mail, ligação e reunião à oportunidade e à próxima ação, sem duplicar corpo de mensagem na timeline.

**Aceite:** cada canal homologado registra entrada, saída, erro e resposta na mesma oportunidade; remarcação atualiza lembretes; transcrição não fica exposta a usuário sem permissão. **Dependência:** 07; gates por provedor.

### Etapa 10 — Campanhas e comunicação em escala

- [ ] **T10.1 — Criar campanha de envio separada de campanha de mídia.**
  - [ ] Configurar segmento por campos/tags/origem/oferta, lista/CSV, template, canal, janela, agenda e estimativa de custo/volume.
  - [ ] Adicionar prévia de destinatários, amostra, aprovação, limites, supressão, descadastro e prevenção de sobreposição com cadência/agente.
- [ ] **T10.2 — Executar e medir.**
  - [ ] Processar em fila com recibo por destinatário, retry sem envio duplo e ações pós-envio (tag, tarefa, negócio, atendente) aprovadas.
  - [ ] Suportar WhatsApp, SMS/Flash e voz apenas quando cada canal, finalidade e fornecedor forem autorizados; medir aceito, entregue, respondido, falho e custo.

**Aceite:** campanha de teste pequena prova preview = público executado, opt-out suprime, cancelamento funciona e métricas conciliam; aquisição de mídia continua módulo distinto. **Dependência:** 07–09.

### Etapa 11 — Construtor visual de automações

- [ ] **T11.1 — Substituir a UI estática, preservando o motor.**
  - [ ] Editor monta gatilhos (contato, negócio, campo, tempo/data, canal, campanha), condições E/OU, atrasos, horário, ramificações e ações allowlisted.
  - [ ] Implementar rascunho, validação de grafo, simulação, versão publicada imutável, rollback e política para execução antiga em espera.
- [ ] **T11.2 — Fechar segurança e observabilidade.**
  - [ ] Reusar `AutomationRun`/`Job`/outbox; ações passam por serviços de domínio, privacidade, RBAC, idempotência e limite de custo.
  - [ ] Mostrar insights por fluxo/nó, falha, pausa humana, conflito entre fluxos, replay e auditoria; proibir ciclo infinito e webhook arbitrário.

**Aceite:** operador cria e publica sem código um fluxo “lead → triagem → tarefa → espera → condição → handoff”; edição não altera runs antigos; duplicata/retry não duplica efeito. **Dependência:** 04, 07, 10.

### Etapa 12 — Construtor de agentes e subagentes

- [ ] **T12.1 — Criar agentes governados.**
  - [ ] Editor define nome, objetivo, instruções, tom, público/oferta, base de conhecimento versionada, modelo, orçamento e limite de dados/ferramentas.
  - [ ] Avaliar grounding, oferta futura, PII, prompt injection, baixa confiança e handoff antes de publicar/pausar/reverter.
- [ ] **T12.2 — Inserir conversa IA no fluxo.**
  - [ ] Blocos iniciam atendimento, coletam campos propostos, ramificam por intenção/sem resposta e passam ao humano com resumo e fontes.
  - [ ] Implementar posse exclusiva da conversa, pausa quando humano responde e retomada por novo gatilho; nenhuma proposta/preço/etapa sensível muda sem aprovação.
- [ ] **T12.3 — Especializar a Politizai.**
  - [ ] Criar subagentes internos de pesquisa de conta, diagnóstico, briefing, solução, proposta, risco, follow-up, handoff, CS e análise, todos em rascunho.
  - [ ] Alimentar somente catálogo ativo; separar contexto comercial de dados de cidadãos do OS; medir correções e custo por caso.

**Aceite:** agente de triagem responde com base aprovada, não promete IA/Governo futuros, entrega dados com fonte e cede o chat ao humano sem mensagem concorrente. **Dependência:** 02, 07, 11 e provedor aprovado.

### Etapa 13 — Assistente estilo Aura, com aprovação

- [ ] **T13.1 — Evoluir o copiloto gerencial.**
  - [ ] Consultas em linguagem natural sobre CRM e métricas usam catálogo canônico, filtro de permissão, período e links para registros.
  - [ ] Adicionar voz só após avaliar qualidade, transcrição, privacidade e custo; resposta distingue dado, inferência e ausência.
- [ ] **T13.2 — Criação assistida de configuração.**
  - [ ] IA propõe agente, funil/modelo, automação ou gráfico em **rascunho com diff**, explica impacto e exige confirmação do administrador.
  - [ ] Publicação usa serviços existentes, validação, versão, auditoria e undo; comparar cada comando com conta de avaliação da Clint.

**Aceite:** pedido em texto gera prévia correta, usuário cancela sem efeito ou aprova e vê versão publicada; nenhuma configuração sensível nasce de resposta livre isolada. **Dependência:** 04, 11–12, 16.

### Etapa 14 — Aquisição, API, conectores e mídia

- [ ] **T14.1 — Homologar entradas/saídas.**
  - [ ] Completar formulários/landing, Meta Lead Ads, Typeform ou equivalentes aprovados, webhook e API CRUD versionada para contato/conta/negócio/origem/campos.
  - [ ] Usar inbox/outbox, assinatura, mapeamento versionado, cursor, retry, limite e credencial mínima; n8n/Make/Zapier só pelas APIs, nunca SQL.
- [ ] **T14.2 — Fechar atribuição e feedback.**
  - [ ] Reconciliar UTM, fonte, campanha, custo e conversão; homologar importação real Meta/Google Ads onde autorizado.
  - [ ] Enviar sinal de conversão à Meta com consentimento e deduplicação; validar a possibilidade Google em trial/API antes de prometer paridade.

**Aceite:** evento duplicado/fora de ordem não cria lead ou venda dupla; custo e conversão têm proveniência; revogação de credencial e rollback são ensaiados. **Dependência:** 03, 11; gates por provedor.

### Etapa 15 — Checkout, assinatura e pagamentos

- [ ] **T15.1 — Aplicar checkout só a ofertas transacionais.**
  - [ ] Escolher produto individual elegível; modelar pré-checkout, abandono, Pix/boleto pendente/expirado, recusa, compra, reembolso e assinatura atrasada/cancelada.
  - [ ] Integrar provedor aprovado ao contrato atual, conciliando evento anterior e novo estado sem perder origem/histórico nem confundir produtos distintos.
- [ ] **T15.2 — Preservar venda consultiva.**
  - [ ] Mandato/serviço/Lab seguem proposta, aceite, contrato, implantação e cobrança; não fabricar carrinho para igualar o funil da Clint.
  - [ ] Separar ganho, bookings, fatura, pagamento e reversão nos indicadores; testar chargeback, webhook repetido e divergência.

**Aceite:** compra transacional e contrato consultivo fecham corretamente por caminhos diferentes; caixa reconcilia e nenhum evento cria receita duas vezes. **Dependência:** 02, 14.

### Etapa 16 — Dashboards, construtor de indicadores, metas e forecast

- [ ] **T16.1 — Completar análise configurável.**
  - [ ] Construir dashboards salvos e gráficos por métrica, período, data-base, dimensão, filtro e agregação; incluir linha, área, barra, pizza/donut, funil, tabela, número e KPI quando a métrica permitir.
  - [ ] Exportar CSV e abrir drilldown autorizado; manter fórmulas no registro de métricas existente e indicar ausência/atraso de dados.
- [ ] **T16.2 — Medir a cadência longa e resultado.**
  - [ ] Acrescentar cobertura de decisor/patrocinador, diagnóstico, piloto, espera pactuada, compromisso, estágio e coorte por oferta/ICP.
  - [ ] Reusar metas/forecast; separar contratado, MRR, serviço/projeto entregue e recebido; mostrar qualidade da amostra e custo de campanhas/IA.

**Aceite:** gráfico e CSV batem com registros do drilldown; mudar data de criação para ganho altera a leitura de forma explicável; forecast não inclui oferta futura ou negócio sem evidência. **Dependência:** 02, 05–06, 10, 14–15.

### Etapa 17 — Operação, UX móvel, permissões e custo

- [ ] **T17.1 — Tornar o trabalho diário completo.**
  - [ ] Revisar “Meu dia”, 360 de conta/contato, inbox, Kanban, atividades, agente e dashboard em telas pequenas; criar app móvel ou web móvel com paridade de tarefas críticas.
  - [ ] Implementar notificações, inclusive push se houver app, busca, estados vazios/erro, acessibilidade e atalhos de ligação/agendamento com histórico.
- [ ] **T17.2 — Governar escopo e consumo.**
  - [ ] RBAC por workspace, equipe, origem, negócio e canal; ações em massa, exportações, IA e campanhas exigem permissão específica.
  - [ ] Teto, saldo/créditos quando aplicável e ledger de consumo por IA, SMS, voz e provedores; alertas, bloqueio/pausa, auditoria e revogação.

**Aceite:** SDR, closer, gestor e admin cumprem suas jornadas em desktop e móvel, sem acesso cruzado; orçamento excedido pausa somente o recurso dependente. **Dependência:** transversal, após 03–16.

### Etapa 18 — Entrega, CS, renovação e expansão da Politizai

- [ ] **T18.1 — Fechar o ciclo de valor por oferta.**
  - [ ] Reusar contrato, assinatura, handoff, onboarding, CS e Farmer; criar checklists separados para licença, implantação, serviço operado e projeto Lab.
  - [ ] Transferir diagnóstico, promessa, escopo, aprovações, usuários e riscos com aceite explícito da equipe de entrega.
- [ ] **T18.2 — Medir e agir após ganho.**
  - [ ] Acompanhar adoção, entregáveis, capacidade, solicitações, saúde, resultado e riscos; renovação inicia por data/estado sem envio automático indevido.
  - [ ] Nova decisão comercial abre oportunidade de expansão própria; churn e perda têm motivo e aprendizado.

**Aceite:** uma venda OS+serviço produz dois planos de entrega coerentes, contrato e valores conciliados, revisão de valor e renovação rastreável. **Dependência:** 02, 05, 11, 15–16.

### Etapa 19 — Homologação integral, operação e decisão de go-live

- [ ] **T19.1 — Executar suíte de paridade C01–C15.**
  - [ ] Para cada capacidade, anexar teste funcional, integração, falha/retry, RBAC, privacidade, acessibilidade/mobile, dados de prova e comparação com fonte/trial Clint.
  - [ ] Rodar jornadas completas: inbound → venda Mandato longa → contrato → onboarding → renovação; campanha → resposta → handoff; agente → humano; checkout transacional → pagamento/reembolso.
- [ ] **T19.2 — Fechar prontidão produtiva.**
  - [ ] Resolver gates do [Go/No-Go](./PROD13_FINAL_GO_NO_GO.md): identidade/MFA, jurídico/DPO, backup/PITR/restore, segundo operador, observabilidade, pentest, domínio, worker e custo.
  - [ ] Homologar provedores e dados reais por escopo autorizado; executar plano de deploy, migração reversível, smoke, rollback e reconciliação pós-ativação.
- [ ] **T19.3 — Publicar relatório de aceite.**
  - [ ] Marcar C01–C15 como `PAR`, `PARCIAL`, `BLOQUEADO` ou `DIVERGENTE`, com evidência e responsável; nenhum bloqueio recebe “100%”.
  - [ ] Registrar restrições da Clint não verificáveis publicamente e diferenças intencionais Politizai, inclusive canal inelegível e checkout não aplicável a venda consultiva.

**Aceite:** go-live somente com decisão formal e zero bloqueio crítico; “100% de paridade funcional com a Clint” só quando **todos** os C01–C15 tiverem prova de execução real, sem lacunas escondidas. Diferença intencional ou bloqueio de canal permanece explicitamente abaixo de 100%. **Dependência:** 01–18.

## 5. Caminho crítico e pacotes de entrega

| Pacote | Etapas | Resultado utilizável | Bloqueio que impede o próximo marco |
|---|---|---|---|
| **Base comercial Politizai** | 01–06 | Conta, oferta, funil, tarefas e plano consultivo com dados confiáveis. | ICP/oferta indefinidos ou gates de etapa sem evidência. |
| **Conversa e escala** | 07–12 | Inbox, canais homologados, campanhas, editor de fluxo e agentes com handoff. | Elegibilidade, consentimento, provider, orçamento ou qualidade de IA. |
| **Inteligência e receita** | 13–18 | Copiloto, integrações, checkout aplicável, dashboards, mobile e CS. | Métricas sem fonte, eventos sem conciliação ou promessa maior que capacidade de entrega. |
| **Aceite final** | 19 | Relatório de paridade e decisão de operação. | Qualquer C01–C15 sem evidência ou gate produtivo crítico aberto. |

Não há estimativa confiável de semanas ou custo neste momento: faltam definição final das ofertas, acesso de avaliação à Clint, elegibilidade/canais e condições de fornecedores. A execução pode ser rápida por **reuso dos domínios locais**, mas velocidade não transforma mock em integração real. O primeiro pacote já produz valor operacional sem depender de WhatsApp; os demais podem ser desenvolvidos em ramos paralelos respeitando fonte de verdade e ownership.

## 6. Fontes de verificação

- [Benchmark aprofundado da Clint](./BENCHMARK_CLINT.md): 113 URLs de pesquisa no estudo original, com distinção entre tutorial, divulgação e inferência.
- [Aplicação dos mecanismos à Politizai](./CLINT_APLICADA_A_POLITIZAI.md): portfólio, ICP proposto, cadência longa, agentes e métricas.
- Clint oficial: [contato × negócio](https://ajuda.clint.digital/pt-BR/articles/8092285-entenda-a-diferenca-de-contato-e-negocio), [negócio](https://ajuda.clint.digital/pt-BR/articles/9741298-como-funciona-um-negocio), [modelos de etapas](https://ajuda.clint.digital/pt-BR/articles/10365143-como-criar-um-novo-modelo-de-etapas-e-atividades-na-central-de-modelos), [inbox](https://ajuda.clint.digital/pt-BR/articles/8156771-como-gerenciar-sua-caixa-de-entrada-do-whatsapp), [campanhas](https://ajuda.clint.digital/pt-BR/articles/11155266-como-fazer-uma-campanha-de-whatsapp-oficial).
- Clint oficial: [criar agente](https://ajuda.clint.digital/pt-BR/articles/12052502-como-criar-editar-ou-excluir-um-agente-de-ia), [base de conhecimento](https://ajuda.clint.digital/pt-BR/articles/12052517-como-construir-uma-base-de-conhecimento-para-o-seu-agente-de-ia), [agente no fluxo](https://ajuda.clint.digital/pt-BR/articles/12044946-como-incluir-conversacao-por-ia-no-seu-fluxo-de-automacao), [publicar automação](https://ajuda.clint.digital/pt-BR/articles/13892138-como-criar-um-novo-fluxo-de-automacao-na-clint).
- Clint oficial: [checkout](https://ajuda.clint.digital/pt-BR/articles/6560777-regras-de-negocios-integracoes-com-plataformas-de-checkout), [indicador customizado](https://ajuda.clint.digital/pt-BR/articles/17152245-como-criar-e-editar-um-indicador-personalizado), [Meta CAPI](https://ajuda.clint.digital/pt-BR/articles/15263583-como-utilizar-a-acao-enviar-conversao-para-meta-ads-nas-automacoes-da-clint).
- Estado local: [PRD do Revenue OS](./REVENUE_OS_PRD.md), [execução](./EXECUTION_STATUS.md), [validações externas](./EXTERNAL_VALIDATIONS.md), [go/no-go](./PROD13_FINAL_GO_NO_GO.md), [motor de automações](./AUTOMATIONS.md), [inbox](./OMNICHANNEL_INBOX.md), [governança de IA](./AI_GOVERNANCE.md), [métricas](./REVENUE_METRICS.md).
