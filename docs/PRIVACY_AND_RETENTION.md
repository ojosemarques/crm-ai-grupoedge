# Privacidade, consentimento e retenção

## Escopo da CRM-36

Esta fundação local separa identidade, preferência operacional, consentimento,
base legal, finalidade, retenção e solicitações do titular. Ela **não é parecer
jurídico**. As versões seedadas permanecem `PENDING_LEGAL` e não autorizam
integração ou contato real.

## Decisão prática

`PrivacyDecisionService` avalia sempre dentro do workspace e recebe Lead,
finalidade, canal e ação pretendida. O resultado é um dos seguintes:

- `ALLOW`: somente quando há concessão comprovada, finalidade `ACTIVE` e base
  legal `ACTIVE`;
- `DENY`: opt-out, revogação, negativa explícita ou `doNotContact`;
- `REVIEW_REQUIRED`: ausência de evidência, sinal legado ou configuração não
  aprovada.

`REVIEW_REQUIRED` nunca é gravado como autorização. No ambiente local ele
permite apenas registrar fatos internos e produzir simulações explicitamente
marcadas; integrações futuras deverão exigir `ALLOW`. `DENY` bloqueia tentativa
humana e suprime mensagens simuladas. Entrada, atividades, automações e IA usam
a mesma decisão central.

Na CRM-38, a finalidade `marketing-attribution-analytics` e sua base técnica
também nascem `PENDING_LEGAL`. UTM minimizada e referências relacionais podem
ser preservadas como fato local sob `REVIEW_REQUIRED`, mas o touchpoint fica
inelegível para crédito. Referrer é reduzido a hostname/path e click ID somente
ao tipo + SHA-256. IP, user agent, cookie bruto e click ID aberto não são
persistidos. Isso não afirma base legal nem autoriza pixel, provider ou egress.

## Consentimento

`ConsentEvent` é append-only e guarda finalidade/versionamento, canal, ponto de
contato, ação, efeito, origem, instante, evidência, ator e chave idempotente.
Correções criam outro evento referenciando o anterior. `ConsentState` é somente
a projeção corrente e determinística; a história continua nos eventos.

Precedência conservadora:

- `DO_NOT_CONTACT` legado → `OPTED_OUT`;
- `NOT_CONSENTED` → `DENIED`;
- `CONSENTED` sem prova → `REVIEW_REQUIRED`;
- `UNKNOWN` → ausência de autorização;
- `REVOKED` e `OPTED_OUT` não são rebaixados por novo sinal comum.

Um mesmo Contact pode ter estados independentes por finalidade, canal e ponto
de contato. Índices únicos parciais evitam projeções concorrentes duplicadas.

## Finalidades, bases e categorias

`ProcessingPurpose`, `PurposeVersion`, `LegalBasis` e `DataCategory` são
relacionais e pertencem ao workspace. Versões aprovadas/ativas/encerradas são
imutáveis no banco. Status `APPROVED` ou `ACTIVE` exige ator, instante e, para a
base, referência de aprovação. O seed cria somente o template técnico
`legacy-commercial-contact` em `PENDING_LEGAL`.

## Retenção e legal hold

`RetentionPolicyVersion` relaciona finalidade, base e categorias. Previews
geram `RetentionAction` auditada. A versão inicial executa apenas `REVIEW` e não
apaga dados. Política pendente, legal hold ativo e ausência de aprovação humana
geram bloqueadores explícitos. Nenhum histórico comercial é removido.

`LegalHold` pode limitar-se ao Contact, solicitação ou categoria e impede ação
de retenção enquanto ativo. O motivo e a referência de autoridade são
obrigatórios; não se armazena documento bruto.

## Direitos do titular

`DataSubjectRequest` representa acesso, correção, portabilidade, oposição,
revogação ou eliminação. Toda solicitação possui exatamente um responsável ou a
Fila Geral. A máquina de estados exige verificação de identidade antes de
`IN_REVIEW`; a referência guardada deve ser minimizada. Exportação exige
permissão específica e identidade verificada, tem validade informada de 15
minutos e exclui hashes, sessões, segredos e dados de terceiros.

## Backfill local

```bash
pnpm db:privacy:backfill -- --mode=dry-run
pnpm db:privacy:backfill -- --mode=execute
```

O comando recusa produção, host remoto, banco diferente de `politizai_crm` e
schema diferente de `public`. Usa lock por workspace, eventos idempotentes e
itens por execução. Repetir a execução reconhece o estado já reconciliado e não
cria novo evento. O dry-run não altera consentimentos.

## Superfícies locais

- `/privacidade`: resumo, finalidade/base pendente, DSRs, retenção, legal holds
  e eventos recentes;
- `/leads/[leadId]/historico`: indicador prático por Lead;
- `/api/privacy/*`: Route Handlers finos, autenticados, same-origin nas
  mutações e sem cache;
- auditoria: ações `privacy.*` com ator e entidade.

## Decisões jurídicas pendentes

Antes de ativar qualquer versão é obrigatório validar com responsável jurídico:
base legal, texto de aviso, categorias necessárias, prazo de retenção, canal,
procedimento de prova, prazo de DSR e política de eliminação/anonimização. O CRM
não transforma essa validação em credencial nem afirma conformidade legal.

## Minimização no sandbox n8n — CRM-60

O feed local publica somente tipos e versões allowlisted. Antes da serialização,
remove campos de telefone, e-mail, documento, cookie, token, senha, segredo e
autorização; strings com padrão de credencial também são redigidas. Consultas
por ID retornam DTO mínimo no workspace da identidade, sem payload bruto.

Ativação futura exige finalidade, base legal, DPA, retenção, secret manager e
homologação específicos. A simulação local não cria autorização de tratamento,
não transmite dado e não altera regras de opt-out ou consentimento.
