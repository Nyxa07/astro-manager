import { defineConfig } from 'vitest/config';

// Tests du process principal et du preload : code Node, hors du pipeline Angular
// (qui a son propre runner via `ng test`, en environnement jsdom).
export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    include: ['src/{main,preload}/**/*.spec.ts'],
  },
});
