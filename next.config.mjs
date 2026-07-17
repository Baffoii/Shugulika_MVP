/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // keep server actions on (default in 14.2) and allow larger form bodies for uploads metadata
    // pdf-parse (via pdfjs-dist) and mammoth use module patterns that break when
    // webpack bundles them into the server-action layer ("Object.defineProperty
    // called on non-object"). Keeping them external makes Next require() them
    // natively via Node at runtime instead of bundling them.
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
};

export default nextConfig;
