import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  css: ["~/assets/css/tailwind.css"],

  modules: [
    "@nuxt/image",
    "@nuxt/icon",
    "@nuxt/eslint",
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
  },

  nitro: {
    preset: "bun",
    // Use the legacy externals algorithm which caches module resolutions
    // (~3x faster). https://github.com/nitrojs/nitro/issues/2369
    experimental: {
      legacyExternals: true,
    },
    // Skip @vercel/nft dependency tracing — the slowest build step.
    // Runtime dependencies are provided via node_modules in the Dockerfile.
    externals: {
      trace: false,
    },
    minify: false,
    sourceMap: false,
  },
});
