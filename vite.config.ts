import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5173 },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"]
        }
      }
    }
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production")
  }
});