import { describe, expect, it } from "vitest";
import { resolveMetaAdsSyncWindow } from "@/modules/integrations/application/meta-ads-service";

describe("janela de sincronização Meta Ads", () => {
  it("avança o cron um dia por execução sem pular lacunas", () => {
    expect(resolveMetaAdsSyncWindow({
      mode: "INCREMENTAL",
      automatic: true,
      watermarkDate: "2026-11-15",
      today: "2026-11-18",
      initialSince: "2026-09-22",
      lookbackDays: 7,
    })).toEqual({ since: "2026-11-16", until: "2026-11-16" });
  });

  it("revalida ontem e hoje quando o cron já está em dia", () => {
    expect(resolveMetaAdsSyncWindow({
      mode: "INCREMENTAL",
      automatic: true,
      watermarkDate: "2026-11-18",
      today: "2026-11-18",
      initialSince: "2026-09-22",
      lookbackDays: 7,
    })).toEqual({ since: "2026-11-17", until: "2026-11-18" });
  });

  it("mantém lookback e intervalo amplo somente na execução manual", () => {
    expect(resolveMetaAdsSyncWindow({
      mode: "INCREMENTAL",
      automatic: false,
      watermarkDate: "2026-11-17",
      today: "2026-11-18",
      initialSince: "2026-09-22",
      lookbackDays: 7,
    })).toEqual({ since: "2026-11-10", until: "2026-11-18" });
  });

  it("inicia o backfill automático pelo primeiro dia configurado", () => {
    expect(resolveMetaAdsSyncWindow({
      mode: "INITIAL",
      automatic: true,
      watermarkDate: null,
      today: "2026-11-18",
      initialSince: "2026-09-22",
      lookbackDays: 7,
    })).toEqual({ since: "2026-09-22", until: "2026-09-22" });
  });
});
