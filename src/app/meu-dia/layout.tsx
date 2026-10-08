import type { ReactNode } from "react";

export default function MyDayLayout({
  children,
  modal,
}: Readonly<{
  children: ReactNode;
  modal: ReactNode;
}>) {
  return <>{children}{modal}</>;
}
