import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedAccountDemoData } from "@/modules/settings/application/account-demo-seed-service";
import { seedLifecycleDemoData } from "@/modules/settings/application/lifecycle-demo-seed-service";
import { seedOmnichannelDemoData } from "@/modules/settings/application/omnichannel-demo-seed-service";
import { seedCustomerSuccessDemoData } from "@/modules/settings/application/customer-success-demo-seed-service";
import { seedCustomerServiceDemoData } from "@/modules/settings/application/customer-service-demo-seed-service";
import { seedFarmerDemoData } from "@/modules/settings/application/farmer-demo-seed-service";
import { seedGoalDemoData } from "@/modules/settings/application/goal-demo-seed-service";
import { seedForecastDemoData } from "@/modules/settings/application/forecast-demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const database = getDatabaseClient();

try {
  const structure = await seedDemoDatabase(database);
  const data = await seedCrm29DemoData(database);
  const accounts = await seedAccountDemoData(database);
  const lifecycle = await seedLifecycleDemoData(database);
  const communications = await seedOmnichannelDemoData(database);
  const customerSuccess = await seedCustomerSuccessDemoData(database);
  const customerService = await seedCustomerServiceDemoData(database);
  const farmer = await seedFarmerDemoData(database);
  const goals = await seedGoalDemoData(database);
  const forecast = await seedForecastDemoData(database);
  process.stdout.write(
    `${JSON.stringify({ seed: "politizai-demo-v1", structure, data, accounts, lifecycle, communications, customerSuccess, customerService, farmer, goals, forecast })}\n`,
  );
} finally {
  await database.$disconnect();
}
