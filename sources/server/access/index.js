/**
 * Подсистема доступа: политика (чистые правила) + индекс лент.
 * Ядро ($class.canSee/canWrite) и RAG пользуются одним и тем же кодом.
 */
export * as POLICY from './policy.js';
export * as REFS from './refs.js';
