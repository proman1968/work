/**
 * Спекулятивное декодирование Halowin Bubo (v0.1.2) и автоподготовка локальных сред:
 *  - профиль `default` + `--mtp-draft-vocab auto` (для кириллицы и кода);
 *  - штатные флаги и переменные `GUFO_DENSE_TWIN_MODEL` / `GUFO_DRAFT_OUT_MODEL` без тихого отключения MTP;
 *  - сигнатура запуска `#runtime/engine-state.json` и парсинг Prometheus-счётчиков `:8731/metrics`;
 *  - автоматический подбор пакетов Python/ONNX по модальности и обновление системных UI-хендлеров.
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
    parseHalogenPrometheusText,
    computeHalogenMetricsDelta,
    computeBuboLaunchSignature,
    packagesForModality,
    DEFAULT_ENGINE_SETTINGS,
} from '../sources/modules/trainer/index.js';
import { isCoreEnginePath } from '../sources/host/auto-updater.js';

const BUBO_HELP_TEXT = `
Usage: bubo serve llm [options]

Options:
  --host <addr>                 Bind address (default 127.0.0.1)
  --port <num>                  Listen port
  --model <path>                Main GGUF model
  --mtp-model <path>            MTP predictor weights
  --twin-model <path>           Dense twin weights
  --draft-head-model <path>     Draft head weights
  --speculative <mode>          Speculative draft backend: mtp | off | dflash2 | dspark
  --mtp-draft-vocab <mode>      MTP draft head vocabulary: auto | latin | full
  --draft-tokens <n>            Maximum speculative draft length (default 7)
  --prompt-lookup               Propose tokens from earlier conversation match
  --no-prompt-lookup            Turn off prompt lookup proposals
  --no-mtp                      Turn off MTP defaults and speculative decode
  --no-twin                     Omit default dense twin
  --no-draft-head               Omit default Q4_K draft head
  --npu-prefill <on|off>        Ryzen AI NPU prefill
  --profile <name>              default | subagents | exact | stock
`;

const SIDECARS = {
    mtpModel: 'C:/w/mtp.gguf',
    twinModel: 'C:/w/twin.gguf',
    draftHeadModel: 'C:/w/draft.gguf',
    mmprojModel: 'C:/w/mmproj.gguf',
};

function capsFromHelp(text = BUBO_HELP_TEXT) {
    const flags = parseEngineHelpFlags(text);
    return {
        flags,
        known: flags.length > 0,
        speculative: flags.includes('--speculative'),
        mtpDraftVocabFlag: flags.includes('--mtp-draft-vocab'),
        draftTokensFlag: flags.includes('--draft-tokens'),
        promptLookupFlag: flags.includes('--prompt-lookup'),
        noPromptLookupFlag: flags.includes('--no-prompt-lookup'),
        draftMaxFlag: flags.includes('--draft-tokens'),
        lookupFlag: flags.includes('--prompt-lookup') ? '--prompt-lookup' : '',
    };
}

describe('Спекулятивное декодирование Halowin Bubo v0.1.2 и автоподготовка сред', () => {
    it('1. По умолчанию выбран профиль default и словарь черновика auto (без latin-просадки на русском тексте)', () => {
        assert.equal(DEFAULT_ENGINE_SETTINGS.profile, 'default');
        assert.equal(DEFAULT_ENGINE_SETTINGS.mtpDraftVocab, 'auto');
        assert.equal(DEFAULT_ENGINE_SETTINGS.draftMax, 7);
    });

    it('2. Разбор флагов Bubo из --help и сборка полного плана спекуляции с GUFO_DENSE_TWIN_MODEL / GUFO_DRAFT_OUT_MODEL', () => {
        const flags = parseEngineHelpFlags(BUBO_HELP_TEXT);
        assert.ok(flags.includes('--speculative'));
        assert.ok(flags.includes('--mtp-draft-vocab'));
        assert.ok(flags.includes('--draft-tokens'));

        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto', promptLookup: 'auto' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
        });
        assert.equal(plan.mode, 'explicit');
        assert.equal(plan.enabled, true);
        assert.equal(plan.promptLookup, true);
        assert.equal(plan.args[plan.args.indexOf('--speculative') + 1], 'mtp');
        assert.equal(plan.args[plan.args.indexOf('--mtp-draft-vocab') + 1], 'auto');
        assert.equal(plan.envVars.GUFO_DENSE_TWIN_MODEL, SIDECARS.twinModel);
        assert.equal(plan.envVars.GUFO_DRAFT_OUT_MODEL, SIDECARS.draftHeadModel);
        assert.ok(!plan.args.includes('--lookup-cache-dynamic'), 'чужой флаг llama.cpp не передаётся в Bubo');
    });

    it('3. Полное выключение спекуляции передаёт --no-mtp / --no-twin / --no-draft-head без подключения sidecar-весов', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'off', promptLookup: 'off' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
        });
        assert.equal(plan.mode, 'off');
        assert.equal(plan.enabled, false);
        assert.ok(plan.args.includes('--no-mtp'));
        assert.ok(!plan.args.includes('--mtp-model'));
        assert.deepEqual(plan.envVars, {});
    });

    it('4. Без MTP-весов спекуляция помечается недоступной', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'auto' },
            capabilities: capsFromHelp(),
            sidecars: { mmprojModel: SIDECARS.mmprojModel },
        });
        assert.equal(plan.mode, 'unavailable');
        assert.equal(plan.enabled, false);
        assert.deepEqual(plan.args, []);
    });

    it('5. Режим «Включено» передаёт штатный флаг Bubo --draft-tokens и --no-prompt-lookup при отключении кэша подсказок', () => {
        const plan = resolveSpeculationPlan({
            settings: { speculation: 'on', draftMax: 10, promptLookup: 'off' },
            capabilities: capsFromHelp(),
            sidecars: SIDECARS,
        });
        assert.equal(plan.enabled, true);
        assert.equal(plan.args[plan.args.indexOf('--draft-tokens') + 1], '10');
        assert.ok(plan.args.includes('--no-prompt-lookup'));
    });

    it('6. Настройки движка: автообновление старого неявного subagents → default и сохранение явного профиля', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-engine-settings-'));
        try {
            // Имитируем старый engine.json от 1.0.42 без profileExplicit
            const rtDir = path.join(root, 'MODELS', 'Local', '$provider', '#runtime');
            await fsp.mkdir(rtDir, { recursive: true });
            await fsp.writeFile(path.join(rtDir, 'engine.json'), JSON.stringify({ profile: 'subagents', speculation: 'auto' }), 'utf8');
            assert.equal(readEngineSettings(root).profile, 'default', 'неявный старый subagents автоматически обновляется до default');

            const saved = writeEngineSettings(root, { profile: 'subagents', draftMax: 99, npuPrefill: false });
            assert.equal(saved.profile, 'subagents', 'явно выбранный профиль сохраняется');
            assert.equal(saved.draftMax, 32);
            assert.equal(saved.npuPrefill, false);
        }
        finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('7. startHalogenBackend запускает bubo.exe с --profile default, --mtp-draft-vocab auto, env GUFO_* и НЕ отключает MTP тихо при выходе', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-bubo-spec-'));
        try {
            const binDir = path.join(root, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'bin');
            const rocmDir = path.join(root, 'MODELS', 'Local', '$provider', '#runtime', 'bubo', 'runtime', 'rocm-10.0.0-gfx1151');
            const weightsDir = path.join(root, 'MODELS', 'Local', 'Qwen3.8-Flash-Next', '$ai', '#weights');
            await fsp.mkdir(binDir, { recursive: true });
            await fsp.mkdir(rocmDir, { recursive: true });
            for (const sub of ['mtp', 'mmproj', 'twin', 'draft_head'])
                await fsp.mkdir(path.join(weightsDir, sub), { recursive: true });

            await fsp.writeFile(path.join(binDir, 'bubo.exe'), 'MZ_FAKE');
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
            const mockSpawn = (cmd, args, opts) => {
                const listeners = {};
                const proc = {
                    pid: 6150 + spawned.length,
                    stdout: { on: () => {} },
                    stderr: { on: () => {} },
                    on(ev, cb) { listeners[ev] = cb; },
                    unref: () => {},
                    kill: () => {},
                    emitExit(code) { listeners.exit?.(code, null); },
                };
                spawned.push({ cmd, args, opts, proc });
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
            assert.ok(started.signature?.length >= 12);
            assert.equal(spawned.length, 1);

            const { args, opts } = spawned[0];
            assert.equal(args[args.indexOf('--profile') + 1], 'default');
            assert.equal(args[args.indexOf('--speculative') + 1], 'mtp');
            assert.equal(args[args.indexOf('--mtp-draft-vocab') + 1], 'auto');
            assert.equal(opts.env.GUFO_DENSE_TWIN_MODEL, files.twin);
            assert.equal(opts.env.GUFO_DRAFT_OUT_MODEL, files.draft);

            // При раннем выходе процесс НЕ перезапускается тихо без MTP (что маскировало бы ошибку скоростью 40 tok/s)
            spawned[0].proc.emitExit(2);
            await new Promise(r => setTimeout(r, 400));
            assert.equal(spawned.length, 1, 'тихий перезапуск без MTP отключён');

            const sigDefault = computeBuboLaunchSignature({ profile: 'default', mtpDraftVocab: 'auto' });
            const sigSub = computeBuboLaunchSignature({ profile: 'subagents', mtpDraftVocab: 'latin' });
            assert.notEqual(sigDefault, sigSub);
        }
        finally {
            stopHalogenBackend();
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('8. Парсинг счётчиков :8731/metrics считает чистый серверный tok/s и КПД спекуляции MTP', () => {
        const before = parseHalogenPrometheusText(`
llamacpp:tokens_predicted_total 100
llamacpp:tokens_predicted_seconds_total 1.5
llamacpp:prompt_tokens_total 500
llamacpp:prompt_seconds_total 0.5
llamacpp:spec_decode_num_drafts_total 25
llamacpp:spec_decode_num_draft_tokens_total 150
llamacpp:spec_decode_num_accepted_tokens_total 110
`);
        const after = parseHalogenPrometheusText(`
llamacpp:tokens_predicted_total 240
llamacpp:tokens_predicted_seconds_total 3.5
llamacpp:prompt_tokens_total 1900
llamacpp:prompt_seconds_total 1.5
llamacpp:spec_decode_num_drafts_total 60
llamacpp:spec_decode_num_draft_tokens_total 350
llamacpp:spec_decode_num_accepted_tokens_total 266
`);
        const delta = computeHalogenMetricsDelta(before, after);
        assert.equal(delta.decodeTokens, 140);
        assert.equal(delta.serverDecodeTokPerSec, 70);
        assert.equal(delta.serverPrefillTokPerSec, 1400);
        assert.equal(delta.mtpAcceptPct, 78);
        assert.ok(delta.mtpTokensPerStep > 5);
    });

    it('9. Пакеты Python по модальности (включая ONNX DirectML/NPU) и автообновление системных UI-хендлеров', async () => {
        const tmpWeights = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-onnx-mod-'));
        try {
            assert.deepEqual(packagesForModality('rerank', tmpWeights), ['torch', 'transformers', 'safetensors', 'accelerate']);
            await fsp.writeFile(path.join(tmpWeights, 'model.onnx'), 'ONNX');
            const onnxPkgs = packagesForModality('rerank', tmpWeights);
            assert.ok(onnxPkgs.some(p => p.startsWith('onnxruntime')), 'для ONNX-графа подбирается onnxruntime(-directml) без тяжёлого SDK');
            assert.ok(!onnxPkgs.includes('torch'));
        }
        finally {
            await fsp.rm(tmpWeights, { recursive: true, force: true });
        }

        assert.equal(isCoreEnginePath('MODELS/$ai/$folder/$class/$ai/handlers/pages/form/trainer/$handler/trainer.js'), true);
        assert.equal(isCoreEnginePath('$server/$folder/handlers/pages/form/$handler/form.js'), true);
        assert.equal(isCoreEnginePath('$server/$folder/class.js'), false, 'пользовательский class.js корня остаётся защищённым');
    });

    it('10. local_infer_worker.py без установленного torch не падает на @torch.inference_mode() и отдаёт missingDeps', async () => {
        const { spawnSync } = await import('node:child_process');
        const workerPath = path.resolve(process.cwd(), 'sources/modules/trainer/worker/local_infer_worker.py');
        const pyRunner = [
            'import sys, runpy',
            "sys.modules['torch'] = None",
            "sys.modules['torch.nn'] = None",
            "sys.modules['torch.nn.functional'] = None",
            `runpy.run_path(${JSON.stringify(workerPath)}, run_name='__main__')`,
        ].join('; ');
        const res = spawnSync('python', ['-c', pyRunner], {
            input: '{"id":"t1","op":"check_deps"}\n{"id":"t2","weightsDir":".","inputIds":[1,2]}\n',
            encoding: 'utf8',
            timeout: 15000,
        });
        assert.equal(res.status, 0, 'воркер завершается штатно без AttributeError: ' + (res.stderr || ''));
        const events = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
        assert.equal(events[0]?.event, 'ready');
        assert.equal(events[1]?.id, 't1');
        assert.equal(events[1]?.data?.packages?.torch, false);
        assert.equal(events[2]?.id, 't2');
        assert.equal(events[2]?.event, 'error');
        assert.deepEqual(events[2]?.missingDeps, ['torch']);
    });

    it('11. Неполный ONNX-граф (без *.onnx_data) не выбирается воркером — прозрачный фоллбэк на PyTorch', async () => {
        const { spawnSync } = await import('node:child_process');
        const workerPath = path.resolve(process.cwd(), 'sources/modules/trainer/worker/local_infer_worker.py');
        const tmpWeights = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-onnx-broken-'));
        try {
            await fsp.writeFile(path.join(tmpWeights, 'config.json'), '{"model_type":"xlm-roberta"}');
            await fsp.writeFile(path.join(tmpWeights, 'model.onnx'), 'tiny-graph-without-external-data');
            const pyRunner = [
                'import sys, runpy',
                "sys.modules['torch'] = None",
                "sys.modules['torch.nn'] = None",
                "sys.modules['torch.nn.functional'] = None",
                `runpy.run_path(${JSON.stringify(workerPath)}, run_name='__main__')`,
            ].join('; ');
            const req = JSON.stringify({ id: 'e1', op: 'embed', weightsDir: tmpWeights, input: ['x'] });
            const res = spawnSync('python', ['-c', pyRunner], {
                input: `${req}\n`,
                encoding: 'utf8',
                timeout: 15000,
            });
            assert.equal(res.status, 0, res.stderr || '');
            const events = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
            const err = events.find(e => e.id === 'e1');
            assert.equal(err?.event, 'error');
            assert.deepEqual(err?.missingDeps, ['torch', 'transformers'], 'ONNX без внешних данных не считается рабочим');
        }
        finally {
            await fsp.rm(tmpWeights, { recursive: true, force: true });
        }
    });

    it('12. TTS: метод синтеза выбирается по tts_model_type (VoiceDesign / CustomVoice / Base), а не по наличию метода', async () => {
        const { spawnSync } = await import('node:child_process');
        const workerPath = path.resolve(process.cwd(), 'sources/modules/trainer/worker/local_infer_worker.py');
        const py = `
import json, os, runpy, tempfile
ns = runpy.run_path(${JSON.stringify(workerPath)}, run_name='worker_under_test')

class FakeTTS:
    def __init__(self, instruct_raises=False):
        self.calls = []
        self.instruct_raises = instruct_raises
    def get_supported_speakers(self):
        return ['Vivian', 'Serena', 'Ryan']
    def generate_voice_design(self, text, language, instruct):
        self.calls.append(['voice_design', instruct])
        return ([[0.1, -0.2, 0.3]], 24000)
    def generate_custom_voice(self, text, language, speaker, instruct=None):
        self.calls.append(['custom_voice', speaker, instruct])
        if instruct is not None and self.instruct_raises:
            raise ValueError('this model does not support instruct')
        return ([[0.1, -0.2]], 24000)

def run(kind, extra=None, instruct_raises=False):
    d = tempfile.mkdtemp()
    with open(os.path.join(d, 'config.json'), 'w', encoding='utf-8') as fh:
        json.dump({'tts_model_type': kind}, fh)
    with open(os.path.join(d, 'model.safetensors'), 'w') as fh:
        fh.write('w')
    m = FakeTTS(instruct_raises)
    req = {'weightsDir': d, 'text': 'Привет', 'language': 'Russian'}
    req.update(extra or {})
    try:
        res = ns['handle_tts'](req, {('tts', d): m})
        return {'ok': True, 'calls': m.calls, 'kind': res.get('ttsKind'), 'audio': bool(res.get('audioBase64'))}
    except RuntimeError as e:
        try:
            msg = json.loads(str(e)).get('error', str(e))
        except Exception:
            msg = str(e)
        return {'ok': False, 'error': msg, 'calls': m.calls}

print(json.dumps([
    run('voice_design'),
    run('custom_voice', {'voice': 'serena'}),
    run('base'),
    run('custom_voice', {'voice': 'SERENA', 'instructions': 'angry tone'}, True),
]))
`;
        const res = spawnSync('python', ['-c', py], { encoding: 'utf8', timeout: 30000 });
        assert.equal(res.status, 0, res.stderr || '');
        const [vd, cv, base, cvNoInstruct] = JSON.parse(String(res.stdout || '').trim());
        assert.equal(vd.ok, true, vd.error || '');
        assert.equal(vd.kind, 'voice_design');
        assert.equal(vd.calls[0][0], 'voice_design', 'VoiceDesign не должен вызывать generate_custom_voice');
        assert.ok(vd.calls[0][1], 'без описания голоса подставляется дефолтный instruct');
        assert.equal(vd.audio, true);
        assert.equal(cv.ok, true, cv.error || '');
        assert.equal(cv.kind, 'custom_voice');
        assert.equal(cv.calls[0][1], 'Serena', 'имя спикера сопоставляется с регистром модели');
        assert.equal(base.ok, false);
        assert.match(base.error, /эталон/i, 'Base без эталонной записи даёт честную ошибку');
        assert.equal(cvNoInstruct.ok, true, cvNoInstruct.error || '');
        assert.equal(cvNoInstruct.calls.length, 2, 'при отказе instruct повторяем без него');
        assert.equal(cvNoInstruct.calls[1][2], null);
    });

    it('13. TTS/ASR: русские описания голоса переводятся в английский профиль с мужским баритоном по умолчанию, а язык Ru нормализуется в Russian', async () => {
        const { spawnSync } = await import('node:child_process');
        const workerPath = path.resolve(process.cwd(), 'sources/modules/trainer/worker/local_infer_worker.py');
        const py = `
import base64, json, os, runpy, tempfile
ns = runpy.run_path(${JSON.stringify(workerPath)}, run_name='worker_under_test')

norm_voice = ns['_normalize_voice_design_instruct']
norm_asr = ns['_asr_language']

class StrictASR:
    SUPPORTED = set(ns['SUPPORTED_ASR_LANGUAGES'].values())
    def __init__(self):
        self.calls = []
    def transcribe(self, audio, language=None):
        self.calls.append(language)
        if language is not None and language not in self.SUPPORTED:
            raise ValueError(f"Unsupported language: {language}")
        return [type('R', (), {'text': 'проверка распознана'})()]

d = tempfile.mkdtemp()
asr_model = StrictASR()
res_ru = ns['handle_stt']({
    'weightsDir': d,
    'audioBase64': base64.b64encode(b'RIFF....WAVE').decode('ascii'),
    'language': 'Ru',
}, {('stt', d): ('qwen_asr', asr_model)})

res_unknown = ns['handle_stt']({
    'weightsDir': d,
    'audioBase64': base64.b64encode(b'RIFF....WAVE').decode('ascii'),
    'language': 'klingon',
}, {('stt', d): ('qwen_asr', asr_model)})

print(json.dumps({
    'defaultVoice': norm_voice(''),
    'maleVoice': norm_voice('мужской голос'),
    'femaleVoice': norm_voice('женский спокойный голос'),
    'announcerVoice': norm_voice('мужской диктор, бас'),
    'asrRu': norm_asr('Ru'),
    'asrRusWord': norm_asr('русский'),
    'asrAuto': norm_asr('auto'),
    'asrUnknown': norm_asr('xx-YY'),
    'sttCalls': asr_model.calls,
    'sttText': res_ru.get('text'),
    'sttLang': res_ru.get('language'),
    'sttUnknownLang': res_unknown.get('language'),
}))
`;
        const res = spawnSync('python', ['-c', py], { encoding: 'utf8', timeout: 30000 });
        assert.equal(res.status, 0, res.stderr || '');
        const out = JSON.parse(String(res.stdout || '').trim());
        assert.match(out.defaultVoice, /^Male,.*baritone/i, 'голос по умолчанию — мужской баритон');
        assert.match(out.maleVoice, /^Male,.*baritone/i, '«мужской голос» переведён в английский профиль Male baritone');
        assert.match(out.femaleVoice, /^Female,.*female voice/i, '«женский спокойный голос» переведён в Female');
        assert.match(out.announcerVoice, /^Male,.*bass-baritone.*announcer/i, '«мужской диктор, бас» переведён в bass-baritone announcer');
        assert.equal(out.asrRu, 'Russian');
        assert.equal(out.asrRusWord, 'Russian');
        assert.equal(out.asrAuto, null);
        assert.equal(out.asrUnknown, null);
        assert.deepEqual(out.sttCalls, ['Russian', null]);
        assert.equal(out.sttText, 'проверка распознана');
        assert.equal(out.sttLang, 'Russian');
        assert.equal(out.sttUnknownLang, 'Auto');

        // Шаблоны ODA используют ~for="items" + $for.item (а не JS-синтаксис `p of items`)
        for (const rel of [
            'MODELS/$ai/$folder/$class/$ai/handlers/pages/form/trainer/$handler/trainer.js',
            'MODELS/$ai/$folder/$class/$provider/handlers/pages/form/trainer/$handler/trainer.js',
        ]) {
            const src = await fsp.readFile(path.resolve(process.cwd(), rel), 'utf8');
            assert.ok(!/~for="[^"]+\b(of|in)\b/.test(src), `${rel} не должен содержать ~for="... of/in ..."`);
        }
    });

    it('14. Ускорение Qwen3-TTS: прямой 15-шаговый цикл _install_fast_qwen_tts_code_predictor и детектор ROCm gfx1151', async () => {
        const { spawnSync } = await import('node:child_process');
        const {
            isStrixHaloGfx1151Host,
            hasRocmGfx1151InVenvSync,
            AMD_ROCM_GFX1151_WHL_INDEX,
            ROCM_GFX1151_TORCH_VERSION,
        } = await import('../sources/modules/trainer/index.js');

        assert.equal(AMD_ROCM_GFX1151_WHL_INDEX, 'https://repo.amd.com/rocm/whl/gfx1151/');
        assert.match(ROCM_GFX1151_TORCH_VERSION, /\+rocm7\.\d+/);

        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-rocm-venv-'));
        try {
            assert.equal(hasRocmGfx1151InVenvSync(tmp), false);
            const venvDir = path.join(tmp, 'MODELS', 'Local', '$provider', '#runtime', 'venv');
            await fsp.mkdir(venvDir, { recursive: true });
            await fsp.writeFile(path.join(venvDir, '.rocm-gfx1151-ok'), ROCM_GFX1151_TORCH_VERSION);
            assert.equal(hasRocmGfx1151InVenvSync(tmp), true);
            assert.equal(typeof isStrixHaloGfx1151Host, 'function');
        }
        finally {
            await fsp.rm(tmp, { recursive: true, force: true });
        }

        const workerPath = path.resolve(process.cwd(), 'sources/modules/trainer/worker/local_infer_worker.py');
        const py = `
import json, runpy
ns = runpy.run_path(${JSON.stringify(workerPath)}, run_name='worker_under_test')

class DummyModel:
    def __init__(self):
        class CP:
            class cfg:
                num_code_groups = 16
            config = cfg()
            def generate(self, **kw):
                return 'orig_called'
        class Talker:
            code_predictor = CP()
        class M:
            talker = Talker()
        self.model = M()

m = DummyModel()
ns['_install_fast_qwen_tts_code_predictor'](m)
cp = m.model.talker.code_predictor
print(json.dumps({
    'patched': bool(getattr(cp, '_work_fast_patched', False)),
    'fallbackNone': cp.generate(inputs_embeds=None),
}))
`;
        const res = spawnSync('python', ['-c', py], { encoding: 'utf8', timeout: 15000 });
        assert.equal(res.status, 0, res.stderr || '');
        const out = JSON.parse(String(res.stdout || '').trim());
        assert.equal(out.patched, true);
        assert.equal(out.fallbackNone, 'orig_called');
    });
});
