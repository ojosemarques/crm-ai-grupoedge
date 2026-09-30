# Etapa 19 — evidência das jornadas completas

## Escopo executável

| Jornada | Prova integrada | Fatos de aceite |
| --- | --- | --- |
| Inbound → venda longa → contrato → onboarding → renovação | `stage18-value-cycle.integration.test.ts` e suítes de intake, vendas consultivas e contratos | identidade canônica, oportunidade ganha, contrato aceito, dois planos conciliados, aceite da entrega e renovação em revisão |
| Campanha → resposta → handoff | `stage19-complete-journeys.integration.test.ts` | público congelado e aprovado, tentativa local aceita, resposta recebida ligada ao lead e transferência auditada para fila humana |
| Agente → humano | `stage19-complete-journeys.integration.test.ts` | versão avaliada e publicada, resposta com base aprovada, pausa quando humano assume e bloqueio de mensagem concorrente |
| Checkout → pagamento → reembolso | `stage19-complete-journeys.integration.test.ts` | checkout individual, webhooks assinados, replay idempotente, caixa bruto/reembolsado/líquido reconciliado |

## Evidência de interface

`stage19-complete-journeys.spec.ts` percorre Leads, Pré-vendas, Contratos, Onboarding, Farmer, Campanhas, Atendimento, Agentes e Pagamentos. A mesma prova verifica as superfícies críticas em viewport móvel de 390 × 844.

## Limites da prova

- Campanha, agente e checkout usam simuladores locais governados; `externalEgress` permanece falso.
- A jornada transacional é aplicável apenas a produto individual elegível. Venda consultiva segue contrato e onboarding.
- A prova confirma comportamento do Politizai CRM. Comparação com funções privadas da Clint continua limitada às fontes públicas registradas no benchmark.
- Homologação de provedor real, MFA, restauração de backup, pentest e decisões jurídico/DPO pertencem aos gates produtivos da T19.2 e exigem evidência externa própria.

## Execução

```bash
pnpm test:integration -- tests/integration/stage18-value-cycle.integration.test.ts
pnpm test:integration -- tests/integration/stage19-complete-journeys.integration.test.ts
pnpm test:e2e -- tests/e2e/stage19-complete-journeys.spec.ts
```

O aceite requer os fatos persistidos e os testes aprovados. Um resultado parcial ou um gate externo aberto não deve ser descrito como paridade total.
