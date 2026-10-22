import { NextResponse } from "next/server";
import { crmMcpOAuthMetadata } from "@/modules/crm-mcp/domain/crm-mcp-oauth-config";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET() { return NextResponse.json(crmMcpOAuthMetadata(), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } }); }
