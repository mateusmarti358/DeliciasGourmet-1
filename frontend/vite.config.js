import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /admin abre admin.html (dev); em produção o servidor Express faz o mesmo.
const adminRewrite = {
  name: "admin-rewrite",
  configureServer(s) {
    s.middlewares.use((req, _res, next) => {
      if (req.url === "/admin" || req.url.startsWith("/admin/")) req.url = "/admin.html";
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), adminRewrite],
  server: { proxy: { "/api": "http://localhost:3001", "/assets/uploads": "http://localhost:3001" } },
  build: { rollupOptions: { input: { main: "index.html", admin: "admin.html" } } },
});
