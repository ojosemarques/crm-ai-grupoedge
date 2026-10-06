import { describe, expect, it } from "vitest";

import {
  POLITIZAI_MCP_CALLBACK_CLIENT_ID,
  POLITIZAI_MCP_CALLBACK_REDIRECT_URI,
  POLITIZAI_MCP_CLIENT_ID,
  POLITIZAI_MCP_REDIRECT_URI,
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
});
