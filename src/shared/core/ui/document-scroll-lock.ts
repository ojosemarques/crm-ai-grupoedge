let lockDepth = 0;

export function acquireDocumentScrollLock(): () => void {
  lockDepth += 1;
  document.body.classList.add("ui-scroll-locked");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockDepth = Math.max(0, lockDepth - 1);
    if (lockDepth === 0) document.body.classList.remove("ui-scroll-locked");
  };
}
