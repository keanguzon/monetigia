/**
 * CSRF protection: verify that the request's Origin header matches the Host header.
 * This prevents cross-site POST requests from third-party origins.
 *
 * Skipped in development mode for DX convenience.
 */
export function assertSameOrigin(request: Request): void {
    if (process.env.NODE_ENV === "development") return;

    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (!origin || !host) {
        throw new Error("forbidden");
    }

    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
        throw new Error("forbidden");
    }
}
