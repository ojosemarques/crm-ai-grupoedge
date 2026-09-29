import { NextResponse } from "next/server";

export function leadEntryResponse(result: unknown, successStatus = 200): NextResponse {
  const directlyRejected =
    result &&
    typeof result === "object" &&
    "outcome" in result &&
    result.outcome === "REJECTED";
  const nestedResult =
    result && typeof result === "object" && "result" in result
      ? result.result
      : null;
  const nestedRejected =
    nestedResult &&
    typeof nestedResult === "object" &&
    "outcome" in nestedResult &&
    nestedResult.outcome === "REJECTED";

  if (directlyRejected || nestedRejected) {
    return NextResponse.json({ result }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ result }, { status: successStatus, headers: { "Cache-Control": "no-store" } });
}
