import { describe, expect, it } from "vitest";
import { calculateSatisfaction, classifySurvey, elapsedSeconds, nextCustomerRequestStatus } from "@/modules/customer-service/domain/customer-service-contracts";

describe("CRM-53 contratos determinísticos", () => {
  it("aceita somente transições finitas", () => {
    expect(nextCustomerRequestStatus("OPEN", "START")).toBe("IN_PROGRESS");
    expect(nextCustomerRequestStatus("OPEN", "CLOSE")).toBeNull();
    expect(nextCustomerRequestStatus("CLOSED", "REOPEN")).toBe("IN_PROGRESS");
  });
  it("calcula segundos sem produzir valor negativo", () => {
    const start = new Date("2053-02-01T12:00:00Z");
    expect(elapsedSeconds(start, new Date("2053-02-01T12:01:01Z"))).toBe(61);
    expect(elapsedSeconds(start, new Date("2053-02-01T11:00:00Z"))).toBe(0);
  });
  it("classifica NPS de forma reproduzível", () => {
    expect([6, 7, 9].map((value) => classifySurvey("NPS", value, 0, 10))).toEqual(["DETRACTOR", "PASSIVE", "PROMOTER"]);
    expect(classifySurvey("NPS", 11, 0, 10)).toBeNull();
  });
  it("mantém ausência sem métrica inventada", () => {
    expect(calculateSatisfaction("NPS", [], 0)).toEqual({ value: null, validResponses: 0, responseRate: null, distribution: {} });
    expect(calculateSatisfaction("NPS", [10, 8, 2], 4)).toMatchObject({ value: 0, validResponses: 3, responseRate: 0.75 });
    expect(calculateSatisfaction("CSAT", [4, 5], 2).value).toBe(4.5);
  });
});
