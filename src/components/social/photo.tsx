"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
export function SocialPhoto({
  src,
  alt,
  thumbnail = false,
}: {
  src: string;
  alt: string;
  thumbnail?: boolean;
}) {
  const [loaded, setLoaded] = useState(""),
    [failed, setFailed] = useState("");
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (image.current?.complete) {
      if (image.current.naturalWidth) setLoaded(src);
      else setFailed(src);
    }
  }, [src]);
  const pending = loaded !== src && failed !== src;
  return (
    <div
      className={
        thumbnail
          ? "social-photo-frame social-photo-thumb"
          : "social-photo-frame"
      }
      aria-busy={pending}
    >
      {/* biome-ignore lint/performance/noImgElement: authenticated private route must retain session cookies and private/no-store delivery. */}
      <img
        ref={image}
        src={src}
        alt={alt}
        width={thumbnail ? 64 : 1080}
        height={thumbnail ? 64 : 1350}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(src)}
        onError={() => setFailed(src)}
        style={{ opacity: loaded === src ? 1 : 0 }}
      />
      {pending && (
        <span
          className="social-photo-state skeleton-block"
          role="status"
          aria-label="Carregando foto…"
        />
      )}
      {failed === src && (
        <span
          className="social-photo-state"
          role="img"
          aria-label="Foto indisponível"
        >
          <Icon name="camera" />
          {!thumbnail && (
            <small>
              Foto indisponível. Atualize a página para tentar novamente.
            </small>
          )}
        </span>
      )}
    </div>
  );
}
