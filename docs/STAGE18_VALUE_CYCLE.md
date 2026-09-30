# Etapa 18 — ciclo de entrega, sucesso e renovação

## Objetivo operacional

A Etapa 18 liga o fato comercial aceito à execução pós-venda sem perder a composição da oferta, os compromissos assumidos ou as decisões posteriores. O fluxo canônico é:

`oportunidade ganha → contrato aceito → handoff aceito → planos de entrega → carteira e plano de sucesso → renovação, expansão, contração ou churn`

O aceite humano continua obrigatório nas mudanças de responsabilidade e nas decisões financeiras. Datas e sinais geram trabalho para revisão; não disparam comunicação externa nem renovação automática.

## Matriz de aceite

| Requisito | Registro verificável | Regra de aceite |
| --- | --- | --- |
| Oferta OS + serviço | linhas imutáveis da versão contratual e planos de entrega vinculados | cada componente contratado produz exatamente um plano coerente com sua natureza; o total dos planos reconcilia com o contrato |
| Licença, implantação, serviço operado e projeto Lab | tipo, checklist versionado, responsável, prazo e entregáveis | cada categoria usa seu próprio checklist e mantém o snapshot usado na criação |
| Transferência comercial | snapshot do handoff e eventos sequenciais | diagnóstico, promessa, escopo, aprovações, usuários e riscos chegam à entrega; o caso nasce somente após aceite explícito |
| Acompanhamento após ganho | plano de sucesso, marcos, sinais de saúde e evidências | adoção, entregáveis, capacidade, solicitações, resultado e risco distinguem dado observado de dado ausente |
| Revisão de valor | decisão, valores anterior/novo/delta e movimento de receita | alteração exige responsável humano, motivo e evidência; correção usa movimento reversor |
| Renovação | renovação, próxima ação e eventos | nasce por data/estado, permanece em revisão e não envia mensagem nem confirma receita automaticamente |
| Expansão | sinal revisado e oportunidade própria | confirmação humana cria uma oportunidade independente e rastreável, com próxima ação |
| Churn/perda | decisão, motivo, evidência e evento | preserva o aprendizado e distingue churn de logo e de receita |

## Operação

### 1. Conferir venda e contrato

1. Confirme que a oportunidade está ganha e possui conta canônica.
2. Abra **Contratos** e confira versão aceita, vigência, linhas, MRR, TCV e total.
3. Para uma venda OS + serviço, confira que a composição contratual contém componentes separados. Divergência de composição ou valor bloqueia a passagem para entrega.

### 2. Transferir para entrega

1. Em **Handoff e onboarding**, crie a passagem escolhendo oportunidade e responsável.
2. Revise o snapshot de diagnóstico, promessa, escopo, aprovações, usuários, riscos e valores.
3. Marque como pronta e envie para a equipe de entrega.
4. A equipe de entrega aceita ou rejeita com motivo. O aceite cria os planos e checklists aplicáveis; a rejeição devolve a passagem sem apagar o histórico.

### 3. Executar planos

1. Inicie cada plano e trate seus marcos na ordem das dependências.
2. Registre evidência ao concluir um marco.
3. Use bloqueio com motivo quando houver impedimento. Um plano bloqueado não altera automaticamente os demais componentes da venda.
4. Ative ou conclua somente após os marcos obrigatórios.

### 4. Acompanhar Customer Success

1. Atribua a conta a uma pessoa ou fila com próxima ação.
2. Crie o plano de sucesso com objetivo, data-alvo e marcos verificáveis.
3. Recalcule saúde quando houver novos fatos. `Dados insuficientes` permanece diferente de uma avaliação negativa.
4. Registre adoção, entregáveis, capacidade, solicitações, resultado e riscos com fonte e data.

### 5. Renovar, expandir ou encerrar

1. Abra **Farmer** e revise as renovações priorizadas por data, risco e próxima ação.
2. Registre risco e evidência antes da decisão.
3. Para expansão, registre o sinal e confirme a criação de uma oportunidade própria com próxima ação.
4. Para renovação, contração ou churn, registre motivo, comentário, evidência e valores. Correções são feitas por reversão; o fato original não é apagado.

## Controles e invariantes

- Todas as consultas e mutações usam o `workspaceId` da sessão e o escopo RBAC do responsável ou equipe.
- Handoff, planos, marcos, renovação e decisões usam revisão otimista e chave de idempotência.
- Snapshots contratuais, eventos e movimentos financeiros preservam o histórico; fatos emitidos não são reescritos.
- Ausência de dado não vira nota negativa, renovação, expansão, churn ou comunicação externa.
- Valores monetários são persistidos em centavos e conciliados na mesma moeda.
- Uma nova decisão comercial de expansão pertence a uma oportunidade própria.

## Evidência técnica

- Integração de aceite: `tests/integration/stage18-value-cycle.integration.test.ts`.
- Jornada web e móvel: `tests/e2e/stage18-value-cycle.spec.ts`.
- Suítes de base: contratos comerciais, onboarding, Customer Success e Farmer.

## Resposta a incidentes

- **Valor divergente:** suspenda o handoff, abra nova versão contratual e só retome após novo aceite.
- **Transferência rejeitada:** corrija o snapshot/origem e reenvie; não crie caso manual em paralelo.
- **Plano bloqueado:** registre motivo e próxima ação no plano afetado; preserve os demais planos.
- **Renovação indevida:** não apague eventos. Registre decisão corretiva ou reversão com motivo e evidência.
- **Oportunidade de expansão duplicada:** use a oportunidade já ligada ao sinal; a restrição de unicidade impede uma segunda ligação.

