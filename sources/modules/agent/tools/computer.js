/**
 * Экран персонального компьютера: скриншоты, мышь/клавиатура, передача человеку.
 * Скриншот возвращается богатым результатом { text, images } — loop.js кладёт PNG
 * в ленту (entry.images), а в контекст модели — последние 3 (SHOTS_IN_CONTEXT).
 * Координаты — пиксели при 1280×800.
 */
import { getDocker } from '../../sandbox/driver.js';
import { loadSandboxConfig } from '../../sandbox/config.js';
import {
    ownerOf, computerName, ensureComputer, findComputer, execDisplayAction,
    screenshotPng, touchComputer, controlBy,
} from '../../sandbox/manager.js';
import { ctxRun } from './sandbox.js';

async function useDisplayComputer(args, ctx) {
    const cfg = loadSandboxConfig();
    if (cfg.enabled === false)
        throw new Error('песочницы выключены (#system/sandbox.json enabled:false)');
    const docker = await getDocker();
    const owner = ownerOf(ctx);
    const name = computerName(args?.name);
    const pc = await ensureComputer(docker, owner, name, cfg);
    touchComputer(owner, name, pc.id);
    return { docker, owner, name, pc };
}

function shotResult(png, label) {
    return { text: 'Скриншот [' + label + '] — экран 1280×800, смотри изображение в конце контекста.', images: [{ png, label }] };
}

const NAME_PROP = { name: { type: 'string', description: 'Компьютер (по умолчанию main)' } };

export const computerTools = [
    {
        name: 'computer_screenshot',
        readonly: true,
        description: 'Скриншот экрана компьютера (1280×800). Смотри изображение в конце контекста; координаты для computer_action — пиксели этого скриншота. Нужен графический образ (work-computer).',
        parameters: { type: 'object', properties: { ...NAME_PROP } },
        run: ctxRun('computer_screenshot', async (args, ctx) => {
            const { docker, pc } = await useDisplayComputer(args, ctx);
            const png = await screenshotPng(docker, pc.id, { signal: ctx?.signal });
            return shotResult(png, 'экран «' + pc.name + '»');
        }),
    },
    {
        name: 'computer_action',
        risk: 'write',
        description: 'Мышь и клавиатура компьютера + свежий скриншот после. Сначала computer_screenshot, целься по нему. Пока экраном управляет человек — недоступно.',
        parameters: {
            type: 'object',
            properties: {
                ...NAME_PROP,
                action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'drag', 'move', 'type', 'key', 'scroll', 'wait'], description: 'Действие' },
                x: { type: 'number', description: 'X в пикселях (click, move, scroll)' },
                y: { type: 'number', description: 'Y в пикселях (click, move, scroll)' },
                x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number', description: 'Координаты drag' },
                button: { type: 'integer', description: 'Кнопка click: 1 или 3' },
                text: { type: 'string', description: 'Текст для type (латиница; кириллица — через буфер обмена браузера на этапе 3)' },
                key: { type: 'string', description: 'Клавиша для key (Return, Tab, Escape, ctrl+c, …)' },
                direction: { type: 'string', enum: ['up', 'down'] },
                amount: { type: 'integer', description: 'Шаги scroll (1–10)' },
                ms: { type: 'integer', description: 'Пауза wait, мс' },
            },
            required: ['action'],
        },
        run: ctxRun('computer_action', async (args, ctx) => {
            const { docker, pc } = await useDisplayComputer(args, ctx);
            const { label } = await execDisplayAction(docker, pc.id, args, { signal: ctx?.signal });
            const png = await screenshotPng(docker, pc.id, { signal: ctx?.signal });
            return shotResult(png, 'после: ' + label);
        }),
    },
    {
        name: 'computer_handoff',
        risk: 'write',
        description: 'Передать экран человеку: он увидит скриншот и вопрос (капча, вход в аккаунт, подтверждение). Агент ждёт ответа и продолжает. В автономном запуске недоступно.',
        parameters: {
            type: 'object',
            properties: {
                ...NAME_PROP,
                reason: { type: 'string', description: 'Что нужно от человека (увидит в вопросе)' },
            },
            required: ['reason'],
        },
        run: ctxRun('computer_handoff', async (args, ctx) => {
            const { host, entry, turn } = ctx;
            const { docker, pc } = await useDisplayComputer(args, ctx);
            const png = await screenshotPng(docker, pc.id, { signal: ctx?.signal }).catch(() => null);
            if (typeof host.wait !== 'function')
                return 'Человек недоступен (автономный запуск). Действуй сам в пределах песочницы и явно укажи допущение.'
                    + (png ? ' Скриншот приложен к вызову.' : '');
            entry.status = 'waiting';
            await host.save();
            const res = await host.wait({
                kind: 'question', item: turn.id, call: entry.id,
                question: 'Компьютер «' + pc.name + '» ждёт вас: ' + (args?.reason || 'нужно вмешательство')
                    + ' (кнопка «Компьютер» — посмотреть экран и взять управление)',
            }) || {};
            entry.status = 'running';
            const answer = String(res.content ?? res.answer ?? '').trim();
            if (answer)
                entry.answer = answer;
            const out = answer ? 'Ответ человека: ' + answer : 'Человек не ответил по существу — действуй сам в пределах песочницы.';
            if (!png)
                return out;
            return { text: out + ' Актуальный скриншот приложен.', images: [{ png, label: 'экран после ответа человека' }] };
        }),
    },
];

/** Кто управляет экраном (для UI/WS-слоя). */
export async function computerControl(args, ctx) {
    const docker = await getDocker();
    const found = await findComputer(docker, ownerOf(ctx), computerName(args?.name));
    if (!found)
        return { control: 'agent', exists: false };
    return { control: controlBy(found.id), exists: true, id: found.id };
}
