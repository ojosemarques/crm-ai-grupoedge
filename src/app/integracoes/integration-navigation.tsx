"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./integrations.module.css";

const channels = [["", "Todas as integrações"], ["/canais", "Matriz de canais"], ["/whatsapp", "WhatsApp"], ["/instagram", "Instagram"], ["/email", "E-mail"], ["/telefonia", "Telefonia"], ["/calendario", "Calendário"], ["/meta-ads", "Meta Ads"], ["/google-ads", "Google Ads"], ["/n8n", "n8n"]] as const;

export function IntegrationNavigation() {
  const pathname = usePathname();
  return <nav aria-label="Canais de integração" className={styles.navigation}>{channels.map(([path, label]) => <Link aria-current={pathname === `/integracoes${path}` ? "page" : undefined} href={`/integracoes${path}`} key={path}>{label}</Link>)}</nav>;
}
