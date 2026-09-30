# Contatos, contas, entrada e portabilidade

Este documento registra o contrato funcional e o aceite da Etapa 03 do roadmap
de paridade com a Clint. O escopo permanece no CRM comercial da Politizai. Uma
pessoa, conta ou oportunidade comercial não concede acesso aos dados
operacionais de cidadãos ou gabinetes no Politizai OS.

## Identidade comercial

`Contact` representa a pessoa canônica e `Account` representa a instituição. O
relacionamento entre ambos é um fato datado: cada papel tem início, término,
fonte e evidência próprios. Encerrar um vínculo não apaga o contato, a conta, o
papel anterior, as oportunidades ou os demais fatos comerciais.

Uma pessoa pode ter vínculos simultâneos ou sucessivos com instituições
diferentes. Cada oportunidade continua sendo uma decisão de compra independente,
mesmo quando compartilha o mesmo contato ou a mesma conta. Tags e campos
customizados são sempre definidos e gravados dentro do workspace e da entidade
correta; uma definição não autoriza leitura ou escrita em outra entidade.

Telefone e e-mail são sinais de identidade, não autorização para fusão. Um
identificador compartilhado abre revisão humana e preserva os registros
separados. Qualquer merge segue o fluxo governado de qualidade de dados, com
prévia, decisão campo a campo, confirmação, ledger e reversão quando permitida.

## Entrada comercial

Cadastro manual, CSV, formulário, landing page, anúncio e webhook adaptam seus
dados para a mesma fronteira de intake. O servidor resolve workspace e ator,
valida origem, UTM, versão da oferta e consentimento e aplica idempotência antes
de persistir o efeito.

Uma entrada representa uma submissão ou sinal de aquisição. Ela não cria uma
oportunidade automaticamente. A abertura do negócio permanece uma decisão
comercial explícita e auditada. Repetir a mesma chave lógica devolve o efeito
anterior; usar a mesma chave com conteúdo diferente produz conflito.

## Importação, exportação e ações em massa

A importação CSV usa um layout versionado e uma prévia calculada no servidor. A
prévia mostra linhas válidas, inválidas, duplicadas e em conflito sem alterar os
dados. A confirmação recalcula a prévia, verifica o fingerprint e processa cada
linha pela fronteira canônica de escrita.

A exportação aplica o mesmo RBAC e escopo da consulta. O arquivo contém apenas
contatos e negócios autorizados, usa UTF-8, cabeçalhos estáveis e proteção contra
fórmulas de planilha. Workspace, ator, filtros, quantidade e motivo ficam na
auditoria; o conteúdo exportado não é copiado para o log.

Ações em massa têm duas fases. `DRY_RUN` calcula a seleção e o efeito esperado
sem mutação. `EXECUTE` exige motivo, fingerprint vigente e chave idempotente,
revalida a autorização de cada item e registra resultados alterados, ignorados
e rejeitados. Uma prévia de outro workspace ou que ficou desatualizada não pode
ser executada.

## Matriz de requisito e evidência

| Requisito | Comportamento verificável | Evidência principal |
|---|---|---|
| Preservar contato e conta | IDs e fatos existentes continuam válidos após a migração aditiva. | [`schema.prisma`](../prisma/schema.prisma), [migration da Etapa 03](../prisma/migrations/20260930030000_stage03_portability/migration.sql) e testes de integração de contas/contatos. |
| Vínculo datado e mudança de gabinete | O mesmo contato pode ter dois papéis; encerrar um papel grava `validTo` e mantém o anterior consultável. | [`account-service.ts`](../src/modules/accounts/application/account-service.ts), telas de conta/contato e cenário de vínculo histórico. |
| Múltiplos negócios | Duas oportunidades independentes podem referenciar o mesmo contato e contas autorizadas sem compartilhar estágio, valor ou histórico. | Serviço de oportunidades, detalhe de conta/contato e cenário de aceite comercial. |
| Tags por entidade | Tags de contato, conta, lead e oportunidade são isoladas por workspace e entidade. | Schema, serviço de tags/campos comerciais e APIs protegidas. |
| Campos customizados | Definição tipada valida valor, entidade, workspace e estado ativo antes da gravação. | Schema, serviço de campos customizados, configuração administrativa e testes de validação. |
| Colisão com revisão humana | Telefone ou e-mail compartilhado abre revisão e não executa merge automático. | [`contact-identity-service.ts`](../src/modules/contacts/application/contact-identity-service.ts), [`data-quality-service.ts`](../src/modules/data-quality/application/data-quality-service.ts) e testes de identidade. |
| Intake multicanal | Manual, CSV, formulário, landing, anúncio e webhook chegam à mesma operação idempotente. | [`lead-intake-service.ts`](../src/modules/leads/application/lead-intake-service.ts), contratos e adaptadores HTTP. |
| Origem, UTM, oferta e consentimento | A submissão preserva a evidência recebida e a versão da oferta; ausência continua distinta de negativa. | Contrato de entrada, snapshot da submissão, atribuição de marketing e fundação de privacidade. |
| Não criar negócio por mensagem | Uma submissão aceita altera apenas os fatos de entrada previstos; o total de oportunidades permanece igual. | Teste de integração do intake com contagem anterior e posterior de oportunidades. |
| Prévia de importação | Preview não altera banco e classifica cada linha; confirmação revalida hash e mapeamento. | [`lead-csv-import-service.ts`](../src/modules/leads/application/lead-csv-import-service.ts), API e tela de entrada. |
| Exportação autorizada | O arquivo só inclui linhas visíveis no mesmo escopo da consulta e neutraliza fórmulas. | Serviço/rota de portabilidade, `portability.export` e testes de workspace/RBAC. |
| Ações em massa seguras | Dry-run não grava; execução exige motivo, fingerprint e idempotência e produz auditoria por lote. | Serviço/rotas de ações em massa, `PortabilityBulkOperation`/itens, `portability.manage` e testes de replay/conflito. |
| Roundtrip e isolamento | Exportar e reimportar preserva os fatos portáveis, não duplica registros e não revela outro workspace. | Cenários A03-01 a A03-04 abaixo. |

## Cenários de aceite

### A03-01 — Pessoa, instituições e negócios independentes

1. Criar um contato no workspace A.
2. Vinculá-lo às contas Gabinete Alfa e Instituto Beta, com papéis e datas
   próprias.
3. Criar uma oportunidade em cada conta.
4. Encerrar o vínculo com Gabinete Alfa e registrar o motivo.
5. Confirmar que o vínculo encerrado continua no histórico, o vínculo com
   Instituto Beta permanece ativo e cada oportunidade preserva conta, estágio,
   valor e timeline próprios.

**Resultado esperado:** um contato, dois vínculos e dois negócios, sem
reescrita dos fatos anteriores.

### A03-02 — Telefone compartilhado

1. Registrar dois contatos distintos com o mesmo telefone e evidências pessoais
   diferentes.
2. Processar novamente o mesmo sinal de contato em ordem concorrente.
3. Consultar a fila de revisão de identidade.

**Resultado esperado:** dois contatos permanecem ativos e separados; existe
revisão humana com evidência do identificador compartilhado; nenhum merge ou
sobrescrita ocorre automaticamente.

### A03-03 — Roundtrip CSV idempotente

1. No workspace A, exportar contatos e negócios autorizados usando o layout
   versionado.
2. Validar cabeçalhos, codificação, neutralização de fórmulas e contagens.
3. Gerar a prévia de importação do mesmo arquivo.
4. Confirmar a importação e repetir a confirmação com a mesma chave
   idempotente.
5. Exportar novamente com os mesmos filtros.

**Resultado esperado:** a prévia não altera dados; a primeira confirmação cria
ou associa somente os fatos ausentes; o replay não duplica contato, vínculo,
submissão ou oportunidade; a segunda exportação mantém os valores portáveis e
as contagens esperadas.

### A03-04 — Isolamento entre workspaces

1. Criar dados homônimos nos workspaces A e B.
2. Como usuário restrito ao workspace A, tentar consultar, exportar, importar,
   executar lote e reutilizar IDs ou fingerprint produzidos no workspace B.
3. Comparar banco, resposta e auditoria dos dois workspaces.

**Resultado esperado:** nenhuma resposta contém dados do workspace B; IDs,
definições, prévias e fingerprints externos ao contexto são rejeitados; nenhum
registro do workspace B é alterado.

### A03-05 — Entrada sem oportunidade implícita

1. Contar as oportunidades do workspace.
2. Enviar sinais equivalentes por formulário, landing page, anúncio e webhook,
   com origem, UTM, oferta e consentimento.
3. Repetir um evento com a mesma chave e tentar reutilizar a chave com payload
   divergente.

**Resultado esperado:** os canais geram submissões coerentes pela mesma
fronteira; o replay é idempotente; o payload divergente é recusado; a contagem
de oportunidades não muda.

### A03-06 — Ação em massa com dry-run

1. Selecionar registros visíveis e incluir deliberadamente um ID sem acesso.
2. Solicitar `DRY_RUN` com motivo.
3. Confirmar que nenhuma linha foi alterada.
4. Executar usando o fingerprint retornado e repetir a mesma chave idempotente.

**Resultado esperado:** a prévia discrimina itens autorizados e rejeitados; a
execução altera somente os autorizados; o replay devolve o resultado persistido;
motivo, ator, ação e contagens ficam auditados.

## Verificação de fechamento

O fechamento da etapa exige, no mínimo:

- migrations aplicadas do zero e sobre a versão anterior;
- testes unitários e de integração dos serviços alterados;
- cenários A03-01 a A03-06 executados com dois workspaces;
- lint, typecheck e build aprovados;
- verificação do schema e das rotas no ambiente de produção;
- health e readiness confirmando aplicação e banco disponíveis.
