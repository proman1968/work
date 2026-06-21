import { HANDLER } from './constants.js';

export function buildHandlerPath(handlerId, section = 'pages') {
    return `${HANDLER.prefix}${section}//${handlerId}/`;
}

export function buildHandlerUrl(shortPath, handlerId, section = 'pages') {
    return encodeURI(`${shortPath || ''}${buildHandlerPath(handlerId, section)}`);
}

export function buildOpenUrl(origin, shortPath, page, section = 'pages') {
    const base = origin || '';
    return new URL(buildHandlerUrl(shortPath, page, section), base || 'http://localhost').href;
}

export function buildItemUrl(origin, shortPath) {
    return encodeURI((origin || '') + (shortPath || ''));
}

export function buildMethodHandlerPath(method) {
    return `~/handlers/methods/${method}`;
}
