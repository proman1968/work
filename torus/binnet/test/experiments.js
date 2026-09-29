// Общие сценарии экспериментов BinNet — без зависимостей от Node и браузера.
// Используются консольным test/bench.mjs и браузерным стендом
// (test-ui/index.html?tab=lab — вкладка «8. Эксперименты» в oda-binnet-tester.js).
//
// createExperiments({ gpu, LLM, loadText, folder, onProgress, yieldNow })
//   gpu        — WebGpu (Node) или BrowserGpu (браузер)
//   LLM        — класс из src/core/llm.js
//   loadText   — async (name) => string, name: 'sample' | 'corpus'
//   onProgress — (text) => void, живой прогресс
//   yieldNow   — async () => void, отдать управление UI (в браузере — setTimeout)
// Каждый тест: async (params) => { pass, acc, tps, details, chart? }
//   params.cfg — конфигурация модели поверх дефолтов теста (например DEFAULT_STE)

// Лучшая найденная конфигурация STE (R2 и M1)
export const DEFAULT_STE = {
    learn: 'ste', steCmax: 64, resBeta: 1,
    steLr: 8, steInit: 8,
    steLrHead: 8, steInitHead: 4,
    steLrEmb: 8, steInitEmb: 4,
    // Смещение гейта «забыть»: без него M1 до d32 ≈ 0.6, с ним 1.00
    gateBias: true, forgetBias: -1.5,
};

export function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Запуск с воспроизводимым Math.random (JS-сторона слоев), затем восстановление
export async function withSeed(seed, fn) {
    const orig = Math.random;
    Math.random = mulberry32(seed);
    try { return await fn(); } finally { Math.random = orig; }
}

const line1 = 'Квантовая механика — раздел физики.';
const line2 = 'Кот Шрёдингера жив и мертв одновременно.';
export const FIX = { line1, line2, corpus: line1 + '\n' + line1 + '\n' + line2 };

// Синтетика на память: A f1..fd Q → A. Токены напрямую, без BPE.
export const SYN = { Q: 1, V0: 2, NV: 16, F0: 18, NF: 46, vocab: 64 };

const curve = (h) => h.map(x => `${x.headOnly ? '*' : ''}${x.acc.toFixed(2)}`).join(',');

function hamFrac(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
        let x = (a[i] ^ b[i]) >>> 0;
        while (x) { d++; x &= x - 1; }
    }
    return d / (a.length * 32);
}
function spreadOf(vecs) {
    let s = 0, n = 0;
    for (let i = 0; i < vecs.length; i++)
        for (let j = i + 1; j < vecs.length; j++) { s += hamFrac(vecs[i], vecs[j]); n++; }
    return n ? s / n : 0;
}

export const TEST_INFO = {
    S1: 'Head заучивает одну строку (10 эпох только Head)',
    S2: 'эпохи растят accuracy на маленьком корпусе',
    S6: 'обучение всей цепочки держит заученное (10 Head + 20 full)',
    S7: 'нет слипания: ответы на разные слова различаются после full',
    R1: 'sample.txt: вся цепочка не хуже одного Head на невиданных строках',
    R2: '«Война и мир»: точность на невиданных строках против биграммы',
    M1: 'память: A f1..fd Q → A (случайно = 1/16)',
    M2: 'ассоциативный поиск: K1 V1 … Kn Vn Q Kq → Vq',
    G1: 'обучение на sample.txt и генерация продолжения',
};

export function createExperiments({ gpu, LLM, loadText, folder = 'browser-test', onProgress = () => {}, yieldNow = async () => {} }) {
    const silent = async (fn) => {
        const log = console.log;
        console.log = () => {};
        try { return await fn(); } finally { console.log = log; }
    };
    // Ждем GPU и отдаем управление: ограничивает очередь команд и не морозит UI
    const sync = async () => {
        gpu.flush?.();
        await gpu.device.queue.onSubmittedWorkDone();
        await yieldNow();
    };

    async function makeLlm(p, cfg = {}) {
        const llm = new LLM(Object.assign({ vocabSize: 512, embSize: 4, layersCount: 1, gpu, folder }, p.cfg || {}, cfg));
        await silent(() => llm.load());
        gpu.stepSeed ??= llm.write(new Uint32Array(1), 'step_seed', 'uniform');
        return llm;
    }

    async function trainSplit(p, llm, corpus, headEpochs, fullEpochs, label = '') {
        const history = [];
        let tokens = 0;
        const t0 = performance.now();
        const total = headEpochs + fullEpochs;
        const onLine = (i, n) => onProgress(`${label} эпоха ${history.length + 1}/${total}, строка ${i}/${n}`);
        for (let e = 0; e < total; e++) {
            const headOnly = e < headEpochs;
            const r = await llm.train(corpus, {
                epochs: 1, headOnlyEpochs: headOnly ? 1 : 0,
                bptt: !p.nobptt, bpttK: p.bpttK ? Number(p.bpttK) : undefined,
                onLine, yieldNow: sync,
            });
            history.push({ ...r.history[0], headOnly });
            tokens += r.history[0].tokens;
            onProgress(`${label} эпоха ${history.length}/${total}: acc ${r.history[0].acc.toFixed(3)}`);
        }
        const ms = performance.now() - t0;
        return { history, tokens, ms, tps: tokens / (ms / 1000) };
    }

    async function snapshot(llm) {
        const ids = [];
        for (const row of [FIX.line1, FIX.line2]) {
            for (const t of Array.from(llm.tokenizer.encode(row))) {
                if (!ids.includes(t)) ids.push(t);
                if (ids.length >= 12) break;
            }
            if (ids.length >= 12) break;
        }
        const outs = [];
        for (const id of ids) {
            llm.resetState();
            await llm.forward({ tokenIdx: id, targetIdx: 0 });
            outs.push(Array.from(await gpu.readData(llm.head.input.data)));
        }
        return { out: spreadOf(outs), n: ids.length };
    }

    function m1Seq(d) {
        const A = SYN.V0 + Math.floor(Math.random() * SYN.NV);
        const seq = [A];
        for (let i = 0; i < d; i++) seq.push(SYN.F0 + Math.floor(Math.random() * SYN.NF));
        seq.push(SYN.Q, A);
        return seq;
    }
    // Одна последовательность: обучение только на позиции ответа (Q → A)
    async function m1Train(p, llm, seq) {
        if (llm.ste && !p.nobptt) {
            const mask = seq.map((_, i) => i === seq.length - 2);
            return llm.trainSequence(seq, { mask });
        }
        llm.resetState();
        for (let t = 0; t < seq.length - 1; t++) {
            gpu.stepSeed[0] = Math.trunc(4294967295 * Math.random());
            llm.write(gpu.stepSeed);
            await llm.forward({ tokenIdx: seq[t], targetIdx: seq[t + 1], noRead: true });
            if (t === seq.length - 2) await llm.back({ back_target: seq[t + 1] });
        }
    }
    // M2: K1 V1 … Kn Vn Q Kq → Vq. Ключи 2..17, значения 18..33 (ключи в серии разные).
    function m2Seq(n) {
        const keys = [];
        while (keys.length < n) {
            const k = 2 + Math.floor(Math.random() * 16);
            if (!keys.includes(k)) keys.push(k);
        }
        const vals = keys.map(() => 18 + Math.floor(Math.random() * 16));
        const seq = [];
        keys.forEach((k, i) => seq.push(k, vals[i]));
        const q = Math.floor(Math.random() * n);
        seq.push(SYN.Q, keys[q], vals[q]);
        return seq;
    }
    async function m1Eval(llm, d, n, seqFn = m1Seq) {
        let ok = 0;
        for (let k = 0; k < n; k++) {
            const seq = seqFn(d);
            llm.resetState();
            for (let t = 0; t < seq.length - 2; t++)
                await llm.forward({ tokenIdx: seq[t], targetIdx: seq[t + 1], noRead: true });
            const r = await llm.forward({ tokenIdx: seq[seq.length - 2], targetIdx: seq[seq.length - 1] });
            if (r.predictIdx === seq[seq.length - 1]) ok++;
        }
        return ok / n;
    }

    const splitLines = (text) => text.split('\n').map(l => l.trim()).filter(Boolean);

    const tests = {
        async S1(p = {}) {
            const llm = await makeLlm(p);
            const before = await llm.accuracy(FIX.line1);
            const tr = await trainSplit(p, llm, FIX.line1 + '\n' + FIX.line1, 10, 0, 'S1');
            const after = await llm.accuracy(FIX.line1);
            return { pass: after.acc >= 0.6 && after.acc > before.acc, acc: after.acc, tps: tr.tps,
                chart: tr.history.map(h => h.acc),
                details: `acc ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve(tr.history)})` };
        },
        async S2(p = {}) {
            const llm = await makeLlm(p);
            const before = await llm.accuracy(FIX.corpus);
            const tr = await trainSplit(p, llm, FIX.corpus, 6, 0, 'S2');
            const after = await llm.accuracy(FIX.corpus);
            return { pass: after.acc > before.acc, acc: after.acc, tps: tr.tps,
                chart: tr.history.map(h => h.acc),
                details: `acc ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve(tr.history)})` };
        },
        async S6(p = {}) {
            const llm = await makeLlm(p, p.cfg?.learn === 'ste' ? { embSize: 8 } : { embSize: 8, embLearnRate: 0.01, linUpdateExtra: 3 });
            const tr = await trainSplit(p, llm, FIX.line1 + '\n' + FIX.line1, 10, 20, 'S6');
            const head = tr.history.filter(h => h.headOnly), full = tr.history.filter(h => !h.headOnly);
            const peak = Math.max(...head.map(h => h.acc));
            const tail = full[full.length - 1].acc;
            return { pass: tail >= Math.max(0.5, peak * 0.7), acc: tail, tps: tr.tps,
                chart: tr.history.map(h => h.acc),
                details: `пик head ${peak.toFixed(2)}, хвост full ${tail.toFixed(2)} (${curve(tr.history)})` };
        },
        async S7(p = {}) {
            const llm = await makeLlm(p, { embSize: 8 });
            await trainSplit(p, llm, FIX.line1 + '\n' + FIX.line1, 3, 0, 'S7');
            const b = await snapshot(llm);
            const tr = await trainSplit(p, llm, FIX.line1 + '\n' + FIX.line1, 0, 5, 'S7');
            const a = await snapshot(llm);
            const hold = b.out > 0.05 ? a.out / b.out : 0;
            return { pass: hold >= 0.5, acc: hold, tps: tr.tps,
                details: `разброс out ${b.out.toFixed(3)} → ${a.out.toFixed(3)} (удержание ${hold.toFixed(2)})` };
        },
        async R1(p = {}) {
            const lines = splitLines(await loadText('sample'));
            const cut = Math.max(1, Math.floor(lines.length * 0.8));
            const train = lines.slice(0, cut).join('\n'), test = lines.slice(cut).join('\n');
            const E = Number(p.epochs ?? 8), warm = Number(p.warm ?? 2);
            const res = {};
            for (const mode of ['head', 'full']) {
                const llm = await makeLlm(p, { vocabSize: 1024, embSize: 8, layersCount: 1 });
                const tr = await trainSplit(p, llm, train, mode === 'head' ? warm + E : warm, mode === 'head' ? 0 : E, `R1 ${mode}`);
                res[mode] = { tr, trainAcc: (await llm.accuracy(train)).acc, testAcc: (await llm.accuracy(test)).acc };
            }
            const h = res.head, f = res.full;
            // Критерий — на невиданных строках вся цепочка не хуже одного Head
            // (заучивание train на 600 токенах у Head всегда быстрее и ничего не говорит)
            return { pass: f.testAcc >= h.testAcc - 0.02, acc: f.testAcc, tps: (h.tr.tps + f.tr.tps) / 2,
                chart: f.tr.history.map((x, i) => [h.tr.history[i]?.acc, x.acc]),
                details: `head: train ${h.trainAcc.toFixed(3)} test ${h.testAcc.toFixed(3)} | full: train ${f.trainAcc.toFixed(3)} test ${f.testAcc.toFixed(3)} (${curve(f.tr.history)})` };
        },
        // Обобщение: кусок «Войны и мира», test — невиданные строки; ориентир — биграмма
        async R2(p = {}) {
            const all = (await loadText('corpus')).split('\n').map(l => l.trim()).filter(l => l.length > 20);
            const from = 2000, nTrain = Number(p.lines ?? 400), nTest = Math.round(nTrain / 4);
            const trainLines = all.slice(from, from + nTrain), testLines = all.slice(from + nTrain, from + nTrain + nTest);
            const train = trainLines.join('\n'), test = testLines.join('\n');
            const E = Number(p.epochs ?? 4);
            const modes = String(p.modes ?? 'full').split(',');
            const out = [];
            let bigram = null;
            for (const mode of modes) {
                const llm = await makeLlm(p, { vocabSize: 1024, embSize: 8, layersCount: Number(p.layers ?? 1) });
                const tr = await trainSplit(p, llm, train, mode === 'head' ? E : 0, mode === 'head' ? 0 : E, `R2 ${mode}`);
                if (!bigram) {
                    const counts = new Map();
                    for (const l of trainLines) {
                        const t = llm.tokenizer.encode(l);
                        for (let i = 0; i + 1 < t.length; i++) {
                            const m = counts.get(t[i]) || new Map();
                            m.set(t[i + 1], (m.get(t[i + 1]) || 0) + 1);
                            counts.set(t[i], m);
                        }
                    }
                    const best = new Map([...counts].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
                    const acc = (lines) => { let ok = 0, n = 0; for (const l of lines) { const t = llm.tokenizer.encode(l); for (let i = 0; i + 1 < t.length; i++) { n++; if (best.get(t[i]) === t[i + 1]) ok++; } } return ok / n; };
                    bigram = { train: acc(trainLines), test: acc(testLines) };
                }
                onProgress(`R2 ${mode}: замер точности`);
                const trainAcc = (await llm.accuracy(train)).acc, testAcc = (await llm.accuracy(test)).acc;
                out.push({ mode, trainAcc, testAcc, tps: tr.tps, curve: curve(tr.history), history: tr.history });
            }
            const f = out.find(o => o.mode === 'full') || out[out.length - 1];
            return { pass: f.testAcc > bigram.test, acc: f.testAcc, tps: out[0].tps,
                chart: f.history.map(h => [h.acc, bigram.train]),
                details: `bigram: train ${bigram.train.toFixed(3)} test ${bigram.test.toFixed(3)} | ` +
                    out.map(o => `${o.mode}: train ${o.trainAcc.toFixed(3)} test ${o.testAcc.toFixed(3)} (${o.curve})`).join(' | ') };
        },
        // Память: учим на смеси d ∈ [1..maxd], точность по d. layers=0 — контроль (≈0.06)
        async M1(p = {}) {
            const maxd = Number(p.maxd ?? 8);
            const steps = Number(p.steps ?? 10000);
            const dists = [1, 2, 4, 8, 16, 32].filter(d => d <= maxd);
            const layersList = String(p.layers ?? '0,1').split(',').map(Number);
            const rows = [];
            const chart = [];
            let best = 0, control = 0;
            for (const L of layersList) {
                const llm = await makeLlm(p, { vocabSize: SYN.vocab, embSize: Number(p.emb ?? 4), layersCount: L });
                const t0 = performance.now();
                const curvePts = [];
                const every = Math.max(1, Math.floor(steps / 10));
                for (let s = 0; s < steps; s++) {
                    await m1Train(p, llm, m1Seq(1 + Math.floor(Math.random() * maxd)));
                    if ((s + 1) % 20 === 0) await sync();
                    if ((s + 1) % every === 0) {
                        const a = await m1Eval(llm, maxd, 100);
                        curvePts.push(a);
                        onProgress(`M1 L=${L}: шаг ${s + 1}/${steps}, точность d${maxd} ${a.toFixed(2)}`);
                    }
                }
                const sec = (performance.now() - t0) / 1000;
                onProgress(`M1 L=${L}: итоговый замер`);
                const accs = [];
                for (const d of dists) accs.push(await m1Eval(llm, d, 300));
                const last = accs[accs.length - 1];
                if (L > 0) best = Math.max(best, last); else control = last;
                curvePts.forEach((v, i) => { chart[i] = [...(chart[i] || []), v]; });
                rows.push(`L=${L}: ` + dists.map((d, i) => `d${d} ${accs[i].toFixed(2)}`).join(' ') + ` (${sec.toFixed(0)}s)`);
            }
            const hasControl = layersList.includes(0);
            return { pass: best > 0.5 && (!hasControl || control < 0.15), acc: best, chart,
                details: rows.join(' | ') };
        },
        // Ассоциативный поиск: учим на смеси n ∈ [1..pairs] пар, точность по n.
        // Случайно = 1/16; «угадать из увиденных значений» = 1/n.
        async M2(p = {}) {
            const pairs = Number(p.pairs ?? 4);
            const steps = Number(p.steps ?? 20000);
            const ns = [1, 2, 3, 4, 6, 8].filter(n => n <= pairs);
            const layersList = String(p.layers ?? '1').split(',').map(Number);
            const rows = [], chart = [];
            let best = 0;
            for (const L of layersList) {
                const llm = await makeLlm(p, { vocabSize: SYN.vocab, embSize: Number(p.emb ?? 4), layersCount: L });
                const t0 = performance.now();
                const curvePts = [];
                const every = Math.max(1, Math.floor(steps / 10));
                for (let s = 0; s < steps; s++) {
                    await m1Train(p, llm, m2Seq(1 + Math.floor(Math.random() * pairs)));
                    if ((s + 1) % 20 === 0) await sync();
                    if ((s + 1) % every === 0) {
                        const a = await m1Eval(llm, pairs, 100, m2Seq);
                        curvePts.push(a);
                        onProgress(`M2 L=${L}: шаг ${s + 1}/${steps}, точность n${pairs} ${a.toFixed(2)}`);
                    }
                }
                const sec = (performance.now() - t0) / 1000;
                onProgress(`M2 L=${L}: итоговый замер`);
                const accs = [];
                for (const n of ns) accs.push(await m1Eval(llm, n, 300, m2Seq));
                if (L > 0) best = Math.max(best, accs[accs.length - 1]);
                curvePts.forEach((v, i) => { chart[i] = [...(chart[i] || []), v]; });
                rows.push(`L=${L}: ` + ns.map((n, i) => `n${n} ${accs[i].toFixed(2)}`).join(' ') + ` (${sec.toFixed(0)}s)`);
            }
            return { pass: best > 0.8, acc: best, chart,
                details: rows.join(' | ') + ` · случайно 0.06, из увиденных 1/${pairs}=${(1 / pairs).toFixed(2)}` };
        },
        // Обучение на sample.txt и генерация продолжения первой строки
        async G1(p = {}) {
            const text = await loadText('sample');
            const llm = await makeLlm(p, { vocabSize: 1024, embSize: 8, layersCount: 1 });
            const E = Number(p.epochs ?? 15);
            const tr = await trainSplit(p, llm, text, 0, E, 'G1');
            const prompt = String(p.prompt ?? splitLines(text)[0].split(' ').slice(0, 2).join(' '));
            const gen = await llm.generate(prompt, Number(p.len ?? 30));
            return { pass: typeof gen === 'string' && gen.length > 0, acc: tr.history[tr.history.length - 1].acc, tps: tr.tps,
                chart: tr.history.map(h => h.acc),
                details: `«${prompt}» → «${gen}» (acc ${tr.history[tr.history.length - 1].acc.toFixed(3)})` };
        },
    };
    return tests;
}
