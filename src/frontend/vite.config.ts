import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Copy Shoelace icons to dist for production builds
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@shoelace-style/shoelace/dist/assets/icons/*',
          dest: 'shoelace/assets/icons',
        },
      ],
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    target: 'ES2022',
  },
});
