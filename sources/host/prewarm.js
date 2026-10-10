/**
 * Прогрев серверных кэшей после старта: верхние уровни дерева классов (class.js, дети).
 * Первый вход пользователя иначе платит холодную сборку на каждом узле (сотни мс на узел).
 * Идёт фоном и последовательно, ошибки отдельных узлов не мешают; WORK_PREWARM=0 — выключить.
 */
import { FS } from '../server/index.js';

/**
 * @param {object} root Корень дерева (WORK)
 * @param {number} [depth] Сколько уровней классов прогреть
 * @returns {Promise<{classes: number, ms: number}>}
 */
export async function prewarm(root, depth = 2) {
    const t0 = Date.now();
    let classes = 0;
    const walk = async (item, left) => {
        let kids;
        try {
            kids = await item.items;
        }
        catch { return; }
        for (const kid of kids || []) {
            // только классы: обычные папки (node_modules, docs) и файлы дерево строит по требованию
            if (!(kid instanceof FS.$class))
                continue;
            try {
                await kid.init;
            }
            catch { continue; }
            classes++;
            if (left > 1)
                await walk(kid, left - 1);
        }
    };
    await walk(root, depth);
    return { classes, ms: Date.now() - t0 };
}
