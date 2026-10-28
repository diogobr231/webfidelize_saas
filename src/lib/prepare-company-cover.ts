import {
  COVER_MAX_BYTES,
  COVER_SOURCE_MAX_BYTES,
  validateCoverBytes,
} from "./company-personalization";

/** Runs only in the form: no photo is sent to an external optimizer. */
export async function prepareCompanyCover(file: File) {
  if (file.size > COVER_SOURCE_MAX_BYTES)
    throw new Error("Escolha uma foto de até 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateCoverBytes(bytes, file.type, true);
  if ("error" in checked) throw new Error(checked.error);
  if (typeof createImageBitmap !== "function") {
    const stored = validateCoverBytes(bytes, file.type);
    if ("error" in stored)
      throw new Error(
        "Seu navegador não conseguiu otimizar a foto. Envie uma versão de até 750 KB e 2560 pixels.",
      );
    return file;
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  }).catch(() => {
    throw new Error(
      "Não conseguimos abrir esta foto. Escolha outra imagem PNG, JPEG ou WebP.",
    );
  });
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Não foi possível preparar a foto neste navegador.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.6, 0.48]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= COVER_MAX_BYTES)
        return new File([blob], "foto-do-espaco.jpg", { type: "image/jpeg" });
    }
    throw new Error(
      "Escolha uma foto menor para manter a página rápida no celular.",
    );
  } finally {
    bitmap.close();
  }
}
