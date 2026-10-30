/**
 * ODA core/observers — ResizeObserver / IntersectionObserver (sleep/wake).
 * Вынесено из oda/oda.js без изменений логики.
 * Вызывается фасадом один раз при старте, до первой регистрации.
 */
export function initObservers() {
    ODA.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            entry.target.fire('resize', undefined, { bubbles: false, composed: false });
        }
    })

    ODA.intersectionObserver = new IntersectionObserver(entries => {
        let wake;
        for (let i = 0, entry, l = entries.length; i < l; i++) {
            entry = entries[i];
            if (!entry.target.isConnected) continue;
            const states = entry.target[R].states;
            const wasSleeping = states.sleep === true;
            states.sleep = !entry.isIntersecting;
            if (wasSleeping && entry.isIntersecting) {
                wake ??= new Set();
                wake.add(entry.target);
            }
        }
        if (!wake) return;
        for (let t of wake) {
            t.fire('wake', undefined, { bubbles: false, composed: false });
            t.render?.(true);
        }

    }, { rootMargin: '20%', threshold: 0 })
}
