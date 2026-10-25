/**
 * Подключение Web Awesome из `/vendor/webawesome` без сборки: стили, русские подписи и компоненты
 * (`components.js`) — локально. Lit — `/vendor/lit/lit.js` (общий для компонентов оболочки).
 */
const WA = '/vendor/webawesome';
const THEME = new URL('./theme.css', import.meta.url).href;

await import(WA + '/translations/ru.js');
await import('./components.js');

function stylesheet(href) {
    if (document.querySelector(`link[href="${href}"]`))
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
        link.onload = resolve;
        link.onerror = () => reject(new Error(`Не загрузились стили ${href}`));
        document.head.appendChild(link);
    });
}

/** Тема страницы: токены Web Awesome и наши (theme.css); светлая/тёмная — класс `wa-dark` на `<html>`. */
export async function loadTheme() {
    await Promise.all([stylesheet(`${WA}/styles/webawesome.css`), stylesheet(THEME)]);
    const root = document.documentElement;
    root.classList.add('wa-theme-default', 'wa-palette-default', 'wa-brand-indigo', 'work-app');
    root.lang = 'ru';
    applyScheme(savedScheme());
}

const KEY = 'work.scheme';

/** `light` | `dark`: сохранённый выбор, иначе системный. */
export function savedScheme() {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyScheme(scheme) {
    document.documentElement.classList.toggle('wa-dark', scheme === 'dark');
    document.documentElement.style.colorScheme = scheme;
    try {
        localStorage.setItem(KEY, scheme);
    }
    catch { /* без сохранения */ }
}
