import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
