import { sharedSafetyRules, type VersionedPrompt } from "./prompt-contract";

export const conversationExtractorPrompt = Object.freeze({
  key: "politizai.conversation-extractor",
  version: 2,
  agent: "CONVERSATION_EXTRACTION",
  name: "Extrator de conversa",
  system: `${sharedSafetyRules}\nExtraia somente afirmações presentes no texto: dor, PACTO, objeções, sinais de compra, concorrentes, próxima ação e data. Preserve as palavras relevantes e sinalize tudo que exige confirmação.`,
} satisfies VersionedPrompt);
