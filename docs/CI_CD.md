# CI/CD do CRM Politizai

## Escopo e invariantes

A PROD-04 cria gates de integração contínua e um gate manual de release, mas
**não faz deployment**. Push e pull request usam somente um PostgreSQL efêmero
do próprio job. Nenhum workflow recebe secrets de staging ou produção, aplica
migration remota, cria recurso externo ou publica aplicação.

Invariantes:

- Node `22.22.0`, pnpm `11.14.0` e lockfile congelado;
- actions de terceiros referenciadas por commit imutável;
- heap Node limitado a 4 GiB para comportar o typecheck estrito no runner sem
  consumir toda a memória disponível;
- `permissions: contents: read` e checkout sem credencial persistida;
- banco `politizai_crm` local ao runner e descartado com o service container;
- schemas internos dos testes com nome controlado e remoção em `finally`;
- `KEEP_TEST_SCHEMA=0` obrigatório no CI;
- build Next.js executado com Webpack pelo script canônico do projeto;
- relatórios contêm metadados e status, nunca valores de ambiente;
- artefato de evidência retido por 14 dias; não é um artefato de deployment.

## Workflow `CI`

`.github/workflows/ci.yml` roda em push para `main`, pull request contra `main`
e como workflow reutilizável. A ordem é deliberadamente bloqueante:

1. checkout do SHA sob teste;
2. instalação determinística com `pnpm install --frozen-lockfile`;
3. política local de segredos e artefatos;
4. `prisma generate`;
5. todas as migrations desde zero no PostgreSQL efêmero;
6. lint;
7. `next typegen` e TypeScript;
8. unitários;
9. integrações críticas de modelo, autenticação, lead, distribuição,
   oportunidade e métricas em schema isolado;
10. auditoria de dependências com severidade alta como limite;
11. build Next.js com Webpack;
12. smoke do artefato compilado: liveness, readiness/banco, login, CSP e
    headers;
13. SBOM em SPDX JSON;
14. limpeza defensiva, relatório e upload de evidência, inclusive em falha.

Uma falha interrompe os gates seguintes e deixa o resultado do job como falha.
Os passos `always()` não convertem a execução em sucesso: servem somente para
limpeza e preservação da evidência do bloqueio.

## Banco e schemas efêmeros

O PostgreSQL é um service container `postgres:17.10-alpine`, acessível apenas
no runner. A cadeia principal de migrations usa o schema vazio `public` desse
container. As integrações usam `createEphemeralTestSchema`, prefixo
`politizai_test_integration_`, regex restritiva e `try/finally`.

O próprio GitHub Actions remove o service container ao encerrar o job, inclusive
em cancelamento/falha. Quando as dependências chegaram a ser instaladas, o passo
defensivo também executa:

```bash
pnpm db:test:cleanup -- --confirm=DROP_LOCAL_TEST_SCHEMAS
```

Esse comando só aceita o banco local conhecido e nunca remove `public`.

## Gate manual de release

`.github/workflows/release-gate.yml` recebe obrigatoriamente um SHA completo de
40 caracteres. Antes de carregar o código alvo, valida formato e existência do
commit no próprio repositório. Depois chama o mesmo workflow `CI` com o SHA
imutável. Ele:

- não aplica migrations fora do service container;
- não usa ambientes GitHub de staging/produção;
- não recebe secrets;
- não chama Vercel, Neon ou Fly.io;
- não cria release, tag ou deployment;
- produz relatório `APPROVED` ou `BLOCKED` e SBOM para inspeção humana.

Executar manualmente no GitHub não autoriza publicação. O SHA aprovado deve ser
reutilizado por uma tarefa futura explicitamente autorizada.

## Execução local proporcional

```bash
pnpm install --frozen-lockfile
pnpm security:scan
pnpm db:generate
pnpm db:migrate:deploy
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration -- tests/integration/relational-model.integration.test.ts tests/integration/auth-rbac.integration.test.ts tests/integration/lead-intake.integration.test.ts tests/integration/lead-distribution.integration.test.ts tests/integration/opportunities-sales.integration.test.ts tests/integration/metrics.integration.test.ts
pnpm audit --audit-level=high
pnpm build
pnpm ci:smoke
```

O smoke exige build existente e PostgreSQL local pronto. O relatório local pode
ser produzido com `pnpm release:report`; `.cache/` é ignorado pelo Git.

## Proteção de `main`

O proprietário autenticado possui acesso `ADMIN`, porém a API do GitHub
respondeu `403` ao consultar rulesets e branch protection: o plano pessoal
atual não oferece essas proteções para este repositório privado. O repositório
permaneceu privado; nenhuma proteção foi declarada como aplicada.

Após contratar GitHub Pro ou transferir o repositório para organização Team ou
Enterprise, criar um ruleset ativo para a branch padrão com:

- exclusão e force-push bloqueados;
- histórico linear;
- pull request obrigatório;
- conversa resolvida antes do merge;
- check obrigatório `CI / Quality gate`, exigindo branch atualizada;
- bypass restrito a break-glass auditável, sem uso rotineiro.

Para uma operação individual, definir aprovador externo antes de exigir
aprovação de PR; uma regra impossível de satisfazer não deve bloquear correções
de incidente.

## Evidência remota

A primeira execução integral bem-sucedida foi a
[CI 34855726325](https://github.com/Menddon/crm-politizai/actions/runs/34855726325),
no commit `5cb770303b6ccad408cc9445a10d8a81dd5e95db`, em 6m41s. O artefato privado
`release-evidence-34855726325-1` tem ID `10353311278`, relatório `APPROVED` e
SBOM SPDX 2.3 com 751 pacotes inventariados.

A tentativa anterior, CI `34855240497`, bloqueou corretamente o release quando
o `tsc` atingiu o heap padrão de aproximadamente 2 GiB (`exit 134`). O relatório
foi emitido como `BLOCKED`, a limpeza encontrou zero schema residual e nenhum
passo posterior de teste/build foi executado. O workflow passou então a limitar
o heap a 4 GiB; não houve mudança de regra ou redução de cobertura.
