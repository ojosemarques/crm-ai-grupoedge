import Link from "next/link";

export default function MeetingNotFound() {
  return <main className="mx-auto max-w-2xl px-6 py-16"><section className="surface-panel p-6"><h1 className="text-xl font-semibold">Reunião não encontrada</h1><p className="mt-2 text-sm text-muted-foreground">Ela pode não existir, ter sido removida ou estar fora do seu workspace.</p><Link className="text-link mt-4 inline-block text-sm" href="/agenda">Voltar à agenda</Link></section></main>;
}
