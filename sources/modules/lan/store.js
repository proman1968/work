/**
 * Найденное в сети: #system/lan/candidates.json — { "host:port": { host, port, kind, label, info, via, seen } }.
 * Кандидат ≠ сервис: в /SERVICES/LAN он попадает только после net_register.
 */
import fs from 'node:fs';
import path from 'node:path';

function file() {
    return path.join(process.cwd(), '#system', 'lan', 'candidates.json');
}

export function load() {
    try {
        return JSON.parse(fs.readFileSync(file(), 'utf-8'));
    }
    catch {
        return {};
    }
}

/** Чужой текст в находке урезается до оговорки (F27): склад — инвентарь адресов
 *  и типов, а не архив XML с устройств; полные ответы агент видит в результате инструмента. */
const INFO_FIELD_MAX = 400;
function trimInfo(info) {
    const out = {};
    for (const [k, v] of Object.entries(info || {})) {
        if (typeof v === 'string')
            out[k] = v.length > INFO_FIELD_MAX ? v.slice(0, INFO_FIELD_MAX) + '…' : v;
        else if (v && typeof v === 'object' && !Array.isArray(v))
            out[k] = trimInfo(v);
        else
            out[k] = v;
    }
    return out;
}

/** Слить находки (новые поля поверх старых). @returns {number} сколько новых */
export function merge(list) {
    const all = load();
    let fresh = 0;
    for (const c of list) {
        if (!c?.host)
            continue;
        const k = [c.host, c.port ?? '', c.kind || '', c.url || ''].join('|');
        if (!all[k])
            fresh++;
        all[k] = { ...all[k], ...c, label: String(c.label || all[k]?.label || '').slice(0, 200), id: k,
            info: trimInfo({ ...all[k]?.info, ...c.info }), seen: Date.now() };
    }
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const recent = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].seen - a[1].seen).slice(0, 10000));
    fs.writeFileSync(file() + '.tmp', JSON.stringify(recent, null, 2), 'utf-8');
    fs.renameSync(file() + '.tmp', file());
    return fresh;
}

export function clear() {
    try {
        fs.unlinkSync(file());
    }
    catch { /* нет файла */ }
}
