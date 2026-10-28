"use client";
import { useEffect, useRef, useState } from "react";

/** Local crop/light adjustment. This editor does not claim to use generative AI. */
export default function PhotoInput({
  onPrepared,
}: {
  onPrepared: (file: File | null) => void;
}) {
  const [source, setSource] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [light, setLight] = useState(100),
    [format, setFormat] = useState("portrait");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    onPrepared(null);
    if (!source) return;
    let previewUrl = "";
    setBusy(true);
    setError("");
    setPreview("");
    (async () => {
      if (
        source.size > 12000000 ||
        !["image/jpeg", "image/png", "image/webp"].includes(source.type)
      )
        throw new Error("Use JPEG, PNG ou WebP de até 12 MB.");
      const bitmap = await createImageBitmap(source);
      try {
        if (bitmap.width * bitmap.height > 30000000)
          throw new Error("Reduza a resolução da imagem antes de anexar.");
        const canvas = document.createElement("canvas");
        canvas.width = 1080;
        canvas.height = format === "portrait" ? 1350 : 1080;
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("Não foi possível preparar a foto neste navegador.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.max(
          canvas.width / bitmap.width,
          canvas.height / bitmap.height,
        );
        context.filter = `brightness(${light}%)`;
        context.drawImage(
          bitmap,
          (canvas.width - bitmap.width * scale) / 2,
          (canvas.height - bitmap.height * scale) / 2,
          bitmap.width * scale,
          bitmap.height * scale,
        );
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85),
        );
        if (!blob || blob.size > 1500000)
          throw new Error(
            "A imagem preparada excedeu 1,5 MB. Escolha uma imagem menor.",
          );
        if (current !== sequence.current) return;
        previewUrl = URL.createObjectURL(blob);
        setPreview(previewUrl);
        onPrepared(new File([blob], "post.jpg", { type: "image/jpeg" }));
      } finally {
        bitmap.close();
      }
    })()
      .catch((reason) => {
        if (current === sequence.current)
          setError(
            reason instanceof Error ? reason.message : "Foto indisponível.",
          );
      })
      .finally(() => {
        if (current === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [source, light, format, onPrepared]);
  return (
    <div className="social-photo-editor" aria-busy={busy}>
      <label>
        Foto do cliente
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setSource(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="social-photo-preview">
        {preview ? (
          // biome-ignore lint/performance/noImgElement: local blob already cropped/compressed; it cannot be sent to a shared image optimizer.
          <img
            src={preview}
            width="1080"
            height={format === "portrait" ? "1350" : "1080"}
            alt="Prévia do recorte e da iluminação que serão salvos"
            decoding="async"
          />
        ) : (
          <span role="status">
            {busy ? "Preparando a imagem…" : "Anexe uma foto para começar"}
          </span>
        )}
      </div>
      <label>
        Formato
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value)}
        >
          <option value="portrait">Retrato · 4:5</option>
          <option value="square">Quadrado · 1:1</option>
        </select>
      </label>
      <label>
        Claridade · {light}%
        <input
          type="range"
          min="70"
          max="140"
          step="5"
          value={light}
          onChange={(event) => setLight(Number(event.target.value))}
        />
      </label>
      <p className="social-note">
        Ajuste local de luz e recorte central. A prévia mostra a versão salva;
        não é edição por IA.
      </p>
      {error && (
        <p role="alert" className="social-error">
          {error}
        </p>
      )}
    </div>
  );
}
