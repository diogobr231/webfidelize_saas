import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COVER_BUCKET,
  coverPathBelongsToCompany,
} from "./company-personalization";

/** Exact paths are authorized by the caller's JWT and Storage RLS, without a service key. */
export async function signedCompanyCover(
  db: SupabaseClient,
  companyId: string,
  path: unknown,
) {
  if (typeof path !== "string" || !coverPathBelongsToCompany(path, companyId))
    return null;
  const { data, error } = await db.storage
    .from(COVER_BUCKET)
    .createSignedUrl(path, 60);
  return error ? null : data.signedUrl;
}

export async function signedPublicCover(db: SupabaseClient, path: unknown) {
  if (typeof path !== "string") return null;
  return signedCompanyCover(db, path.split("/")[0] || "", path);
}
