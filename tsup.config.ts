import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
  },
  format: ["esm"],
  target: "node20",
  splitting: true,
  clean: true,
  dts: { entry: "src/index.ts" },
  outDir: "dist",
});
