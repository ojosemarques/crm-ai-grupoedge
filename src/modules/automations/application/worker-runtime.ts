import { createDefaultAutomationActionRegistry } from "@/modules/automations/application/predefined-entry-automation-actions";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createLifecycleAutomationScanner } from "@/modules/automations/application/lifecycle-automation-scheduler";
import { createAutomationWorkerService } from "@/modules/automations/application/automation-worker-service";
import { createWorkerBatchRunner } from "@/modules/automations/application/worker-batch-runner";
import { createWhatsAppWebhookWorkerService } from "@/modules/integrations/application/whatsapp-webhook-worker-service";
import { createEmailMessageWorkerService } from "@/modules/integrations/application/email-message-worker-service";
import { localEmailSinkTransport } from "@/modules/integrations/application/email-transport";
import { createTelephonyWorkerService } from "@/modules/integrations/application/telephony-worker-service";
import { localTelephonySimulator } from "@/modules/integrations/application/telephony-transport";
import { createCalendarWorkerService } from "@/modules/integrations/application/calendar-worker-service";
import { localCalendarSandbox } from "@/modules/integrations/application/calendar-transport";
import { getPaymentWorkerService } from "@/modules/payments/application/payment-worker-service";
import type { ApplicationConfig } from "@/shared/core/config/application-config";
import { getDatabaseClient } from "@/shared/core/database/client";

export function createDefaultWorkerBatchRunner(config: ApplicationConfig) {
  const database = getDatabaseClient();
  const automationEngine = getAutomationEngineService();
  const common = {
    database,
    now: () => new Date(),
    lockTimeoutSeconds: config.AUTOMATION_LOCK_TIMEOUT_SECONDS,
    backoffBaseSeconds: config.AUTOMATION_BACKOFF_BASE_SECONDS,
  };
  const automationWorker = createAutomationWorkerService({
    ...common,
    actionExecutor: createDefaultAutomationActionRegistry(),
  });
  const lifecycleScanner = createLifecycleAutomationScanner({
    database,
    publish: automationEngine.publish,
    now: common.now,
  });
  const paymentWorker = getPaymentWorkerService();
  const calendarWorker = createCalendarWorkerService({ ...common, adapter: localCalendarSandbox });
  const telephonyWorker = createTelephonyWorkerService({ ...common, adapter: localTelephonySimulator });
  const emailWorker = createEmailMessageWorkerService({ ...common, transport: localEmailSinkTransport });
  const whatsappWorker = createWhatsAppWebhookWorkerService(common);

  return Object.freeze({
    database,
    runner: createWorkerBatchRunner({
      scanDue: lifecycleScanner.scanDue,
      processors: [
        { key: "payments", processNext: paymentWorker.processNext },
        { key: "calendar", processNext: calendarWorker.processNext },
        { key: "telephony", processNext: telephonyWorker.processNext },
        { key: "email", processNext: emailWorker.processNext },
        { key: "whatsapp", processNext: whatsappWorker.processNext },
        { key: "automations", processNext: automationWorker.processNext },
      ],
    }),
  });
}
