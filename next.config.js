function developmentSupabaseOrigin() {
  if (process.env.NODE_ENV !== "development") return null;
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof configuredUrl !== "string" || /[\u0000-\u0020\u007f]/.test(configuredUrl)) return null;
  try {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.MONETIGIA_BUILD_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/transactions/new",
        destination: "/transactions",
        permanent: true,
      },
    ];
  },
  async headers() {
    const localApiOrigin = developmentSupabaseOrigin();
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Scripts: self + Next.js inline scripts + Supabase auth (uses postMessage iframes)
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Styles: self + inline styles used by Tailwind/shadcn
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Fonts
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + Supabase storage + OAuth avatars + data URIs
              "img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
              // API connections: self + Supabase
              `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localApiOrigin ? ` ${localApiOrigin}` : ""}`,
              // Frames: Supabase auth uses an iframe for session refresh
              "frame-src 'self' https://*.supabase.co",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

module.exports = nextConfig;
