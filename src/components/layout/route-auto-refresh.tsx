"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function RouteAutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
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
  }, [router, pathname, query, pending]);
  return null;
}
