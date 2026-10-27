#!/usr/bin/env node
// Izolovaný Chrome benchmark celého UI, syntetická data a lokální síť.
process.env.E2E_BENCH_MODE = '1';
process.env.E2E_REQUIRED = '1';
await import('./check-e2e-smoke.mjs');
