"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setFailed(false);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button disabled={isSubmitting} onClick={logout} variant="secondary">
        {isSubmitting ? "Saindo..." : "Sair"}
      </Button>
      {failed ? (
        <p className="text-sm text-danger" role="alert">
          Não foi possível sair. Tente novamente.
        </p>
      ) : null}
    </div>
  );
}
