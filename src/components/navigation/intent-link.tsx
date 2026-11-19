"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & Readonly<{
  prefetch?: false;
}>;

export function resolveIntentPrefetch(
  intent: boolean,
  disabled = false,
): false | null {
  return intent && !disabled ? null : false;
}

/**
 * Evita renderizar rotas dinâmicas caras só porque o link entrou no viewport.
 * O prefetch volta ao padrão do Next.js quando o ponteiro indica intenção real.
 */
export function IntentLink({ onMouseEnter, prefetch, ...props }: IntentLinkProps) {
  const [intent, setIntent] = useState(false);

  return (
    <Link
      {...props}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented && prefetch !== false) setIntent(true);
      }}
      prefetch={resolveIntentPrefetch(intent, prefetch === false)}
    />
  );
}
