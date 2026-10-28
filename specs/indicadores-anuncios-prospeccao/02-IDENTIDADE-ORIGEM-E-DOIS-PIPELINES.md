# Identidade, origem e participações

Observado: Lead possui um pipeline e um Contact opcional; Contact suporta vários leads. Intake possui advisory lock e replay por workspace/idempotencyKey. Dedup de telefone + e-mail atualmente escolhe candidato sem verificar pipeline. ensureContact cria reviews para coincidências; não substituir essa revisão por merge global.

Decisão: reaproveitar Lead somente no pipeline de destino. Nova frente cria novo Lead e preserva o anterior, origem, owner e datas. Vincular ao mesmo Contact apenas quando o contato anterior já estiver confirmado e ativo, houver candidato não ambíguo, telefone/e-mail/nome coerentes e nenhuma divergência relevante. Senão criar contato separado com revisão existente; mostrar “possível histórico”, não identidade confirmada. Não inferir identidade só por nome, email ou telefone.

Replay da mesma chave retorna resultado anterior; nova chave é nova submission comercial, não necessariamente nova pessoa. Reentrada na mesma frente preserva Lead e incrementa conversão com fato de submission. A frente nova recebe seu próprio LEAD_CREATED. Não duplicar CONTACT_CREATED quando reutilizado.

Histórico relacionado: consulta restrita pelo workspace e pela visibilidade atual de cada Lead. Exibir somente leads autorizados com pipeline/etapa/origem/data/responsável e links ao histórico completo, que já contém contatos/reuniões/resultados. Candidatos por ponto compartilhado recebem rótulo incerto; nenhum aviso de existência restrita é enviado. Limitar consulta e informar quando limitada.

Tarefas: selecionar destino na dedup; resolver vínculo confirmado; expor histórico na superfície do lead; fixtures de dois pipelines, replay, ausência de histórico e ambiguidade. Aceite: entrada inbound não muda o Lead de prospecção; replay não cria outro; outro workspace/owner sem permissão não aparece. Rollback somente aplicação; sem merge/backfill de identidade em produção.
