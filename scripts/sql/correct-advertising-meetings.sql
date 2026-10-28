-- Maintenance only. Supply a reviewed JSON manifest through crm.advertising_repair.
-- No campaigns, messages, reminders, offers or sales are created by this repair.
DO $repair$
DECLARE
  request jsonb := current_setting('crm.advertising_repair')::jsonb;
  ws uuid := (request->>'workspaceId')::uuid;
  run_id uuid := (request->>'runId')::uuid;
  signature text := encode(sha256(convert_to((request-'mode')::text,'UTF8')),'hex');
  system_actor uuid; ads uuid; manual_source uuid; general_queue uuid; p3 uuid;
  now_at timestamptz := CURRENT_TIMESTAMP;
  item jsonb; lead_row record; meeting_row record; active_history record; task_row record;
  lead_id uuid; contact_id uuid; submission_id uuid; meeting_id uuid;
  stage_id uuid; history_id uuid; activity_id uuid; stage_activity_id uuid; booking_history_id uuid;
  outcome_history_id uuid; closer_id uuid; slot timestamptz; duration_minutes integer;
  target_status text; before_state jsonb; before_quality text;
  facts jsonb := '[]'::jsonb; common jsonb; saved_signature text; count_inserted integer;
BEGIN
  IF current_schema() <> 'crm' AND current_schema() !~ '^politizai_test_' THEN
    RAISE EXCEPTION 'REPAIR_SCHEMA_NOT_ALLOWED';
  END IF;
  IF current_schema()='crm' AND ws<>'f99613d9-f4a1-449e-a19f-ed9ec3d46105'::uuid THEN
    RAISE EXCEPTION 'REPAIR_WORKSPACE_NOT_ALLOWED';
  END IF;
  IF coalesce(request->>'mode','') NOT IN ('DRY_RUN','APPLY') OR coalesce(jsonb_array_length(request->'items'),0) NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'REPAIR_INVALID_MANIFEST';
  END IF;
  IF (SELECT count(DISTINCT x->>'leadId') FROM jsonb_array_elements(request->'items') x)<>jsonb_array_length(request->'items') THEN
    RAISE EXCEPTION 'REPAIR_DUPLICATE_TARGET';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('advertising-meeting-repair:'||ws::text,0));
  SELECT metadata->>'fingerprint' INTO saved_signature FROM audit_logs
    WHERE "workspaceId"=ws AND action='advertising.meetings.repair_applied' AND "entityId"=run_id;
  IF FOUND THEN
    IF saved_signature IS DISTINCT FROM signature THEN RAISE EXCEPTION 'REPAIR_REPLAY_CONFLICT'; END IF;
    RETURN;
  END IF;
  SELECT id INTO STRICT system_actor FROM actors WHERE "workspaceId"=ws AND key='system' AND type='SYSTEM';
  SELECT id INTO STRICT ads FROM pipelines WHERE "workspaceId"=ws AND name='Anúncios' AND "entityType"='LEAD' AND "deletedAt" IS NULL;
  SELECT id INTO STRICT manual_source FROM lead_sources WHERE "workspaceId"=ws AND key='manual' AND "deletedAt" IS NULL;
  SELECT id INTO STRICT general_queue FROM queues WHERE "workspaceId"=ws AND "isGeneral" AND "deletedAt" IS NULL;
  SELECT id INTO STRICT p3 FROM lead_priority_bands WHERE "workspaceId"=ws AND code='P3' AND "deletedAt" IS NULL;
  SELECT "defaultMeetingDurationMinutes" INTO STRICT duration_minutes FROM workspaces WHERE id=ws AND status='ACTIVE' AND "deletedAt" IS NULL;

  -- Validate every target before changing anything. Any stale or foreign target aborts the whole batch.
  FOR item IN SELECT value FROM jsonb_array_elements(request->'items') LOOP
    lead_id := (item->>'leadId')::uuid;
    closer_id := (item->>'closerId')::uuid;
    slot := (item->>'startsAt')::timestamptz;
    IF item->>'status' NOT IN ('COMPLETED','NO_SHOW') OR slot>now_at THEN RAISE EXCEPTION 'REPAIR_INVALID_OUTCOME'; END IF;
    PERFORM 1 FROM workspace_members WHERE id=closer_id AND "workspaceId"=ws AND status='ACTIVE' AND "deletedAt" IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_CLOSER_NOT_FOUND'; END IF;
    IF coalesce((item->>'newLead')::boolean,false) THEN
      PERFORM 1 FROM leads WHERE "workspaceId"=ws AND (id=lead_id OR ("pipelineId"=ads AND "normalizedPhone"=item->>'phone' AND "deletedAt" IS NULL));
      IF FOUND THEN RAISE EXCEPTION 'REPAIR_NEW_LEAD_ALREADY_EXISTS'; END IF;
      IF item->>'relatedLeadId' IS NOT NULL THEN
        PERFORM 1 FROM leads l JOIN contact_points cp ON cp."contactId"=l."contactId" AND cp."workspaceId"=l."workspaceId"
          JOIN contacts c ON c.id=l."contactId" AND c."workspaceId"=l."workspaceId"
          WHERE l.id=(item->>'relatedLeadId')::uuid AND l."workspaceId"=ws AND l."contactId"=(item->>'contactId')::uuid
            AND l."deletedAt" IS NULL AND NOT l."needsIdentityReview" AND cp."deletedAt" IS NULL AND c."deletedAt" IS NULL AND c.status='ACTIVE'
            AND cp."normalizedValue"=item->>'phone';
        IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_CONFIRMED_CONTACT_LINK_MISSING'; END IF;
        IF coalesce((item->>'confirmIdentity')::boolean,false) AND EXISTS(
          SELECT 1 FROM contact_identity_reviews WHERE "workspaceId"=ws AND status='OPEN'
            AND ("contactId"=(item->>'contactId')::uuid OR "candidateContactId"=(item->>'contactId')::uuid)
        ) THEN RAISE EXCEPTION 'REPAIR_IDENTITY_REVIEW_REQUIRED'; END IF;
      END IF;
    ELSE
      SELECT * INTO STRICT lead_row FROM leads WHERE id=lead_id AND "workspaceId"=ws AND "pipelineId"=ads AND "deletedAt" IS NULL FOR UPDATE;
      IF lead_row."currentStageId"<>(item->>'expectedStageId')::uuid OR lead_row."normalizedPhone" IS DISTINCT FROM item->>'phone'
        OR lead_row.status='CONVERTED' THEN RAISE EXCEPTION 'REPAIR_STALE_LEAD'; END IF;
      IF (SELECT count(*) FROM stage_history WHERE "workspaceId"=ws AND "leadId"=lead_id AND "opportunityId" IS NULL AND "exitedAt" IS NULL)<>1 THEN
        RAISE EXCEPTION 'REPAIR_INVALID_STAGE_HISTORY';
      END IF;
    END IF;
    IF item->>'meetingId' IS NOT NULL THEN
      SELECT * INTO STRICT meeting_row FROM meetings WHERE id=(item->>'meetingId')::uuid AND "workspaceId"=ws AND "leadId"=lead_id AND "deletedAt" IS NULL FOR UPDATE;
      IF meeting_row.revision<>(item->>'expectedMeetingRevision')::integer OR meeting_row.status NOT IN ('SCHEDULED','CONFIRMED') THEN
        RAISE EXCEPTION 'REPAIR_STALE_MEETING';
      END IF;
    ELSIF EXISTS(SELECT 1 FROM meetings WHERE "workspaceId"=ws AND "leadId"=lead_id AND "deletedAt" IS NULL) THEN
      RAISE EXCEPTION 'REPAIR_UNEXPECTED_MEETING';
    END IF;
  END LOOP;
  IF request->>'mode'='DRY_RUN' THEN RETURN; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(request->'items') LOOP
    lead_id := (item->>'leadId')::uuid; closer_id := (item->>'closerId')::uuid; stage_activity_id := gen_random_uuid();
    slot := (item->>'startsAt')::timestamptz; target_status := item->>'status';
    SELECT id INTO STRICT stage_id FROM pipeline_stages WHERE "workspaceId"=ws AND "pipelineId"=ads AND "deletedAt" IS NULL
      AND "leadStageCode"::text=CASE WHEN target_status='COMPLETED' THEN 'PROPOSAL' ELSE 'MEETING_NO_SHOW' END;
    before_state := NULL;
    IF coalesce((item->>'newLead')::boolean,false) THEN
      contact_id := (item->>'contactId')::uuid; submission_id := gen_random_uuid();
      IF item->>'relatedLeadId' IS NULL THEN
        INSERT INTO contacts(id,"workspaceId","preferredName",origin,status,quality,"createdByActorId","updatedByActorId","createdAt","updatedAt")
          VALUES(contact_id,ws,item->>'name','MANUAL','ACTIVE','UNKNOWN',system_actor,system_actor,now_at,now_at);
        INSERT INTO contact_points(id,"workspaceId","contactId",type,"originalValue","normalizedValue","isPrimary",source,"createdByActorId","updatedByActorId","createdAt","updatedAt")
          VALUES(gen_random_uuid(),ws,contact_id,'PHONE',item->>'phone',item->>'phone',true,'MANUAL',system_actor,system_actor,now_at,now_at);
      ELSIF coalesce((item->>'confirmIdentity')::boolean,false) THEN
        SELECT quality::text INTO STRICT before_quality FROM contacts WHERE id=contact_id AND "workspaceId"=ws FOR UPDATE;
        UPDATE contacts SET quality='CONFIRMED',"updatedAt"=now_at,"updatedByActorId"=system_actor WHERE id=contact_id AND "workspaceId"=ws;
        INSERT INTO audit_logs(id,"workspaceId","actorId",action,"entityType","entityId",reason,changes,metadata)
          VALUES(gen_random_uuid(),ws,system_actor,'contact.identity.user_confirmed','Contact',contact_id,'Usuário confirmou expressamente a mesma pessoa nas duas frentes.',
            jsonb_build_object('fromQuality',before_quality,'toQuality','CONFIRMED','relatedLeadId',item->>'relatedLeadId'),jsonb_build_object('repairRunId',run_id));
      END IF;
      INSERT INTO leads(id,"workspaceId","contactId","sourceId","pipelineId","currentStageId","queueId","routingQueueId","fullName","normalizedPhone",status,
        "slaStartedAt","slaDueAt","lastActivityAt","createdByActorId","updatedByActorId","createdAt","updatedAt")
        VALUES(lead_id,ws,contact_id,manual_source,ads,stage_id,general_queue,general_queue,item->>'name',item->>'phone','QUALIFIED',now_at,now_at,now_at,system_actor,system_actor,now_at,now_at);
      INSERT INTO lead_form_submissions(id,"workspaceId","leadId","contactId","sourceId",status,channel,"intakeOutcome","formIdentifier","idempotencyKey",
        "submittedFullName","submittedPhone","normalizedPhone","submittedAt","rawPayload","createdByActorId","createdAt")
        VALUES(submission_id,ws,lead_id,contact_id,manual_source,'LINKED','MANUAL','CREATED','user-confirmed-advertising-repair',run_id::text||':'||lead_id::text,
          item->>'name',item->>'phone',item->>'phone',now_at,jsonb_build_object('repairRunId',run_id,'acquisitionReportedByUser','Anúncios','campaignUnknown',true),system_actor,now_at);
      INSERT INTO lead_sla_cycles(id,"workspaceId","leadId","submissionId","priorityBandId","assignedQueueId","receivedAt","assignedAt","automaticAcknowledgedAt","createdByActorId","createdAt")
        VALUES(gen_random_uuid(),ws,lead_id,submission_id,p3,general_queue,now_at,now_at,now_at,system_actor,now_at);
    ELSE
      SELECT * INTO STRICT lead_row FROM leads WHERE id=lead_id AND "workspaceId"=ws;
      before_state := jsonb_build_object('stageId',lead_row."currentStageId",'status',lead_row.status,'updatedAt',lead_row."updatedAt",'lastActivityAt',lead_row."lastActivityAt",'updatedByActorId',lead_row."updatedByActorId",'nextActionTaskId',lead_row."nextActionTaskId",'nextActionAt',lead_row."nextActionAt",'nextActionDescription',lead_row."nextActionDescription");
      contact_id := lead_row."contactId";
    END IF;
    SELECT * INTO STRICT lead_row FROM leads WHERE id=lead_id AND "workspaceId"=ws;
    common := jsonb_build_object('workspaceId',ws,'occurredAt',now_at,'recordedAt',now_at,'sourceRevision',1,'quantity',1,
      'executionMode','MANUAL','definitionVersion',1,'producerVersion','advertising-repair.v1','leadId',lead_id,'contactId',contact_id,
      'pipelineId',ads,'sourceId',lead_row."sourceId",'leadOwnerMemberIdAtEvent',lead_row."ownerMemberId",
      'safeMetadata',jsonb_build_object('_commercialFrontPipelineId',ads,'repairRunId',run_id,'userConfirmed',true,'reportedStartsAt',slot,
        'occurredAtBasis','administrative_confirmation','originalBookingTimeUnknown',true,'noMessagesOrReminders',true));
    IF coalesce((item->>'newLead')::boolean,false) THEN
      facts := facts || jsonb_build_array(
        common||jsonb_build_object('eventKey','lead:'||lead_id||':created:v1','eventType','LEAD_CREATED','sourceEntityType','Lead','sourceEntityId',lead_id),
        common||jsonb_build_object('eventKey','submission:'||submission_id||':attached:v1','eventType','LEAD_SUBMISSION_ATTACHED','sourceEntityType','LeadFormSubmission','sourceEntityId',submission_id));
      IF item->>'relatedLeadId' IS NULL THEN
        facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','contact:'||contact_id||':created:v1','eventType','CONTACT_CREATED','sourceEntityType','Contact','sourceEntityId',contact_id));
      END IF;
    END IF;
    IF NOT coalesce((item->>'newLead')::boolean,false) THEN
      SELECT * INTO STRICT active_history FROM stage_history WHERE "workspaceId"=ws AND "leadId"=lead_id AND "opportunityId" IS NULL AND "exitedAt" IS NULL;
      UPDATE stage_history SET "exitedAt"=now_at,"exitedByActorId"=system_actor WHERE id=active_history.id AND "workspaceId"=ws;
      facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','stage-history:'||active_history.id||':exited:v1','eventType','STAGE_EXITED',
        'sourceEntityType','StageHistory','sourceEntityId',active_history.id,'activityId',stage_activity_id,'stageId',lead_row."currentStageId",'fromStageId',lead_row."currentStageId",'toStageId',stage_id,'result','MANAGER_CORRECTION'));
    END IF;
    history_id := gen_random_uuid(); activity_id := gen_random_uuid();
    INSERT INTO stage_history(id,"workspaceId","pipelineId","stageId","leadId","enteredAt","enteredByActorId","transitionOrigin","transitionReason","managerCorrection")
      VALUES(history_id,ws,ads,stage_id,lead_id,now_at,system_actor,'SYSTEM','Correção pontual de etapa e reunião confirmada pelo usuário.',true);
    UPDATE leads SET "currentStageId"=stage_id,status='QUALIFIED',"lastActivityAt"=now_at,"updatedAt"=now_at,"updatedByActorId"=system_actor WHERE id=lead_id AND "workspaceId"=ws;
    INSERT INTO activities(id,"workspaceId","leadId",type,direction,result,subject,description,"occurredAt","previousValues","newValues","createdByActorId","updatedByActorId","createdAt","updatedAt")
      VALUES(stage_activity_id,ws,lead_id,'STAGE_CHANGE','INTERNAL','CORRECTED','Correção gerencial de etapa após conferência da reunião',
        'Etapa corrigida por solicitação explícita do usuário. Não representa emissão de proposta ou criação de venda.',now_at,before_state,
        jsonb_build_object('stageId',stage_id,'repairRunId',run_id),system_actor,system_actor,now_at,now_at);
    facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','stage-history:'||history_id||':entered:v1','eventType','STAGE_ENTERED',
      'sourceEntityType','StageHistory','sourceEntityId',history_id,'activityId',stage_activity_id,'stageId',stage_id,'result','MANAGER_CORRECTION'));
    IF item->>'meetingId' IS NULL THEN
      meeting_id := gen_random_uuid(); booking_history_id := gen_random_uuid();
      INSERT INTO meetings(id,"workspaceId","leadId","ownerMemberId",title,status,"startsAt","endsAt","durationMinutes","timeZone","completedAt","noShowAt",outcome,revision,
        "createdByActorId","updatedByActorId","createdAt","updatedAt",observation)
        VALUES(meeting_id,ws,lead_id,closer_id,'Reunião registrada por confirmação histórica do usuário',target_status::"MeetingStatus",slot,slot+make_interval(mins=>duration_minutes),duration_minutes,'America/Sao_Paulo',
          CASE WHEN target_status='COMPLETED' THEN now_at END,CASE WHEN target_status='NO_SHOW' THEN now_at END,'Resultado e horário confirmados pelo usuário.',2,system_actor,system_actor,now_at,now_at,
          'Registro retroativo, sem convite ou lembrete. Duração reservada padrão do workspace; duração efetiva não informada. Agendador original não informado.');
      INSERT INTO meeting_history(id,"workspaceId","meetingId","leadId","ownerMemberId","meetingRevision",action,"newStatus","newStartsAt","newEndsAt","occurredAt","recordedByActorId",reason)
        VALUES(booking_history_id,ws,meeting_id,lead_id,closer_id,1,'SCHEDULED','SCHEDULED',slot,slot+make_interval(mins=>duration_minutes),now_at,system_actor,'Agendamento histórico confirmado pelo usuário; data original de registro não informada.');
      facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','meeting-history:'||booking_history_id||':scheduled:v1','eventType','MEETING_SCHEDULED',
        'sourceEntityType','MeetingHistory','sourceEntityId',booking_history_id,'meetingId',meeting_id,'meetingOwnerMemberIdAtEvent',closer_id));
      SELECT * INTO STRICT meeting_row FROM meetings WHERE id=meeting_id AND "workspaceId"=ws;
    ELSE
      meeting_id := (item->>'meetingId')::uuid;
      SELECT * INTO STRICT meeting_row FROM meetings WHERE id=meeting_id AND "workspaceId"=ws;
      before_state := before_state||jsonb_build_object('meeting',jsonb_build_object('id',meeting_id,'status',meeting_row.status,'startsAt',meeting_row."startsAt",'endsAt',meeting_row."endsAt",'ownerMemberId',meeting_row."ownerMemberId",'revision',meeting_row.revision,'outcome',meeting_row.outcome,'completedAt',meeting_row."completedAt",'noShowAt',meeting_row."noShowAt",'updatedAt',meeting_row."updatedAt",'updatedByActorId',meeting_row."updatedByActorId"));
      UPDATE meetings SET status=target_status::"MeetingStatus","startsAt"=slot,"endsAt"=slot+make_interval(mins=>meeting_row."durationMinutes"),"ownerMemberId"=closer_id,
        "completedAt"=CASE WHEN target_status='COMPLETED' THEN now_at END,"noShowAt"=CASE WHEN target_status='NO_SHOW' THEN now_at END,
        outcome='Resultado e horário confirmados pelo usuário.',revision=revision+1,"updatedAt"=now_at,"updatedByActorId"=system_actor WHERE id=meeting_id AND "workspaceId"=ws;
    END IF;
    outcome_history_id := gen_random_uuid();
    INSERT INTO meeting_history(id,"workspaceId","meetingId","leadId","ownerMemberId","meetingRevision",action,"previousStatus","newStatus","previousStartsAt","previousEndsAt","newStartsAt","newEndsAt","occurredAt","recordedByActorId",reason,outcome)
      SELECT outcome_history_id,ws,meeting_id,lead_id,closer_id,m.revision,
        CASE WHEN target_status='COMPLETED' THEN 'ATTENDED' ELSE 'NO_SHOW' END::"MeetingHistoryAction",CASE WHEN item->>'meetingId' IS NULL THEN 'SCHEDULED'::"MeetingStatus" ELSE meeting_row.status END,target_status::"MeetingStatus",meeting_row."startsAt",meeting_row."endsAt",m."startsAt",m."endsAt",now_at,system_actor,
        'Correção de resultado e etapa solicitada expressamente pelo usuário.','Resultado confirmado; confirmação administrativa registrada agora.' FROM meetings m WHERE m.id=meeting_id AND m."workspaceId"=ws;
    INSERT INTO activities(id,"workspaceId","leadId","meetingId",type,direction,result,subject,description,"occurredAt","previousValues","newValues","createdByActorId","updatedByActorId","createdAt","updatedAt")
      VALUES(activity_id,ws,lead_id,meeting_id,'MEETING','INTERNAL',target_status::"ActivityResult",'Correção de reunião e etapa confirmada pelo usuário',
        'Horário de reunião confirmado pelo usuário. Registro administrativo retroativo; não houve envio de convite, proposta comercial ou mensagem.',now_at,before_state,
        jsonb_build_object('stageId',stage_id,'meetingStatus',target_status,'meetingId',meeting_id,'startsAt',slot,'closerId',closer_id,'repairRunId',run_id),system_actor,system_actor,now_at,now_at);
    facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','meeting-history:'||outcome_history_id||':'||CASE WHEN target_status='COMPLETED' THEN 'meeting_completed' ELSE 'meeting_no_show' END||':v1',
      'eventType',CASE WHEN target_status='COMPLETED' THEN 'MEETING_COMPLETED' ELSE 'MEETING_NO_SHOW' END,'sourceEntityType','MeetingHistory','sourceEntityId',outcome_history_id,
      'meetingId',meeting_id,'activityId',activity_id,'creditedMemberId',closer_id,'meetingOwnerMemberIdAtEvent',closer_id,'result',target_status));
    FOR task_row IN SELECT * FROM tasks WHERE "workspaceId"=ws AND "meetingId"=meeting_id AND status IN ('OPEN','IN_PROGRESS') AND "deletedAt" IS NULL FOR UPDATE LOOP
      before_state := coalesce(before_state,'{}'::jsonb)||jsonb_build_object('meetingTasksBefore',coalesce(before_state->'meetingTasksBefore','[]'::jsonb)||
        jsonb_build_array(jsonb_build_object('id',task_row.id,'status',task_row.status,'result',task_row.result,'completedAt',task_row."completedAt",'updatedAt',task_row."updatedAt",'updatedByActorId',task_row."updatedByActorId")));
      UPDATE tasks SET status=CASE WHEN target_status='COMPLETED' THEN 'COMPLETED' ELSE 'CANCELLED' END::"TaskStatus",result=target_status,
        "completedAt"=CASE WHEN target_status='COMPLETED' THEN now_at END,"updatedAt"=now_at,"updatedByActorId"=system_actor WHERE id=task_row.id AND "workspaceId"=ws;
      facts := facts||jsonb_build_array(common||jsonb_build_object('eventKey','task:'||task_row.id||':'||CASE WHEN target_status='COMPLETED' THEN 'completed' ELSE 'cancelled' END||':meeting:'||outcome_history_id||':v1',
        'eventType',CASE WHEN target_status='COMPLETED' THEN 'TASK_COMPLETED' ELSE 'TASK_CANCELLED' END,'sourceEntityType','Task','sourceEntityId',task_row.id,'taskId',task_row.id,
        'meetingId',meeting_id,'creditedMemberId',task_row."assigneeMemberId",'taskKind',task_row.kind,'result',target_status));
    END LOOP;
    IF EXISTS(SELECT 1 FROM tasks WHERE id=lead_row."nextActionTaskId" AND "workspaceId"=ws AND "meetingId"=meeting_id AND status IN ('COMPLETED','CANCELLED')) THEN
      SELECT * INTO task_row FROM tasks WHERE "workspaceId"=ws AND "leadId"=lead_id AND status IN ('OPEN','IN_PROGRESS') AND "deletedAt" IS NULL ORDER BY "dueAt",id LIMIT 1;
      UPDATE leads SET "nextActionTaskId"=task_row.id,"nextActionAt"=task_row."dueAt","nextActionDescription"=task_row.title WHERE id=lead_id AND "workspaceId"=ws;
    END IF;
    INSERT INTO audit_logs(id,"workspaceId","actorId",action,"entityType","entityId",reason,changes,metadata)
      VALUES(gen_random_uuid(),ws,system_actor,'advertising.meeting.user_corrected','Lead',lead_id,'Etapas, responsáveis e resultados confirmados diretamente pelo usuário.',
        jsonb_build_object('before',before_state,'stageId',stage_id,'meetingId',meeting_id,'status',target_status,'startsAt',slot,'closerId',closer_id,'newLead',coalesce((item->>'newLead')::boolean,false)),jsonb_build_object('repairRunId',run_id));
  END LOOP;
  INSERT INTO commercial_metric_facts
    SELECT (jsonb_populate_record(NULL::commercial_metric_facts,value||jsonb_build_object('id',gen_random_uuid(),'inputFingerprint',encode(sha256(convert_to(value::text,'UTF8')),'hex')))).*
    FROM jsonb_array_elements(facts)
    ON CONFLICT ("workspaceId","eventKey") DO NOTHING;
  GET DIAGNOSTICS count_inserted=ROW_COUNT;
  IF count_inserted<>jsonb_array_length(facts) THEN RAISE EXCEPTION 'REPAIR_FACT_CONFLICT'; END IF;
  INSERT INTO audit_logs(id,"workspaceId","actorId",action,"entityType","entityId",reason,changes,metadata)
    VALUES(run_id,ws,system_actor,'advertising.meetings.repair_applied','MaintenanceRun',run_id,'Correção limitada de Anúncios confirmada pelo usuário.',
      jsonb_build_object('leads',jsonb_array_length(request->'items'),'facts',count_inserted,'newLeads',(SELECT count(*) FROM jsonb_array_elements(request->'items') x WHERE (x->>'newLead')::boolean)),
      jsonb_build_object('fingerprint',signature,'noMessagesOrReminders',true,'noSalesOrOffersCreated',true));
END $repair$;
