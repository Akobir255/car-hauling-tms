import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silences a workspace-root warning caused by an unrelated package-lock.json
  // in the parent C:\Users\User directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
