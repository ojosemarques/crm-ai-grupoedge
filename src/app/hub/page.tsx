import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCompanyHubService } from "@/modules/users/application/company-hub-service";
import { CompanyHub } from "./company-hub";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  const context = await requirePageAuthentication();
  return <CompanyHub initial={await getCompanyHubService().screen(context)} sessionId={context.sessionId} />;
}
