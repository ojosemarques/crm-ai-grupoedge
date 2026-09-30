"use client";

import { useEffect } from "react";

export function announceCompanySwitch() {
  window.localStorage.setItem("crm-company-session-changed", crypto.randomUUID());
}

// Bind requests to the session that rendered this tab. A cookie changed in another
// tab must never turn an old company's form into a write in the newly selected one.
export function useCompanySession(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    const original = window.fetch;
    const scopedFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-crm-session", sessionId);
      const response = await original(input, { ...init, headers });
      if (response.status === 409) {
        const body = await response.clone().json().catch(() => null);
        if (body?.error?.code === "COMPANY_SESSION_CHANGED") window.location.replace("/hub");
      }
      return response;
    };
    window.fetch = scopedFetch;
    const onStorage = (event: StorageEvent) => { if (event.key === "crm-company-session-changed") window.location.replace("/hub"); };
    window.addEventListener("storage", onStorage);
    return () => {
      if (window.fetch === scopedFetch) window.fetch = original;
      window.removeEventListener("storage", onStorage);
    };
  }, [sessionId]);
}
