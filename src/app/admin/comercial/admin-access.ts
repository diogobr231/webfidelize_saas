import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

/** Every sales page calls this before reading commercial or personal data. */
export async function requireSalesAdmin() {
  const session = await requireUser();
  const { data, error } = await session.db.rpc("is_super_admin");
  if (error || data !== true) notFound();
  return session;
}
