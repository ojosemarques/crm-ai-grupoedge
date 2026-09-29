import type { NextRequest } from "next/server";

export function revenueSearchInput(request: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    result[key] = values.length === 1 ? values[0]! : values;
  }
  return result;
}
