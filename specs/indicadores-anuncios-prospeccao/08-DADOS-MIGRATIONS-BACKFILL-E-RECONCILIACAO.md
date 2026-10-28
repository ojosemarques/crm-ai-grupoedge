# Dados, histórico e recuperação

Schema atual comporta as mudanças: Lead.contactId/pipelineId; Activity; snapshots de Stage/Meeting; CommercialMetricFact com pipeline/papéis/origem/correção. Decisão inicial: nenhuma migration ou tabela nova. Cadeia Prisma é canônica; não aplicar supabase/migrations paralelamente. Revisar decisão se teste mostrar lacuna estrutural indispensável.

Reusar commercial-metric-backfill-service e reconciliation-service; origem/fingerprint e run/items persistidos. Fatos reconstruídos não inventam autoria, equipe, data ou origem. Ausência de pipeline histórico é cobertura parcial, não fallback para pipeline atual. Não mover leads históricos, fundir contatos ou apagar fatos.

Antes de APPLY: confirmar workspace/banco/schema e recuperabilidade; DRY_RUN delimitado; contagens por fonte, conflitos/skips/reviews; repetir ensaio em schema isolado; backup/recuperação verificados; batch limitado/checkpoint e reconciliar. Sem backup demonstrável, não executar backfill de produção. Consultas de reconciliação read-only podem continuar. Rodar duas vezes deve manter saldo e identidade das ocorrências.

Rollout sem schema: código compatível com linhas antigas; cobertura explícita. Rollback = versão anterior do código. Novos registros aditivos de histórico permanecem auditáveis. Não reverter apagando dados. Produção sem backfill necessário deve registrar “não executado/não necessário para novos eventos”, com limites históricos reais.

Aceite: fixture histórica e duas execuções do backfill sem duplicação; comparação de cartões/drilldowns; facts antigos mantêm owner/pipeline. Dados de produção não entram nas fixtures nem no relatório.

## Classificação histórica aditiva — contrato revisado

Não se atualiza safeMetadata de um fato existente: o ensaio confirmou bloqueio append-only. commercial-front-snapshot-service.ts seleciona somente fontes com pipeline nulo/de oportunidade e intervalo LEAD não ambíguo; raw pipeline LEAD já conhecido é preservado. Lote 1–500, advisory lock por workspace, DRY_RUN e expectedCount obrigatório em APPLY. commercial-front-classification-sql.ts insere dois fatos versionados por fonte, com chave única e fingerprint derivado da fonte imutável. Reexecução não seleciona fonte já classificada.

Saldo global por evento/fonte/ator/data e valor financeiro permanece igual; fatos, fingerprints e payloads originais permanecem protegidos. Consultas efetivas ocultam apenas os estornos técnicos e contribuições substituídas dessa classificação. Auditoria registra IDs e quantidades do lote, sem dados pessoais. Recuperação: versão anterior da aplicação continua vendo o mesmo saldo; correção posterior de classificação deve ser outro evento compensatório, nunca DELETE/UPDATE. Ensaio deve provar immutabilidade, saldo 1/12300, novo recorte Anúncios e repetição sem novos fatos.

Dry-run read-only em produção identificou cerca de 32 mil fontes elegíveis, sobretudo tarefas e e-mail, além de reuniões e duas vendas. Sem APPLY antes de validação final, delimitação de lote, evidência de recuperação e reconciliação. Nenhuma migration de schema é necessária; a relação adicionada ao Prisma já existe no PostgreSQL.

## Backup e delimitação confirmados

CLI Supabase confirmou backup físico COMPLETED id 2094133279 de 28/10/2026 06:38:42.846Z, com sete cópias anteriores. PITR desabilitado; nenhum restore real foi disparado. Recuperação específica foi ensaiada no teste isolado, preservando as fontes e o saldo. Cutoff fixado em 2026-10-28 16:00:56.978776+00; 30.983 fontes elegíveis nas duas frentes. Hash do snapshot original e reconciliação constam do estado da execução. Repetir dry-run por lote, exigir contagem exata, não classificar fatos novos além do cutoff.
