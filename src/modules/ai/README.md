# Módulo de IA

A CRM-25 criou a fronteira de inteligência: contratos Zod, prompts versionados,
providers intercambiáveis, fallback local, autorização e rastreabilidade. A
CRM-26 integra essa fronteira à aba Inteligência do cartão do lead para análise,
preparação de ligação, extração por marcadores explícitos e próxima melhor ação.
A CRM-27 adiciona o `ManagerCopilotService`, que combina as consultas
determinísticas do módulo de métricas com a proveniência da camada de IA.

`AIExecutionService` recebe um DTO mínimo já selecionado por um serviço de
aplicação autorizado. Ele revalida `ai.use` sobre o alvo, executa o provider,
valida a saída e persiste `AIInsight`, atividade e `AuditLog` na mesma
transação. `LeadIntelligenceService` transforma a saída em propostas com valor
atual e sugerido. Nenhuma proposta altera PACTO, score ou tarefa antes de uma
confirmação humana; aceite parcial e edição chamam os serviços de domínio e são
auditados.

Sem configuração adicional, `createAIProvider()` retorna
`MockAIProvider`. `OpenAICompatibleProvider` só é construído explicitamente por
injeção e não lê variáveis de ambiente. O Copilot recebe somente agregados
calculados, nunca nomes ou IDs dos registros relacionados; o drilldown fica no
servidor autorizado. Consulte `docs/AI_PROMPTS.md`.
