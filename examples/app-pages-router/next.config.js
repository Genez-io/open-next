/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  cleanDistDir: true,
  transpilePackages: ["@example/shared"],
  output: "standalone",
  outputFileTracing: "../sst",
  experimental: {
    serverActions: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
};

module.exports = nextConfig;
