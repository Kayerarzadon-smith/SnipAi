/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ships a server with only the modules it actually imports, instead of the
  // whole 250MB node_modules tree. This is what makes the app bundle a sane
  // size -- and it is the difference between something you can hand someone
  // and something you cannot.
  output: "standalone",
  experimental: {
    // The tracer follows the runtime references in pipeline.ts into
    // ugc-edit-system and copies the lot -- the venv, and the footage with
    // it. That directory is not JavaScript the server imports; the Python
    // tools are bundled deliberately by scripts/bundle-app, and the library
    // belongs to the person, not the app.
    outputFileTracingExcludes: {
      "*": [
        "./ugc-edit-system/**",
        "./.next/cache/**",
        "./tests/**",
      ],
    },
  },
};

module.exports = nextConfig;
