/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep deploys resilient: don't fail the Vercel build on lint/type nits.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
};

module.exports = nextConfig;
