import type { ReactNode } from "react";
import { IntegrationNavigation } from "./integration-navigation";
import styles from "./integrations.module.css";

export default function IntegrationsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.area}><IntegrationNavigation />{children}</div>;
}
