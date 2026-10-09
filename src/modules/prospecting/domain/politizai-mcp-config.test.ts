import { describe, expect, it } from "vitest";

import {
  POLITIZAI_AUTONOMY_RULES,
  POLITIZAI_MCP_CALLBACK_CLIENT_ID,
  POLITIZAI_MCP_CALLBACK_REDIRECT_URI,
  POLITIZAI_MCP_CLIENT_ID,
  POLITIZAI_MCP_INSTRUCTIONS,
  POLITIZAI_MCP_REDIRECT_URI,
  POLITIZAI_MCP_SERVER_VERSION,
  isAllowedPolitizaiMcpClientId,
  isAllowedPolitizaiMcpClientRegistration,
} from "@/modules/prospecting/domain/politizai-mcp-config";

describe("configuração de clientes OAuth do MCP Politizai", () => {
  it("aceita somente os pares exatos de cliente e callback do ChatGPT", () => {
    expect(isAllowedPolitizaiMcpClientRegistration(POLITIZAI_MCP_CLIENT_ID, POLITIZAI_MCP_REDIRECT_URI)).toBe(true);
    expect(isAllowedPolitizaiMcpClientRegistration(POLITIZAI_MCP_CALLBACK_CLIENT_ID, POLITIZAI_MCP_CALLBACK_REDIRECT_URI)).toBe(true);
    expect(isAllowedPolitizaiMcpClientRegistration(POLITIZAI_MCP_CALLBACK_CLIENT_ID, POLITIZAI_MCP_REDIRECT_URI)).toBe(false);
    expect(isAllowedPolitizaiMcpClientRegistration("https://chatgpt.com/oauth/outro/client.json", "https://chatgpt.com/connector/oauth/outro")).toBe(false);
  });

  it("reconhece somente os client IDs permitidos para refresh e revogação", () => {
    expect(isAllowedPolitizaiMcpClientId(POLITIZAI_MCP_CLIENT_ID)).toBe(true);
    expect(isAllowedPolitizaiMcpClientId(POLITIZAI_MCP_CALLBACK_CLIENT_ID)).toBe(true);
    expect(isAllowedPolitizaiMcpClientId("https://chatgpt.com/oauth/outro/client.json")).toBe(false);
  });

  it("publica a política autônoma contínua sem depender de perguntas ao usuário", () => {
    expect(POLITIZAI_MCP_SERVER_VERSION).toBe("1.4.3");
    expect(POLITIZAI_AUTONOMY_RULES).toEqual({
      executionMode: "CONTINUOUS_UNTIL_QUEUE_EMPTY",
      askUserForResearchInput: false,
      sourceUnavailableAction: "RECORD_CONTINUE_AND_FINISH_TARGET",
      runtimeUnavailableAction: "RETRY_AUTOMATICALLY_WITHOUT_CLAIMING_NEW_TARGETS",
    });
    expect(POLITIZAI_MCP_INSTRUCTIONS).toContain("sem pedir ao usuário links, contatos ou decisões de pesquisa");
    expect(POLITIZAI_MCP_INSTRUCTIONS).toContain("reserve imediatamente o próximo alvo");
    expect(POLITIZAI_MCP_INSTRUCTIONS).toContain("tente recuperar automaticamente");
  });
});
