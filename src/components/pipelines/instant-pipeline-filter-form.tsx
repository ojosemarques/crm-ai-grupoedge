"use client";

import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useRef, useTransition } from "react";

const searchDebounceMs = 150;

function formHref(form: HTMLFormElement) {
  const target = new URL(form.action);
  const params = target.searchParams;
  for (const [name, rawValue] of new FormData(form).entries()) {
    const value = String(rawValue).trim();
    if (value) params.set(name, value);
    else params.delete(name);
  }
  return `${target.pathname}${params.size ? `?${params.toString()}` : ""}`;
}

export function InstantPipelineFilterForm({
  action,
  children,
  className,
  syncKey,
}: Readonly<{
  action: string;
  children: ReactNode;
  className?: string | undefined;
  syncKey: string;
}>) {
  const router = useRouter();
  const debounceTimer = useRef<number | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => () => {
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
  }, []);

  function navigate(form: HTMLFormElement) {
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
    const href = formHref(form);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(event.currentTarget);
  }

  function change(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !["search", "text"].includes(target.type)) {
      navigate(event.currentTarget);
      return;
    }
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    const form = event.currentTarget;
    debounceTimer.current = window.setTimeout(() => navigate(form), searchDebounceMs);
  }

  return (
    <form action={action} aria-busy={pending} className={className} key={syncKey} method="get" onChange={change} onSubmit={submit}>
      {children}
    </form>
  );
}
