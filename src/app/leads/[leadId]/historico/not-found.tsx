import Link from "next/link";

export default function LeadHistoryNotFound() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-16">
      <section className="surface-panel p-6">
        <h1 className="text-xl font-semibold">Lead não encontrado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O registro não existe neste workspace ou não está mais disponível.
        </p>
        <Link className="text-link mt-4 inline-block text-sm" href="/leads/entrada">
          Voltar à entrada de leads
        </Link>
      </section>
    </main>
  );
}
