import "server-only";
import { publicDatabase } from "./supabase/public";

export type CommercialPlan = {
  id: string;
  name: string;
  cents: number;
  staff: number;
};
export async function commercialPlans(): Promise<CommercialPlan[] | null> {
  try {
    const { data, error } = await publicDatabase()
      .from("plans")
      .select("id,name,price_cents,staff_limit")
      .order("price_cents");
    if (error || !data?.length) return null;
    return data.map((plan) => ({
      id: plan.id,
      name: plan.name,
      cents: plan.price_cents,
      staff: plan.staff_limit,
    }));
  } catch {
    return null;
  }
}
