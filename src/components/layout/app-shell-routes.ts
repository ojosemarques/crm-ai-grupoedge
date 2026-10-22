export function isPublicShellRoute(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/acesso-negado"
    || pathname === "/sessao-expirada"
    || pathname === "/hub"
    || pathname === "/tempo-real-publico"
    || pathname === "/f"
    || pathname.startsWith("/f/");
}
