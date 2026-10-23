import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "./lib/supabase/cookie-options";
import { authDomainPolicy, authEntryRedirect } from "./lib/auth-domains";
export async function proxy(request: NextRequest) {
  if (process.env.AUTH_LEGACY_ORIGINS?.trim()) {
    try {
      const target = authEntryRedirect(
        request.headers.get("host"),
        request.nextUrl.pathname,
        request.nextUrl.searchParams,
        authDomainPolicy(
          process.env.APP_URL,
          process.env.AUTH_LEGACY_ORIGINS,
          process.env.VERCEL_ENV === "production",
        ),
      );
      if (target) {
        // Never forward passwords or a stale Server Action POST to another host.
        const moved = NextResponse.redirect(target, 303);
        moved.headers.set("Cache-Control", "private, no-store");
        moved.headers.set("Referrer-Policy", "no-referrer");
        return moved;
      }
    } catch {
      return new NextResponse("O acesso por e-mail precisa ser configurado.", {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  }
  let response = NextResponse.next({ request });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return response;
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions(
        process.env.APP_URL,
        process.env.VERCEL_ENV === "production",
      ),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (
    !user &&
    (path === "/comecar" ||
      path === "/painel" ||
      path.startsWith("/painel/") ||
      path === "/admin" ||
      path.startsWith("/admin/") ||
      path === "/nova-senha")
  ) {
    const target = new URL("/entrar", request.url);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/comecar",
    "/painel/:path*",
    "/admin/:path*",
    "/entrar/:path*",
    "/cadastro",
    "/recuperar",
    "/nova-senha",
    "/auth/:path*",
  ],
};
