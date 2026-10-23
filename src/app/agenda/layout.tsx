import type { ReactNode } from "react";

export default function AgendaLayout({ children, modal }: Readonly<{ children: ReactNode; modal: ReactNode }>) {
  return <>{children}{modal}</>;
}
