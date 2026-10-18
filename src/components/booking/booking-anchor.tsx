"use client";

import { useEffect } from "react";

/** Completes the native fragment jump when the slots arrive after the shell. */
export function BookingAnchor() {
  useEffect(() => {
    if (window.location.hash !== "#horarios" || window.scrollY !== 0) return;

    let interrupted = false;
    const stop = () => {
      interrupted = true;
    };
    const events = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
    ] as const;
    for (const event of events)
      window.addEventListener(event, stop, { capture: true, passive: true });

    const removeListeners = () => {
      for (const event of events) window.removeEventListener(event, stop, true);
    };
    const frame = window.requestAnimationFrame(() => {
      removeListeners();
      const active = document.activeElement;
      if (
        interrupted ||
        window.location.hash !== "#horarios" ||
        window.scrollY !== 0 ||
        (active &&
          active !== document.body &&
          active !== document.documentElement)
      )
        return;

      // No animation or focus change: this also respects reduced motion.
      document.getElementById("horarios")?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      removeListeners();
    };
  }, []);

  return null;
}
