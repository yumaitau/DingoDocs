import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import {
  PATHNAME_HEADER,
  PATHNAME_SIGNATURE_HEADER,
  signPathname,
} from "@/lib/auth/pathname-signature";

const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/icon",
];
const publicFile =
  /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?)$/i;

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);
  forwardedHeaders.set(PATHNAME_HEADER, pathname);
  // Signed so server code can tell a proxy-set pathname from a client-sent
  // one; API routes skip the proxy and would otherwise trust the client.
  const signature = signPathname(pathname);
  if (signature) forwardedHeaders.set(PATHNAME_SIGNATURE_HEADER, signature);
  else forwardedHeaders.delete(PATHNAME_SIGNATURE_HEADER);
  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  response.headers.set("x-request-id", requestId);

  if (
    isPublic(pathname) ||
    pathname.startsWith("/_next") ||
    publicFile.test(pathname)
  )
    return response;

  // Handles the __Secure- prefix Better Auth uses on HTTPS deployments.
  if (!getSessionCookie(request)) {
    const destination = new URL("/sign-in", request.url);
    destination.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(destination);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }

  return response;
}

export const config = {
  // API routes authenticate themselves and return JSON errors, so they stay out
  // of the proxy. This also keeps upload bodies out of the proxy body buffer.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
