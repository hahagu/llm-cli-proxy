// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'vue/html-self-closing': 'off',
  },
}).append({
  ignores: ['app/components/ui/**', 'convex/_generated/**'],
})
