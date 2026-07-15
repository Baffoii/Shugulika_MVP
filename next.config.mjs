/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // keep server actions on (default in 14.2) and allow larger form bodies for uploads metadata
  },
};

export default nextConfig;
