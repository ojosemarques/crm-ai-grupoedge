export type RealtimeTheme = "dark" | "light";
const key = "crm:realtime:theme:v1";
const event = "crm-realtime-theme";

export function readRealtimeTheme(): RealtimeTheme {
  const query = new URLSearchParams(window.location.search).get("theme");
  if (query === "light" || query === "dark") return query;
  try { return window.localStorage.getItem(key) === "light" ? "light" : "dark"; }
  catch { return "dark"; }
}
export function subscribeRealtimeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
export function setRealtimeTheme(theme: RealtimeTheme) {
  const url = new URL(window.location.href);
  url.searchParams.set("theme", theme);
  window.history.replaceState(window.history.state, "", url.href);
  try { window.localStorage.setItem(key, theme); } catch { /* The URL retains the preference when local storage is unavailable. */ }
  window.dispatchEvent(new Event(event));
}
