import tailwindcss from "@tailwindcss/vite";

const isProd = process.env.NODE_ENV === "production";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: !isProd },

  css: ["~/assets/css/tailwind.css"],

  modules: [
    "@nuxt/image",
    "@nuxt/icon",
    // ESLint module is only needed during development
    ...(!isProd ? ["@nuxt/eslint"] as const : []),
    "@nuxt/fonts",
    "shadcn-nuxt",
    "convex-nuxt",
  ],

  convex: {
    url: process.env.CONVEX_SELF_HOSTED_URL,
  },

  shadcn: {
    /**
     * Prefix for all the imported component.
     * @default "Ui"
     */
    prefix: "",
    /**
     * Directory that the component lives in.
     * Will respect the Nuxt aliases.
     * @link https://nuxt.com/docs/api/nuxt-config#alias
     * @default "@/components/ui"
     */
    componentDir: "@/components/ui",
  },

  vite: {
    plugins: [tailwindcss()],
    build: {
      sourcemap: false,
    },
  },

  nitro: {
    preset: "bun",
    // Server code runs on your own infrastructure — minification adds build
    // time without a meaningful benefit (no code is sent to end users).
    minify: false,
    sourceMap: false,
  },

  experimental: {
    buildCache: true,
  },

  icon: {
    // Scan source files and only bundle icons that are actually used
    clientBundle: {
      scan: true,
    },
    serverBundle: "local",
  },
});
