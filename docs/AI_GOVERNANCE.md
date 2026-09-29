# Governança de IA

## Estado local

A CRM-59 opera exclusivamente com `MockAIProvider`, determinístico e sem rede.
O adaptador compatível externo existe como fronteira técnica, mas permanece
desabilitado por padrão e exige habilitação e autorização de egress explícitas.
Nenhuma credencial é lida, armazenada ou solicitada nesta fase.

## Registro canônico

Cada caso de uso possui versões imutáveis em `AIUseCaseVersion`. A versão fixa
responsável humano, risco, provider/modelo lógicos, prompt, contratos, allowlist,
denylist, confiança mínima, fallback e limites de timeout, retry, taxa, tokens e
custo. O ciclo é `DRAFT → EVALUATED → APPROVED → DISABLED`; publicar exige uma
avaliação local integralmente aprovada e permissão administrativa. Rollback é
uma mudança auditada de versão ativa, nunca reescrita de configuração.

Casos aprovados no seed local:

- resumo operacional;
- próxima melhor ação;
- classificação interna não sensível para rascunho;
- síntese gerencial de métricas persistidas.

Não são autorizadas mutações comerciais, envio de mensagens, alteração de etapa,
responsável, PACTO ou score pelo adapter. Recomendações continuam propostas
revisáveis; uma decisão humana é um fato append-only e não executa uma ação.

## Fronteira de dados

Antes do adapter, `minimizeAIInput` aplica allowlist por caso de uso, remove
campos proibidos e redige e-mail, telefone, documento, segredo, token e padrões
equivalentes. Conteúdo não confiável é separado por contrato e padrões de prompt
injection são substituídos antes da execução. Somente fingerprints SHA-256,
contagens e metadados seguros entram na observabilidade; o payload original não
é duplicado nos logs de governança.

A saída é validada por schemas Zod `strict()`. Campo extra, formato inesperado ou
falha de provider é rejeitado e encaminhado ao fallback local determinístico.
Fato, inferência, evidência, ausência e confiança continuam separados.

## Proveniência e revisão

`AIExecutionTrace` registra versão do caso de uso, provider/modelo/prompt,
fingerprints, `asOf`, timezone, status, latência, orçamento, redações e fallback.
Os estados são `REQUESTED`, `RUNNING`, `SUCCEEDED`, `REJECTED`, `FAILED` e
`FALLBACK`. `AIHumanDecision` registra `ACCEPTED`, `EDITED` ou `REJECTED` com
idempotência. Se o fingerprint atual divergir do original, a sugestão é marcada
obsoleta e preservada como rejeitada; nenhuma mutação é aplicada.

## Avaliações

`pnpm test:ai:evals` executa o dataset `politizai-ai-governance@1`, versionado no
repositório. Ele cobre contrato estrito, grounding, isolamento, PII, segredo,
prompt injection, recusa de mutação, baixa confiança e orçamento. A execução
administrativa persiste `AIEvaluationRun` e resultados append-only. Uma versão
só pode sair de `DRAFT` após todos os casos passarem.

## Observabilidade e RBAC

`/governanca-ia` apresenta versões, avaliações, sucesso/falha, fallback, latência
e alertas dos últimos 30 dias. Gestor consulta e executa avaliações locais;
Administrador também aprova, desabilita e faz rollback. Visualizador, SDR e
Closer não acessam a governança por URL direta. Toda ação é reautorizada no
servidor e auditada por workspace.

## Limitações e futuro

- métricas de custo são estimativas tipadas e permanecem zero no modo local;
- não houve homologação de provider, modelo, contrato, residência de dados ou
  DPA externo;
- qualquer ativação externa exige task própria, revisão de privacidade e
  segurança, credencial server-side, orçamento aprovado e teste de egress;
- a CRM-59 não configura rede, não envia dado a terceiros e não faz deploy.
