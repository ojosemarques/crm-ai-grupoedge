# Auditoria preliminar histórica anterior à PROD-13 atual

> Este documento registra a auditoria de 14 de setembro de 2026, anterior à
> criação da infraestrutura e ao release candidate fechado. A decisão atual da
> PROD-13 está em
> [`PROD13_FINAL_GO_NO_GO.md`](./PROD13_FINAL_GO_NO_GO.md).

## Decisão executiva

**NO-GO para operação real.** O código possui evidência local e de CI suficiente
para continuar a preparação, mas não existe ambiente de staging ou produção
provisionado, publicado ou homologado. Consequentemente, não há evidência
remota para banco gerenciado, deployment, worker, backup/PITR, restore,
observabilidade, proteção de borda ou rollback.

Esta decisão foi emitida em 14 de setembro de 2026 e não autoriza PROD-14,
deploy, migration remota, DNS, egress, provider externo ou uso de dados reais.

## Commit e escopo auditados

- release candidate técnico auditado: `53e1e1252282bdedd35bffbd9087026743e72132`;
- repositório: `Menddon/crm-politizai`, privado, branch `main`;
- CI do SHA: execução `34856733334`, concluída com sucesso;
- gate manual do SHA: execução `34856766713`, tentativa 2 concluída com
  sucesso e SBOM SPDX 2.3;
- deployments registrados no GitHub para o repositório: zero;
- `.vercel` no checkout: ausente;
- relatórios de staging, deployment de staging, aceite de staging e release
  candidate de produção: ausentes.

O commit criado para registrar esta auditoria altera somente documentação. Ele
não substitui o SHA técnico acima nem representa um release publicado.

## Inventário de recursos

| Recurso | Estado verificável | Resultado |
|---|---|---|
| GitHub privado | presente; CI e gate manual verdes | PASS |
| Vercel staging | não provisionado | BLOCKED |
| Neon staging | não provisionado; autenticação não disponível | BLOCKED |
| Fly.io worker staging | não provisionado | BLOCKED |
| Vercel produção | não provisionado | BLOCKED |
| Neon produção | não provisionado | BLOCKED |
| Fly.io worker produção | não provisionado | BLOCKED |
| domínio/DNS | somente arquitetura proposta; nenhuma associação | BLOCKED |
| providers comerciais | configuração local desativada/simulada; nenhum egress | PASS |

## Matriz de evidências

`PASS` significa somente que a evidência indicada existe no escopo declarado.
Não converte validação local em aprovação de produção.

| Área | Estado | Severidade | Evidência | Condição para aprovação |
|---|---|---:|---|---|
| Commit, CI e supply chain | PASS | — | CI `34856733334`; gate `34856766713`; scanner e SBOM | fixar o mesmo SHA na promoção futura |
| Deployment e configuração remota | BLOCKED | crítica | nenhum deployment e nenhum projeto Vercel do CRM | concluir PROD-05 a PROD-12 |
| Migrations | PASS local / BLOCKED remoto | crítica | 59 migrations desde zero no PostgreSQL efêmero do CI | medir locks/duração e confirmar zero pendência no staging e produção |
| Banco, TLS, pool e privilégios | BLOCKED | crítica | não existe PostgreSQL gerenciado do CRM | provisionar projetos isolados, migrator e runtime mínimo |
| Backup, PITR e restore | BLOCKED | crítica | restore somente local na CRM-63 | habilitar política remota e comprovar restore isolado recente |
| Rollback da aplicação e dados | BLOCKED | crítica | runbook proposto, sem deployment ou restore remoto | ensaiar rollback web/worker e recuperação isolada |
| Web e worker | BLOCKED | crítica | código local; Vercel e Fly.io ausentes | homologar o mesmo SHA, concorrência, reinício e shutdown |
| Liveness e readiness | PASS local / BLOCKED remoto | alta | smoke local aprovado | medir por HTTPS contra web, banco e worker de staging |
| SLO, alertas e plantão | BLOCKED | alta | catálogo local; sem telemetria central ou on-call | configurar painéis, destinos, thresholds e responsáveis |
| Logs e redaction | PASS local / BLOCKED remoto | alta | redaction testada localmente | validar logs reais de web/worker sem conteúdo sensível |
| WAF e rate limit compartilhado | BLOCKED | alta | rate limit ainda em memória; nenhuma borda configurada | homologar coordenação PostgreSQL e proteção de borda |
| Cookies, CSP e HSTS | PASS local / BLOCKED remoto | alta | headers testados; `style-src 'unsafe-inline'` permanece | remover ressalva e validar TLS/HSTS/CSP no host final |
| CSRF, XSS, SSRF, IDOR e CSV | PASS em testes locais / BLOCKED remoto | alta | testes dirigidos e checkpoints CRM-30/62/64 | DAST e pentest no ambiente equivalente |
| Isolamento por workspace e RBAC | PASS local / BLOCKED remoto | crítica | integração e E2E locais anteriores | smoke remoto cross-workspace com identidades sintéticas |
| Identidade administrativa | BLOCKED | crítica | bootstrap seguro existe, mas não foi consumido | nomear pessoa autorizada e executar bootstrap uma única vez |
| MFA/SSO e recuperação | BLOCKED | alta | não implementados/homologados | implementar ou obter aceite formal de risco antes de dados reais |
| LGPD, finalidade e retenção | BLOCKED | crítica | políticas técnicas estão `PENDING_LEGAL` | jurídico/DPO aprovar base, avisos, DPA, retenção e direitos |
| Responsáveis operacionais | BLOCKED | crítica | release, migration, incidente e rollback owners não designados | registrar nomes e substitutos antes da janela |
| Suporte e resposta a incidente | BLOCKED | alta | runbooks locais; sem escala ou plantão | definir canal, horário, escalonamento e comunicação |
| Custos e alertas de orçamento | BLOCKED | alta | estimativas da PROD-02; nenhuma conta de staging/produção | aprovar cobrança, limites e owners financeiros |
| Domínio e DNS | BLOCKED | média | `crm.politizai.com.br` é somente recomendação | confirmar domínio, owner, TTL e rollback de DNS |
| Adapters externos | PASS desativado | — | preflight local rejeita ativação em nuvem sem configuração explícita | manter desativados até homologação individual |
| Credenciais demonstrativas | BLOCKED para produção | crítica | existem somente para uso local; produção não existe | provar ausência no cofre e no banco de produção |
| Cross-browser e acessibilidade | BLOCKED | alta | Chromium local; Firefox/WebKit/leitor de tela pendentes | executar matriz remota e inspeção assistiva |
| Carga, soak, p95 e p99 | BLOCKED | alta | baseline local não representa nuvem | homologar volume esperado, pool, jobs e failover |
| Checklist completo | BLOCKED | crítica | itens obrigatórios permanecem abertos | encerrar cada item com owner, data e evidência |

Não foi observada falha crítica em produção porque produção não existe. A
ausência de evidência é tratada como `BLOCKED`, nunca como aprovação.

## Riscos aceitos

Nenhum risco de produção foi aceito nesta auditoria. As ressalvas de CSP,
rate limit em memória, ausência de MFA/SSO, cobertura somente local e providers
simulados continuam aceitas exclusivamente para desenvolvimento local sem dados
reais.

No tema de proteção de dados, a definição do controlador, do operador e do
encarregado e suas responsabilidades precisa ser aprovada pela organização. A
ANPD também orienta a adoção de medidas administrativas e técnicas de
segurança. Referências: [agentes de tratamento e encarregado](https://www.gov.br/anpd/pt-br/assuntos/noticias/nova-versao-do-guia-dos-agentes-de-tratamento)
e [guia de segurança da informação](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte).

## Responsáveis

| Função | Estado | Exigência |
|---|---|---|
| Release owner | BLOCKED — não designado | aprovar SHA, janela e resultado |
| Migration owner | BLOCKED — não designado | executar e observar migrations |
| Incident commander | BLOCKED — não designado | coordenar resposta e comunicação |
| Rollback owner | BLOCKED — não designado | decidir e executar rollback |
| Jurídico/DPO | BLOCKED — não designado | aprovar tratamento e direitos |
| On-call técnico | BLOCKED — não designado | receber e responder alertas |
| Owner financeiro | BLOCKED — não designado | aprovar orçamento e limites |

## Plano de rollback

O estado atual não requer rollback: nenhum ambiente remoto foi alterado. Na
futura janela, a aplicação deve voltar ao deployment anterior do mesmo ambiente
sem reverter schema automaticamente; o worker deve ser interrompido e retornar
ao commit anterior preservando jobs. Restore de dados só ocorre em destino
isolado, após diagnóstico, reconciliação e decisão conjunta dos owners de
migration, rollback e incidente.

## Ações exatas antes de uma janela de go-live

1. Concluir PROD-05 a PROD-09 e obter `PROD-10 APROVADA` com evidência remota.
2. Provisionar produção na PROD-11 sem publicação e validar isolamento.
3. Executar PROD-12 como release fechado, ainda protegido e sem tráfego real.
4. Nomear todos os responsáveis e obter aprovações jurídica, financeira,
   segurança e privacidade.
5. Fechar cada blocker do `GO_LIVE_CHECKLIST.md` com data, owner e evidência.
6. Reexecutar a auditoria PROD-13 sobre um SHA e recursos concretos.
7. Somente após decisão `GO`, solicitar autorização explícita e separada para
   PROD-14; domínio, DNS e abertura pública ficam fora desta decisão NO-GO.

## Verificações executadas nesta auditoria

| Verificação | Resultado |
|---|---|
| Git limpo e `HEAD == origin/main` no início | PASS |
| CI e gate manual do SHA auditado | PASS |
| inventário GitHub de deployments | PASS: zero |
| `pnpm readiness:preflight` | PASS: `READY_FOR_LOCAL` |
| `pnpm security:scan` | PASS: 963 arquivos rastreados após inclusão do relatório |
| cinco arquivos de testes dirigidos | PASS: 31 testes |
| `pnpm ci:smoke` | PASS: liveness, readiness, banco, login e headers |
| inventário Vercel/Neon/Fly | BLOCKED: recursos não provisionados |

Nenhuma suite histórica completa, migration, seed, deploy, DNS, egress ou
ativação externa foi executada pela PROD-13.
