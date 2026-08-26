/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// タイピング処理の単体テストは DOM に依存しない純粋関数として書く方針のため
// (design.md §11)、vitest の environment は 'node' に固定する。
// jsdom / happy-dom / @testing-library は導入しない。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
