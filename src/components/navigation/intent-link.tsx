"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & Readonly<{
  prefetch?: false;
}>;

export function resolveIntentPrefetch(): false {
  return false;
}

/**
 * O runtime Cloudflare renderiza as rotas dinâmicas completas durante o prefetch.
 * Manter o prefetch desligado evita concorrência com a navegação realmente solicitada.
 */
export function IntentLink(props: IntentLinkProps) {
  return <Link {...props} prefetch={resolveIntentPrefetch()} />;
}
