import encodeQR from "qr";
import decodeQR from "qr/decode.js";
import { describe, expect, it } from "vitest";

import { buildMarketingFormShareUrl, marketingFormQrDataUrl } from "@/modules/marketing-forms/domain/marketing-form-sharing";

describe("compartilhamento de formulário", () => {
  it("monta URL canônica com encoding e sem parâmetros arbitrários", () => {
    expect(buildMarketingFormShareUrl("https://crm.example", "captacao-mandato", {
      defaultUtmSource: "rede social",
      defaultUtmMedium: "bio/instagram",
      defaultUtmCampaign: "lançamento & mandato",
    })).toBe("https://crm.example/f/captacao-mandato?utm_source=rede+social&utm_medium=bio%2Finstagram&utm_campaign=lan%C3%A7amento+%26+mandato");
  });

  it("gera um QR que decodifica para a mesma URL", () => {
    const url = "https://crm.example/f/captacao?utm_source=instagram";
    expect(marketingFormQrDataUrl(url)).toMatch(/^data:image\/gif;base64,/);
    const matrix = encodeQR(url, "raw", { ecc: "medium", border: 4 });
    const scale = 5;
    const width = matrix.length * scale;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y += 1) for (let x = 0; x < width; x += 1) {
      const dark = matrix[Math.floor(y / scale)]![Math.floor(x / scale)]!;
      const offset = (y * width + x) * 4;
      data[offset] = dark ? 0 : 255;
      data[offset + 1] = dark ? 0 : 255;
      data[offset + 2] = dark ? 0 : 255;
      data[offset + 3] = 255;
    }
    expect(decodeQR({ width, height: width, data })).toBe(url);
  });
});
