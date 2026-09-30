import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiResourceSchema } from "@/modules/acquisition-api/domain/public-api-contracts";
import { getPublicApiService } from "@/modules/acquisition-api/application/public-api-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
type Context = { params: Promise<{ resource: string }> };
function bearer(request: NextRequest) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : ""; }
export async function GET(request: NextRequest, context: Context) { try { await enforceRateLimit("public-api-v1", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const resource = apiResourceSchema.parse((await context.params).resource); return NextResponse.json(await getPublicApiService().list(bearer(request), resource, Object.fromEntries(request.nextUrl.searchParams)), { headers: { "Cache-Control": "no-store", "X-API-Version": "2026-09-30" } }); } catch (error) { return handleRouteError(error); } }
export async function POST(request: NextRequest, context: Context) { try { await enforceRateLimit("public-api-v1", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const resource = apiResourceSchema.parse((await context.params).resource); const result = await getPublicApiService().create(bearer(request), resource, request.headers.get("idempotency-key") ?? "", await readLimitedJson(request, 64 * 1024)); return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "no-store", "X-API-Version": "2026-09-30" } }); } catch (error) { return handleRouteError(error); } }
