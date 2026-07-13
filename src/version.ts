// src/version.ts — single source of truth (inlined from package.json at build time).
import pkg from '../package.json';

export const VERSION: string = (pkg as { version: string }).version;
