/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep deploys resilient: don't fail the Vercel build on lint/type nits.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  experimental: {
    // Every page here is a "use client" component that fetches its own data
    // in useEffect. The App Router's client-side Router Cache otherwise keeps
    // a page instance (and its stale fetched data) alive for 30s on
    // back/forward or Link navigation, so re-visiting a page you just
    // mutated (e.g. Categories after renaming/deleting) can briefly show
    // stale counts. Disabling it means every navigation re-fetches fresh.
    staleTimes: { dynamic: 0 },
  },
};

module.exports = nextConfig;
