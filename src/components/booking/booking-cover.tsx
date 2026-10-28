"use client";

import { useState, type ReactNode } from "react";

/** A failed/expired image must never leave an empty hero rectangle. */
export function BookingCover({
  src,
  companyName,
  children,
}: {
  src: string | null;
  companyName: string;
  children: ReactNode;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!src || failedSource === src) return children;
  return (
    <figure className="booking-cover">
      <img
        src={src}
        alt={`Espaço de ${companyName}`}
        width={960}
        height={640}
        fetchPriority="high"
        decoding="async"
        onError={() => setFailedSource(src)}
      />
      <figcaption>
        <span aria-hidden="true" />
        {companyName}
      </figcaption>
    </figure>
  );
}
