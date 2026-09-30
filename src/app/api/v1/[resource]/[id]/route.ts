import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiResourceSchema } from "@/modules/acquisition-api/domain/public-api-contracts";
import { getPublicApiService } from "@/modules/acquisition-api/application/public-api-service";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { enforceRateLimit, readLimitedJson, requestClientKey, sensitiveEndpointPolicies } from "@/shared/core/http/request-hardening";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
type Context = { params: Promise<{ resource: string; id: string }> }; const idSchema = z.string().uuid();
function bearer(request: NextRequest) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : ""; }
async function params(context: Context) { const raw = await context.params; return { resource: apiResourceSchema.parse(raw.resource), id: idSchema.parse(raw.id) }; }
export async function GET(request: NextRequest, context: Context) { try { await enforceRateLimit("public-api-v1", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const target = await params(context); return NextResponse.json(await getPublicApiService().get(bearer(request), target.resource, target.id), { headers: { "Cache-Control": "no-store", "X-API-Version": "2026-09-30" } }); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: NextRequest, context: Context) { try { await enforceRateLimit("public-api-v1", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const target = await params(context); return NextResponse.json(await getPublicApiService().update(bearer(request), target.resource, target.id, request.headers.get("idempotency-key") ?? "", await readLimitedJson(request, 64 * 1024)), { headers: { "Cache-Control": "no-store", "X-API-Version": "2026-09-30" } }); } catch (error) { return handleRouteError(error); } }
export async function DELETE(request: NextRequest, context: Context) { try { await enforceRateLimit("public-api-v1", requestClientKey(request), sensitiveEndpointPolicies.n8nMachine); const target = await params(context); return NextResponse.json(await getPublicApiService().remove(bearer(request), target.resource, target.id, request.headers.get("idempotency-key") ?? "", await readLimitedJson(request, 16 * 1024)), { headers: { "Cache-Control": "no-store", "X-API-Version": "2026-09-30" } }); } catch (error) { return handleRouteError(error); } }
