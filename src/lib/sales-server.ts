import "server-only";
import { cache } from "react";
import { publicDatabase } from "./supabase/public";
import { salesOfferColumns, type SalesOffer } from "./sales";

export const getSalesOffers = cache(async (): Promise<SalesOffer[] | null> => {
  try {
    const { data, error } = await publicDatabase()
      .from("sales_offers")
      .select(salesOfferColumns)
      .eq("active", true)
      .eq("published", true)
      .order("created_at")
      .limit(100);
    return error ? null : (data as SalesOffer[]);
  } catch {
    return null;
  }
});
