import Image from "next/image";

import edgeSymbol from "../../app/icon.png";
import styles from "./brand-logo.module.css";

export function BrandLogo({ appearance = "auto" }: Readonly<{ appearance?: "auto" | "light" }>) {
  return (
    <span aria-label="Grupo Edge CRM" className={styles.logo} data-appearance={appearance} role="img">
      <Image alt="" className={styles.symbol} priority sizes="36px" src={edgeSymbol} />
      <span className={styles.wordmark}>Grupo Edge CRM</span>
    </span>
  );
}
