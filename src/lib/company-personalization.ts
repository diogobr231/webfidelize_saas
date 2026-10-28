import { z } from "zod";

export const LOGO_BUCKET = "company-logos";
// Kept below the framework's default 1 MiB Server Action body limit.
export const LOGO_MAX_BYTES = 750 * 1024;
export const COVER_BUCKET = "company-covers";
export const COVER_MAX_BYTES = 750 * 1024;
export const COVER_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const brandThemes = [
  { value: "teal", label: "Verde-azulado", color: "#0d8078" },
  { value: "blue", label: "Azul", color: "#2462c7" },
  { value: "violet", label: "Violeta", color: "#7651c5" },
  { value: "rose", label: "Rosa", color: "#b73f70" },
] as const;

export function isGoogleMapsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return false;
    if (
      url.hostname === "maps.app.goo.gl" ||
      url.hostname === "maps.google.com"
    )
      return true;
    return (
      url.hostname === "www.google.com" && url.pathname.startsWith("/maps")
    );
  } catch {
    return false;
  }
}

export const personalizationSchema = z.object({
  name: z.string().trim().min(2, "Informe pelo menos 2 caracteres.").max(100),
  description: z.string().trim().max(240, "Use até 240 caracteres."),
  address: z.string().trim().max(200, "Use até 200 caracteres."),
  maps_url: z
    .string()
    .trim()
    .max(500, "Use um link com até 500 caracteres.")
    .refine(
      (value) => value === "" || isGoogleMapsUrl(value),
      "Informe um link HTTPS válido do Google Maps ou deixe em branco.",
    ),
  phone: z
    .string()
    .max(24)
    .transform((value) => value.replace(/[\s()+.-]/g, ""))
    .refine(
      (value) => value === "" || /^\d{10,13}$/.test(value),
      "Informe um telefone com DDD ou deixe em branco.",
    ),
  theme: z.enum(["teal", "blue", "violet", "rose"]),
  density: z.enum(["comfortable", "compact"]),
  agenda_view: z.enum(["day", "week"]),
});

export type PersonalizationState = {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};

export function logoPathBelongsToCompany(path: string, companyId: string) {
  return (
    path.startsWith(`${companyId}/`) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(
      path,
    )
  );
}

/** Detect actual raster signatures. Browser filenames and MIME declarations are untrusted. */
export function validateLogoBytes(bytes: Uint8Array, declaredType: string) {
  if (!bytes.length || bytes.length > LOGO_MAX_BYTES) {
    return { error: "Escolha uma imagem de até 750 KB." } as const;
  }
  const starts = (signature: number[]) =>
    signature.every((n, i) => bytes[i] === n);
  const png =
    starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    bytes.length >= 24 &&
    startsAt(bytes, 12, [0x49, 0x48, 0x44, 0x52]);
  const jpeg =
    starts([0xff, 0xd8, 0xff]) &&
    bytes.length >= 4 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;
  const webp =
    starts([0x52, 0x49, 0x46, 0x46]) &&
    startsAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]) &&
    bytes.length >= 20;
  const kind = png
    ? { mime: "image/png", extension: "png" }
    : jpeg
      ? { mime: "image/jpeg", extension: "jpg" }
      : webp
        ? { mime: "image/webp", extension: "webp" }
        : null;
  if (!kind || declaredType !== kind.mime) {
    return {
      error:
        "Use uma imagem PNG, JPEG ou WebP válida. SVG e outros formatos não são aceitos.",
    } as const;
  }
  return kind;
}

function startsAt(bytes: Uint8Array, offset: number, signature: number[]) {
  return signature.every((n, i) => bytes[offset + i] === n);
}

export const coverPathBelongsToCompany = logoPathBelongsToCompany;

/** Read dimensions before decoding a photo, bounding memory on mobile devices. */
export function rasterDimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length >= 24)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === "image/webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X")
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    if (chunk === "VP8 " && startsAt(bytes, 23, [0x9d, 0x01, 0x2a]))
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (length < 8) return null;
        return {
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      }
      offset += length;
    }
  }
  return null;
}

export function validateCoverBytes(
  bytes: Uint8Array,
  declaredType: string,
  source = false,
) {
  const max = source ? COVER_SOURCE_MAX_BYTES : COVER_MAX_BYTES;
  if (!bytes.length || bytes.length > max)
    return {
      error: source
        ? "Escolha uma foto de até 10 MB."
        : "A foto deve ter até 750 KB depois de otimizada.",
    } as const;
  // The existing raster signature check uses the same limit as the stored cover.
  const signature = validateLogoBytes(
    bytes.subarray(0, Math.min(bytes.length, LOGO_MAX_BYTES)),
    declaredType,
  );
  // A source JPEG may be larger than the stored image; keep its end marker for validation.
  const kind =
    declaredType === "image/jpeg" && bytes.length > LOGO_MAX_BYTES
      ? startsAt(bytes, 0, [0xff, 0xd8, 0xff]) &&
        startsAt(bytes, bytes.length - 2, [0xff, 0xd9])
        ? { mime: "image/jpeg", extension: "jpg" }
        : signature
      : signature;
  if ("error" in kind) return kind;
  const size = rasterDimensions(bytes, kind.mime);
  const maxDimension = source ? 12000 : 2560;
  const maxPixels = source ? 50_000_000 : 6_553_600;
  if (
    !size ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > maxDimension ||
    size.height > maxDimension ||
    size.width * size.height > maxPixels
  )
    return {
      error:
        "Não foi possível usar as dimensões desta foto. Escolha uma imagem menor em PNG, JPEG ou WebP.",
    } as const;
  return { ...kind, ...size };
}
