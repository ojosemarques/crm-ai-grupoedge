import Image from "next/image";

import lightLogo from "../../../public/brand/politizai-logo-light.png";
import darkLogo from "../../../public/brand/politizai-logo-dark.png";
import styles from "./brand-logo.module.css";

export function BrandLogo({ appearance = "auto" }: Readonly<{ appearance?: "auto" | "light" }>) {
  return (
    <span aria-label="Politizai" className={styles.logo} data-appearance={appearance} role="img">
      <Image alt="" className={styles.light} priority sizes="240px" src={lightLogo} />
      <Image alt="" className={styles.dark} priority sizes="240px" src={darkLogo} />
    </span>
  );
}
