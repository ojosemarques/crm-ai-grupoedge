import { describe, expect, it, vi } from "vitest";
import { advertisingMessageActivities } from "./realtime-advertising-activities";

describe("mensagens manuais de anúncios", () => {
  it("conta logs sem fato de canal uma vez, pela frente histórica e pelo autor do workspace", async () => {
    const from = new Date("2026-10-28T03:00:00Z"), to = new Date("2026-10-28T18:00:00Z");
    const activity = (id: string, leadId: string) => ({ id, leadId, occurredAt: new Date("2026-10-28T14:00:00Z"), createdAt: to, createdBy: { userId: "user" } });
    const database = {
      activity: { findMany: vi.fn().mockResolvedValue([activity("manual", "ads-lead"), activity("already-counted", "ads-lead"), activity("prospecting", "pros-lead"), activity("unknown", "unknown-lead")]) },
      stageHistory: { findMany: vi.fn().mockResolvedValue([{ leadId: "ads-lead", pipelineId: "ads", enteredAt: from, exitedAt: null }, { leadId: "pros-lead", pipelineId: "pros", enteredAt: from, exitedAt: null }]) },
      workspaceMember: { findMany: vi.fn().mockResolvedValue([{ userId: "user", id: "carlos" }]) },
    };
    const rows = await advertisingMessageActivities(database as never, "workspace", from, to, new Set(["ads"]), new Set(["already-counted"]), { ownerMemberId: "carlos" });
    expect(rows.map(row => [row.id, row.creditedMemberId, row.quantity])).toEqual([["manual", "carlos", 1]]);
    expect(database.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace", lead: { ownerMemberId: "carlos" }, deletedAt: null, correctsActivityId: null, messageId: null }) }));
    expect(database.stageHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace" }) }));
    expect(database.workspaceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", userId: { in: ["user"] } } }));
  });
});
