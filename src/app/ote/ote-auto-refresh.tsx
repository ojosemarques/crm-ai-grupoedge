"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function OteAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
