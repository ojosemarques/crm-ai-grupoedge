# Bloqueios remanescentes da PROD-10

## Decisão após a correção dirigida

A recuperação dirigida fechou os bloqueios técnicos de staging que podiam ser
resolvidos sem custo: worker serverless remoto, regressão do Pipeline, ensaio
isolado de indisponibilidade do banco, validação com VoiceOver/zoom e owners
nominais. O ambiente gratuito está homologado para construção e testes.

A **PROD-11 continua em NO-GO** porque o Vercel Hobby não oferece o runtime
automático de um minuto ou processo persistente definido como requisito para a
operação real. O endpoint serverless foi comprovado em execução manual
protegida, mas fica desabilitado pelo kill switch fora das janelas de
homologação.

## Bloqueio obrigatório antes de produção

| Bloqueio | Evidência atual | Ação futura |
|---|---|---|
| Worker operacional 24×7 | Endpoint protegido e idempotente aprovado no staging; agendamento automático não existe no plano gratuito | Aprovar host persistente ou plano/frequência equivalente, registrar novo ADR se a arquitetura mudar e homologar auto-restart/health/custo |
| Substituto e on-call | Operação de staging concentrada em Matheus Mendonça | Nomear substituto e escala antes de dados reais |
| Jurídico, DPO e pentest | Não foram executados nem presumidos | Obter aprovações/evidências específicas antes do go-live |

## Itens encerrados nesta correção

- configuração inválida e kill switch do worker agora são estados distintos;
- worker remoto manual executou um job sintético uma única vez, mesmo com duas
  chamadas concorrentes e replay;
- `/pipeline` deixou de falhar no staging após o homologador garantir as oito
  etapas e as transições canônicas de pré-vendas;
- falha de banco foi ensaiada em branch Neon descartável, sem alterar o staging
  principal;
- VoiceOver real e zoom real de 200% foram verificados no macOS/Chrome;
- responsáveis nominais de staging foram registrados.

Nenhum recurso de produção, domínio, integração externa, upgrade ou cobrança
foi criado.
