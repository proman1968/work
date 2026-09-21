/**
 * ODA core/observers — ResizeObserver / IntersectionObserver (sleep/wake).
 * Вынесено из oda/oda.js без изменений логики.
 * Вызывается фасадом один раз при старте, до первой регистрации.
 */
export function initObservers() {
    ODA.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            entry.target.fire('resize');
        }
    })

    ODA.intersectionObserver = new IntersectionObserver(entries => {
        let wake;
        for (let i = 0, entry, l = entries.length; i < l; i++) {
            entry = entries[i];
            if (!entry.target.isConnected) continue;
            entry.target[R].states.sleep = !entry.isIntersecting;
            if (!entry.target[R].states.sleep) {
                wake ??= [];
                wake.add(entry.target)
            }
        }
        if (!wake) return;
        for (let t of wake) {
            t.fire('wake');
            t.render?.(true);
        }

    }, { rootMargin: '20%', threshold: 0 })
}
