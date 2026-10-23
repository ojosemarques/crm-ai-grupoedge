export default function AgendaLeadHistoryModalLoading() {
  return <div aria-label="Carregando ficha do lead" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="status"><div className="surface-panel w-full max-w-6xl p-6"><div className="skeleton h-10 w-72" /><div className="skeleton mt-5 h-80" /><span className="sr-only">Carregando ficha completa do lead…</span></div></div>;
}
