# Limitações da camada gratuita de produção

## Decisão aceita

A autorização da PROD-11 aceitou provisoriamente uma infraestrutura sem worker
24×7 e com custo obrigatório de **R$ 0** enquanto o produto ainda está em
construção. Essa decisão não equivale a aceitar os riscos para operação real.

## Vercel Hobby

- não existe processo persistente para o worker;
- o endpoint serverless pode ser invocado manualmente, mas permanece desligado;
- nenhum agendamento por minuto ou disponibilidade contínua foi declarado;
- o projeto permanece sem Git e sem domínio customizado, mas possui um único
  release candidate protegido por Vercel Authentication;
- o deployment fechado não possui usuário do CRM, dado operacional ou tráfego
  público e não constitui go-live;
- limites de execução, observabilidade, suporte e proteção não equivalem ao
  perfil produtivo pago definido no ADR original.

## Neon Free

- histórico de recuperação observado: 6 horas;
- branch de produção não pode ser protegida no plano atual: a tentativa segura
  foi recusada por limite do plano (HTTP 422);
- a conta não permitiu personalizar o intervalo de suspensão (HTTP 412);
- compute observado: 0,25 CU;
- retenção, SLA, suporte, capacidade e proteção contra exclusão não atendem à
  arquitetura definitiva prevista para dados reais;
- o banco pode suspender e apresentar latência de retomada.

## Gates que permanecem fechados

- bootstrap administrativo, identidade e login interno de produção;
- novo deployment, domínio e tráfego real;
- dados pessoais ou importação de staging/local;
- worker automático ou persistente;
- providers externos, egress e webhooks comerciais;
- go-live sem retenção/restore adequados, segundo responsável operacional,
  jurídico/DPO, pentest e janela formal de rollback.

Qualquer upgrade, cartão, cobrança ou contratação exige nova autorização antes
da confirmação no provider.

O estado técnico do release candidate está consolidado em
[`PRODUCTION_RELEASE_CANDIDATE.md`](./PRODUCTION_RELEASE_CANDIDATE.md) e nos
relatórios especializados `PROD12_*`.
