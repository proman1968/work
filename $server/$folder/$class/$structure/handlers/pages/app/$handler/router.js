/**
 * Маршрут рабочего места в адресной строке: `#view=class&unit=unit.sales&place=head&path=/DATA/…&id=…`.
 * Контекст (подразделение и место) живёт в адресе вместе с экраном: ссылку можно переслать,
 * вкладка после перезагрузки открывается там же. Остальные параметры сохраняются как есть.
 */

/** Параметры маршрута в порядке записи в адрес. */
export const ROUTE_KEYS = Object.freeze(['view', 'unit', 'place', 'path', 'id']);

/** Экран по умолчанию. */
export const HOME = 'home';

/** Разбор `location.hash` (с решёткой или без). */
export function parseHash(hash = '') {
    const q = new URLSearchParams(String(hash).replace(/^#\/?/, ''));
    const route = { view: q.get('view') || HOME, unit: q.get('unit') || '', place: q.get('place') || '', path: q.get('path') || '', id: q.get('id') || '', params: {} };
    for (const [k, v] of q)
        if (!ROUTE_KEYS.includes(k))
            route.params[k] = v;
    return route;
}

const encode = v => encodeURIComponent(v).replace(/%2F/gi, '/');

/** Запись маршрута в адрес (`#…`); пустые значения и экран по умолчанию не пишутся. */
export function formatHash(route = {}) {
    const pairs = ROUTE_KEYS
        .map(k => [k, route[k] ?? ''])
        .filter(([k, v]) => v !== '' && !(k === 'view' && v === HOME));
    for (const [k, v] of Object.entries(route.params ?? {}))
        if (v !== '' && v != null)
            pairs.push([k, String(v)]);
    return pairs.length ? '#' + pairs.map(([k, v]) => `${k}=${encode(String(v))}`).join('&') : '#';
}

/** Новый маршрут: поля `patch` поверх `route`; экран другого класса не тянет за собой чужой `id` и параметры. */
export function navigate(route, patch = {}) {
    const next = { ...route, ...patch };
    const moved = 'view' in patch || 'path' in patch;
    if (moved && !('id' in patch))
        next.id = '';
    next.params = patch.params ?? (moved ? {} : route.params ?? {});
    return next;
}

/** Совпадают ли маршруты. */
export function sameRoute(a, b) {
    return formatHash(a) === formatHash(b);
}
