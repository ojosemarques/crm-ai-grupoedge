import { Prisma } from "@/generated/prisma/client";

// The producer fingerprint derives from the immutable source fingerprint,
// destination front and correction side. This producer's version defines that
// contract; retries use the same event keys and never modify existing facts.
export function commercialFrontClassificationSql(workspaceId: string, candidates: readonly Readonly<{ id: string; pipelineId: string }>[]) {
  return Prisma.sql`
    WITH candidates AS (
      SELECT id::uuid, "pipelineId"::uuid FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb) AS input(id text, "pipelineId" text)
    )
    INSERT INTO commercial_metric_facts
    SELECT (jsonb_populate_record(NULL::commercial_metric_facts,
      to_jsonb(f) || jsonb_build_object(
        'id', gen_random_uuid(),
        'eventKey', f."eventKey" || ':front-classification:' || side.kind || ':v1',
        'recordedAt', CURRENT_TIMESTAMP,
        'quantity', f.quantity * side.sign,
        'valueCents', f."valueCents" * side.sign,
        'correctionOfFactId', f.id,
        'reversedAt', NULL,
        'reversalReason', CASE WHEN side.kind = 'reversal'
          THEN 'Compensa contribuição sem frente para classificação histórica aditiva.'
          ELSE 'Classifica contribuição pela frente comprovada no intervalo histórico do lead.' END,
        'producerVersion', 'front-classification.v1',
        'inputFingerprint', encode(sha256(convert_to(f."inputFingerprint" || ':front-classification:v1:' || c."pipelineId" || ':' || side.kind, 'UTF8')), 'hex'),
        'safeMetadata', (CASE WHEN jsonb_typeof(f."safeMetadata") = 'object' THEN f."safeMetadata"
          WHEN f."safeMetadata" IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('_originalMetadata', f."safeMetadata") END)
          || jsonb_build_object('frontClassificationRule', 1, 'classifiedFactId', f.id)
          || CASE WHEN side.kind = 'replacement' THEN jsonb_build_object('_commercialFrontPipelineId', c."pipelineId") ELSE '{}'::jsonb END
      )
    )).*
    FROM commercial_metric_facts f JOIN candidates c ON c.id = f.id
    CROSS JOIN (VALUES ('reversal', -1), ('replacement', 1)) AS side(kind, sign)
    WHERE f."workspaceId" = ${workspaceId}::uuid
    ON CONFLICT ("workspaceId", "eventKey") DO NOTHING
  `;
}
