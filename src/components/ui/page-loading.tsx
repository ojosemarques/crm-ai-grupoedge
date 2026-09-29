export function PageLoading({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <main aria-busy="true" aria-label={`Carregando ${title}`} className="page-state" role="status">
      <section className="page-state__panel">
        <span aria-hidden="true" className="page-state__pulse" />
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div aria-hidden="true" className="page-state__skeleton"><span /><span /><span /></div>
      </section>
    </main>
  );
}
