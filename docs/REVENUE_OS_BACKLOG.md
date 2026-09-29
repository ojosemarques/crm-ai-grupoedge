# Backlog executivo — CRM-33 a CRM-64

## Regra de autorização

CRM-33 a CRM-43 estão concluídas e validadas localmente. Por decisão explícita,
as validações externas das CRM-40, CRM-41 e do geocoding opcional da CRM-42 estão
adiadas; fixtures e gates locais estão aprovados, sem credenciais ou egress.
CRM-44 está concluída e validada localmente, com ativação externa bloqueada por
política e homologação pendentes. CRM-45 está concluída e validada somente com
sink local; domínio e provider externos permanecem adiados. CRM-46 está
concluída e validada somente no simulador local; provider, PSTN e gravação
permanecem adiados. CRM-47 está concluída e validada somente no sandbox local;
provider, OAuth e webhook público permanecem adiados. CRM-48 a CRM-50 estão
concluídas e validadas localmente. A CRM-51 está concluída e validada localmente;
CRM-52 a CRM-64 foram concluídas e validadas localmente. A CRM-64 aprovou
somente homologação local/isolada; produção permanece NO-GO. Novas ações exigem
mensagem explícita, checkpoint, validação proporcional e parada ao final.

## Ordem exata

| ID | Pri. | Entrega | Dependências | Credencial externa | Aceite essencial |
|---|---|---|---|---|---|
| CRM-33 | P0 | Contact e ContactPoint canônicos | CRM-32 | concluída e validada | backfill idempotente, colisões em review, Lead preservado |
| CRM-34 | P0 | Accounts, papéis e comitê de compra | CRM-33 | não | conta/contato N:N, organização legada sem merge cego |
| CRM-35 | P0 | Lifecycle e ownership por função | CRM-34 | não | estado e histórico separados; owner/fila explícitos |
| CRM-36 | P0 | Consentimento, finalidade, base legal e retenção | CRM-33, CRM-35 | concluída; jurídico pendente | opt-out preservado, consent events e política versionada |
| CRM-37 | P0 | Fundação da plataforma de integrações | CRM-36 | concluída e validada | connection/sync/mapping/inbox/outbox seguros, sem provider real |
| CRM-38 | P0 | Touchpoints, sessão, formulário e atribuição versionada | CRM-33, CRM-37 | concluída e validada | evidência/cobertura, sem inventar touchpoint histórico |
| CRM-39 | P0 | Hierarquia de mídia, custo e performance | CRM-38 | concluída localmente | fatos tipados, moeda, granularidade e reconciliação |
| CRM-40 | P1 | Conector Meta Ads somente leitura | CRM-39 | validação externa adiada | implementação/fixtures aprovadas; conta real, rate limit e reconciliação externa pendentes |
| CRM-41 | P1 | Conector Google Ads somente leitura | CRM-39 | validação externa adiada | implementação/fixtures, cursor e reconciliação local aprovados; projeto Cloud/conta real pendentes |
| CRM-42 | P1 | Inteligência geográfica e territórios | CRM-34, CRM-38 | validação externa de geocoding adiada | concluída localmente; dimensões tipadas, evidência explícita, territórios versionados, mapa offline e supressão de pequenos grupos |
| CRM-43 | P0 | Inbox omnichannel e contratos de comunicação | CRM-36, CRM-37 | concluída e validada localmente | Conversation/Message canônicos, consentimento, identidade, ownership, delivery simulado e backfill reconciliados |
| CRM-44 | P1 | WhatsApp — fundação local e fronteira de sandbox | CRM-43 | ativação externa bloqueada | contratos, webhook/worker, janela, template, opt-out, idempotência e status validados localmente; provider não validado |
| CRM-45 | P1 | E-mail em sink local | CRM-43 | validação externa adiada | contratos, threading, retry, bounce/reply/suppression e consentimento validados localmente; domínio/provider reais pendentes |
| CRM-46 | P1 | Telefonia em sandbox | CRM-43 | validação externa adiada | chamada/status/resultado/recording reference nula, privacidade, retry e métricas validados localmente |
| CRM-47 | P1 | Calendário externo em sandbox | CRM-37, CRM-43 | validação externa adiada | Meeting continua oficial; sync bidirecional local, conflitos e backfill conservador |
| CRM-48 | P0 | Contratos e versões comerciais | CRM-34, CRM-35 | assinatura futura opcional | Opportunity/Offer preservados; assinatura e vigência explícitas |
| CRM-49 | P0 | Assinaturas e ledger de receita | CRM-48 | não | movimentos append-only, MRR reproduzível, correção reversora |
| CRM-50 | P1 | Pagamentos em sandbox | CRM-37, CRM-49 | sim | webhook assinado, cobrança/pagamento reconciliados; sem ERP |
| CRM-51 | P0 | Handoff e onboarding | CRM-35, CRM-48 | não | ganho ≠ ativação; marcos, owner e histórico |
| CRM-52 | P0 | Carteira, plano e saúde de Customer Success | CRM-51 | não | regra versionada, evidência e ausência separadas |
| CRM-53 | P1 | Solicitações do cliente e satisfação | CRM-52 | canais opcionais | SLA/CSAT/NPS limitados ao cliente; sem help desk genérico |
| CRM-54 | P0 | Farmer, renovação, expansão, contração e churn | CRM-49, CRM-52 | concluída e validada localmente | eventos confirmados, expansão cria Opportunity rastreável |
| CRM-55 | P0 | Metas e quotas versionadas | CRM-35, CRM-49 | concluída e validada localmente | período/timezone, alvo por pessoa/função/equipe e histórico |
| CRM-56 | P0 | Forecast e snapshots | CRM-54, CRM-55 | concluída e validada localmente | commit/best case/pipeline por corte; sem previsão fictícia |
| CRM-57 | P0 | Camada completa de métricas de receita | CRM-39, CRM-49, CRM-54, CRM-56 | não | fórmulas únicas, coortes, comparativos e drilldowns |
| CRM-58 | P1 | Home por função, Account/Contact 360 e busca global | CRM-42, CRM-43, CRM-52, CRM-57 | não | concluída localmente: ação principal, progressive disclosure, busca server-side e RBAC |
| CRM-59 | P1 | IA governada e avaliações | CRM-36, CRM-37, CRM-57 | externa adiada | concluída localmente: registro versionado, redação, eval, fallback, decisão humana e observabilidade; provider externo desabilitado |
| CRM-60 | P1 | Extensibilidade segura via n8n | CRM-37, CRM-43, CRM-59 | validação externa adiada | concluída localmente: APIs/outbox, machine RBAC, propostas humanas e zero acesso ao banco |
| CRM-61 | P0 | Qualidade de dados, reconciliação e merge governado | CRM-38, CRM-49, CRM-60 | não | concluída localmente: issues, regras, owner/fila/SLA, reconciliação e merge humano reversível |
| CRM-62 | P0 | Observabilidade, segurança e privacidade operacional | CRM-50, CRM-58, CRM-61 | concluída localmente; serviços externos futuros | SLOs, alertas, redaction, DSR, retenção e threat model validados localmente |
| CRM-63 | P0 | Recuperação, concorrência e testes de carga | CRM-62 | concluída e validada localmente | restore, rollback, carga, caos controlado e capacidade com zero schema residual |
| CRM-64 | P0 | Homologação e aceite de prontidão para produção | CRM-63 | concluída e validada localmente | homologação local aprovada; produção NO-GO; nenhum deploy |

## Dependências por trilha

```text
CRM-32
  └─ 33 Identidade
      ├─ 34 Contas ─ 35 Lifecycle ─ 48 Contratos ─ 49 Receita
      │                  ├─ 51 Onboarding ─ 52 CS ─ 53 Atendimento
      │                  └─ 55 Metas
      │                                     49 + 52 ─ 54 Farmer
      │                                     54 + 55 ─ 56 Forecast
      └─ 36 Privacidade ─ 37 Integrações
                         ├─ 38 Atribuição ─ 39 Mídia ─ 40/41 Ads
                         ├─ 43 Inbox ─ 44/45/46 Canais
                         ├─ 47 Calendário
                         └─ 50 Pagamentos (após 49)

39 + 49 + 54 + 56 ─ 57 Métricas
42 + 43 + 52 + 57 ─ 58 UX por função
36 + 37 + 57 ─ 59 IA real ─ 60 n8n
38 + 49 + 60 ─ 61 Qualidade
50 + 58 + 61 ─ 62 Segurança/observabilidade ─ 63 Resiliência ─ 64 Aceite
```

## Fases e critérios

### Fase A — CRM-33 a CRM-39: modelo e aquisição

- migrations somente aditivas e backfills idempotentes;
- Lead, source, campanha e criativo atuais continuam funcionando;
- identidade e atribuição mostram cobertura e divergência;
- nenhuma credencial externa necessária.

### Fase B — CRM-40 a CRM-47: conectores e comunicação

- provider primeiro em mock/local, depois sandbox comprovado;
- status nunca avança por configuração apenas;
- inbox/outbox, consentimento, retry, rate limit e observabilidade obrigatórios;
- falha externa não corrompe domínio.

### Fase C — CRM-48 a CRM-54: receita e cliente

- ganho, contrato, ativação, pagamento e receita são fatos distintos;
- ledger e históricos append-only;
- pós-venda tem owner e próxima ação;
- escopo não cresce para contabilidade ou help desk genérico.

### Fase D — CRM-55 a CRM-61: gestão, IA e qualidade

- metas/forecast possuem snapshots reproduzíveis;
- dashboards consomem uma camada única;
- IA/n8n não executam mutação fora do domínio;
- merge/reconciliação preservam aliases, IDs e auditoria.

### Fase E — CRM-62 a CRM-64: readiness

- threat model, LGPD, SLO, backup/restore e incidente validados;
- carga e concorrência usam ambiente descartável, nunca produção;
- CRM-64 relata lacunas honestamente e não implica deploy.

## Itens que dependem de terceiros

CRM-40, 41, 44, 45, 46, 47, 50, 59 e 60 precisam de contas/credenciais de
sandbox, termos e escopos aprovados. CRM-36 depende de decisões jurídicas sobre
base legal/retenção. CRM-62 a CRM-64 dependem da topologia de hospedagem ainda
não escolhida. Bloqueio externo não autoriza credencial improvisada ou mudança
de conta.

## P0, P1 e P2

- P0 constrói a fonte oficial, integridade, ciclo de receita e readiness.
- P1 conecta providers e melhora operação depois da fundação segura.
- P2 permanece no PRD como hipótese posterior: atribuição avançada, previsão
  assistida, telemetria de produto, benchmarks e conectores adicionais.

Nenhum item P2 recebe ID nesta fila porque CRM-33 a CRM-64 já formam o programa
autorizável. Novos IDs exigem novo planejamento após CRM-64.

### Estado da CRM-48

Contratos versionados são snapshots explícitos de oportunidade e oferta. A
fundação local foi concluída e validada com estados, RBAC, auditoria, hash,
aceite manual e backfill conservador. Ela não inclui assinatura/provider nem
revisão jurídica homologada. A CRM-49 permanece não iniciada.

### Estado da CRM-61

Regras determinísticas versionadas, ocorrências com owner/fila/SLA, varredura
dry-run/execute idempotente, reconciliação, candidatos e merge governado de
Contact/Account foram concluídos e validados localmente. O merge exige escolha
humana campo a campo, confirmação, revisão/fingerprint, locks, ledger e permite
rollback apenas sem mudança posterior. A execução síncrona declara cobertura
parcial acima de 2.000 registros por entidade. A CRM-62 está concluída e
validada localmente; CRM-63 e CRM-64 também foram concluídas e validadas
localmente. Nenhum resultado autoriza produção ou deploy.
