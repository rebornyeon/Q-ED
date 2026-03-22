import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware(routing);

const protectedRoutes = ["/dashboard", "/study", "/upload"];
const authRoutes = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip locale prefix for route matching
  const pathWithoutLocale = pathname.replace(/^\/(ko|en)/, "") || "/";

  const isProtected = protectedRoutes.some((r) => pathWithoutLocale.startsWith(r));
  const isAuthRoute = authRoutes.some((r) => pathWithoutLocale.startsWith(r));

  if (isProtected || isAuthRoute) {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // Determine locale from path
    const locale = pathname.startsWith("/en") ? "en" : "ko";

    if (isProtected && !user) {
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
    }

    if (isAuthRoute && user) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
  runtime: "nodejs",
};
