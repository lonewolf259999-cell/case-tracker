/** @type {import('next').NextConfig} */

/* Headers the app should always send. Kept in one place so a new route cannot
   accidentally ship without them. */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  // Lets `npm run build` produce a self-contained server for a VPS/DirectAdmin.
  output: 'standalone',

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
