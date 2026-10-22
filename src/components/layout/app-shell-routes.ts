export function isPublicShellRoute(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/acesso-negado"
    || pathname === "/sessao-expirada"
    || pathname === "/hub"
    || pathname === "/tempo"
    || pathname === "/tempo-real-publico"
    || pathname === "/f"
    || pathname.startsWith("/f/");
}

export function isStandaloneShellRoute(pathname: string): boolean {
  return pathname === "/tempo-real" || isPublicShellRoute(pathname);
}
