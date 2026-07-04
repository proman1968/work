// Skill Manager — запуск и контроль выполнения скиллов
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as CORE from '../server/index.js';
import { PLANNING_SKILL_ID, routeSkill, saveTaskSkill } from './skill-router.js';

const SKILL_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    DONE: 'done',
    ERROR: 'error',
};

/**
 * Загрузить data.js скилла по его ID через import()
 * Ищет $skill/$storage/$skill/data.js (execute, METADATA)
 * и $skill/data.js (keywords для роутинга)
 */
async function loadSkillData(skillId) {
    const skillsItem = await WORK.get_item('/skills');
    if (!skillsItem) return null;

    const categories = await skillsItem.items;
    for (const cat of categories) {
        if (!cat.isDir && !cat.isStorage) continue;

        const items = await cat.items;
        const found = items.find(f => f.id === skillId);
        if (!found) continue;

        // Deep: $skill/$storage/$skill/data.js (execute, METADATA)
        const deepDataFile = await found._get_item('$skill')
            .then(skillFolder => skillFolder?._get_item('$storage'))
            .then(storage => storage?._get_item('$skill'))
            .then(skillDataFolder => skillDataFolder?.children)
            .then(children => children?.find(f => f.id === 'data.js'));

        // Surface: $skill/data.js (keywords)
        const surfaceDataFile = await found._get_item('$skill')
            .then(skillFolder => skillFolder?.children)
            .then(children => children?.find(f => f.id === 'data.js'));

        const dataFile = deepDataFile || surfaceDataFile;
        if (!dataFile) continue;

        try {
            const dir = dataFile.parent?.dir || dataFile.dir;
            const fullPath = path.join(dir, 'data.js');
            const mod = await import('file://' + fullPath + '?v=' + Date.now());
            const data = mod.default || mod;

            // Объединяем surface keywords с deep execute
            if (deepDataFile && surfaceDataFile && deepDataFile !== surfaceDataFile) {
                try {
                    const surfaceDir = surfaceDataFile.parent?.dir || surfaceDataFile.dir;
                    const surfacePath = path.join(surfaceDir, 'data.js');
                    const surfaceMod = await import('file://' + surfacePath + '?v=' + Date.now());
                    const surfaceData = surfaceMod.default || surfaceMod;
                    if (surfaceData.keywords && !data.keywords)
                        data.keywords = surfaceData.keywords;
                }
                catch { /* surface load failed — use deep only */ }
            }

            return {
                storage: deepDataFile?.parent?.parent?.parent || found,
                data,
                path: fullPath,
            };
        }
        catch (e) {
            console.warn('[skill-manager] load data', skillId, e.message);
        }
    }
    return null;
}

/**
 * Выполнить скилл по .skill файлу
 * @param {string} skillFilePath — путь к .skill файлу
 * @param {object} storage — storage вызывающего контекста
 * @param {object} options — { taskPath, logAuthor }
 */
export async function executeSkill(skillFilePath, storage, options = {}) {
    const { taskPath, logAuthor } = options;
    const skillItem = await WORK.get_item(skillFilePath);
    if (!skillItem?.load) throw new Error('Не найден .skill файл: ' + skillFilePath);

    const raw = await skillItem.load();
    const skill = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!skill?.skill) throw new Error('Некорректный .skill файл: нет поля skill');

    // Обновляем статус → running
    await updateSkillStatus(skillFilePath, storage, SKILL_STATUS.RUNNING);

    try {
        // Находим реальный скилл в skills/
        const found = await loadSkillData(skill.skill);
        if (!found) throw new Error('Скилл "' + skill.skill + '" не найден в /skills');

        const { data, storage: skillStorage } = found;

        // Подготавливаем params для execute
        const executeParams = {
            data: skill.data || {},
        };

        // Добавляем контекст
        const LLM = await WORK.get_item('/services/AI/GigaChat').catch(() => null);
        const context = {
            LLM,
            WORK,
            storage,
            skillStorage,
        };

        // Контекст выполнения: save_file и search делегируются к storage (caller)
        const execCtx = Object.create(storage);
        execCtx.save_file = async (saveParams = {}) => {
            const filename = saveParams.filename || saveParams.id;
            if (!filename)
                throw new Error('save_file: filename обязателен');
            return storage.save_file({
                ...saveParams,
                filename,
                encoding: saveParams.encoding || (Buffer.isBuffer(saveParams.post) ? undefined : 'utf-8'),
                user: WORK,
                logAuthor,
                ignore_save_logs: true,
            });
        };
        if (typeof storage.search === 'function')
            execCtx.search = storage.search.bind(storage);

        // Вызываем execute
        let result;
        if (typeof data.execute === 'function') {
            result = await data.execute.call(execCtx, executeParams, context);
        }
        else if (typeof data.execute === 'string') {
            // Это текст инструкции — отдаём LLM
            if (!LLM?.generate) throw new Error('LLM недоступен для скилла ' + skill.skill);
            result = await LLM.generate({
                messages: [
                    { role: 'system', content: data.execute },
                    { role: 'user', content: JSON.stringify(executeParams.data) }
                ]
            });
        }
        else if (data.services?.length) {
            // Скилл через внешний сервис
            throw new Error('Скилл "' + skill.skill + '" пока не поддерживается (services)');
        }
        else {
            throw new Error('Скилл "' + skill.skill + '" не имеет execute');
        }

        // Обновляем статус → done
        await updateSkillStatus(skillFilePath, storage, SKILL_STATUS.DONE, result);

        // Если это скилл "Планирование" и есть шаги — создаём первый шаг
        if (skill.skill === PLANNING_SKILL_ID && result?.steps?.length && taskPath) {
            try {
                const stepPath = await spawnPlanStep(storage, taskPath, result.steps[0], logAuthor);
                if (stepPath && storage.appendLogIncludes)
                    await storage.appendLogIncludes(taskPath, [stepPath], { user: WORK });
            }
            catch (e) {
                console.warn('[skill-manager] spawnPlanStep:', e.message);
            }
        }

        return { ok: true, result };
    }
    catch (err) {
        console.warn('[skill-manager]', err.message);
        await updateSkillStatus(skillFilePath, storage, SKILL_STATUS.ERROR, { error: err.message });
        throw err;
    }
}

/**
 * Создать первый шаг плана — маршрутизировать и сохранить как .skill
 */
async function spawnPlanStep(storage, taskPath, step, logAuthor) {
    const route = await routeSkill(step.prompt);
    const skillLog = await saveTaskSkill(storage, step.prompt, route, { logAuthor });
    const path = skillLog?.logFullPath || skillLog?.path;
    return path || null;
}

/**
 * Обновить статус и результат в .skill файле через save()
 */
async function updateSkillStatus(skillFilePath, storage, status, result) {
    try {
        const skillItem = await WORK.get_item(skillFilePath);
        if (!skillItem?.load) return;

        const raw = await skillItem.load();
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
        data.status = status;
        data.updatedAt = Date.now();
        if (result !== undefined) data.result = result;
        if (status === SKILL_STATUS.ERROR) data.error = result?.error || String(result);

        await skillItem.save({
            post: JSON.stringify(data, null, 2),
            encoding: 'utf-8',
            user: WORK,
        });
    }
    catch (e) {
        console.warn('[skill-manager] status update failed', e.message);
    }
}

export { SKILL_STATUS };