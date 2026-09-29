"use client";
export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) { return <main className="page-canvas"><div className="error-state" role="alert"><h1>Não foi possível carregar as contas</h1><p>Tente novamente sem perder os filtros.</p><button onClick={reset} type="button">Tentar novamente</button></div></main>; }
