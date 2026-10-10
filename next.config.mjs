import path from "node:path";

const nextConfig = {
  // Keep deployment traces within this app instead of treating the parent
  // Termux home directory and its unrelated lockfile as the project root.
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
