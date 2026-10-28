import { z } from "zod";
import { isGoogleMapsUrl } from "./company-personalization";

export const bookingIntakeSchema = z
  .object({
    delivery_location: z.string().trim().max(500),
    pet_name: z.string().trim().max(80),
    pet_species: z.enum(["", "dog", "cat", "other"]),
    pet_size: z.enum(["", "small", "medium", "large"]),
    meeting_topic: z.string().trim().max(120),
  })
  .strict();

export function safeDeliveryLocation(value: string) {
  return !/^https?:\/\//i.test(value) || isGoogleMapsUrl(value);
}

export function compactBookingDetails(
  input: z.infer<typeof bookingIntakeSchema>,
) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== ""),
  );
}

export function bookingDetailValidationMessage(niche: string) {
  if (niche === "pet-shop")
    return "Informe o nome e a espécie do pet para continuar.";
  if (niche === "fornecedores" || niche === "logistica")
    return "Confira o endereço ou use um link HTTPS do Google Maps.";
  return "Confira os dados adicionais antes de continuar.";
}

export const bookingDetailLabels: Record<string, string> = {
  delivery_location: "Local de entrega/atendimento",
  pet_name: "Pet",
  pet_species: "Espécie",
  pet_size: "Porte",
  meeting_topic: "Assunto da reunião",
};

export const bookingDetailOptions: Record<string, Record<string, string>> = {
  pet_species: { dog: "Cão", cat: "Gato", other: "Outro" },
  pet_size: { small: "Pequeno", medium: "Médio", large: "Grande" },
};
