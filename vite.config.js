import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// If deploying to GitHub Pages at https://<user>.github.io/<repo>/,
// set base to "/<repo>/". For Vercel/Netlify or a custom domain, leave "/".
export default defineConfig({
  plugins: [react()],
  base: "/Leverage-Homes-Dashboard/",
});
