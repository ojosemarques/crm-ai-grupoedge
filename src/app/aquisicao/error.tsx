"use client";
export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) {
  return <main className="page-canvas"><h1>Não foi possível carregar a aquisição</h1><p>Os dados persistidos não foram alterados.</p><button className="button button-primary" onClick={reset} type="button">Tentar novamente</button></main>;
}
