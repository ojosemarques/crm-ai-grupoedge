import { parseQuizAgendaToken } from "@/modules/marketing-forms/domain/quiz-agenda-token";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgendaPicker } from "./agenda-picker";
import { NativeAgendaEntry } from "./native-agenda-entry";

export const metadata: Metadata = {
  title: "Agendamento | Politizai",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AgendaPage({ params }: { params: Promise<{ receipt: string }> }) {
  const { receipt } = await params;
  if (receipt === "meta") return <NativeAgendaEntry />;
  if (!z.uuid().safeParse(receipt).success && !parseQuizAgendaToken(receipt)) notFound();
  return <AgendaPicker receipt={receipt} />;
}
