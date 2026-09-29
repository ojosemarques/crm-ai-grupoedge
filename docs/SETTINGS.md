# Configurações comerciais

## Escopo da CRM-17

`/configuracoes` permite ao Administrador manter somente dados do workspace
autenticado. A página é um adaptador do `CommercialSettingsService`; a interface
não acessa Prisma e uma chamada direta à API repete a autorização no servidor.

Toda alteração segue duas chamadas: `POST /api/settings/commercial` devolve o
impacto e avisos; `PATCH /api/settings/commercial` exige `confirmed: true`. Um
lock transacional por workspace, validação Zod, revisão otimista e `AuditLog`
mantêm a decisão consistente. Falha antes do commit reverte configuração e log.

## O que é configurável

- produtos, preço de lista em centavos e estado ativo;
- ofertas/planos, produto, preço, desconto e validade;
- nomes, ordem e estado ativo de motivos de perda e desqualificação;
- nomes e ordem das etapas existentes, além das arestas permitidas;
- pesos e penalidades do scoring, limiar de capacidade e faixas P1/P2/P3;
- política `SLA imediato — 0 minutos` e limites visuais saudável/atenção;
- mínimo PACTO, duração padrão de 30 ou 40 minutos e cadência de tentativas;
- round-robin, limite opcional de leads abertos por SDR e limites de lead parado
  ou sem atividade.

Códigos semânticos de etapa, tipos de pipeline, moeda BRL e a estratégia
`ROUND_ROBIN` não são livres: são invariantes do MVP. A CRM-17 não adiciona um
builder de automações.

## Versionamento e história

`CommercialSettingsVersion` e `CadenceStep` formam snapshots append-only. O
workspace guarda somente a revisão operacional vigente. Scoring cria uma nova
`ScoringRuleVersion`; `LeadScore` antigo continua ligado à versão original.

Cada alteração de SLA cria novas `SlaPolicy` e `LeadPriorityBand`, liga a versão
à anterior e inativa a projeção anterior. `LeadSlaCycle` não é recalculado nem
movido. Assim, mudar faixas hoje não altera o atendimento histórico.

Produtos, planos e motivos mantêm identidade estável. Quando deixam de ser
oferecidos, `active=false`; oportunidades, propostas e leads existentes mantêm
suas FKs. Excluir configurações em uso não faz parte da API.

## Regras operacionais consumidas

- entrada de lead consulta faixas vigentes e SLA vigente;
- round-robin exclui SDRs indisponíveis e respeita `maxOpenLeadsPerSdr`;
- agenda usa `defaultMeetingDurationMinutes` como seleção inicial;
- PACTO usa `pactoMinimumInvestigatedDimensions` e registra o mínimo na revisão;
- scoring usa somente a versão ativa, preservando os cálculos antigos;
- pré-vendas e vendas consultam `PipelineStageTransition.active` no servidor;
- produtos, planos e motivos inativos não aparecem em novos fluxos.

`leadStagnationDays`, `leadWithoutActivityDays` e a cadência estão persistidos e
versionados para métricas/automações futuras. A CRM-17 não implementa essas
tasks futuras.

## Validações relevantes

- pesos positivos totalizam exatamente 100;
- P2 começa abaixo de P1 e as três faixas não se sobrepõem;
- SLA permanece zero; apenas os limites visuais podem mudar;
- atenção termina após saudável;
- cadência começa em D0, não repete dias e é crescente;
- desconto não supera preço;
- reativar plano exige produto ativo;
- a última saída ativa de uma etapa com registros abertos não pode ser bloqueada;
- editar pipeline não cria ou remove etapas nem troca seus códigos semânticos.
