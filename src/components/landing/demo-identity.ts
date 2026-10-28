import type { IconName } from "@/components/ui/icon";

/** Illustrative identities only: no business, customer, or address is real. */
const identities: Record<
  string,
  { name: string; initials: string; icon: IconName }
> = {
  salao: { name: "Seu salão", initials: "SS", icon: "scissors" },
  "pet-shop": { name: "Seu pet shop", initials: "SP", icon: "paw" },
  clinica: { name: "Sua clínica", initials: "SC", icon: "heart" },
  escritorio: { name: "Seu escritório", initials: "SE", icon: "briefcase" },
  restaurante: { name: "Seu restaurante", initials: "SR", icon: "utensils" },
  fornecedores: { name: "Sua empresa", initials: "SE", icon: "building" },
  logistica: { name: "Sua empresa", initials: "SE", icon: "truck" },
  academia: { name: "Sua academia", initials: "SA", icon: "dumbbell" },
};

export function demoIdentity(slug: string) {
  return (
    identities[slug] ?? {
      name: "Seu espaço",
      initials: "SE",
      icon: "building" as const,
    }
  );
}
