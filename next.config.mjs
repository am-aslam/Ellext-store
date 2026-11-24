/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `next dev` artifacts isolated from `next build`; sharing `.next`
  // while both commands run can leave webpack manifests pointing at missing chunks.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: { unoptimized: true },
};
export default nextConfig;
