import { META_PREFIX, SYSTEM_PREFIX } from './constants.js';

/** Hide `$meta` folders in public URL paths */
export function toShortPath(path) {
    return path?.replace(/\/\$[^/]+(?:\/\$[^/]+)*(?=\/[^$])/g, '/~') || '';
}

/** Split a path string or copy an array of steps */
export function parsePathSteps(path) {
    if (Array.isArray(path)) return [...path];
    return (path ?? '').split('/');
}

export const PATH_STEP = {
    EMPTY: 'empty',
    TILDE: 'tilde',
    ANCESTOR: 'ancestor',
    WILDCARD: 'wildcard',
    CURRENT: 'current',
    NAME: 'name',
};

export function classifyPathStep(step) {
    if (!step) return PATH_STEP.EMPTY;
    switch (step[0]) {
        case '~': return PATH_STEP.TILDE;
        case '@': return PATH_STEP.ANCESTOR;
        case '*': return PATH_STEP.WILDCARD;
        case '.': return PATH_STEP.CURRENT;
        default: return PATH_STEP.NAME;
    }
}

export function isMetaId(id) {
    return id?.[0] === META_PREFIX;
}

export function isSystemId(id) {
    return id?.[0] === SYSTEM_PREFIX;
}

export function joinPath(...segments) {
    return segments.filter(Boolean).join('/');
}
