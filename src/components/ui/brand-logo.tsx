import Image from "next/image";

import edgeGroupOnDark from "../../../public/brand/edge-group-black.png";
import edgeGroupOnLight from "../../../public/brand/edge-group-white.png";
import politizaiDark from "../../../public/brand/politizai-logo-dark.png";
import politizaiLight from "../../../public/brand/politizai-logo-light.png";
import styles from "./brand-logo.module.css";

export type BrandLogoVariant = "edge-group" | "politizai";

export function BrandLogo({ appearance = "auto", variant = "edge-group" }: Readonly<{
  appearance?: "auto" | "light";
  variant?: BrandLogoVariant;
}>) {
  const label = variant === "politizai" ? "Politizai" : "EDGE GROUP";

  return (
    <span aria-label={label} className={styles.logo} data-appearance={appearance} data-brand={variant} role="img">
      {variant === "politizai" ? (
        <>
          <Image alt="" className={styles.politizaiLight} priority sizes="180px" src={politizaiLight} />
          <Image alt="" className={styles.politizaiDark} priority sizes="180px" src={politizaiDark} />
        </>
      ) : (
        <>
          <Image alt="" className={styles.edgeLight} priority sizes="200px" src={edgeGroupOnLight} />
          <Image alt="" className={styles.edgeDark} priority sizes="200px" src={edgeGroupOnDark} />
        </>
      )}
    </span>
  );
}
