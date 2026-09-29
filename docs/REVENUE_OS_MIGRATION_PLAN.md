# Plano de migração — CRM para Revenue OS

## Regra central

Toda evolução usa `expand → migrate → reconcile → switch → contract`. A fase
`contract` é uma task separada, posterior a observação e rollback comprovados.
Nenhuma CRM pode misturar criação de estrutura, migração destrutiva e remoção
legada no mesmo release.

## Baseline protegido

- branch `main` e backup privado do código inaugurados na PROD-01;
- backup local validado do schema `public` antes de qualquer nova migration;
- 23 diretórios de migration e 24 registros históricos preservados;
- IDs de Workspace, Actor, Lead, Opportunity, Activity e AuditLog imutáveis;
- 82 schemas legados sem evidência permanecem fora do escopo;
- testes usam apenas `politizai_test_*` efêmero e limpeza em `finally`.

Cada task futura inicia com Git limpo, `pnpm db:status`, fingerprint das tabelas
afetadas, backup proporcional e confirmação da dependência anterior.

## Padrão por mudança

### 1. Expand

- criar tabelas, enums e colunas aditivas;
- novos FKs começam opcionais quando o backfill ainda não existe;
- criar índices sem bloquear desnecessariamente e medir impacto;
- escrever serviços novos atrás de flag do workspace;
- manter API e projeção antigas funcionando.

### 2. Migrate

- backfill idempotente em lotes com cursor persistido;
- mapear origem e versão da regra;
- nunca escolher duplicata ambígua automaticamente;
- registrar conflito em data quality/merge review;
- manter contagens antes/depois e amostra de IDs.

### 3. Reconcile

- comparar projeção antiga e nova por workspace;
- medir cobertura, divergência, nulos e duplicatas;
- executar shadow read e, quando necessário, dual write controlado;
- bloquear switch se o denominador ou a amostra não estiver explícito.

### 4. Switch

- trocar leitura por feature flag e workspace piloto;
- manter rollback sem restaurar dump;
- monitorar erros, latência e divergência;
- registrar início/fim e commit exato.

### 5. Contract

- somente após janela de observação definida;
- nova autorização, backup e restore rehearsal;
- remover compatibilidade obsoleta em migration própria;
- nunca apagar histórico ou external mapping necessário.

## Ondas planejadas

### Onda A — identidade e conta

1. **CRM-33 concluída:** Contact/ContactPoint, reviews e controle persistido de backfill;
2. **CRM-33 concluída:** `Lead.contactId` e `LeadFormSubmission.contactId` opcionais;
3. **CRM-33 concluída:** backfill determinístico por Lead e workspace operacional;
4. **CRM-33 concluída:** colisões viram review, sem merge;
5. **CRM-33 concluída:** dual write entrada de lead → ContactPoint + campos legados;
6. **CRM-33 concluída:** leitura autorizada no Lead 360 e reconciliação;
7. **futuro/CRM-34:** criar Account e vínculos; organização textual só gera candidato;
8. **futuro:** adicionar vínculos opcionais em Opportunity/Meeting/Activity.

Rollback: desligar a leitura nova; campos atuais continuam íntegros. Contract de
campos de identidade do Lead não faz parte da onda inicial.

### Onda B — lifecycle, ownership e privacidade

Lifecycle e ownership foram implementados na CRM-35 com projeções, históricos,
transferências e backfill conservador. O backfill deriva somente estados inequívocos dos
eventos atuais; casos ambíguos ficam `UNKNOWN`/issue. Opt-out atual gera evento
de consentimento correspondente, mas ausência de opt-out não vira consentimento.
Privacidade e consentimento continuam reservados à CRM-36.

### Onda C — integração e marketing

Criar connection/sync/mapping/inbox/outbox antes de qualquer provider. Ligar
LeadSource/Campaign/Creative atuais às dimensões novas. Touchpoints antigos só
são gerados quando submissão/payload possui evidência; não fabricar sessão,
click ID ou custo. Atribuição histórica começa com cobertura declarada.

### Onda D — comunicação

Expandir Conversation/Message/Meeting com IDs externos opcionais. Primeiro
modo é sandbox/read-only; envio exige consent purpose, template/policy e
idempotência. Activity continua timeline oficial.

### Onda E — contrato e receita

Criar Contract/Subscription/RevenueMovement sem alterar ganho atual. Backfill
de oportunidade ganha pode criar candidato a contrato, nunca contrato assinado
ou pagamento. MRR/TCV atuais permanecem métricas comerciais até reconciliação.

### Onda F — pós-venda

Evoluir CustomerHandoff para onboarding; depois CS, satisfação, renovação,
expansão e churn. Ganhos antigos geram handoff candidato apenas quando existe
owner/dado suficiente. Churn não é inferido por inatividade.

### Onda G — planejamento, métricas e superfícies

Metas/quotas/forecast entram com snapshots antes dos dashboards. A camada de
métricas expande definições e reconcilia atuais. Superfícies por função só
consomem contratos estáveis da camada única.

### Onda H — governança e readiness

Data quality, IA real, n8n, observabilidade, segurança, restore e carga são
validados antes de homologação. Produção exige autorização separada.

## Estratégias específicas de compatibilidade

| Estado atual | Expansão | Regra de compatibilidade |
|---|---|---|
| dados pessoais em `Lead` | Contact/ContactPoint | dual write; Lead permanece legível |
| `organization` texto | Account | vínculo opcional; sem criação/merge cego |
| LeadSource/Campaign/Creative | marketing hierarchy | IDs atuais preservados por bridge |
| LeadFormSubmission | form/session/touchpoint | submissão segue imutável; links aditivos |
| Conversation/Message | omnichannel | provider fields opcionais; simulated continua válido |
| Meeting | calendário externo | Meeting é oficial; mapping externo não substitui |
| Offer/Opportunity | Contract | ganho não cria assinatura/pagamento por inferência |
| MRR/TCV em Opportunity | revenue ledger | métricas distinguem vendido de contratado/ativo/recebido |
| CustomerHandoff | onboarding | relação preservada e expandida |
| WebhookEvent | WebhookInbox | bridge/migração com idempotência; não apagar payload histórico |
| Job/AutomationRun | sync/outbox jobs | infraestrutura reutilizada com tipos novos |
| AIInsight | IA governada | provenance atual preservada; provider externo é novo modo |
| AuditLog/StageHistory/Activity | novos eventos | continuam fontes históricas, sem reescrita |

## Backfill e controle operacional

Cada backfill terá:

- ID da execução, versão, workspace e commit;
- filtro e total elegível;
- cursor e batch size;
- dry-run com contagens;
- chave idempotente por registro/regra;
- erros categorizados, retry limitado e dead-letter;
- relatório de criados, ligados, divergentes e ignorados;
- verificação de amostra de IDs e checksums;
- opção de pausa sem perder cursor.

Não se usa JSON como atalho para adiar modelagem de campos medidos. Não se roda
backfill em todos os workspaces sem limite, lock e plano de impacto.

### Evidência da CRM-33

No workspace operacional `politizai`, o dry-run persistido identificou 472 Leads
e não criou registros. A execução criou 472 Contacts, 832 ContactPoints, ligou
472 Leads e 518 submissões e abriu 157 reviews de valores compartilhados, com
zero item ignorado ou falho. A repetição usou o mesmo run concluído e processou
zero lotes adicionais. Os 48 Leads ativos de workspaces históricos de teste
ficaram deliberadamente fora do escopo autenticado; nenhum backfill global foi
executado. Os IDs e contagens históricas foram reconciliados sem alteração.

## Testes por migration

- aplicação em banco vazio e cópia sanitizada;
- upgrade do último schema suportado;
- reexecução do backfill sem duplicar;
- isolamento cross-workspace e constraints compostas;
- concorrência de entrada/sync;
- rollback por feature flag;
- queries e índices dos principais recortes;
- preservação de IDs, contagens e eventos;
- restore rehearsal quando houver contract ou dado crítico.

## Critérios de parada

Parar a migration se houver divergência de workspace, colisão não explicada,
queda de contagem, perda de vínculo histórico, lock excessivo, aumento anormal
de erro ou impossibilidade de rollback. Corrigir a causa em task autorizada; não
continuar para a onda seguinte.

## PROD-01

O lifecycle de schemas efêmeros, `.gitignore`, backup e repositório privado são
pré-condições permanentes. Nenhuma migration futura pode incluir `.backups`,
usar os 82 schemas preservados, remover o volume, apontar testes a banco remoto
ou reconstruir `public` destrutivamente.

## Onda CRM-34 — contas

1. aplicar `20260912020000_canonical_accounts` primeiro em schema efêmero;
2. reconciliar IDs e contagens do `public` antes/depois;
3. executar o seed estrutural idempotente;
4. rodar `pnpm db:accounts:backfill -- --mode=dry-run`;
5. executar o mesmo comando com `--mode=execute` somente no banco local;
6. repetir a execução e exigir zero nova review;
7. manter todos os `organizationName` legados e os vínculos históricos.

O backfill cria somente revisões e candidatos. A decisão de criar conta,
vincular conta existente, manter sem vínculo ou descartar é humana, auditada e
reversível por novo evento. Nenhum contrato de schema legado foi autorizado.
