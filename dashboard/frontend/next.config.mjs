/** @type {import('next').NextConfig} */

// In dev, the API is the local dev-server (real Fastify, in-memory state).
// In prod (Stage 3), api + frontend sit behind the same CloudFront origin, so
// `/api/*` is same-origin — this rewrite only matters for local development.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8087';

const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
