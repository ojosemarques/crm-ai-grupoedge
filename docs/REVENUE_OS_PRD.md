# PRD — Politizai Revenue OS

## Estado deste documento

Este documento é a entrega de planejamento da CRM-32. Ele descreve a expansão
do MVP local já implementado, mas não afirma que os módulos novos existem. As
CRM-33 a CRM-64 permanecem backlog não iniciado e exigem autorização individual.

## Visão

O Politizai Revenue OS será a evolução do Politizai CRM para coordenar o ciclo
de receita permanente: aquisição, atendimento, venda, contratação, ativação,
sucesso, renovação e expansão. Continuará sendo um monólito modular com
PostgreSQL como fonte única da verdade, autorização server-side, eventos
históricos e auditoria append-only.

Ele não será CRM eleitoral, gestão de gabinete, ERP contábil, data warehouse,
help desk genérico ou plataforma livre de automação. Integrações trazem e
entregam fatos por contratos controlados; não substituem os serviços de domínio.

## Resultados esperados

O sistema deverá responder, conforme a função e a permissão:

1. quem precisa de ação agora, por qual motivo e com qual próximo passo;
2. de onde vieram contatos, oportunidades e receita, com atribuição versionada;
3. qual conta, contato e comitê participam de uma decisão de compra;
4. qual receita foi contratada, ativada, recebida, renovada, expandida ou perdida;
5. onde o ciclo desacelera e quais registros compõem cada indicador;
6. quais dados são fato, inferência, ausência ou informação externa ainda não reconciliada;
7. quais consentimentos, finalidades e regras de retenção permitem cada uso;
8. quais integrações, automações e análises de IA produziram cada efeito.

## Personas e decisões

| Persona | Pergunta principal | Ação primária típica |
|---|---|---|
| Marketing | Qual investimento gera demanda qualificada e receita? | Corrigir campanha, atribuição ou qualidade de captura |
| SDR | Quem atender agora? | Executar a próxima ação do lead |
| Closer | Qual negociação mover hoje? | Avançar uma oportunidade com evidência |
| Customer Success | Qual cliente corre risco ou precisa ativar valor? | Executar ação do plano de sucesso |
| Farmer | Qual renovação ou expansão exige atuação? | Trabalhar renovação/expansão |
| Gestor/RevOps | Onde o ciclo perde conversão, velocidade ou receita? | Abrir o recorte e atribuir correção |
| Administrador | O sistema está seguro, configurado e integrado? | Resolver configuração, acesso ou falha |

Papel técnico e função comercial continuam separados. Uma pessoa pode exercer
mais de uma função, mas só recebe dados e ações concedidos por permissão e escopo.

## Escopo funcional planejado

### P0 — fundação do ciclo de receita

- identidade canônica de contatos e múltiplos pontos de contato;
- contas, vínculos e comitê de compra;
- lifecycle e ownership por função, com histórico;
- consentimento, finalidade, base legal e retenção;
- plataforma de integrações com inbox/outbox, cursor, mapeamento e idempotência;
- touchpoints, atribuição versionada, hierarquia de mídia e fatos de custo;
- inteligência geográfica tipada;
- comunicação omnichannel sobre a timeline existente;
- contratos, assinaturas e fatos de receita em centavos;
- onboarding, Customer Success, renovação, expansão e churn;
- metas, quotas, forecast histórico e métricas do ciclo completo;
- dashboards por função, busca global autorizada, qualidade de dados;
- observabilidade, recuperação, segurança e readiness de produção.

### P1 — conectores e inteligência governada

- Meta Ads e Google Ads em sandbox antes de qualquer ativação real;
- WhatsApp, e-mail, telefonia, calendário e pagamentos por adapters;
- IA real com provedor aprovado, minimização e avaliação;
- n8n como cliente de APIs/eventos, nunca do banco;
- atendimento de CS e satisfação estritamente ligados ao ciclo de cliente.

### P2 — evolução após evidência operacional

- atribuição multi-touch avançada após cobertura e qualidade suficientes;
- forecast assistido após histórico mínimo e baseline determinístico;
- health score com sinais de produto quando houver fonte confiável;
- benchmarks, coortes e experimentos com governança;
- conectores adicionais implementados apenas por demanda comprovada.

## Jornadas-alvo

### Aquisição até venda

Touchpoint → sessão/formulário → Contact/ContactPoint → Lead → distribuição e
SLA → PACTO/score → reunião → Opportunity/Offer → ganho/perda. O fluxo atual é
preservado; identidade e atribuição passam a ser vinculadas, não recriadas.

### Venda até ativação

Ganho → contrato → assinatura → handoff → onboarding → ativação. Ganho não
equivale automaticamente a receita recebida nem a onboarding concluído.

### Cliente até renovação

Conta ativa → carteira de CS → plano e marcos → saúde → renovação → expansão,
contração ou churn. Cada desfecho usa evento e motivo explícitos.

### Integração até fato oficial

Webhook/poll → WebhookInbox/SyncRun → validação → mapeamento externo → serviço
de domínio → OutboxEvent/AuditLog. Payload bruto é evidência, não estado oficial.

## Requisitos permanentes

- todo registro pertence a um workspace e é consultado com escopo autorizado;
- IDs atuais, fatos históricos e autoria nunca são substituídos em migração;
- dinheiro usa moeda explícita e inteiros em centavos;
- instantes usam `timestamptz`; datas civis usam timezone do workspace;
- identidade, lifecycle, propriedade e permissão são conceitos distintos;
- valores filtráveis ou mensuráveis ficam em colunas relacionais tipadas;
- JSON é reservado a payload bruto, evidência, configuração flexível validada e metadados;
- fatos externos guardam provedor, chave externa, horário do fato e ingestão;
- retry não duplica efeito; toda integração possui idempotency key;
- sugestão de IA não se torna mutação sem confirmação e serviço de domínio;
- todo KPI informa definição, período, timezone, numerador, denominador e drilldown;
- estados de indisponibilidade diferenciam zero, atraso de sincronização e ausência de dado.

## Limites deliberados

- contratos e pagamentos representam verdade comercial e de cobrança, não livro contábil;
- atendimento registra solicitações ligadas ao cliente, não substitui uma central completa;
- comunicação não armazena segredo de provedor nem permite envio fora de consentimento;
- mídia registra hierarquia, custo e performance, não substitui gerenciadores de anúncios;
- busca global retorna somente campos e registros autorizados;
- n8n não executa SQL nem decide transições comerciais;
- IA não define causa, score vigente, forecast oficial ou ação sensível sozinha;
- dashboards por função reutilizam métricas e drilldowns; não duplicam fórmulas.

## Critérios de sucesso da expansão

- contato único pode participar de múltiplos leads e contas sem mesclagem destrutiva;
- receita e pipeline reconciliam com contrato, assinatura e pagamento conforme a definição;
- atribuição mantém versão, janela, modelo e cobertura;
- ownership corrente e histórico explicam quem responde por cada estágio do ciclo;
- cada função começa por uma fila acionável, não por dezenas de KPIs;
- conectores falham de modo observável sem corromper o domínio;
- retenção, consentimento e acesso são verificáveis por auditoria;
- releases preservam rollback, backup e compatibilidade com CRM-00 a CRM-31.

## Fora da CRM-32

Não foram criados models, migrations, APIs, telas, workers, conectores,
credenciais ou recursos externos. Este PRD não autoriza CRM-33, deploy ou uso de
dados reais.
