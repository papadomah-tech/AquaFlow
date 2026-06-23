/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required: prevents Next.js trying to statically generate
  // pages that depend on runtime env vars (Supabase)
  output: 'standalone',
  experimental: {
    // Allow server components to read env vars at runtime
    serverComponentsExternalPackages: ['@supabase/supabase-js'],
  },
}
module.exports = nextConfig
