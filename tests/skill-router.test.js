import '../oda/reactor.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ROUTE_MODES,
    buildTaskSkillBody,
    classifyRoute,
    detectCompositePrompt,
    keywordFallbackScore,
    loadSkillCatalog,
    routeSkill,
} from '../sources/host/skill-router.js';

function unit(vec) {
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0)) || 1;
    return vec.map(x => x / norm);
}

function mockTokenEmbed(text) {
    const t = String(text).toLowerCase();
    if (/найди|поиск файлов|find file|поиск документов/.test(t))
        return unit([1, 0, 0, 0]);
    if (/картин|изображ|нарис|генерация изображ/.test(t))
        return unit([0, 1, 0, 0]);
    if (/диалог|объясни|как это работает|привет|вопрос|общение/.test(t))
        return unit([0, 0, 1, 0]);
    if (/поиск файлов|найти файл|find command/.test(t))
        return unit([0.95, 0.05, 0, 0]);
    if (/генерация изображ/.test(t))
        return unit([0.05, 0.95, 0, 0]);
    if (/генерация видео/.test(t))
        return unit([0.05, 0.9, 0.05, 0]);
    return unit([0, 0, 0.05, 0.95]);
}

describe('skill-router', () => {
    it('loadSkillCatalog finds dialogue and file search skills', async () => {
        const catalog = await loadSkillCatalog(process.cwd());
        assert.ok(catalog.some(item => item.id === 'Диалог'), 'dialogue skill exists');
        assert.ok(catalog.some(item => item.id === 'Поиск файлов'), 'file search skill exists');
    });

    it('classifyRoute picks execute for clear leader', () => {
        const route = classifyRoute([
            { id: 'Поиск файлов', sim: 0.9 },
            { id: 'Генерация изображений', sim: 0.2 },
        ], { dialogueSkill: { id: 'Диалог', path: '/skills/system/Диалог' } });
        assert.equal(route.mode, ROUTE_MODES.EXECUTE);
        assert.equal(route.skills[0].id, 'Поиск файлов');
    });

    it('classifyRoute falls back to dialogue when scores are low', () => {
        const dialogueSkill = { id: 'Диалог', path: '/skills/system/Диалог' };
        const route = classifyRoute([{ id: 'X', sim: 0.1 }], { dialogueSkill });
        assert.equal(route.mode, ROUTE_MODES.DIALOGUE);
        assert.equal(route.skills[0].id, 'Диалог');
    });

    it('keywordFallbackScore ranks file search for find query', () => {
        const catalog = [
            { id: 'Поиск файлов', keywords: 'найти файл поиск документов' },
            { id: 'Диалог', keywords: 'диалог общение' },
        ];
        const scored = keywordFallbackScore('найди файл readme', catalog);
        assert.equal(scored[0].id, 'Поиск файлов');
    });

    it('routeSkill routes file search to execute', async () => {
        const catalog = await loadSkillCatalog(process.cwd());
        const route = await routeSkill('найди файл readme', {
            skills: catalog,
            embedFn: mockTokenEmbed,
        });
        assert.equal(route.mode, ROUTE_MODES.EXECUTE);
        assert.equal(route.skills[0].id, 'Поиск файлов');
    });

    it('routeSkill routes generic question to dialogue', async () => {
        const catalog = await loadSkillCatalog(process.cwd());
        const route = await routeSkill('объясни как это работает', {
            skills: catalog,
            embedFn: mockTokenEmbed,
        });
        assert.equal(route.mode, ROUTE_MODES.DIALOGUE);
    });

    it('buildTaskSkillBody keeps execute preview interactive', () => {
        const body = buildTaskSkillBody('найди файл', {
            mode: ROUTE_MODES.EXECUTE,
            skills: [{ id: 'Поиск файлов', path: '/skills/system/Поиск файлов', sim: 0.9 }],
            scores: [],
        });
        assert.equal(body.route, 'execute');
        assert.equal(body.disabled, false);
        assert.equal(body.skills[0].id, 'Поиск файлов');
    });

    it('buildTaskSkillBody keeps choice preview interactive', () => {
        const body = buildTaskSkillBody('файл и картинка', {
            mode: ROUTE_MODES.CHOICE,
            skills: [
                { id: 'Поиск файлов', sim: 0.8 },
                { id: 'Генерация изображений', sim: 0.78 },
            ],
            scores: [],
        });
        assert.equal(body.route, 'choice');
        assert.equal(body.disabled, false);
        assert.equal(body.skills.length, 2);
    });

    it('detectCompositePrompt matches multi-step requests', () => {
        assert.ok(detectCompositePrompt('найди readme и нарисуй закат'));
        assert.ok(!detectCompositePrompt('найди readme'));
    });

    it('classifyRoute uses clarify for weak multi-match', () => {
        const route = classifyRoute([
            { id: 'Поиск файлов', sim: 0.35 },
            { id: 'Генерация изображений', sim: 0.33 },
            { id: 'X', sim: 0.1 },
        ], { dialogueSkill: { id: 'Диалог' } });
        assert.equal(route.mode, ROUTE_MODES.CLARIFY);
        assert.equal(route.skills.length, 2);
    });

    it('routeSkill routes composite prompt to planning', async () => {
        const catalog = await loadSkillCatalog(process.cwd());
        const route = await routeSkill('найди readme и нарисуй закат', {
            skills: catalog,
            embedFn: mockTokenEmbed,
        });
        assert.equal(route.mode, ROUTE_MODES.EXECUTE);
        assert.equal(route.skills[0].id, 'Планирование');
    });
});
