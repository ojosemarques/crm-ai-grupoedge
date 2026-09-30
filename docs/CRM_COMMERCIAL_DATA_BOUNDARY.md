# Fronteira de dados do CRM comercial

## Objetivo

Este documento define a fronteira obrigatória entre o CRM comercial interno da
Politizai e os produtos operacionais usados pelos clientes. O CRM registra a
relação de venda da Politizai com uma instituição. Ele não é um CRM eleitoral,
um sistema de atendimento do gabinete nem uma cópia dos dados operacionais do
Politizai OS.

Esta fronteira vale para banco, APIs, interfaces, busca, exportação, jobs,
automações, integrações, IA, logs, auditoria, suporte e ambientes de teste.

## Separação física

O domínio comercial pertence a um **projeto Supabase dedicado ao CRM** e ao
schema PostgreSQL privado `crm`. Esse schema não deve ser exposto pela Data API
nem acessado diretamente pelo navegador. A aplicação e os workers acessam o
banco somente pelo backend, com papéis de banco de menor privilégio e os casos
de uso do domínio.

Os dados operacionais do Politizai OS pertencem a outro projeto/banco e a outra
finalidade. Não são permitidas foreign tables, views, réplicas, joins, database
links ou credenciais compartilhadas que tornem dados do OS consultáveis pelo
CRM. Uma integração futura entre os produtos deve trocar apenas eventos ou
referências mínimas aprovadas, por contrato versionado e allowlist de campos;
ela não altera essa separação.

Ambientes de desenvolvimento, teste, staging e produção usam bancos e
credenciais separados. Seeds e fixtures usam somente pessoas e instituições
fictícias. Dumps de produção do OS não podem alimentar ambientes do CRM.

## Dados permitidos

O CRM pode persistir apenas dados necessários à aquisição, venda, contratação,
implantação, sucesso, renovação e expansão da própria Politizai:

- conta institucional prospect ou cliente, como gabinete, mandato, campanha,
  partido, órgão ou empresa, com dados cadastrais e contexto comercial;
- contato profissional que participa da compra, implantação, uso contratado ou
  gestão do relacionamento com a Politizai;
- vínculo datado entre contato e conta, com papel, fonte, evidência, influência,
  autoridade, início e fim;
- lead, oportunidade, oferta, proposta, contrato, implantação, serviço,
  faturamento, pagamento, sucesso, renovação e expansão;
- comunicação comercial ou contratual autorizada, atividade, tarefa, reunião e
  evidência de decisão;
- consentimento, preferência de canal, finalidade, base legal, retenção,
  solicitação do titular, segurança e auditoria referentes ao próprio CRM.

Uma conta pode representar um gabinete como **organização compradora**. Isso
não autoriza importar as pessoas atendidas pelo gabinete nem seu histórico
operacional.

## Dados proibidos

O CRM não pode receber, persistir, indexar, inferir, mostrar, exportar ou enviar
a provedores:

- cidadãos, eleitores, lideranças comunitárias ou contatos mantidos pelo cliente
  para a operação do mandato, salvo quando a mesma pessoa participar de uma
  compra da Politizai e houver registro comercial independente e justificável;
- solicitações, protocolos, atendimentos, demandas, casos, encaminhamentos,
  manifestações ou histórico de relacionamento do gabinete com cidadãos;
- preferências políticas, intenção de voto, filiação, segmentação eleitoral,
  dados de campanha ou perfis operacionais mantidos pelo cliente;
- mensagens, anexos, documentos ou bases de conhecimento do Politizai OS que
  não sejam evidência mínima e aprovada da relação comercial com a Politizai;
- credenciais, tokens, chaves, identificadores internos ou payloads brutos do
  tenant operacional do cliente.

Um dado proibido não se torna permitido por estar disponível em uma integração,
por ter o mesmo telefone de um contato comercial ou por ser útil a score, IA,
automação ou prospecção. Similaridade de identidade nunca autoriza cópia ou
fusão entre os domínios.

## Domínio comercial

Os conceitos comerciais têm significados distintos:

| Conceito | Regra |
|---|---|
| `Account` | Instituição prospect ou cliente da Politizai; não é tenant operacional nem conjunto de cidadãos. |
| `Contact` | Pessoa identificada no contexto comercial da Politizai. |
| `AccountContactRole` | Vínculo temporal e evidenciado entre pessoa e instituição. Encerrar um vínculo não move oportunidades ou contratos. |
| Comprador/decisor | Pessoa com autoridade sobre orçamento ou contratação; corresponde ao papel `DECISION_MAKER` e à autoridade registrada. |
| Patrocinador | Pessoa que sustenta a iniciativa e a implantação; corresponde a `CHAMPION`, com evidência própria. |
| Usuário | Pessoa prevista para usar a oferta contratada; corresponde a `USER` e não implica poder de compra. |
| `Opportunity` | Uma decisão de compra específica, vinculada a conta, responsáveis e versão de oferta. Não nasce para toda pessoa ou mensagem. |

Papéis são datados. Quando uma pessoa muda de gabinete ou de função, o vínculo
anterior recebe `validTo` e um novo vínculo é criado; fatos passados não são
reescritos. Comprador, patrocinador e usuário podem ser pessoas diferentes e
devem aparecer separadamente na proposta e no histórico quando aplicável.

## RBAC, finalidade e minimização

Toda consulta ou mutação deriva `workspaceId`, membership e ator do contexto
autenticado. IDs, papéis, workspace ou finalidade enviados pelo cliente nunca
ampliam acesso. O serviço combina RBAC (`WORKSPACE`, `TEAM` ou `OWN`) com o
recurso concreto antes da consulta; esconder controles na interface não é uma
decisão de autorização.

O acesso também exige uma finalidade comercial ativa e compatível com a
categoria do dado e com a ação. Consentimento ou outra base aprovada é avaliada
por finalidade e canal. Score, automação, interesse comercial ou papel de
administrador não substituem finalidade, base legal, opt-out ou minimização.

Permissões de privacidade, exportação, ações em massa, auditoria e administração
são capacidades separadas. Usuários comerciais veem somente os dados mínimos
necessários ao seu escopo; dados sensíveis são mascarados quando a atividade não
exige o valor integral. Atores técnicos e integrações recebem escopos menores,
expiração, owner humano e revogação independente.

## Retenção e acesso do titular

Cada categoria do CRM possui finalidade, base legal, sistemas de origem, owner,
política de retenção e versão aprovados. O prazo começa pelo gatilho definido na
política, como fim da relação ou última atividade comercial válida; não pode ser
estendido por atividade técnica, replay ou cópia de integração.

Retenção é executada pelo serviço governado, com prévia, escopo, motivo,
idempotência, auditoria e respeito a legal hold. Histórico contratual, financeiro
ou de segurança pode seguir prazo próprio, com acesso restrito. Política ausente,
pendente ou incompatível gera revisão e não autoriza comunicação nem retenção
indefinida.

Solicitações de acesso, correção, portabilidade, restrição, oposição, revogação
ou eliminação incluem somente dados do CRM após verificação de identidade e
escopo. O CRM não consulta o OS para enriquecer a resposta; uma solicitação que
também alcance o OS é encaminhada ao processo daquele produto, sem cruzar as
bases.

## Resposta segura e deny-by-default

Todo recurso, campo, origem, integração ou finalidade não explicitamente
permitido é negado. Em especial:

- referência de outro workspace, projeto ou domínio retorna `404` ou `403`
  conforme o contrato da rota, sem revelar existência, contagem ou metadados;
- categoria operacional do OS, cidadão ou atendimento é rejeitada antes da
  consulta e nunca aparece parcialmente em busca, autocomplete, métrica,
  exportação ou prompt de IA;
- integração sem contrato allowlisted, finalidade ativa ou credencial mínima
  permanece desativada;
- dúvida de identidade ou finalidade produz revisão humana, sem merge, envio ou
  importação automática;
- a negação registra somente ator, workspace, ação, tipo de recurso, razão e
  correlação necessários à segurança, sem copiar o payload proibido.

Falha de autorização não pode cair para acesso global, dados demonstrativos,
workspace padrão ou credencial privilegiada. Jobs, workers, callbacks e suporte
administrativo repetem os mesmos controles do fluxo interativo.

## Evidência de conformidade

A fronteira só é considerada efetiva quando houver, no ambiente alvo:

- projeto Supabase e schema `crm` confirmados, sem exposição pela Data API;
- papel de runtime sem acesso ao projeto/banco do Politizai OS;
- testes positivos por papel e escopo e testes negativos de outro workspace,
  referência de cidadão/atendimento e payload proibido;
- inspeção de busca, exportação, métricas, IA, logs e auditoria sem dados do OS;
- finalidade e retenção versionadas, com owners e estados consultáveis;
- trilha de vínculo datado e oportunidade preservada após mudança de conta;
- registro de deployment, commit, migration e smoke autenticado da fronteira.

Uma tela vazia, uma tabela separada ou uma regra apenas documental não substitui
essas evidências.
