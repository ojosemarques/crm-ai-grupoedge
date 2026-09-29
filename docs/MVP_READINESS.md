# Prontidão local do MVP — CRM-31

## Resultado

Em 11 de setembro de 2026, o Politizai CRM foi aceito como **MVP local**. O
escopo da CRM-01 à CRM-31 está implementado e foi validado nos limites descritos
neste documento. Este resultado não equivale a prontidão, certificação de
segurança ou capacidade de produção.

## Atualização de readiness — CRM-64

Em 13 de setembro de 2026, o programa CRM-32–64 foi aceito para homologação
local/isolada. O preflight, migrations desde zero, smoke E2E, RBAC, readiness,
mobile, inventário de `public` e ausência de schemas residuais foram validados.
Produção permanece **NO-GO**: jurídico/DPO, ambiente equivalente, secret
manager, banco gerenciado/PITR, observabilidade e rate limit distribuídos,
pentest, multibrowser, capacidade externa e homologações de providers continuam
pendentes. Consulte `PRODUCTION_READINESS.md` e `GO_LIVE_CHECKLIST.md`.

## Atualização local — CRM-54

Em 13 de setembro de 2026, a camada pós-venda passou a incluir Farmer,
renovações, sinais de expansão, contração e churn confirmados por pessoas
autorizadas. A implementação preserva `RevenueMovement` como ledger append-only,
separa sinal de expansão de `Opportunity`, distingue logo churn de revenue churn
e exige evidência, motivo, RBAC, workspace e confirmação humana. O backfill
conservador criou somente duas renovações `IN_REVIEW` a partir de assinaturas
locais verificáveis e não fabricou decisão financeira.

O gate local passou com 249 testes unitários, 309 integrações legadas e 7
integrações Farmer em schemas efêmeros isolados, 4 testes CRM-29 e 90 dos 91 E2E
na primeira execução integral. O único E2E inicialmente falho revelou overflow
mobile no seletor de assinatura após a criação dos dados Farmer; a correção foi
validada no arquivo afetado com 2/2 testes. Lint, TypeScript, build, auditoria de
dependências, migration status e limpeza dry-run passaram. Não houve provider,
egress, banco remoto ou deploy.

## 1. Escopo concluído

- fundação Next.js/TypeScript, PostgreSQL/Prisma, health check e monólito modular;
- login local, sessão, RBAC server-side e isolamento por workspace/equipe;
- entrada única por cadastro, CSV, webhook local e simulador, com deduplicação;
- round-robin, Fila Geral explícita, tarefa imediata e SLA 0 em segundos;
- Meu Dia, lista, cartão 360, timeline, tarefas e próxima ação;
- PACTO, scoring versionado e pipelines de pré-vendas e vendas;
- agenda interna, briefing, oportunidades, propostas, ganho e perda;
- configurações, administração, métricas, dashboard e drilldowns;
- worker PostgreSQL e 12 automações predefinidas com efeitos simulados;
- auditoria append-only, saúde determinística, IA local e Copilot rastreável;
- sistema visual Politizai consistente e responsivo, base fictícia de 320 leads
  e cobertura crítica.

## 2. Escopo parcial

Não há item parcial dentro do escopo local da CRM-31. Há limites deliberados:
a validação automatizada de navegador usa Chromium; o teste de volume representa
o MVP com 320 leads; e a avaliação visual manual cobre as 15 rotas principais em
desktop e mobile, além de PACTO, Inteligência e estados públicos. O produto ainda
não passou por pesquisa de usabilidade com operadores reais nem por validação em
outros motores de navegador.

## 3. Itens não implementados

- deploy, infraestrutura de produção e operação com dados reais;
- validações externas dos conectores Meta Ads e Google Ads read-only;
  WhatsApp, Instagram, telefonia, e-mail, SMS e calendários externos;
- pagamentos reais/provider, onboarding externo, SSO, MFA, recuperação de senha, BI e app móvel;
- provider externo de LLM habilitado no runtime;
- rate limit compartilhado, CSP/HSTS finais, observabilidade e recuperação de
  desastre de produção;
- exportação administrativa, desabilitada até revisão específica de segurança.

As CRM-40 e CRM-41 adicionaram os conectores server-side Meta Ads e Google Ads
somente leitura, validados localmente com fixtures e falhas determinísticas. Isso
não altera a prontidão de produção: as validações externas estão adiadas, sem
handshake, conta real, egress ou reconciliação externa comprovados. Consulte
[`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md).

## 4. Comandos executados

O gate final foi executado em uma cópia byte a byte em
`/tmp/politizai-crm-validation.n2JRFA`, preservando o checkout original cujos
arquivos continuam não rastreados e cujo `node_modules` tinha arquivos
`dataless`:

```bash
pnpm db:up
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:crm29
pnpm test:e2e
pnpm audit
pnpm build
pnpm db:status
pnpm worker
```

Também foram usados `next start` em porta local, `curl` para health/login e SQL
somente de leitura para comparar contagens antes e depois do reinício. O worker
foi encerrado manualmente com `Ctrl-C` depois do log de inicialização e
encerramento gracioso.

## 5. Lint, tipos, testes e build

| Gate | Resultado final |
|---|---|
| ESLint | aprovado, sem erros |
| TypeScript estrito | aprovado, sem erros |
| Unitários | 124/124 em 29 arquivos |
| Integração PostgreSQL | 195/195 em 24 arquivos; 23 migrations desde schema vazio |
| Seed CRM-29 | 4/4, incluindo idempotência e coerência |
| E2E em `next start` | 39/39 |
| E2E estritamente local | 1/1 em `next dev` |
| Auditoria de dependências | nenhuma vulnerabilidade conhecida |
| Build Next.js 16.3.4 | aprovado |
| Status de migrations | 23 migrations; schema de demonstração atualizado |

O primeiro E2E encontrou erro na varredura administrativa; o segundo expôs
`Connection terminated due to connection timeout` após dezenas de páginas. A
causa era dupla: consultas concorrentes dentro da mesma transação/connection e
um novo pool Prisma criado a cada lookup no build de produção. As leituras da
varredura foram serializadas e o cliente passou a ser singleton por processo.
Somente a execução integral posterior, com 39+1 aprovações, compõe o gate final.

## 6. Evidências do fluxo E2E

`tests/e2e/opportunities-sales.spec.ts` percorreu um mesmo lead por login,
entrada, normalização, score, prioridade, round-robin, SLA, primeira tentativa,
briefing local, PACTO, qualificação, reunião, comparecimento, oportunidade,
proposta, negociação, ganho, dashboard e auditoria.

Os cenários alternativos provaram no-show, duplicidade, desqualificação, acesso
negado, ausência de próxima ação, automação em falha, override de prioridade,
opt-out e indisponibilidade de todos os SDRs com fallback explícito para Fila
Geral. O dashboard reconciliou KPI e drilldown, e todos os oito usuários locais
autenticaram com os respectivos papéis.

## 7. Riscos remanescentes

- o driver `pg` ainda avisa que consultas concorrentes no mesmo client serão
  descontinuadas no pg 9; os gates passam, mas os locais restantes devem ser
  serializados ou redesenhados antes dessa atualização;
- 320 leads não medem carga, contenção, pool ou planos SQL de produção;
- não houve pentest, SAST/DAST, avaliação jurídica/LGPD ou ensaio de desastre;
- rate limit em memória não coordena múltiplas réplicas;
- decisões de infraestrutura, SLO, retenção e suporte ainda não foram aprovadas.

## 8. Limitações do modo local

Mensagens, lembretes, webhook, simulador, agenda e IA não usam provedores reais.
O Compose possui credenciais públicas de demonstração; os dados são fictícios;
o worker e o web dependem do PostgreSQL local. A conexão externa de IA não é
configurada. O CSV é síncrono e limitado. A suíte automatizada recusa banco
remoto e usa schemas descartáveis.

## 9. Checklist de segurança antes de dados reais

- [ ] executar revisão independente de autenticação, RBAC e isolamento;
- [ ] implantar cofre e rotação de segredos, MFA/SSO administrativo e recovery;
- [ ] validar LGPD, consentimento, não-contatar, retenção e direitos do titular;
- [ ] executar pentest, SAST, DAST, secret scanning e revisão de supply chain;
- [ ] configurar CSP/HSTS, TLS, rate limit compartilhado e proteção de borda;
- [ ] revisar redaction, traces e acesso a payloads/timeline/auditoria;
- [ ] testar backup, restauração, resposta a incidente e revogação de acesso;
- [ ] aprovar política para IA e integrações antes de transmitir qualquer dado.

## 10. Checklist para publicação futura

- [ ] definir ambiente, capacidade, SLO, responsáveis e janela de mudança;
- [ ] ensaiar migrations e rollback em homologação equivalente;
- [ ] usar PostgreSQL gerenciado, TLS, pool e usuário de menor privilégio;
- [ ] executar a matriz completa a partir do artefato exato do release;
- [ ] testar carga, planos SQL, concorrência do worker e desligamento gracioso;
- [ ] configurar logs, métricas, alertas e runbooks;
- [ ] validar backup restaurável antes da migration;
- [ ] executar smoke tests pós-release e registrar aprovadores/evidências.

O procedimento completo está em [`DEPLOYMENT_FUTURE.md`](./DEPLOYMENT_FUTURE.md).

## 11. Próximas melhorias P1 e P2

P1: pesquisa com SDRs/closers, calendário comercial do SLA, exportação segura,
notificações em tempo real, testes multibrowser, observabilidade e eliminação
do padrão depreciado do `pg`.

P2: integrações de comunicação e anúncios, calendários externos, pagamentos reais,
LLM externo governado, SSO, BI e aplicativo móvel. Nada disso foi antecipado.

## 12. Deploy

Nenhum deploy, publicação, alteração de banco remoto ou envio de dados a
serviços externos foi realizado.

## Inteligência geográfica local — CRM-42

A prontidão local agora inclui dimensões geográficas tipadas, observações
append-only, perfil corrente com conflitos revisáveis, territórios versionados,
membership temporal e uma tela gerencial com mapa esquemático offline e tabela
equivalente. O backfill de cidade/UF é conservador e idempotente, não inventa
coordenadas e não altera responsáveis.

Métricas regionais reutilizam a camada oficial, mantêm o universo RBAC e
suprimem grupos com menos de cinco leads. Geocoding, tiles e validação com
fornecedor externo continuam fora da prontidão: nenhuma credencial, chamada,
egress, banco remoto ou deploy foi usado. O gate da CRM-42 está detalhado em
[`GEOGRAPHIC_INTELLIGENCE.md`](./GEOGRAPHIC_INTELLIGENCE.md) e no checkpoint de
execução.

## Inbox omnichannel local — CRM-43

A prontidão local agora inclui uma caixa de entrada unificada sobre
`Conversation` e `Message` canônicos, com owner ou fila explícita,
participantes, revisão de identidade, status append-only, tentativas de entrega,
SLA de conversa, templates versionados e correlação com timeline, integração,
automação e privacidade. A interface `/inbox` executa somente o simulador
determinístico local e identifica esse modo de forma explícita.

O gate aprovou 188/188 testes unitários, 247/247 integrações, 4/4 CRM-29,
71/71 E2E de produção e 1/1 local-only, além de lint, tipos, audit, build,
backup/restore e migration desde zero. O `public` terminou com 165 tabelas,
37 migrations concluídas, oito conversas, oito mensagens, zero vínculo cruzado
de workspace e zero conversa acionável sem owner/fila. Naquele checkpoint, os
canais específicos e validações com providers ainda estavam fora da prontidão;
as fundações locais posteriores são descritas abaixo. Binários continuam fora.
Detalhes: [`OMNICHANNEL_INBOX.md`](./OMNICHANNEL_INBOX.md).

## WhatsApp — CRM-44

A prontidão local agora inclui profile por workspace, contratos normalizados,
webhook com challenge/assinatura/tenant, processamento assíncrono, retry,
dead-letter/replay, janela de atendimento, templates com estado provider
separado, opt-out e referências de mídia sem binário. O simulador e os testes
não acessam a Meta.

A prontidão externa é **não validada e bloqueada**. A política oficial pode
impedir o uso por entidades ou serviços relacionados a política; é obrigatória
uma revisão formal de elegibilidade antes de credenciais ou sandbox. Nenhum
WABA, número, template aprovado, token, webhook público ou mensagem real foi
usado. Consulte [`WHATSAPP_CLOUD_API.md`](./WHATSAPP_CLOUD_API.md).

## E-mail — CRM-45

O canal de e-mail está pronto apenas para demonstração local: sender fictício,
threading por headers, inbox canônica, outbox/job, worker com lock e retry,
status temporais, bounce/complaint/unsubscribe, suppression e backfill foram
validados com sink determinístico. O runtime não contém implementação SMTP
ativa, não guarda credencial e não consulta DNS.

A prontidão externa é **adiada e não validada**. É necessário escolher e
homologar provider, domínio e mailbox; configurar secrets fora do banco;
publicar e validar SPF/DKIM/DMARC; implementar webhook assinado e unsubscribe
público; e reconciliar entrega, bounce, complaint e replies reais. Consulte
[`EMAIL_CHANNEL.md`](./EMAIL_CHANNEL.md) e
[`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md).

## Telefonia — CRM-46

A prontidão local inclui profile por workspace, chamada relacionada ao Inbox,
eventos append-only, múltiplas pernas, worker PostgreSQL, retry/dead-letter,
callback local assinado, disposição humana, próxima ação, SLA, auditoria,
métricas e backfill conservador. O único transporte é o simulador determinístico.

A prontidão externa é **adiada e não validada**. Nenhum provider, número, PSTN,
credencial, áudio, gravação, transcrição, storage ou egress foi usado. Políticas
jurídicas e de gravação, sandbox, webhook e reconciliação real continuam
pendentes em [`TELEPHONY_CHANNEL.md`](./TELEPHONY_CHANNEL.md) e
[`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md).

O gate local aprovou 218/218 unitários, 274/274 integrações, 4/4 CRM-29,
77/77 E2E de produção e 1/1 local-only, além de lint, tipos, audit, build,
backup/restore e 43 migrations desde zero. A validação não eleva o canal a
sandbox ou provider externo.

## Calendário — CRM-47

A prontidão local inclui profile por workspace, link Meeting/evento, sync nos
dois sentidos, inbox/outbox, runs/cursors, worker PostgreSQL, retry/dead-letter,
callback local assinado, conflito explícito, resolução humana, RBAC, auditoria,
UI e backfill conservador. `Meeting` e `MeetingHistory` continuam oficiais.

A prontidão externa é **adiada e não validada**. Nenhum provider, OAuth, conta,
credencial, webhook público, egress, calendário remoto ou banco remoto foi
usado. Os gates externos estão descritos em
[`CALENDAR_CHANNEL.md`](./CALENDAR_CHANNEL.md).

O gate local aprovou 226/226 unitários, 283/283 integrações, 4/4 CRM-29,
79/79 E2E de produção e 2/2 local-only, além de lint, tipos, audit, build,
backup/restore e 44 migrations desde zero. O `public` permaneceu íntegro, o
backfill deixou 80 reuniões em revisão explícita e nenhum link externo foi
inventado. Essa validação não equivale a homologação com provider real.

## Conectores Ads locais — CRM-40 e CRM-41

Meta Ads e Google Ads possuem contratos, RBAC, configuração por referência,
persistência, idempotência, cursor e falha controlada validados por fixtures. A
CRM-41 acrescenta hierarquia manager/customer, templates GAQL, custo em micros,
métricas provider separadas e múltiplos assets. Isso não equivale a homologação:
as validações externas foram adiadas e estão em
[`EXTERNAL_VALIDATIONS.md`](./EXTERNAL_VALIDATIONS.md). Nenhuma credencial,
conta real, egress, banco remoto ou deploy integrou esses gates.

## Revisão visual posterior — DESIGN-07

A prontidão visual local foi ampliada em 11 de setembro de 2026. Superfícies,
cabeçalhos, indicadores, badges, vazios, tabelas e feedback foram consolidados
nas telas operacionais e administrativas. O QA automatizado verificou 15 rotas
em cinco resoluções (75 combinações), capturas de 1440×900 e 390×844, navegação
por teclado, nomes acessíveis, controles rotulados, IDs, overflow, movimento
reduzido e refluxo equivalente a zoom de 200%.

O gate final dessa revisão aprovou 127/127 unitários, 198/198 integrações,
53/53 E2E em produção, 1/1 E2E local, lint, tipos e build. Isso melhora a
consistência demonstrável do MVP local, mas não substitui pesquisa com SDRs e
closers, teste multibrowser ou auditoria independente de acessibilidade.

## IA governada local — CRM-59

A prontidão local agora inclui casos de uso versionados e imutáveis após
publicação, allowlist e redação antes do adapter, proveniência por execução,
fallback determinístico, decisões humanas append-only, avaliações reproduzíveis
e observabilidade protegida por RBAC. O runtime padrão permanece sem chave e sem
rede, usando exclusivamente o `MockAIProvider`.

Isso não representa homologação de IA externa. Provider, modelo, credencial,
residência de dados, DPA, custo real, egress e SLO de produção continuam não
validados e exigem autorização e revisão próprias antes de qualquer ativação.

## Checklist de aceite observado

| Item | Implementado | Testado | Observação |
|---|:---:|:---:|---|
| Login com diferentes usuários | Sim | Sim | oito contas no E2E |
| Entrada simulada e distribuição | Sim | Sim | serviço único, SDR e Fila Geral |
| SLA em segundos e prioridade explicada | Sim | Sim | timestamps e score persistidos |
| Trabalho do lead, PACTO e atividades | Sim | Sim | fluxo principal e alternativos |
| Reunião e contexto do closer | Sim | Sim | agenda, briefing, show/no-show |
| Oportunidade, ganho e perda | Sim | Sim | integração e E2E |
| Dashboard e drilldown | Sim | Sim | reconciliação automatizada |
| IA simulada e confirmação humana | Sim | Sim | provider local e revisão parcial |
| Auditoria e permissões | Sim | Sim | API, interface e matriz de acesso |
| Reinício sem perda | Sim | Sim | 338 leads e 52 oportunidades antes/depois |
| Seed sem duplicação | Sim | Sim | 4/4 testes dedicados |
| Deploy/produção | Não | Não | explicitamente fora do escopo |

## Contratos comerciais — CRM-48

Concluído e validado localmente: contrato separado de oportunidade/oferta,
snapshots versionados e imutáveis, HTML imprimível com hash, aceite manual,
RBAC, auditoria, métricas e backfill conservador. O gate aprovou 229 unitários,
287 integrações, 4 CRM-29, 81 E2E de produção e 2 local-only, além de lint,
typecheck, audit e build. Não inclui assinatura eletrônica, revisão jurídica
homologada, provider, egress, credencial, banco remoto ou deploy.

## Handoff e onboarding — CRM-51

O fluxo operacional local separa oportunidade ganha, contrato aceito, envio,
aceite, ativação e conclusão. Templates e marcos são versionados; a evidência,
owner, próxima ação, prazo, histórico append-only, RBAC e backfill conservador
estão implementados. A validação aprovou 237 unitários, 297 integrações, 4
CRM-29, 85 E2E de produção e 3 local-only, além de lint, typecheck, audit,
build, backup/restore, 50 migrations desde zero, QA 1440×900/390×844 e zero
schema temporário residual. Provisionamento externo, ERP, contabilidade, help
desk, provider, credencial, egress, banco remoto e deploy permanecem fora do
escopo.

## Atendimento ao cliente e satisfação — CRM-53

A prontidão local agora inclui solicitações ligadas à conta, owner/fila e
próxima ação explícitos, SLA versionado, primeira resposta e resolução como
fatos persistidos, timeline append-only, CSAT/NPS versionados, RBAC, auditoria,
métricas e backfill conservador. A validação aprovou 245 unitários, 309
integrações, 4 CRM-29, 89 E2E de produção e 3 local-only, além de lint,
typecheck, audit, build, backup/restore, 52 migrations desde zero e QA
1440×900/390×844.

Isso não torna o CRM um help desk/ITSM e não habilita canal real. Convites são
simulados, satisfação não implica causa ou churn e não houve provider,
credencial, egress, banco remoto ou deploy.
