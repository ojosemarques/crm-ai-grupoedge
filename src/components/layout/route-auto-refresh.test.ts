import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteAutoRefresh } from "./route-auto-refresh";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), effect: vi.fn(), pending: false }));
vi.mock("react", () => ({ useEffect: mocks.effect, useTransition: () => [mocks.pending, (callback: () => void) => callback()] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => "/aquisicao/midia", useSearchParams: () => new URLSearchParams("periodStart=2026-10-29&periodEnd=2026-10-29") }));

let cleanup: (() => void) | undefined;
let visibility: string;
let online: boolean;
const listeners = new Map<string, () => void>();
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); listeners.clear(); mocks.pending = false; visibility = "visible"; online = true;
  const events = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
  vi.stubGlobal("window", { ...events, setInterval: (callback: () => void, delay: number) => setInterval(callback, delay), clearInterval: (timer: ReturnType<typeof setInterval>) => clearInterval(timer) });
  vi.stubGlobal("document", { ...events, get visibilityState() { return visibility; } });
  vi.stubGlobal("navigator", { get onLine() { return online; } });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount(enabled = true) {
  RouteAutoRefresh({ enabled });
  cleanup = mocks.effect.mock.calls[0]![0]();
}

describe("atualização automática da rota", () => {
  it("atualiza os dados periodicamente sem navegar ou alterar o filtro", () => {
    mount();
    vi.advanceTimersByTime(14_999); expect(mocks.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(mocks.refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000); expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it("não consulta em aba oculta, offline ou durante uma atualização pendente", () => {
    mount(); visibility = "hidden"; vi.advanceTimersByTime(15_000);
    visibility = "visible"; online = false; vi.advanceTimersByTime(15_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    cleanup?.(); mocks.effect.mockClear(); mocks.pending = true; online = true; mount();
    vi.advanceTimersByTime(15_000); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("consulta ao recuperar foco, visibilidade e conexão", () => {
    mount(); listeners.get("focus")?.(); listeners.get("visibilitychange")?.(); listeners.get("online")?.();
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
  it("suspende a atualização quando a importação está aberta", () => {
    mount(false); vi.advanceTimersByTime(60_000);
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
  it("remove o temporizador e os eventos ao sair da tela", () => {
    mount(); cleanup?.(); cleanup = undefined; vi.advanceTimersByTime(60_000);
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
});
