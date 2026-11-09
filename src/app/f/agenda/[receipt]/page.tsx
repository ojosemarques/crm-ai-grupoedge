import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgendaPicker } from "./agenda-picker";

export const metadata: Metadata = {
  title: "Agendamento | Politizai",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AgendaPage({ params }: { params: Promise<{ receipt: string }> }) {
  const { receipt } = await params;
  if (!z.uuid().safeParse(receipt).success) notFound();
  return <AgendaPicker receipt={receipt} />;
}
