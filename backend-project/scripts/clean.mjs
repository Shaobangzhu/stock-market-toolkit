import { rmSync } from 'node:fs';

// Only this package's generated output; never source, data, .env, or other projects.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
