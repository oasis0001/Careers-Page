import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static assets (david_before.png, Brain.glb, fonts/, 3DSpaceScreens/, BrainSpaceScreens/)
// live in /public and are served from the site root — matching the relative paths
// the original index.html used (e.g. 'Brain.glb', '3DSpaceScreens/...').
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
});
