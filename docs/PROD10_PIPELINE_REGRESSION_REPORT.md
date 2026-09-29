# Regressão do Pipeline — recuperação PROD-10

## Reprodução e causa raiz

Antes da correção, `/pipeline` respondia HTTP 200, mas caía no error boundary. O
serviço de domínio registrou a mensagem exata:

> O pipeline de pré-vendas está incompleto. Etapas ausentes:
> TRYING_CONTACT, CONNECTED, IN_QUALIFICATION, QUALIFIED, MEETING_SCHEDULED,
> NURTURING, DISQUALIFIED.

A causa não estava na UI nem nas regras de transição. O homologador de staging
criava somente a etapa `NEW`; o serviço do Pipeline corretamente recusava uma
configuração incompleta.

## Correção mínima

`ensureStagingLeadPipeline` passou a criar/reutilizar idempotentemente:

- as oito etapas canônicas de pré-vendas;
- as 23 transições do grafo real de domínio;
- um motivo sintético de desqualificação;
- auditoria `prod10.pipeline_configuration.repaired`.

Nenhuma regra comercial foi afrouxada. A correção apenas completa a fixture de
homologação.

## Validação

- teste de regressão dirigido prova que o homologador incompleto falhava e que
  duas execuções produzem exatamente o mesmo pipeline;
- Quadro, Lista, busca, responsável, prioridade, etapa e limpar filtros;
- abertura/cancelamento do diálogo e retorno do foco;
- transição normal, sensível com confirmação, desqualificação com motivo e
  transição proibida;
- drag permitido e bloqueado;
- mensagens de sucesso/erro e `router.refresh`;
- admin, SDR, closer, viewer negado e cross-workspace;
- desktop, mobile e zoom de 200% sem overflow horizontal da página.

O staging passou a exibir oito etapas e o serviço deixou de lançar a exceção.
