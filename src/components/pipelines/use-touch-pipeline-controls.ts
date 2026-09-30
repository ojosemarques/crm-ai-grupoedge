"use client";

import { useEffect, useState } from "react";

const touchPipelineQuery = "(max-width: 1024px), (hover: none), (pointer: coarse)";

export function useTouchPipelineControls() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(touchPipelineQuery);
    const sync = () => setEnabled(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  return enabled;
}
