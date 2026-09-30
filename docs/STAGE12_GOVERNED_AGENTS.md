# Etapa 12 — agentes governados

O construtor em `/agentes` persiste rascunhos com revisão otimista e publica versões imutáveis somente após avaliação de grounding, oferta futura, PII, prompt injection, baixa confiança, handoff e aprovação sensível.

O runtime é `LOCAL_DETERMINISTIC`: usa apenas a base versionada aprovada, devolve fontes, custo por caso e propostas de campos. Não envia dados a provedor externo. A conversa tem posse exclusiva; resposta humana pausa o agente e uma retomada exige novo gatilho. Preço, proposta, desconto e mudança de etapa ficam como proposta pendente e nunca são aplicados automaticamente.

Os dez subagentes Politizai são entregues como catálogo interno em `DRAFT`: pesquisa de conta, diagnóstico, briefing, solução, proposta, risco, follow-up, handoff, Customer Success e análise. O catálogo exposto ao agente aceita somente produtos ativos e declara separação dos dados de cidadãos do OS.
