-- Cadastro comercial idempotente do workspace Politizai. Executar no schema crm.
-- O preço zero é apenas a referência do catálogo; cada venda exige valor positivo.
DO $setup$
DECLARE
  workspace_id uuid;
  actor_id uuid;
  product_id uuid;
  template_id uuid;
  version_id uuid;
  template_version integer;
  created_product boolean := false;
  created_template boolean := false;
  definition jsonb := jsonb_build_object(
    'title', 'Registro comercial {{contractNumber}} — {{accountName}}',
    'introduction', 'Registro da venda do SISTEMA POLITIZAI para {{accountName}}, conforme os dados e as condições confirmados no CRM.',
    'scope', 'Produto: SISTEMA POLITIZAI. O escopo e a descrição da venda constam no registro comercial preenchido pelo vendedor.',
    'payment', 'Valor total negociado: {{total}}. A entrada, as parcelas, a forma de pagamento e as condições são as informadas e confirmadas pelo vendedor no fechamento.'
  );
BEGIN
  IF current_schema() <> 'crm' AND current_schema() !~ '^politizai_test_' THEN
    RAISE EXCEPTION 'Configure o schema crm ou um schema temporário de testes.';
  END IF;
  SELECT id INTO STRICT workspace_id FROM workspaces
    WHERE slug = 'politizai' AND status = 'ACTIVE' AND "deletedAt" IS NULL;
  SELECT id INTO STRICT actor_id FROM actors
    WHERE "workspaceId" = workspace_id AND type = 'SYSTEM' AND key = 'system';
  PERFORM pg_advisory_xact_lock(hashtextextended('politizai-sales:' || workspace_id::text, 0));

  SELECT id INTO product_id FROM products
    WHERE "workspaceId" = workspace_id AND "deletedAt" IS NULL
      AND (sku = 'SISTEMA-POLITIZAI' OR upper(name) = 'SISTEMA POLITIZAI')
    ORDER BY version DESC, "createdAt" DESC LIMIT 1;
  IF product_id IS NULL THEN
    product_id := gen_random_uuid();
    INSERT INTO products (id, "workspaceId", "catalogItemId", version, sku, name,
      description, kind, "revenueCategory", audience, availability,
      "approvedConditions", "listPriceCents", currency, active, "salesGateProfile",
      "createdByActorId", "updatedByActorId", "createdAt", "updatedAt")
    VALUES (product_id, workspace_id, gen_random_uuid(), 1, 'SISTEMA-POLITIZAI', 'SISTEMA POLITIZAI',
      'Sistema Politizai com preço e condições definidos pelo vendedor em cada venda.',
      'LICENSE', 'SOFTWARE', 'INSTITUTIONAL', 'AVAILABLE',
      'Preço, entrada, parcelas e condições negociados pelo vendedor e confirmados no fechamento.',
      0, 'BRL', true, 'STANDARD', actor_id, actor_id, now(), now());
    created_product := true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = product_id AND active
    AND audience = 'INSTITUTIONAL' AND availability = 'AVAILABLE') THEN
    RAISE EXCEPTION 'O produto existente precisa de revisão de disponibilidade.';
  END IF;

  SELECT id, "currentVersion" INTO template_id, template_version FROM contract_templates
    WHERE "workspaceId" = workspace_id AND key = 'politizai-commercial-record';
  IF template_id IS NULL THEN
    template_id := gen_random_uuid();
    template_version := 1;
    INSERT INTO contract_templates (id, "workspaceId", key, name, purpose, status,
      "currentVersion", "legalReviewState", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt")
    VALUES (template_id, workspace_id, 'politizai-commercial-record',
      'Registro comercial — SISTEMA POLITIZAI',
      'Registro interno dos dados e condições negociados no fechamento da venda.',
      'ACTIVE', 1, 'PENDING_LEGAL', actor_id, actor_id, now(), now());
    created_template := true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = template_id
    AND status = 'ACTIVE' AND "deletedAt" IS NULL) THEN
    RAISE EXCEPTION 'O modelo existente precisa de revisão de disponibilidade.';
  END IF;
  SELECT id INTO version_id FROM contract_template_versions
    WHERE "workspaceId" = workspace_id AND "templateId" = template_id AND version = template_version;
  IF version_id IS NULL THEN
    version_id := gen_random_uuid();
    INSERT INTO contract_template_versions (id, "workspaceId", "templateId", version,
      "titleTemplate", introduction, "allowedVariables", "contentHash", "createdByActorId", "createdAt")
    VALUES (version_id, workspace_id, template_id, template_version,
      definition->>'title', definition->>'introduction',
      ARRAY['contractNumber', 'accountName', 'contactName', 'opportunityName', 'total'],
      encode(sha256(convert_to(definition::text, 'UTF8')), 'hex'), actor_id, now());
    INSERT INTO contract_template_clauses (id, "workspaceId", "templateVersionId", position, key, "titleTemplate", "bodyTemplate", "createdAt")
    VALUES (gen_random_uuid(), workspace_id, version_id, 0, 'scope', 'Produto e escopo', definition->>'scope', now()),
      (gen_random_uuid(), workspace_id, version_id, 1, 'payment', 'Valores e condições', definition->>'payment', now());
    created_template := true;
  END IF;
  IF created_product OR created_template THEN
    INSERT INTO audit_logs (id, "workspaceId", "actorId", action, "entityType", "entityId", changes, "occurredAt")
    VALUES (gen_random_uuid(), workspace_id, actor_id, 'sales.foundation.configured',
      'Workspace', workspace_id,
      jsonb_build_object('productId', product_id, 'templateVersionId', version_id,
        'createdProduct', created_product, 'createdTemplate', created_template,
        'pricing', 'SELLER_DEFINED'), now());
  END IF;
END
$setup$;
