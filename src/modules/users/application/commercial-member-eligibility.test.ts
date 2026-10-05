import { describe, expect, it } from "vitest";

import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";

describe("elegibilidade operacional de membros comerciais", () => {
  it("inclui vendedor pelo papel do workspace mesmo com outro vínculo de equipe", () => {
    const where = commercialMemberWhere({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      functions: ["CLOSER"],
    });

    expect(where).toMatchObject({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      status: "ACTIVE",
      OR: expect.arrayContaining([
        {
          role: { key: { in: ["closer"] }, deletedAt: null },
        },
      ]),
    });
  });

  it("não atravessa o escopo de equipe para recuperar membro sem vínculo", () => {
    const where = commercialMemberWhere({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      functions: ["SDR", "CLOSER"],
      teamIds: ["00000000-0000-4000-8000-000000000002"],
    });

    expect(where.OR).toHaveLength(1);
    expect(where.OR).toEqual([
      {
        teamMemberships: {
          some: expect.objectContaining({
            teamId: { in: ["00000000-0000-4000-8000-000000000002"] },
          }),
        },
      },
    ]);
  });
});
