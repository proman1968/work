/**
 * Спекулятивное декодирование встроенного движка Halowin Bubo:
 * разбор `--help`, сборка аргументов (MTP + Draft Head + Prompt Lookup), настройки и откат.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
    parseEngineHelpFlags,
    resolveSpeculationPlan,
    readEngineSettings,
    writeEngineSettings,
    startHalogenBackend,
    stopHalogenBackend,
    DEFAULT_ENGINE_SETTINGS,
} from '../sources/modules/trainer/index.js';

const HELP_TEXT = `
Usage: bubo serve llm [options]

Options:
  --host <addr>                 Bind address (default 127.0.0.1)
  --port <num>                  Listen port
  --model <path>                Main GGUF model
  --mtp-model <path>            MTP predictor weights
  --twin-model <path>           Dense twin weights
  --draft-head-model <path>     Draft head weights
  --speculative <mode>          Speculative decoding mode: mtp | ngram | none
  --draft-max <n>               Maximum draft tokens
  --draft-min <n>               Minimum draft tokens
  --draft-p-min <p>             Draft acceptance threshold
  --lookup-cache-dynamic <file> Dynamic prompt lookup cache
  --npu-prefill <on|off>        Ryzen AI NPU prefill
`;

const SIDECARS = {
    mtpModel: 'C:/w/mtp.gguf',
    twinModel: 'C:/w/twin.gguf',
    draftHeadModel: 'C:/w/draft.gguf',
    mmprojModel: 'C:/w/mmproj.gguf',
};

function capsFromHelp(text = HELP_TEXT) {
    const flags = parseEngineHelpFlags(text);
    return {
        flags,
        known: flags.length > 0,
        speculative: flags.includes('--speculative'),
        draftMaxFlag: flags.includes('--draft-max'),
        draftMinFlag: flags.includes('--draft-min'),
        draftPMinFlag: flags.includes('--draft-p-min'),
        lookupFlag: flags.includes('--lookup-cache-dynamic') ? '--lookup-cache-dynamic' : '',
    };
}

describe('Спекулятивное декодирование Halowin Bubo (MTP + Draft Head)', () => {
    it('1. Разбор флагов из --help движка', () => {
        const flags = parseEngineHelpFlags(HELP_TEXT);
        assert.ok(flags.includes('--speculative'));
        assert.ok(flags.includes('--draft-max'));
        assert.ok(flags.includes('--lookup-cache-dynamic'));
        assert.ok(!flags.includes('--not-a-flag'));
        assert.deepEqual(parseEngineHelpFlags(''), []);
    });

    it('2. Авто-режим: MTP передаётся весами, а поддерживаемый --speculative включает спекуляцию явно', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto', promptLookup: 'auto', draftMax: 8 },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
            lookupPath: 'C:/w/#cache/lookup.bin',
        });
        assert.equal(plan.mode, 'explicit');
        assert.equal(plan.enabled, true);
        assert.equal(plan.promptLookup, true);
        assert.deepEqual(plan.args.slice(0, 2), ['--mtp-model', SIDECARS.mtpModel]);
        assert.ok(plan.args.includes('--twin-model'));
        assert.ok(plan.args.includes('--draft-head-model'));
        assert.ok(plan.args.includes('--speculative'));
        assert.equal(plan.args[plan.args.indexOf('--speculative') + 1], 'mtp');
        assert.ok(plan.args.includes('--lookup-cache-dynamic'));
        assert.equal(plan.args[plan.args.indexOf('--lookup-cache-dynamic') + 1], 'C:/w/#cache/lookup.bin');
        assert.equal(plan.sidecars.mtp, true);
    });

    it('3. Полное выключение: веса спекуляции не подключаются вовсе', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'off', promptLookup: 'off' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
            lookupPath: 'C:/w/lookup.bin',
        });
        assert.equal(plan.mode, 'off');
        assert.equal(plan.enabled, false);
        assert.equal(plan.promptLookup, false);
        assert.deepEqual(plan.args, []);
    });

    it('4. Без MTP-весов спекуляция недоступна, аргументы не добавляются', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto' },
            capabilities: capsFromHelp(),
            sidecars: { mmprojModel: SIDECARS.mmprojModel },
        });
        assert.equal(plan.mode, 'unavailable');
        assert.deepEqual(plan.args, []);
        assert.ok(plan.reasons.some(r => /MTP-предсказателя/.test(r)));
    });

    it('5. Неизвестные возможности движка: sidecar-веса передаются, новых флагов нет', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto' },
            capabilities: { flags: [] },
            sidecars: SIDECARS,
        });
        assert.equal(plan.mode, 'weights-only');
        assert.equal(plan.capabilitiesKnown, false);
        assert.ok(plan.args.includes('--mtp-model'));
        assert.ok(!plan.args.includes('--speculative'));
    });

    it('6. Режим «Включено» передаёт глубину черновика и порог', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'on', draftMax: 12, promptLookup: 'off' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
        });
        assert.equal(plan.enabled, true);
        assert.equal(plan.args[plan.args.indexOf('--draft-max') + 1], '12');
        assert.ok(plan.args.includes('--draft-min'));
        assert.ok(plan.args.includes('--draft-p-min'));
        assert.ok(!plan.args.includes('--lookup-cache-dynamic'));
    });

    it('7. Готовый пакет (bubo-package.json) не смешивается с динамическим Prompt Lookup', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto', promptLookup: 'auto' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
            hasManifest: true,
            lookupPath: 'C:/w/lookup.bin',
        });
        assert.equal(plan.promptLookup, false);
        assert.ok(!plan.args.includes('--lookup-cache-dynamic'));
    });

    it('8. Настройки движка сохраняются и валидируются', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-engine-settings-'));
        try {
            assert.equal(readEngineSettings(root).speculation, DEFAULT_ENGINE_SETTINGS.speculation);
            const saved = writeEngineSettings(root, { speculation: 'on', draftMax: 99, promptLookup: 'off', npuPrefill: false });
            assert.equal(saved.speculation, 'on');
            assert.equal(saved.draftMax, 32, 'глубина черновика ограничена 32');
            assert.equal(saved.promptLookup, 'off');
            assert.equal(saved.npuPrefill, false);
            assert.ok(saved.updatedAt > 0);
            assert.equal(readEngineSettings(root).speculation, 'on');
            const invalid = writeEngineSettings(root, { speculation: 'fastest' });
            assert.equal(invalid.speculation, DEFAULT_ENGINE_SETTINGS.speculation, 'неизвестный режим отбрасывается');
        }
        finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('9. startHalogenBackend передаёт --speculative mtp и автоматически откатывается при падении движка', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-bubo-spec-'));
        try {
            const binDir = path.join(root, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'bin');
            const rocmDir = path.join(root, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151');
            const weightsDir = path.join(root, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights');
            await fsp.mkdir(binDir, { recursive: true });
            await fsp.mkdir(rocmDir, { recursive: true });
            for (const sub of ['mtp', 'mmproj', 'twin', 'draft_head'])
                await fsp.mkdir(path.join(weightsDir, sub), { recursive: true });

            const exe = path.join(binDir, 'bubo.exe');
            await fsp.writeFile(exe, 'MZ_FAKE');
            const files = {
                main: path.join(weightsDir, 'Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf'),
                mtp: path.join(weightsDir, 'mtp', 'mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf'),
                mmproj: path.join(weightsDir, 'mmproj', 'mmproj-Qwen3.8-Flash-Next-BF16.gguf'),
                twin: path.join(weightsDir, 'twin', 'iq4-nofullattn-nohc.gguf'),
                draft: path.join(weightsDir, 'draft_head', 'draft-out-q4k.gguf'),
            };
            for (const p of Object.values(files))
                await fsp.writeFile(p, 'GGUF');

            const spawned = [];
            const mockSpawn = (cmd, args) => {
                const listeners = {};
                const proc = {
                    pid: 5150 + spawned.length,
                    stdout: { on: () => {} },
                    stderr: { on: () => {} },
                    on(ev, cb) { listeners[ev] = cb; },
                    unref: () => {},
                    kill: () => {},
                    emitExit(code) { listeners.exit?.(code, null); },
                };
                spawned.push({ cmd, args, proc });
                return proc;
            };

            const started = await startHalogenBackend({
                rootDir: root,
                port: 59971,
                spawnImpl: mockSpawn,
                capabilities: capsFromHelp(),
            });
            assert.equal(started.mode, 'bubo-windows');
            assert.equal(started.speculation.enabled, true);
            assert.equal(spawned.length, 1);
            const args = spawned[0].args;
            assert.ok(args.includes('--mtp-model'));
            assert.ok(args.includes('--draft-head-model'));
            assert.equal(args[args.indexOf('--speculative') + 1], 'mtp');
            assert.ok(args.includes('--lookup-cache-dynamic'));

            // Движок «упал» сразу после запуска с новым флагом — WORK перезапускает его без спекуляции
            spawned[0].proc.emitExit(1);
            await new Promise(resolve => setTimeout(resolve, 900));
            assert.ok(spawned.length >= 2, 'движок перезапущен без спекулятивных флагов');
            const retryArgs = spawned[1].args;
            assert.ok(!retryArgs.includes('--speculative'), 'повторный запуск без --speculative');
            assert.ok(!retryArgs.includes('--mtp-model'), 'повторный запуск без MTP-весов');
            assert.ok(!retryArgs.includes('--lookup-cache-dynamic'), 'повторный запуск без Prompt Lookup');
        }
        finally {
            stopHalogenBackend();
            await fsp.rm(root, { recursive: true, force: true });
        }
    });
});
