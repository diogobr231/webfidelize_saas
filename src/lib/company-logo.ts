import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOGO_BUCKET,
  logoPathBelongsToCompany,
} from "./company-personalization";

/** The caller's JWT and Storage RLS authorize this exact path; no privileged key. */
export async function signedCompanyLogo(
  db: SupabaseClient,
  companyId: string,
  path: unknown,
) {
  if (typeof path !== "string" || !logoPathBelongsToCompany(path, companyId))
    return null;
  const { data, error } = await db.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(path, 60);
  return error ? null : data.signedUrl;
}

/** Catalog returns only a currently published logo from an active public booking page. */
export async function signedPublicLogo(db: SupabaseClient, path: unknown) {
  if (typeof path !== "string") return null;
  return signedCompanyLogo(db, path.split("/")[0] || "", path);
}
