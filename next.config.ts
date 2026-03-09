import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);

const nextConfig: NextConfig = {
  typedRoutes: true,
  turbopack: {
    root: currentDirectory,
  },
};

export default nextConfig;
