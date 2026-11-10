"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function RouteAutoRefresh({ enabled = true, refreshOnReturnTo }: Readonly<{
  enabled?: boolean;
  refreshOnReturnTo?: string;
}> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const previousPathname = useRef(pathname);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const previous = previousPathname.current;
    previousPathname.current = pathname;
    // A página continua montada por trás da ficha interceptada. Ao voltar, a navegação pode restaurar o quadro anterior.
    if (enabled && pathname === refreshOnReturnTo && previous !== pathname) {
      startTransition(() => router.refresh());
    }
  }, [enabled, pathname, refreshOnReturnTo, router]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (!pending && document.visibilityState === "visible" && navigator.onLine) {
        startTransition(() => router.refresh());
      }
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, pathname, query, pending, enabled]);
  return null;
}
