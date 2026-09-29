import { PublicStatePage } from "@/components/ui/public-state-page";

export default function AccessDeniedPage() {
  return <PublicStatePage action={{ href: "/", label: "Voltar ao início" }} description="Sua conta continua segura. Se precisar deste acesso, fale com o administrador do workspace." eyebrow="Acesso negado" title="Você não tem permissão para esta ação" />;
}
