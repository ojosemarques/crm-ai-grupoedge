# Etapa 13 — assistente com aprovação

Implementação validável do assistente gerencial e da criação assistida de configurações. A comparação abaixo usa somente fontes públicas já registradas em [ETAPA01_CLINT_FONTES.md](./ETAPA01_CLINT_FONTES.md) e [BENCHMARK_CLINT.md](./BENCHMARK_CLINT.md). Não houve acesso a conta, trial ou API autenticada da Clint.

| Comando Politizai | Comportamento entregue | Evidência pública equivalente na Clint | Estado comparativo |
|---|---|---|---|
| `QUERY` | Interpreta aliases homologados, exige período, aplica o escopo de permissão do catálogo gerencial, fornece fórmula, fontes, links e separa dado, inferência e ausência. Texto desconhecido retorna ausência estruturada. | A página pública da Aura anuncia consultas e análises por conversa; a documentação pública não expõe precisão, escopo de permissão ou contrato de ausência. | **DOCUMENTADO_PUBLICAMENTE** para a existência geral; detalhes **NÃO_VERIFICÁVEIS_SEM_CONTA**. |
| `PROPOSE` | Cria somente um `DRAFT` persistido de agente, modelo de funil, automação ou gráfico, com diff, impacto e prévia. Nenhum objeto de domínio é criado nessa etapa. | A página da Aura anuncia criação desses quatro tipos por conversa. O tutorial de indicador descreve geração de gráfico e salvamento posterior. | **DOCUMENTADO_PUBLICAMENTE** como oferta/fluxo geral. |
| `CANCEL` | Cancela o rascunho por revisão otimista e registra auditoria com `domainMutationExecuted=false`. | Não foi localizada fonte pública que prove cancelamento sem efeito para todos os quatro objetos. | **NÃO_VERIFICÁVEL_SEM_CONTA**. |
| `APPROVE` | Exige administrador e permissões do serviço alvo. Publica por serviços existentes, grava alvo, snapshot, hash e versão imutável. Modelo de funil não é aplicado a pipelines existentes. | A documentação comprova publicação/versionamento de automações e salvamento de gráficos; não prova confirmação, atomicidade e permissões da Aura para todo objeto. | Automação/gráfico **DOCUMENTADO_PUBLICAMENTE**; contrato transversal **NÃO_VERIFICÁVEL_SEM_CONTA**. |
| `UNDO` | Pausa agente/automação, arquiva modelo não aplicado ou desativa a versão do gráfico; cria versão `UNDONE` ligada à versão anterior e auditoria. | As fontes públicas não demonstram reversão completa de comandos da Aura. | **NÃO_VERIFICÁVEL_SEM_CONTA**. |

## Gates

- Voz permanece `BLOCKED_PENDING_EVALUATION` até existirem evidências de qualidade de transcrição, privacidade/consentimento e custo.
- Resposta livre nunca publica configuração: `PROPOSE` e `APPROVE` são comandos separados.
- Falha durante publicação entra em `PUBLISH_FAILED`; o sistema não executa replay automático que possa duplicar o alvo.
- A comparação com a Clint é documental. Os itens marcados como não verificáveis continuam pendentes de uma conta de avaliação.
