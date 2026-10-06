import type { ReactNode } from "react";

export default function ActiveProspectingLayout({
  children,
  modal,
}: Readonly<{
  children: ReactNode;
  modal: ReactNode;
}>) {
  return <>{children}{modal}</>;
}
