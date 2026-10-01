import { PublicStatePage } from "@/components/ui/public-state-page";

export default function ExpiredSessionPage() {
  return <PublicStatePage action={{ href: "/login", label: "Entrar novamente" }} description="Entre novamente para continuar usando o Grupo Edge CRM." eyebrow="Sessão encerrada" title="Sua sessão expirou" />;
}
