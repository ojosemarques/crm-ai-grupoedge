import Image from "next/image";
import type { ReactNode } from "react";
import politizaiLogo from "../../../public/brand/politizai-logo-vector.svg";
import styles from "./realtime-dashboard.module.css";

type IconName = "grid" | "trophy" | "chart" | "expand" | "exit" | "play" | "pause" | "link" | "close" | "copy" | "phone" | "message" | "people" | "calendar" | "check" | "sale" | "arrow" | "clock" | "sun" | "moon";
const iconPaths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  trophy: <><path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v5m-4 3h8m-6-3h4v3" /></>,
  chart: <><path d="M4 3v17h17M8 15l4-5 4 3 5-8" /></>,
  expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  exit: <path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h13" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: <><path d="M8 4v16M16 4v16" /></>,
  link: <><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  phone: <path d="m5 3 4 4-2 3a17 17 0 0 0 7 7l3-2 4 4-2 2C11 23 1 13 3 5l2-2Z" />,
  message: <path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z" />,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 6-7" /></>,
  sale: <><path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4 9 9 0 1 0 20 15Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
};

export function Icon({ name, className }: Readonly<{ name: IconName; className?: string }>) {
  return <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">{iconPaths[name]}</svg>;
}

export function BrandMark() {
  return <Image alt="Logo Politizai" className={styles.brandMark} src={politizaiLogo} width={40} height={40} unoptimized />;
}

export function Avatar({ initials, position = 1 }: Readonly<{ initials: string; position?: number }>) {
  return <span className={styles.avatar} data-color={((position - 1) % 5) + 1}>{initials}</span>;
}
