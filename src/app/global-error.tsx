"use client";

import styles from "./global-error.module.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function GlobalError({ retry }: GlobalErrorProps) {
  return (
    <html lang="pt-BR">
      <body className={styles.body}>
        <main className={styles.main}>
          <section className={styles.panel}>
            <h1 className={styles.title}>
              Não foi possível carregar
            </h1>
            <p className={styles.description}>
              O erro foi tratado sem expor detalhes internos. Tente novamente.
            </p>
            <button
              className={styles.button}
              onClick={retry}
              type="button"
            >
              Tentar novamente
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
