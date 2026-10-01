import type { ReactNode } from "react";

export default function PipelineLayout({
  children,
  modal,
}: Readonly<{
  children: ReactNode;
  modal: ReactNode;
}>) {
  return <>{children}{modal}</>;
}
