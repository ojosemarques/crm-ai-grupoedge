# Handoff comercial e onboarding — CRM-51

## Limites do domínio

O fluxo separa fatos que não são equivalentes: oportunidade ganha, contrato
aceito, handoff preparado e enviado, aceite do responsável, onboarding
iniciado, marcos evidenciados, cliente ativado e onboarding concluído.

Nenhuma etapa posterior é inferida de uma anterior. Pagamento, assinatura,
receita, provisionamento externo, ERP e help desk não são acionados pela CRM-51.

## Estados e concorrência

CustomerHandoff usa DRAFT → READY → SENT → ACCEPTED e pode terminar em REJECTED
ou CANCELLED. Registros legados REQUESTED só avançam quando seus vínculos
mínimos estão completos.

OnboardingCase usa PENDING → IN_PROGRESS → ACTIVATED → COMPLETED, com BLOCKED e
CANCELLED explícitos. Revisão otimista e locks consultivos protegem comandos
concorrentes. Conflitos `P2034` de transações serializáveis recebem retry
limitado da transação completa; a criação também verifica, sob o mesmo lock, se
já existe handoff ativo para a oportunidade. Toda mutação recebe chave
idempotente, gera OnboardingEvent append-only e AuditLog.

## Templates e marcos

O seed cria Implantação padrão v1 com quatro marcos ordenados e dependentes:
kickoff, acessos, configuração e critérios de ativação. O aceite copia nomes,
ordem, obrigatoriedade, dependência e prazos para o caso; mudar o template não
reescreve o histórico.

Um marco só é concluído com evidência humana. A ativação é bloqueada enquanto
existir marco obrigatório pendente. Todo caso aberto tem responsável operacional
ou fila, próxima ação e prazo.

## Métricas

A tela /onboarding calcula do banco: preparar envio, aguardando aceite, em
andamento, bloqueados, atrasados e prontos para ativar. O retorno informa o
instante da consulta, a fórmula e o timezone America/Sao_Paulo.

## Backfill

O comando pnpm db:onboarding:backfill executa dry-run por padrão; --execute
habilita o modo efetivo. Somente oportunidade WON com conta canônica, contrato
ACCEPTED, template publicado, owner ativo e ausência de handoff pode gerar
rascunho. Qualquer ausência vira REVIEW_REQUIRED. --run-key controla o replay.

## Permissões

- onboarding.read: leitura no escopo;
- onboarding.manage: criação e preparação do handoff;
- onboarding.accept: aceite ou rejeição;
- onboarding.execute: marcos, bloqueio, ativação e conclusão;
- onboarding.assign: redistribuição;
- onboarding.correct: cancelamento e backfill.

Administrador tem workspace; gestor opera sua equipe; closer opera os próprios
casos; visualizador tem somente leitura. A API repete os guards do servidor.
