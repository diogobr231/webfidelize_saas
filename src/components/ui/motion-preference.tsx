"use client";

import { useEffect } from "react";

/** Keyboard navigation stays immediate. No request, tracking, storage or React rerender. */
export function MotionPreference() {
  useEffect(() => {
    const keyboard = () => {
      document.documentElement.dataset.inputModality = "keyboard";
    };
    const pointer = () => {
      document.documentElement.dataset.inputModality = "pointer";
    };
    document.addEventListener("keydown", keyboard, { passive: true });
    document.addEventListener("pointerdown", pointer, { passive: true });
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("pointerdown", pointer);
      delete document.documentElement.dataset.inputModality;
    };
  }, []);
  return null;
}
