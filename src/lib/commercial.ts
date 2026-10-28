import "server-only";
import { publicDatabase } from "./supabase/public";

export type CommercialPlan = {
  id: string;
  name: string;
  cents: number;
  staff: number;
  teamInsights: boolean;
  teamExport: boolean;
};
export async function commercialPlans(): Promise<CommercialPlan[] | null> {
  try {
    const { data, error } = await publicDatabase()
      .from("plans")
      .select("id,name,price_cents,staff_limit,team_insights,team_export")
      .order("price_cents");
    if (error || !data?.length) return null;
    return data.map((plan) => ({
      id: plan.id,
      name: plan.name,
      cents: plan.price_cents,
      staff: plan.staff_limit,
      teamInsights: plan.team_insights === true,
      teamExport: plan.team_export === true,
    }));
  } catch {
    return null;
  }
}
