# Plano de execução de produção — PROD-03 em diante

## Regra de controle

Este plano é uma sequência futura, não uma autorização. Cada task começa
somente após comando explícito do usuário, depende da anterior concluída e deve
parar ao final. Nenhum recurso externo foi criado pela PROD-02.

Invariantes permanentes:

- staging e produção nunca compartilham projeto, banco, worker ou segredo;
- web e worker de uma release usam o mesmo commit;
- migrations rodam uma vez em runner protegido, nunca no build concorrente;
- nenhuma credencial ou valor sensível aparece em Git, log ou relatório;
- nenhum seed demonstrativo entra em produção;
- `public` não é apagado e mudança destrutiva exige plano separado;
- provider externo, egress, dado real e cobrança exigem autorização específica;
- rollback de aplicação não substitui restore validado de dados.

## Sequência exata

### PROD-03 — hardening local para a topologia escolhida

**Mudança externa/cobrança:** não.

**Status:** concluída e validada localmente, sem recurso externo.

Preparado localmente:

- contratos `DATABASE_URL` pooled e `DIRECT_URL` exclusivo de migration;
- guardas cloud-safe por ambiente/host/banco e revisão do preflight;
- configuração Vercel `gru1`, Node 22, pnpm 11 e build Webpack;
- inventário de secrets sem valores, sessão/cookies e origins explícitos;
- liveness/readiness separados, CSP e headers de segurança;
- bootstrap administrativo CLI-only, transacional e auditável.

Dockerfile/arquivo Fly, workflow remoto de migrations, artefato assinado e
runbooks operacionais de infraestrutura permanecem gates das próximas etapas;
a PROD-03 não autorizou worker remoto nem recursos.

Aceite: gates locais passam, artefatos não contêm segredo, nenhum host remoto é
contatado e o diff corresponde somente à preparação aprovada.

### PROD-04 — CI/CD, supply chain e gates de release

**Mudança externa/cobrança:** configuração do repositório GitHub e consumo
normal de Actions; nenhum recurso de aplicação, banco ou deploy.

- CI com PostgreSQL efêmero, migrations desde zero, lint, tipos, testes, audit,
  build Webpack e smoke;
- scanner versionável sem eco de segredo;
- SBOM SPDX e relatório de gate;
- gate manual por SHA completo sem deployment ou migration remota;
- Dependabot semanal e alertas compatíveis com o plano;
- proteção de `main` documentada, pois o plano privado atual retorna `403`.

Aceite: execução verde no commit da task, schemas descartados, evidência
publicada como artefato interno e nenhum acesso a staging/produção.

### PROD-05 — contratar e provisionar staging

**Mudança externa/cobrança:** sim.

Com autorização de cobrança:

- confirmar/contratar Vercel Pro;
- criar `crm-politizai-staging` em `gru1` ligado ao GitHub privado;
- criar `crm-politizai-staging-db` Neon Launch em `sa-east-1`;
- criar `crm-politizai-worker-staging` Fly em `gru`;
- configurar identidades, budgets, proteção, secrets exclusivos e alertas;
- não criar produção.

Aceite: inventário sem valores, isolamento demonstrado, cobrança aprovada e
nenhum dado de produção presente.

### PROD-06 — migration e deployment de staging

**Mudança externa/cobrança:** sim; usa os recursos de staging.

- aplicar 59+ migrations via `DIRECT_URL` e identidade de migration;
- usar seed exclusivamente estrutural/fictício autorizado;
- publicar web e worker do mesmo SHA;
- validar TLS, pooled runtime, readiness, login, RBAC, workspace, jobs e logs;
- registrar URLs sem expor secrets.

Aceite: schema esperado, zero drift, smoke completo, worker sem duplicidade e
staging protegido.

### PROD-07 — homologação operacional de staging

**Mudança externa/cobrança:** sim; pode elevar uso.

- carga e soak com perfil representativo;
- concorrência/restart/overlap do worker e backlog/dead-letter;
- testes de pool, timeout, falha de banco e recuperação;
- snapshot, `pg_dump`, restore isolado e reconciliação;
- validação de observabilidade, alertas, SLO, RPO/RTO e runbooks;
- segurança, RBAC, browsers, acessibilidade e operação humana.

Aceite: relatório go/no-go de staging e custos medidos. Falha mantém produção
bloqueada.

### PROD-08 — contratar e provisionar produção

**Mudança externa/cobrança:** sim, alta sensibilidade.

- criar `crm-politizai`, `crm-politizai-production-db` e
  `crm-politizai-worker-production` separados;
- configurar domínio/DNS somente com autorização específica;
- configurar secrets, identidades mínimas, budgets, proteção e alertas;
- habilitar PITR de sete dias, snapshots e destino off-provider;
- não migrar dados nem publicar a aplicação até o gate seguinte.

Aceite: isolamento e inventário verificados, rollback de configuração possível,
nenhuma credencial exibida.

### PROD-09 — ensaio final e congelamento da release

**Mudança externa/cobrança:** sim; sem cutover público.

- decidir se produção inicia vazia ou recebe migração autorizada;
- congelar commit, migrations, artefatos, owners e janela;
- executar backup e restore recente;
- ensaiar expand/contract, smoke, rollback e comunicação;
- concluir jurídico/DPO, segurança e checklist de dados reais;
- emitir decisão formal go/no-go.

Aceite: todos os itens obrigatórios de `GO_LIVE_CHECKLIST.md` têm responsável,
evidência e aprovação. NO-GO encerra a task sem cutover.

### PROD-10 — cutover de produção

**Mudança externa/cobrança:** sim; ação externa crítica.

- confirmar autorização nominal da janela;
- snapshot/dump e checksum pré-mudança;
- aplicar migrations uma única vez;
- publicar web e worker do mesmo commit;
- associar domínio, executar smoke e observar SLO/pool/jobs;
- reverter conforme runbook ao ultrapassar o limite de erro.

Aceite: negócio, segurança, privacidade e operação aprovam; contagens e
fingerprints reconciliam; nenhum secret aparece no relatório.

### PROD-11 — hypercare e fechamento

**Mudança externa/cobrança:** sim; operação do ambiente real.

- monitorar incidentes, custos, pool, backlog e feedback dos papéis;
- provar o próximo backup e restore isolado;
- confirmar rotação, on-call e acesso mínimo;
- registrar riscos aceitos, correções e custo real;
- decidir encerramento de hypercare.

Aceite: SLO/RPO/RTO e custo real documentados, incidentes resolvidos ou com
owner, e prontidão operacional formalmente aceita.

## Matriz de autorização

| Task | Código/repositório | Recurso externo | Pode cobrar | Banco remoto | Deploy |
|---|---|---|---|---|---|
| PROD-03 | sim | não | não | não | não |
| PROD-04 | CI e GitHub | Actions/Dependabot | consumo do plano | não | não |
| PROD-05 | inventário | cria staging | sim | cria, sem dados | não |
| PROD-06 | sim | altera staging | sim | sim, staging | sim, staging |
| PROD-07 | testes/runbooks | usa staging | sim | sim, staging | possível redeploy staging |
| PROD-08 | inventário | cria produção | sim | cria, sem dados | não |
| PROD-09 | freeze/ensaio | usa ambientes | sim | sim, controlado | ensaio/staging |
| PROD-10 | release | altera produção | sim | sim, produção | sim, produção |
| PROD-11 | relatório/correções autorizadas | opera produção | sim | sim | somente se aprovado |

## Gates humanos

Antes da primeira criação externa:

- billing owner autoriza plano, orçamento e cartão;
- proprietário GitHub/Vercel confirma organização e acessos;
- responsável DNS confirma domínio;
- segurança aprova secret manager, identidades e proteção;
- DPO/jurídico aprova finalidade, retenção e dados reais;
- operação nomeia release, migration, rollback e incident owners;
- negócio aprova RPO, RTO, janela e universo inicial de dados.

## Referências

- [Decisão de arquitetura](./CLOUD_ARCHITECTURE_DECISION.md)
- [Custos e limites](./CLOUD_COSTS_AND_LIMITS.md)
- [Prontidão para produção](./PRODUCTION_READINESS.md)
- [Checklist de go-live](./GO_LIVE_CHECKLIST.md)
- [Relatório de aceite](./ACCEPTANCE_REPORT.md)
- [Plano futuro anterior](./DEPLOYMENT_FUTURE.md)
