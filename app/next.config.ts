import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hay lockfiles sueltos fuera del proyecto (C:\Users\manue) — fijar la raíz evita
  // que Turbopack infiera un workspace equivocado.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
