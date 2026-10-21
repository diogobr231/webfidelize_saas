import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, configured } from "./supabase/server";
import {
  hasRecentRecoveryClaims,
  verifiedSessionIdentity,
  RECOVERY_WINDOW_SECONDS,
} from "./auth-flow";
import {
  createRecoveryProof,
  validRecoverySecret,
  verifyRecoveryProof,
} from "./auth-recovery-proof";
import { getAuthOrigin } from "./auth-origin";

const recoveryCookie = "wf-recovery-proof";

export function recoveryProofConfigured(): boolean {
  return validRecoverySecret(process.env.AUTH_FLOW_SECRET);
}

async function verifiedIdentity(db: SupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser();
  if (userError || !user) return null;
  const { data, error } = await db.auth.getClaims();
  if (error || !data) return null;
  const identity = verifiedSessionIdentity(data.claims, user.id);
  return identity ? { identity, claims: data.claims } : null;
}

/** Called only immediately after a successful verifyOtp with type recovery. */
export async function issueRecoveryProof(db: SupabaseClient): Promise<boolean> {
  const secret = process.env.AUTH_FLOW_SECRET;
  if (!validRecoverySecret(secret)) return false;
  const verified = await verifiedIdentity(db);
  if (!verified) return false;
  (await cookies()).set(
    recoveryCookie,
    createRecoveryProof(verified.identity, secret),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: getAuthOrigin().startsWith("https://"),
      path: "/",
      maxAge: RECOVERY_WINDOW_SECONDS,
    },
  );
  return true;
}

export async function clearRecoveryProof() {
  (await cookies()).delete(recoveryCookie);
}

export async function isRecoverySession(db: SupabaseClient): Promise<boolean> {
  // getUser checks the current account/session with Auth; getClaims verifies the
  // signature before reading AMR. Neither a query parameter nor getSession is proof.
  const verified = await verifiedIdentity(db);
  if (!verified) return false;
  if (hasRecentRecoveryClaims(verified.claims, verified.identity.userId))
    return true;
  return verifyRecoveryProof(
    (await cookies()).get(recoveryCookie)?.value,
    verified.identity,
    process.env.AUTH_FLOW_SECRET,
  );
}

export async function requireRecoverySession() {
  if (!configured()) redirect("/recuperar?erro=configuracao");
  const db = await createClient();
  if (!(await isRecoverySession(db))) redirect("/recuperar?erro=recuperacao");
  return { db };
}
