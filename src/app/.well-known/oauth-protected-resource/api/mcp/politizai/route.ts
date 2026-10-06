import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = getProtectedResourceMetadata;
