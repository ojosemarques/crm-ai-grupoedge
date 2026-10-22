import type { ReactNode } from "react";

export default function AdvertisingLayout({
  children,
  modal,
}: Readonly<{
  children: ReactNode;
  modal: ReactNode;
}>) {
  return <>{children}{modal}</>;
}
