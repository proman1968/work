/** Мета хендлера form/editor. Визуалка — editor.js. */
export default {
    icon: 'editor:mode-edit',
    label: 'Свойства',
    allowSave: true,
    /** Редактор свойств класса — только роль ADMIN. */
    roles: ['ADMIN'],
    /**
     * Редактор — только элементам с полями (STATIC, иначе FIELDS —
     * как $fields клиента: STATIC при наличии, иначе FIELDS).
     * @param {$folder} $context Элемент, для которого проверяется показ
     * @returns {Promise<boolean>} Есть ли поля для редактора
     */
    async allowUse($context) {
        const md = await $context?.METADATA;
        const raw = md?.STATIC?.length ? md.STATIC : md?.FIELDS;
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.fields) ? raw.fields : []);
        return list.length > 0;
    },
}
