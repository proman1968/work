/**
 * Хендлер переноса локальных моделей (/MODELS/Local) на диск / USB-флешку или через .tar.
 * Открывает единый диалог выгрузки и загрузки через `WORK.showDialog`.
 */
function invalidateClientModelsTree() {
    for (const w of [window, window.parent, window.top]) {
        try {
            const wk = w?.WORK;
            if (!wk?.items)
                continue;
            for (const k of Object.keys(wk.items)) {
                if (k === '/MODELS' || k.startsWith('/MODELS/')) {
                    const node = wk.items[k];
                    if (node?.[w.R]?.cache)
                        delete node[w.R].cache.items;
                    node?.reset?.();
                }
            }
        }
        catch { /* ignore cross-frame */ }
    }
}

export default {
    icon: 'carbon:usb',
    label: 'Выгрузить / Загрузить (Диск / Флешка)',
    roles: ['BOSS'],
    order: 5,
    allowUse($context) {
        const p = String($context?.path || $context?.short || '');
        return p === '/MODELS/Local';
    },
    async execute() {
        const ctx = await (this.$context || this.$item?.$context) || await WORK.get_item('/MODELS/Local');
        const mod = await import('/$server/$folder/lib/local-models-transfer/local-models-transfer.js');
        await mod.openLocalModelsTransferDialog(ctx, {
            mode: 'export',
            onComplete: () => invalidateClientModelsTree(),
        });
    },
};
