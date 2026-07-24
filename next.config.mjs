/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf-parse (via pdfjs-dist) and mammoth use module patterns that break when
  // webpack bundles them into the server-action layer ("Object.defineProperty
  // called on non-object"). Keeping them external makes Next require() them
  // natively via Node at runtime instead of bundling them.
  // Renamed from experimental.serverComponentsExternalPackages in Next 15+.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
