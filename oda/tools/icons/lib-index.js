/**
 * ODA tools/icons/lib-index — клиентский индекс SVG-библиотек.
 * Один fetch `${lib}.svg` на библиотеку (мемоизация), дальше — из кэша.
 * id берутся из symbol[id] и g[id]: 45 из 48 библиотек лежат
 * в symbol (старый селектор только g[id] молча отдавал пустоту).
 * Заменяет несуществующий серверный метод `svg_icons_list`.
 */
/** Имена SVG-библиотек в lib/svg (статический манифест: библиотека не зависит от серверного листинга папок). */
export const ICON_LIBS = ['ai', 'av', 'aws', 'bootstrap', 'box', 'bpmn', 'brands', 'carbon', 'communication', 'cryptocolor', 'cryptocurrency', 'device', 'editor', 'enterprise', 'eva', 'files-color', 'files', 'flags', 'flatcolor', 'fontawesome', 'games', 'hardware', 'iconoir', 'icons', 'image', 'industry-buildings', 'lineawesome', 'loaders', 'logos', 'maps', 'material', 'notification', 'odant', 'office-set', 'phone', 'shopping', 'social-media', 'social', 'space-sci-fi', 'spinners', 'symbols', 'tools', 'travel-and-tourism', 'unicon', 'vscode', 'weather'];

const parser = new DOMParser();
const jobs = Object.create(null);

export async function loadLibIndex(lib) {
    lib = String(lib || '').replace(/\.svg$/i, '');
    if (!lib)
        return [];
    return jobs[lib] ??= (async () => {
        try {
            const res = await fetch('/oda/tools/icons/lib/svg/' + lib + '.svg');
            if (!res.ok)
                return [];
            const svgText = await res.text();
            const doc = parser.parseFromString(svgText, 'text/html');
            return Array.prototype.map.call(doc.querySelectorAll('symbol[id], g[id]'), i => i.id);
        }
        catch {
            delete jobs[lib];
            return [];
        }
    })();
}
