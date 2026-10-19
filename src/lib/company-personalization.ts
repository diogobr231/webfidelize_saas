import { z } from "zod";

export const LOGO_BUCKET = "company-logos";
// Kept below the framework's default 1 MiB Server Action body limit.
export const LOGO_MAX_BYTES = 750 * 1024;
export const brandThemes = [
  { value: "teal", label: "Verde-azulado", color: "#0d8078" },
  { value: "blue", label: "Azul", color: "#2462c7" },
  { value: "violet", label: "Violeta", color: "#7651c5" },
  { value: "rose", label: "Rosa", color: "#b73f70" },
] as const;

export const personalizationSchema = z.object({
  name: z.string().trim().min(2, "Informe pelo menos 2 caracteres.").max(100),
  description: z.string().trim().max(240, "Use até 240 caracteres."),
  address: z.string().trim().max(200, "Use até 200 caracteres."),
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
