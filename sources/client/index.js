import { $file } from './file.js';

export function parseHistoryEntryPath(path) {
    return $file.parseHistoryEntryPath(path);
}

export function historyEntryLabel(path) {
    return $file.historyEntryLabel(path);
}

export function historyUserLabel(path) {
    return $file.historyUserLabel(path);
}

export function historyUserLabelAsync(path) {
    return $file.historyUserLabelAsync(path);
}

export function fixMdHistoryLinks(md) {
    return $file.fixMdHistoryLinks(md);
}

export { $item } from '../core.js';
export { $field } from './field.js';
export { $folder } from './folder.js';
export { $file };
export { $storage } from './storage.js';
export { $user } from './user.js';
export { $handler } from './handler.js';