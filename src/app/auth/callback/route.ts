import { NextResponse, type NextRequest } from "next/server";
import { createClient, configured } from "@/lib/supabase/server";
import {
  authDestination,
  authPageUrl,
  parseEmailConfirmation,
} from "@/lib/auth-flow";
import { authCallbackOrigin } from "@/lib/auth-origin";
import { isRecoverySession } from "@/lib/auth-recovery";

export async function GET(request: NextRequest) {
  let origin: string;
  try {
    origin = authCallbackOrigin(request.headers);
  } catch {
    return new NextResponse(
      "O acesso por e-mail ainda precisa ser configurado.",
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const go = (destination: string) => {
    const response = NextResponse.redirect(new URL(destination, origin));
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const params = request.nextUrl.searchParams;
  const next = authDestination(params.get("next"));
  // New email templates land here without consuming the token. Link scanners
  // may follow GET redirects; only the explicit confirmation POST verifies OTP.
  if (params.has("token_hash")) {
    const confirmation = parseEmailConfirmation(Object.fromEntries(params));
    if (!confirmation)
      return go(authPageUrl("/entrar", { next, erro: "link" }));
    return go(`/auth/confirm?${new URLSearchParams(confirmation)}`);
  }
  const code = params.get("code");
  if (code && code.length <= 4096 && configured()) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      if (await isRecoverySession(db)) return go("/nova-senha");
      if (params.get("next") === "/nova-senha")
        return go("/recuperar?erro=recuperacao");
      return go(next);
    }
  }
  return go(
    authPageUrl(
      params.get("next") === "/nova-senha" ? "/recuperar" : "/entrar",
      { next, erro: "link" },
    ),
  );
}
