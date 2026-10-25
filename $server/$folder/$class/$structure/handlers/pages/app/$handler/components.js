/**
 * Компоненты Web Awesome, которые использует оболочка: подключаются явно (лоадер Web Awesome
 * не видит элементы внутри shadow DOM Lit-компонентов). Новый компонент — добавить в список.
 */
const WA = '/vendor/webawesome/components';

export const COMPONENTS = Object.freeze([
    'badge', 'breadcrumb', 'breadcrumb-item', 'button', 'callout', 'card', 'checkbox', 'dialog', 'input', 'option', 'page',
    'pagination', 'popover', 'popup', 'select', 'spinner', 'textarea', 'tree', 'tree-item',
]);

await Promise.all(COMPONENTS.map(name => import(`${WA}/${name}/${name}.js`)));
