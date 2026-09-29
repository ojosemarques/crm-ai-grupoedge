import type { SVGProps } from "react";

export type IconName =
  | "agenda"
  | "alerta"
  | "auditoria"
  | "automacoes"
  | "copilot"
  | "dashboard"
  | "entrada"
  | "equipe"
  | "filtro"
  | "inbox"
  | "leads"
  | "mais"
  | "meu-dia"
  | "notificacoes"
  | "pipeline"
  | "receita"
  | "relogio"
  | "seta-direita"
  | "tendencia"
  | "vendas"
  | "configuracoes"
  | "sol"
  | "lua";

type IconProps = Readonly<{
  name: IconName;
  size?: number;
}> & Omit<SVGProps<SVGSVGElement>, "name">;

function IconPaths({ name }: Readonly<{ name: IconName }>) {
  switch (name) {
    case "dashboard":
      return <><rect height="7" rx="1.5" width="7" x="3" y="3" /><rect height="5" rx="1.5" width="7" x="14" y="3" /><rect height="11" rx="1.5" width="7" x="14" y="10" /><rect height="7" rx="1.5" width="7" x="3" y="14" /></>;
    case "meu-dia":
      return <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="M17 3h4v4" /><path d="m21 3-5 5" /></>;
    case "leads":
      return <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>;
    case "entrada":
      return <><path d="M4 4h16v16H4z" /><path d="M4 9h4l2 3h4l2-3h4" /></>;
    case "inbox":
      return <><rect height="16" rx="2" width="20" x="2" y="4" /><path d="m4 7 8 6 8-6" /></>;
    case "pipeline":
      return <><path d="M4 5h16l-5.5 6v5l-5 3v-8z" /><path d="M8 5h8" /></>;
    case "agenda":
      return <><rect height="18" rx="2" width="18" x="3" y="4" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>;
    case "vendas":
      return <><path d="M3 7h18v13H3z" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18M10 12v2h4v-2" /></>;
    case "copilot":
      return <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /><path d="m5.5 15 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>;
    case "notificacoes":
      return <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>;
    case "equipe":
      return <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" /><circle cx="18" cy="9" r="3" /><path d="M16 15h2a4 4 0 0 1 4 4v2" /></>;
    case "automacoes":
      return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.51.7 1 .9.2.08.42.1.6.1h.09v4H21a1.7 1.7 0 0 0-1.6 1z" /></>;
    case "auditoria":
      return <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></>;
    case "configuracoes":
      return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.37.51.7 1 .9.2.08.42.1.6.1h.09v4H21a1.7 1.7 0 0 0-1.6 1z" /></>;
    case "receita":
      return <><circle cx="12" cy="12" r="9" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12" /></>;
    case "relogio":
      return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
    case "tendencia":
      return <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>;
    case "alerta":
      return <><path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>;
    case "filtro":
      return <path d="M4 5h16l-6 7v5l-4 2v-7z" />;
    case "mais":
      return <path d="M12 5v14M5 12h14" />;
    case "seta-direita":
      return <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>;
    case "sol":
      return <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>;
    case "lua":
      return <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />;
  }
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <IconPaths name={name} />
    </svg>
  );
}
