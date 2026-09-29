import type { AutomationActionType } from "@/generated/prisma/client";
import type {
  AutomationActionExecution,
  AutomationActionExecutor,
} from "@/modules/automations/domain/automation-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

type ActionHandler = (
  ...parameters: Parameters<AutomationActionExecutor["execute"]>
) => ReturnType<AutomationActionExecutor["execute"]>;

export function createAutomationActionRegistry(
  handlers: Partial<Record<AutomationActionType, ActionHandler>> = {},
): AutomationActionExecutor {
  return Object.freeze({
    async execute(transaction, execution: AutomationActionExecution) {
      const handler = handlers[execution.actionType];
      if (!handler) {
        throw new ApplicationError(
          `A ação ${execution.actionType} ainda não possui um serviço de domínio registrado.`,
          {
            code: "AUTOMATION_ACTION_NOT_REGISTERED",
            statusCode: 409,
            expose: true,
          },
        );
      }
      return handler(transaction, execution);
    },
  });
}
