# Qualidade de dados, reconciliação e merge governado

## Princípios

A CRM-61 trata qualidade como um domínio operacional persistido. Uma ocorrência
é um fato detectado por uma regra determinística e versionada, com evidência
mínima, severidade, prioridade, responsável ou Fila Geral, prazo e histórico.
Ausência de dado, divergência e duplicidade provável são estados distintos.
Nenhuma regra usa IA, provider externo ou inferência como árbitro.

O workspace é derivado da sessão. API, serviço e constraints compostas impedem
leitura ou mutação cruzada. Eventos de ocorrência, resultados de reconciliação e
execuções de merge são append-only; correção gera um novo fato e AuditLog.

## Regras determinísticas iniciais

| Chave | Dimensão | Evidência e ação esperada |
|---|---|---|
| `CONTACT_NO_USABLE_CHANNEL` | completude | ausência de canal válido e permitido; confirmar canal ou ausência |
| `CONTACT_DUPLICATE_POINT` | unicidade | telefone/e-mail normalizado compartilhado; revisar o par |
| `ACCOUNT_DUPLICATE_IDENTITY` | unicidade | documento, domínio ou nome normalizado coincidente; revisar o par |
| `LEAD_MISSING_LATEST_ATTRIBUTION` | atribuição | origem vigente ausente; reconciliar sem reescrever a origem inicial |
| `OPPORTUNITY_MISSING_NEXT_ACTION` | completude | oportunidade aberta sem próxima ação; corrigir pelo serviço comercial |
| `WON_WITHOUT_CONTRACT` | integridade referencial | ganho sem contrato relacionado; confirmar exceção ou criar pelo fluxo próprio |
| `INVOICE_PAYMENT_MISMATCH` | reconciliação financeira | projeção paga diferente do ledger confirmado; revisar pelo fluxo financeiro |

Versões publicadas são imutáveis. Uma mudança de definição exige nova versão e
preserva a regra usada por cada ocorrência. A varredura oferece `DRY_RUN` sem
mutação e `EXECUTE` explícito, ambos idempotentes por workspace e chave. O
checkpoint informa `complete` ou `bounded:2000`; o segundo caso é cobertura
parcial explícita e não é apresentado como varredura completa.

## Ciclo da ocorrência

`OPEN` pode ser assumida (`IN_REVIEW`), comentada, resolvida ou descartada com
motivo. Evidência alterada após resolução reabre a ocorrência; a mesma evidência
não fabrica uma nova. A revisão otimista impede sobrescrever trabalho recente.
SDR e Closer leem/resolvem somente seu escopo; Gestor e Administrador operam no
workspace conforme a matriz de permissões.

## Reconciliação

Resultados guardam fonte, alvo, fonte canônica, regra de precedência, instante e
timezone. Pagamentos `CONFIRMED` e não revertidos são o ledger factual; o valor
pago da cobrança é a projeção comparada. Sem cobranças no recorte, o estado é
`UNAVAILABLE`, nunca um zero interpretado como conciliação perfeita.

## Duplicidade e merge

A detecção apenas cria candidato. A decisão humana pode marcar “não duplicado”
ou preparar uma prévia. O merge suporta exclusivamente `Contact` e `Account` e
exige:

- escolha explícita do sobrevivente;
- decisão campo a campo;
- motivo e confirmação literal;
- fingerprint e revisão ainda atuais;
- locks PostgreSQL e transação única;
- ledger dos relacionamentos transferidos;
- AuditLog e execução imutável.

Contratos bloqueiam merge de contato. Contratos, assinaturas ou cobranças
bloqueiam merge de conta. Esses fatos não são reescritos. O registro de origem
permanece com estado `MERGED` e ponte para o sobrevivente, preservando IDs e
aliases. A reversão só ocorre se o fingerprint pós-merge continuar idêntico;
qualquer mudança posterior bloqueia rollback automático e exige nova revisão.

## Operação local

A tela `/qualidade-dados` apresenta indicadores, filtros paginados, regras,
candidatos, reconciliações e planos. “Diagnosticar” não grava ocorrências;
“Executar varredura” é uma ação separada. Merge e reversão têm confirmações
humanas próprias. O módulo não envia dados, não liga providers e não altera
regras comerciais de aquisição, receita ou automações.

Limitação atual: a execução síncrona cobre até 2.000 registros por entidade e
declara truncamento no checkpoint. Escala acima desse limite deve usar o worker
incremental da fase de readiness, sem ocultar cobertura parcial.
