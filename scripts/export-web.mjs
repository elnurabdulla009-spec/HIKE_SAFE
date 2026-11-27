// Builds the static web version for GitHub Pages: `npm run export:web`.
// Cross-platform (works on Windows too), no extra packages.
import { execSync } from 'node:child_process';
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
// The public demo uses ONLY the mock backend, so it must not contain any
// Supabase URL or key: ignore .env (EXPO_NO_DOTENV) and unset the variables,
// and --clear Metro's cache so no old inlined values survive.
const env = { ...process.env, EXPO_NO_DOTENV: '1' };
for (const k of Object.keys(env)) if (k.startsWith('EXPO_PUBLIC_')) delete env[k];
execSync('npx expo export --platform web --clear', { stdio: 'inherit', env });

// GitHub Pages has no file for /HIKE_SAFE/live etc. It serves 404.html instead,
// so 404.html = the app itself, and expo-router then shows the right screen.
copyFileSync('dist/index.html', 'dist/404.html');

// GitHub Pages runs Jekyll by default, which DROPS folders starting with "_"
// (our JavaScript lives in dist/_expo). This empty file turns Jekyll off.
writeFileSync('dist/.nojekyll', '');

console.log('\nReady: dist/ (with 404.html and .nojekyll)');
