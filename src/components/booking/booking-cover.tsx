"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (src && image.current?.complete && image.current.naturalWidth > 0)
      setLoadedSource(src);
  }, [src]);
  if (!src || failedSource === src) return children;
  return (
    <figure className="booking-cover" aria-busy={loadedSource !== src}>
      <img
        ref={image}
        src={src}
        alt={`Espaço de ${companyName}`}
        width={960}
        height={640}
        fetchPriority="high"
        decoding="async"
        onLoad={() => setLoadedSource(src)}
        onError={() => setFailedSource(src)}
      />
      <figcaption>
        <span aria-hidden="true" />
        {companyName}
      </figcaption>
    </figure>
  );
}
