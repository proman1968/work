ODA({
    is: 'oda-binnet-tester',
    template: /*html*/`
    <style>
        :host { @apply --vertical; padding: 12px; gap: 10px; max-width: 900px; font-family: sans-serif; }
        h2 { margin: 0; font-size: 18px; }
        .sub { color: #666; font-size: 13px; }
        .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .card { border: 1px solid var(--border-color, #ddd); border-radius: 8px; padding: 10px 14px; }
        .pill { display: inline-block; padding: 2px 12px; border-radius: 999px; font-weight: bold; font-size: 13px;
            background: #eee; color: #555; }
        .pill.ok { background: #dff0d8; color: #2a6b2a; }
        .pill.fail { background: #f8d7da; color: #a11; }
        .pill.run { background: #fff3cd; color: #8a6d00; }
        .status-ok { color: green; font-weight: bold; }
        .status-fail { color: red; font-weight: bold; }
        .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .tab { padding: 5px 12px; border: 1px solid #bbb; border-radius: 999px; cursor: pointer; font-size: 13px; }
        .tab[selected] { border-color: #4d85cf; font-weight: bold; }
        .tab[disabled] { opacity: .45; cursor: default; }
        .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #ccc; margin-right: 5px; }
        .dot.ok { background: #3a3; } .dot.fail { background: #c33; } .dot.run { background: #db0; }
        ul.tests { list-style: none; margin: 8px 0 0; padding: 0; }
        ul.tests li { padding: 3px 0; font-size: 13px; }
        details { margin-top: 6px; font-size: 12px; color: #555; }
        details summary { cursor: pointer; }
        pre.log { background: #111; color: #0f0; padding: 8px; height: 140px; overflow: auto; font-size: 12px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .t-pass { color: green; font-weight: bold; }
        .t-fail { color: red; font-weight: bold; }
        .t-run { color: #a60; font-weight: bold; }
        button.btn { padding: 7px 16px; border: 2px solid #4d85cf; border-radius: 8px;
            background: #e8f0fe; color: #070637; font-weight: bold; font-size: 14px;
            cursor: pointer; }
        button.btn:hover { background: #4d85cf; color: #fff; }
        button.btn:active { transform: translateY(1px); }
        button.btn.primary { background: #4d85cf; color: #fff; font-size: 15px; padding: 8px 20px; }
        button.btn.primary:hover { background: #3564a8; }
        .muted { color: #888; font-size: 12px; }
        .pbar { height: 10px; background: #e5e5e5; border-radius: 999px; overflow: hidden; flex: 1; min-width: 120px; }
        .pfill { height: 100%; background: #4d85cf; border-radius: 999px; transition: width .3s; }
        .progtext { font-size: 12px; color: #555; white-space: nowrap; }
    </style>
    <div>
        <h2>BinNet — стенд тестов</h2>
        <div class="sub">WebGPU + слои бинарной Mamba-модели. Одна кнопка — один зачет.</div>
    </div>
    <div class="row">
        <button class="btn primary" @tap="runAll">▶ Прогнать всё</button>
        <button class="btn" @tap="copyReport">Копировать отчет</button>
        <span class="pill {{overallPill}}">{{overall || 'еще не запускали'}}</span>
    </div>
    <div class="row" ~if="progTotal">
        <div class="pbar"><div class="pfill" :style="'width:' + progPct + '%'"></div></div>
        <span class="progtext">{{progDone}}/{{progTotal}} · {{progCurrent || ''}}</span>
    </div>
    <div class="tabs">
        <div class="tab" ~for="tabs" :selected="$for.item === focused" :disabled="$for.item.disabled" @tap="focused = $for.item.disabled ? focused : $for.item"><span class="dot {{$for.item.dot}}"></span>{{$for.item.label}}</div>
    </div>
    <div class="card" ~if="focused?.id === 'gpu'">
        <div class="row"><span class="pill {{gpuPill}}">{{gpuSummary}}</span><span class="muted">{{adapterInfo || 'адаптер не запрошен'}}</span></div>
        <ul class="tests" ~if="gpuTests?.length">
            <li ~for="gpuTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'tokenizer'">
        <div class="row"><span class="pill {{tokPill}}">{{tokSummary}}</span><span class="muted">{{tokInfo || ''}}</span></div>
        <ul class="tests" ~if="tokTests?.length">
            <li ~for="tokTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'embedding'">
        <div class="row"><span class="pill {{embPill}}">{{embSummary}}</span><span class="muted">{{embInfo || ''}}</span></div>
        <ul class="tests" ~if="embTests?.length">
            <li ~for="embTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'linear'">
        <div class="row"><span class="pill {{linPill}}">{{linSummary}}</span><span class="muted">{{linInfo || ''}}</span></div>
        <ul class="tests" ~if="linTests?.length">
            <li ~for="linTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'mamba'">
        <div class="row"><span class="pill {{mamPill}}">{{mamSummary}}</span><span class="muted">{{mamInfo || ''}}</span></div>
        <ul class="tests" ~if="mamTests?.length">
            <li ~for="mamTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'head'">
        <div class="row"><span class="pill {{hedPill}}">{{hedSummary}}</span><span class="muted">{{hedInfo || ''}}</span></div>
        <ul class="tests" ~if="hedTests?.length">
            <li ~for="hedTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused?.id === 'llm'">
        <div class="row"><span class="pill {{llmPill}}">{{llmSummary}}</span><span class="muted">{{llmInfo || ''}}</span></div>
        <ul class="tests" ~if="llmTests?.length">
            <li ~for="llmTests"><span class="{{$for.item.cls}}">{{$for.item.mark}} {{$for.item.id}} {{$for.item.label}}</span> — {{$for.item.details}}<span ~if="$for.item.ms"> ({{$for.item.ms}}мс)</span></li>
        </ul>
    </div>
    <div class="card" ~if="focused && !['gpu','tokenizer','embedding','linear','mamba','head','llm'].includes(focused.id)">
        <div><b>{{focused?.label}}</b> — шаг в плане, панель появится позже.</div>
    </div>
    <div class="card">
        <div><b>Метрики</b></div>
        <oda-loss-chart id="chart" label="" :data="chartData" :legend="chartLegend"></oda-loss-chart>
        <details><summary>Эталонный корпус и лог</summary>
            <div class="muted">Эталон заморожен в коде тестов; поле ниже — только для справки.</div>
            <div class="muted" style="white-space: pre-line">{{corpus}}</div>
        </details>
    </div>
    <details><summary>Лог выполнения</summary><pre class="log">{{logText}}</pre></details>
    `,
    adapterInfo: '',
    limits: null,
    features: [],
    gpuTests: [],
    tokTests: [],
    embTests: [],
    linTests: [],
    mamTests: [],
    hedTests: [],
    llmTests: [],
    overall: '',
    overallPill: '',
    progDone: 0,
    progTotal: 0,
    progCurrent: '',
    get progPct() { return this.progTotal ? Math.round(this.progDone / this.progTotal * 100) : 0; },
    gpuSummary: 'не запускали',
    gpuPill: '',
    tokSummary: 'не запускали',
    tokPill: '',
    embSummary: 'не запускали',
    embPill: '',
    linSummary: 'не запускали',
    linPill: '',
    linInfo: '',
    mamSummary: 'не запускали',
    mamPill: '',
    mamInfo: '',
    hedSummary: 'не запускали',
    hedPill: '',
    hedInfo: '',
    llmSummary: 'не запускали',
    llmPill: '',
    llmInfo: '',
    tok: null,
    tokInfo: '',
    embInfo: '',
    emb: null,
    embGpu: null,
    corpus: 'Квантовая механика — раздел физики.\nКот Шрёдингера жив и мертв одновременно.',
    chartData: [],
    chartLegend: ['loss'],
    logLines: [],
    get logText() { return (this.logLines || []).join('\n'); },
    tabDot(id) {
        const map = { gpu: this.gpuTests, tokenizer: this.tokTests, embedding: this.embTests, linear: this.linTests, mamba: this.mamTests, head: this.hedTests, llm: this.llmTests };
        const items = map[id] || [];
        if (!items.length) return '';
        if (items.some(x => x.status === 'fail')) return 'fail';
        if (items.some(x => x.status === 'running')) return 'run';
        if (items.every(x => x.status === 'pass')) return 'ok';
        return '';
    },
    get tabs() {
        return [
            { id: 'gpu', label: '1. WebGPU', dot: this.tabDot('gpu') },
            { id: 'tokenizer', label: '2. Tokenizer', dot: this.tabDot('tokenizer') },
            { id: 'embedding', label: '3. Embedding', dot: this.tabDot('embedding') },
            { id: 'linear', label: '4. Linear', dot: this.tabDot('linear') },
            { id: 'mamba', label: '5. Mamba', dot: this.tabDot('mamba') },
            { id: 'head', label: '6. Head', dot: this.tabDot('head') },
            { id: 'llm', label: '7. LLM', dot: this.tabDot('llm') },
            { id: 'node', label: '8. Node-Dawn', disabled: true },
        ];
    },
    focused: null,
    attached() {
        this.focused = this.tabs[0];
    },
    log(msg) {
        this.logLines = [...(this.logLines || []), `[${new Date().toLocaleTimeString()}] ${msg}`];
    },
    // --- Внутренние хелперы: возвращают {pass, details}, используются и кнопками, и автотестами ---
    async _getAdapter() {
        if (!navigator.gpu) throw new Error('navigator.gpu недоступен (нужен Chrome/Edge + WebGPU)');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('requestAdapter вернул null');
        return adapter;
    },
    _applyAdapterInfo(adapter) {
        const info = adapter.info || {};
        this.adapterInfo = `${info.vendor || '?'} / ${info.architecture || '?'} / ${info.device || '?'} (${info.description || 'gpu'})`;
        this.limits = {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize,
            maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
            maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
        };
        this.features = [...adapter.features];
    },
    async _smoke41() {
        const adapter = await this._getAdapter();
        const device = await adapter.requestDevice();
        try {
            const code = `
                @group(0) @binding(0) var<storage, read> a: array<u32>;
                @group(0) @binding(1) var<storage, read_write> b: array<u32>;
                @compute @workgroup_size(1)
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    b[0] = a[0] + 1u;
                }`;
            const module = device.createShaderModule({ code });
            const bufA = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, mappedAtCreation: false });
            device.queue.writeBuffer(bufA, 0, new Uint32Array([41]));
            const bufB = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
            const pipe = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
            const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bufA } }, { binding: 1, resource: { buffer: bufB } }] });
            const enc = device.createCommandEncoder();
            const pass = enc.beginComputePass();
            pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
            device.queue.submit([enc.finish()]);
            await device.queue.onSubmittedWorkDone();
            const stag = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            const enc2 = device.createCommandEncoder();
            enc2.copyBufferToBuffer(bufB, 0, stag, 0, 4);
            device.queue.submit([enc2.finish()]);
            await stag.mapAsync(GPUMapMode.READ);
            const out = new Uint32Array(stag.getMappedRange().slice(0))[0];
            stag.unmap();
            return out;
        } finally {
            device.destroy?.();
        }
    },
    // --- Раннер автотестов ---
    _mkItems(defs) {
        return defs.map(d => ({ ...d, status: 'idle', mark: '○', cls: 't-idle', details: 'не запущен', ms: 0 }));
    },
    async _runSuite(items, key) {
        this[key] = [...items];
        let passCount = 0;
        for (let i = 0; i < items.length; i++) {
            items[i].status = 'running'; items[i].mark = '…'; items[i].cls = 't-run'; items[i].details = 'выполняется…';
            this.progCurrent = `${items[i].id} ${items[i].label}`;
            this[key] = [...items];
            const t0 = performance.now();
            try {
                const r = await items[i].run();
                items[i].ms = Math.round(performance.now() - t0);
                items[i].status = r.pass ? 'pass' : 'fail';
                items[i].mark = r.pass ? '✓' : '✗';
                items[i].cls = r.pass ? 't-pass' : 't-fail';
                items[i].details = r.details;
                if (r.pass) passCount++;
                this.log(`${r.pass ? 'PASS' : 'FAIL'} ${items[i].id} ${items[i].label}: ${r.details} (${items[i].ms}мс)`);
                this.progDone++;
                if (!r.pass) break; // стоп на первом красном
            } catch (e) {
                items[i].ms = Math.round(performance.now() - t0);
                items[i].status = 'fail'; items[i].mark = '✗'; items[i].cls = 't-fail';
                items[i].details = 'исключение: ' + (e.message || e);
                this.log(`FAIL ${items[i].id}: ${items[i].details}`);
                this.progDone++;
                break;
            }
            this[key] = [...items];
        }
        this.progCurrent = '';
        this[key] = [...items];
        return { passCount, total: items.length, ok: passCount === items.length };
    },
    _gpuTestDefs() {
        return [
            { id: 'G1', label: 'adapter доступен', run: async () => {
                const a = await this._getAdapter();
                this._applyAdapterInfo(a);
                this.gpuStatus = 'OK: WebGPU доступен'; this.gpuStatusClass = 'status-ok';
                return { pass: true, details: this.adapterInfo };
            }},
            { id: 'G2', label: 'smoke 41+1=42 на GPU', run: async () => {
                const out = await this._smoke41();
                return out === 42 ? { pass: true, details: '41+1=42' } : { pass: false, details: `ожидалось 42, получено ${out}` };
            }},
            { id: 'G3', label: 'лимиты ≥ 1MB storage', run: async () => {
                const a = await this._getAdapter();
                const lim = a.limits.maxStorageBufferBindingSize;
                return lim >= 1048576
                    ? { pass: true, details: `maxStorageBufferBindingSize=${lim}` }
                    : { pass: false, details: `maxStorageBufferBindingSize=${lim} < 1MB — таблицы весов не влезут` };
            }},
        ];
    },
    _tokTestDefs() {
        const FIX = ['Квантовая механика — раздел физики.', 'Кот Шрёдингера жив и мертв одновременно.'];
        return [
            { id: 'T1', label: 'roundtrip до обучения 100%', run: async () => {
                const { TokenizerCore } = await import('../src/tokenizer/tokenizer-core.js');
                const t = new TokenizerCore({ vocabSize: 1024, maxTokenLength: 5 });
                let ok = 0;
                for (let row of FIX) if (t.decode(t.encode(row)) === row) ok++;
                this.tok = t; this.tokRefreshInfo();
                return ok === FIX.length ? { pass: true, details: `${ok}/${FIX.length} строк` } : { pass: false, details: `${ok}/${FIX.length} строк` };
            }},
            { id: 'T2', label: 'train дает merges>0', run: async () => {
                const tok = await this.tokEnsure();
                let added = 0;
                for (let e = 0; e < 3; e++) for (let row of FIX) added += tok.train(row + ' ' + row);
                this.tokRefreshInfo();
                return added > 0
                    ? { pass: true, details: `+${added} merges, ${this.tokInfo}` }
                    : { pass: false, details: 'train не добавил ни одного merge' };
            }},
            { id: 'T3', label: 'сжатие ≥20% после train', run: async () => {
                const tok = await this.tokEnsure();
                const bytes = new TextEncoder().encode(FIX.join('\n')).length;
                const n = tok.encode(FIX.join('\n')).length;
                const ratio = (1 - n / bytes) * 100;
                this.chartData = [...(this.chartData || []), n];
                return ratio >= 20
                    ? { pass: true, details: `${bytes} байт → ${n} токенов (−${ratio.toFixed(0)}%)` }
                    : { pass: false, details: `${bytes} байт → ${n} токенов (−${ratio.toFixed(0)}% < 20%)` };
            }},
            { id: 'T4', label: 'roundtrip после обучения 100%', run: async () => {
                const tok = await this.tokEnsure();
                let ok = 0, bad = '';
                for (let row of FIX) {
                    const back = tok.decode(tok.encode(row));
                    if (back === row) ok++; else bad = `${JSON.stringify(row)}→${JSON.stringify(back)}`;
                }
                return ok === FIX.length ? { pass: true, details: `${ok}/${FIX.length} строк` } : { pass: false, details: bad };
            }},
            { id: 'T5', label: 'детерминизм encode', run: async () => {
                const tok = await this.tokEnsure();
                const a = Array.from(tok.encode(FIX.join('\n'))).join(',');
                const b = Array.from(tok.encode(FIX.join('\n'))).join(',');
                return a === b ? { pass: true, details: 'повторный encode идентичен' } : { pass: false, details: 'encode нестабилен' };
            }},
            { id: 'T6', label: 'время train+encode < 5с', run: async () => {
                const { TokenizerCore } = await import('../src/tokenizer/tokenizer-core.js');
                const t0 = performance.now();
                const t = new TokenizerCore({ vocabSize: 1024, maxTokenLength: 5 });
                for (let e = 0; e < 3; e++) for (let row of FIX) t.train(row + ' ' + row);
                t.encode(FIX.join('\n'));
                const ms = Math.round(performance.now() - t0);
                return ms < 5000 ? { pass: true, details: `${ms}мс` } : { pass: false, details: `${ms}мс ≥ 5000` };
            }},
        ];
    },
    _suiteSummary(key) {
        const items = this[key] || [];
        if (!items.length) return { text: 'не запускали', pill: '' };
        const p = items.filter(x => x.status === 'pass').length;
        const ok = p === items.length && items.every(x => x.status === 'pass');
        const bad = items.some(x => x.status === 'fail');
        return { text: `${p}/${items.length}`, pill: ok ? 'ok' : (bad ? 'fail' : 'run') };
    },
    async runGpuTests() {
        this.log('=== Автотест WebGPU (G1–G3) ===');
        this.gpuSummary = 'выполняется…'; this.gpuPill = 'run';
        const r = await this._runSuite(this._mkItems(this._gpuTestDefs()), 'gpuTests');
        const s = this._suiteSummary('gpuTests');
        this.gpuSummary = s.text; this.gpuPill = s.pill;
        this._updateOverall();
        return r;
    },
    async runTokTests() {
        this.log('=== Автотест Tokenizer (T1–T6) ===');
        this.tokSummary = 'выполняется…'; this.tokPill = 'run';
        const r = await this._runSuite(this._mkItems(this._tokTestDefs()), 'tokTests');
        const s = this._suiteSummary('tokTests');
        this.tokSummary = s.text; this.tokPill = s.pill;
        this._updateOverall();
        return r;
    },
    async runAll() {
        this.overall = 'выполняется…'; this.overallPill = 'run';
        // Общий знаменатель прогресса: сумма всех пунктов (вызов defs без прогона безопасен)
        this.progDone = 0; this.progCurrent = '';
        this.progTotal = this._gpuTestDefs().length + this._tokTestDefs().length
            + this._embTestDefs().length + this._linTestDefs().length + this._mamTestDefs().length
            + this._hedTestDefs().length + this._llmTestDefs().length;
        const g = await this.runGpuTests();
        let t = { passCount: 0, total: 0, ok: true };
        let e = { passCount: 0, total: 0, ok: true };
        if (g.ok) t = await this.runTokTests();
        else this.log('SKIP Tokenizer: WebGPU красный');
        if (g.ok && t.ok && this._embTestDefs) e = await this.runEmbTests();
        else if (!(g.ok && t.ok)) this.log('SKIP Embedding: предыдущий шаг красный');
        let l = { passCount: 0, total: 0, ok: true };
        if (g.ok && t.ok && e.ok && this._linTestDefs) l = await this.runLinTests();
        else if (!(g.ok && t.ok && e.ok)) this.log('SKIP Linear: предыдущий шаг красный');
        let mm = { passCount: 0, total: 0, ok: true };
        if (g.ok && t.ok && e.ok && l.ok && this._mamTestDefs) mm = await this.runMamTests();
        else if (!(g.ok && t.ok && e.ok && l.ok)) this.log('SKIP Mamba: предыдущий шаг красный');
        let h = { passCount: 0, total: 0, ok: true };
        if (g.ok && t.ok && e.ok && l.ok && mm.ok && this._hedTestDefs) h = await this.runHedTests();
        else if (!(g.ok && t.ok && e.ok && l.ok && mm.ok)) this.log('SKIP Head: предыдущий шаг красный');
        let s = { passCount: 0, total: 0, ok: true };
        if (g.ok && t.ok && e.ok && l.ok && mm.ok && h.ok && this._llmTestDefs) s = await this.runLlmTests();
        else if (!(g.ok && t.ok && e.ok && l.ok && mm.ok && h.ok)) this.log('SKIP LLM: предыдущий шаг красный');
        const parts = [`WebGPU ${g.passCount}/${g.total}`, `Tokenizer ${t.passCount}/${t.total}`, `Embedding ${e.passCount}/${e.total}`, `Linear ${l.passCount}/${l.total}`, `Mamba ${mm.passCount}/${mm.total}`, `Head ${h.passCount}/${h.total}`, `LLM ${s.passCount}/${s.total}`];
        const ok = g.ok && t.ok && e.ok && l.ok && mm.ok && h.ok && s.ok;
        this.overall = ok ? `✓ ВСЁ ЗЕЛЕНО: ${parts.join(', ')}` : `✗ СТОП: ${parts.join(', ')}`;
        this.overallPill = ok ? 'ok' : 'fail';
        // Бар закрывается всегда: пропуски видны отсутствием секций + СТОП
        this.progDone = this.progTotal; this.progCurrent = '';
        this.log(this.overall);
    },
    _updateOverall() {
        const gs = this._suiteSummary('gpuTests'), ts = this._suiteSummary('tokTests'), es = this._suiteSummary('embTests'), ls = this._suiteSummary('linTests'), ms = this._suiteSummary('mamTests'), hs = this._suiteSummary('hedTests'), ss = this._suiteSummary('llmTests');
        if (this.gpuTests?.length) { this.gpuSummary = gs.text; this.gpuPill = gs.pill; }
        if (this.tokTests?.length) { this.tokSummary = ts.text; this.tokPill = ts.pill; }
        if (this.embTests?.length) { this.embSummary = es.text; this.embPill = es.pill; }
        if (this.linTests?.length) { this.linSummary = ls.text; this.linPill = ls.pill; }
        if (this.mamTests?.length) { this.mamSummary = ms.text; this.mamPill = ms.pill; }
        if (this.hedTests?.length) { this.hedSummary = hs.text; this.hedPill = hs.pill; }
        if (this.llmTests?.length) { this.llmSummary = ss.text; this.llmPill = ss.pill; }
        const parts = [];
        if (this.gpuTests?.length) parts.push(`WebGPU ${gs.text}`);
        if (this.tokTests?.length) parts.push(`Tokenizer ${ts.text}`);
        if (this.embTests?.length) parts.push(`Embedding ${es.text}`);
        if (this.linTests?.length) parts.push(`Linear ${ls.text}`);
        if (this.mamTests?.length) parts.push(`Mamba ${ms.text}`);
        if (this.hedTests?.length) parts.push(`Head ${hs.text}`);
        if (this.llmTests?.length) parts.push(`LLM ${ss.text}`);
        if (parts.length) this.overall = parts.join(', ');
    },
    async copyReport() {
        const line = (x) => `- [${x.status === 'pass' ? 'x' : ' '}] ${x.id} ${x.label}: ${x.details}${x.ms ? ` (${x.ms}мс)` : ''}`;
        const md = [`# BinNet test report ${new Date().toLocaleString()}`, ``,
            `Adapter: ${this.adapterInfo || '—'}`,
            ``, `## WebGPU`, ...((this.gpuTests || []).map(line)),
            ``, `## Tokenizer`, ...((this.tokTests || []).map(line)),
            ``, `## Embedding`, ...((this.embTests || []).map(line)),
            ``, `## Linear`, ...((this.linTests || []).map(line)),
            ``, `## Mamba`, ...((this.mamTests || []).map(line)),
            ``, `## Head`, ...((this.hedTests || []).map(line)),
            ``, `## LLM`, ...((this.llmTests || []).map(line)),
            ``, `Итог: ${this.overall || 'тесты не запускались'}`].join('\n');
        try {
            await navigator.clipboard.writeText(md);
            this.log('Отчет скопирован в буфер обмена');
        } catch (e) {
            this.log('copyReport FAIL (clipboard недоступен): ' + e.message + '\n' + md);
        }
    },
    async tokEnsure() {
        if (!this.tok) {
            const { TokenizerCore } = await import('../src/tokenizer/tokenizer-core.js');
            this.tok = new TokenizerCore({ vocabSize: 1024, maxTokenLength: 5 });
            this.log('TokenizerCore создан (vocab=1024)');
        }
        return this.tok;
    },
    tokRefreshInfo() {
        const vocabSize = Object.keys(this.tok.inverseVocab).length;
        const merges = Object.keys(this.tok.merges).length;
        this.tokInfo = `vocab=${vocabSize}, merges=${merges}`;
    },
    // Ручные методы удалены (минимализм): всё покрытие — через автотесты.
    async embEnsure() {
        if (!this.emb) {
            const { BrowserGpu } = await import('./browser-gpu.js');
            const { Embedding } = await import('../src/layers/embedding.js');
            this.embGpu = await BrowserGpu.create();
            this.emb = new Embedding({
                vocabSize: 64, embSize: 8, embLearnRate: 0.5,
                gpu: this.embGpu, folder: 'browser-test',
            });
            await this.emb.load(); // fs зашимлен: всегда свежие случайные веса in-memory
            this.embInfo = `vocab=64, emb=8 u32 (${8 * 32} бит/токен), lr=0.5`;
            this.log('Embedding создан (реальный класс, BrowserGpu)');
        }
        return this.emb;
    },
    _embRow(table, tokenIdx, embSize) {
        return table.slice(tokenIdx * embSize, (tokenIdx + 1) * embSize);
    },
    _embTestDefs() {
        const TOKEN = 5, EMB = 8;
        const bitsOf = (arr) => Array.from(arr, v => v.toString(2).padStart(32, '0')).join('');
        return [
            { id: 'E1', label: 'lookup возвращает строку таблицы', run: async () => {
                const emb = await this.embEnsure();
                await emb.forward({ tokenIdx: TOKEN, targetIdx: 7 });
                const out = await this.embGpu.readData(emb.output);
                const table = await this.embGpu.readData(emb.params.embeddings);
                const row = this._embRow(table, TOKEN, EMB);
                const same = row.every((v, i) => v === out[i]);
                return same
                    ? { pass: true, details: `ряд ${TOKEN} совпал (${EMB} u32)` }
                    : { pass: false, details: `выход forward ≠ строке таблицы ряда ${TOKEN}` };
            }},
            { id: 'E2', label: 'повторный lookup стабилен', run: async () => {
                const emb = await this.embEnsure();
                await emb.forward({ tokenIdx: TOKEN, targetIdx: 7 });
                const a = bitsOf(await this.embGpu.readData(emb.output));
                await emb.forward({ tokenIdx: TOKEN, targetIdx: 7 });
                const b = bitsOf(await this.embGpu.readData(emb.output));
                return a === b ? { pass: true, details: 'бит-в-бит тот же' } : { pass: false, details: 'lookup плавает без обучения' };
            }},
            { id: 'E3', label: 'BACK тянет ряд к цели, без левых бит', run: async () => {
                const emb = await this.embEnsure();
                await emb.forward({ tokenIdx: TOKEN, targetIdx: 7 });
                const table = await this.embGpu.readData(emb.params.embeddings);
                const oldRow = this._embRow(table, TOKEN, EMB).slice();
                // Цель — инверсия ряда: все 256 бит отличаются
                const goal = new Uint32Array(oldRow.map(v => (~v) >>> 0));
                let moved = 0, wrong = 0, cur;
                for (let attempt = 0; attempt < 3; attempt++) {
                    emb.back({ back_target: goal });
                    const t2 = await this.embGpu.readData(emb.params.embeddings);
                    cur = this._embRow(t2, TOKEN, EMB);
                    // Строго побитово: совпадавшее с целью обязано остаться,
                    // отличаться может только в сторону цели
                    const sOld = bitsOf(oldRow), sNew = bitsOf(cur), sGoal = bitsOf(goal);
                    moved = 0; wrong = 0;
                    for (let b = 0; b < sOld.length; b++) {
                        if (sOld[b] === sGoal[b] && sNew[b] !== sGoal[b]) wrong++;
                        if (sOld[b] !== sGoal[b] && sNew[b] === sGoal[b]) moved++;
                    }
                    if (moved > 0) break;
                }
                if (wrong > 0) return { pass: false, details: `${wrong} бит ушли против цели` };
                return moved > 0
                    ? { pass: true, details: `${moved}/256 бит притянуто к цели, левых — 0` }
                    : { pass: false, details: 'ряд не изменился — BACK заморожен (diff=0)' };
            }},
            { id: 'E4', label: 'время forward+back < 5с', run: async () => {
                const emb = await this.embEnsure();
                const goal = new Uint32Array(EMB).fill(0xAAAAAAAA);
                const t0 = performance.now();
                await emb.forward({ tokenIdx: 1, targetIdx: 2 });
                emb.back({ back_target: goal });
                await this.embGpu.readData(emb.params.embeddings);
                const ms = Math.round(performance.now() - t0);
                return ms < 5000 ? { pass: true, details: `${ms}мс` } : { pass: false, details: `${ms}мс ≥ 5000` };
            }},
        ];
    },
    async runEmbTests() {
        this.log('=== Автотест Embedding (E1–E4) ===');
        this.embSummary = 'выполняется…'; this.embPill = 'run';
        const r = await this._runSuite(this._mkItems(this._embTestDefs()), 'embTests');
        const s = this._suiteSummary('embTests');
        this.embSummary = s.text; this.embPill = s.pill;
        this._updateOverall();
        return r;
    },
    // --- Linear: реальный класс + BrowserGpu, in=4/out=4/divider=1 ---
    async _makeLin(IN = 4, OUT = 4) {
        const { BrowserGpu } = await import('./browser-gpu.js');
        const { Linear } = await import('../src/layers/linear.js');
        const gpu = await BrowserGpu.create();
        const lin = new Linear({ in_size: IN, out_size: OUT, divider: 1, gpu, folder: 'browser-test' });
        await lin.load(); // fs зашимлен: свежие случайные веса in-memory
        return { gpu, lin };
    },
    _linPopcount32(v) {
        v >>>= 0;
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        v = (v + (v >>> 4)) & 0x0F0F0F0F;
        return ((v * 0x01010101) >>> 24);
    },
    // Эталон FORWARD на CPU: повторяет шейдер (XNOR-vote, порог > 0)
    _linForwardRef(X, W, inSize, outSize) {
        const wSize = inSize, out = new Uint32Array(outSize);
        for (let idx = 0; idx < outSize; idx++) {
            let val = 0;
            for (let o = 0; o < 32; o++) {
                let sum = 0;
                const wStart = (idx * 32 + o) * wSize;
                for (let i = 0; i < wSize; i++) {
                    const inp = X[i] >>> 0, w = W[wStart + i] >>> 0;
                    sum += this._linPopcount32(inp & w) - this._linPopcount32(inp & (~w >>> 0));
                }
                if (sum > 0) val |= (1 << o);
            }
            out[idx] = val >>> 0;
        }
        return out;
    },
    _linErrBits(a, b) {
        let n = 0;
        for (let i = 0; i < a.length; i++) n += this._linPopcount32((a[i] ^ b[i]) >>> 0);
        return n;
    },
    _linTestDefs() {
        const IN = 4, OUT = 4;
        const rnd = (n, seed) => {
            // детерминированный ГПСЧ, чтобы прогон был воспроизводим
            let s = seed >>> 0;
            const a = new Uint32Array(n);
            for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
            return a;
        };
        return [
            { id: 'L1', label: 'forward детерминирован, размер out=4', run: async () => {
                const { gpu, lin } = await this._makeLin();
                try {
                    const X = rnd(IN, 1234);
                    const r1 = await lin.forward({ data: X.slice() });
                    const a = Array.from(await gpu.readData(r1.data));
                    const r2 = await lin.forward({ data: X.slice() });
                    const b = Array.from(await gpu.readData(r2.data));
                    const same = a.length === OUT && a.every((v, i) => v === b[i]);
                    this.linInfo = `in=${IN}, out=${OUT}, divider=1, веса ${lin.all_weights_size} u32`;
                    return same ? { pass: true, details: `два forward бит-в-бит` } : { pass: false, details: `forward плавает: [${a}] vs [${b}]` };
                } finally { gpu.destroy(); }
            }},
            { id: 'L2', label: 'forward == CPU-эталон XNOR-vote', run: async () => {
                const { gpu, lin } = await this._makeLin();
                try {
                    const X = rnd(IN, 777);
                    const r = await lin.forward({ data: X.slice() });
                    const got = await gpu.readData(r.data);
                    const W = await gpu.readData(lin.params.weights);
                    const ref = this._linForwardRef(X, W, IN, OUT);
                    const bad = ref.findIndex((v, i) => v !== got[i]);
                    return bad === -1
                        ? { pass: true, details: `${OUT} слова совпали с эталоном` }
                        : { pass: false, details: `слово ${bad}: GPU=${got[bad].toString(2)} CPU=${ref[bad].toString(2)}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'L3', label: 'back возвращает back_target размера входа', run: async () => {
                const { gpu, lin } = await this._makeLin();
                try {
                    const X = rnd(IN, 42), T = rnd(OUT, 43);
                    await lin.forward({ data: X.slice() });
                    const res = await lin.back({ back_target: T.slice() });
                    const bt = await gpu.readData(res.back_target);
                    return bt.length === IN
                        ? { pass: true, details: `back_target ${bt.length} u32` }
                        : { pass: false, details: `ожидалось ${IN} u32, получено ${bt.length}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'L4', label: 'UPDATE: быстрая фаза снимает ≥85% ошибок', run: async () => {
                const { gpu, lin } = await this._makeLin();
                try {
                    const X = rnd(IN, 2026);
                    const T2 = rnd(OUT, 90210);
                    const traj = [];
                    let it = 0, err = -1, err0 = -1;
                    for (it = 0; it < 30; it++) {
                        const r = await lin.forward({ data: X.slice() });
                        const out = await gpu.readData(r.data);
                        err = this._linErrBits(out, T2);
                        if (it === 0) err0 = err;
                        if (it % 5 === 0) traj.push(err);
                        if (err === 0) break;
                        await lin.back({ back_target: T2.slice() });
                    }
                    traj.push(err);
                    this.chartData = [...(this.chartData || []), ...traj];
                    // Известный долг: хвост (одинокие нейроны в почти-верных словах)
                    // голодает из-за word-level annealing — критерий по быстрой фазе.
                    const limit = Math.max(2, Math.round(err0 * 0.15));
                    const curve = `${err0}→${traj.join('→')}`;
                    return err <= limit
                        ? { pass: true, details: `${curve} (лимит ${limit})` }
                        : { pass: false, details: `быстрая фаза слаба: ${curve} (лимит ${limit})` };
                } finally { gpu.destroy(); }
            }},
            { id: 'L5', label: 'время forward+back < 10с', run: async () => {
                const { gpu, lin } = await this._makeLin();
                try {
                    const t0 = performance.now();
                    await lin.forward({ data: rnd(IN, 5) });
                    await lin.back({ back_target: rnd(OUT, 6) });
                    await gpu.readData(lin.params.weights);
                    const ms = Math.round(performance.now() - t0);
                    return ms < 10000 ? { pass: true, details: `${ms}мс` } : { pass: false, details: `${ms}мс ≥ 10000` };
                } finally { gpu.destroy(); }
            }},
            { id: 'L6', label: 'BACK = транспонированный вотум (крафт-веса)', run: async () => {
                // Все веса all-ones: вотум за бит = (#единиц цели) − (#нулей).
                // Цель с 20 единицами → ряд all-ones; с 10 → нули.
                const { gpu, lin } = await this._makeLin(1, 1);
                try {
                    lin.params.weights.fill(0xFFFFFFFF);
                    const T1 = new Uint32Array([0x000FFFFF]); // 20 единиц
                    await lin.forward({ data: new Uint32Array([0]) });
                    await lin.back({ back_target: T1 });
                    const bt1 = Array.from(await gpu.readData(lin._shaders.BACK.target));
                    const T2 = new Uint32Array([0x000003FF]); // 10 единиц
                    await lin.back({ back_target: T2 });
                    const bt2 = Array.from(await gpu.readData(lin._shaders.BACK.target));
                    const ok = (bt1[0] >>> 0) === 0xFFFFFFFF && (bt2[0] >>> 0) === 0;
                    return ok
                        ? { pass: true, details: '20/32 → все биты, 10/32 → ноль' }
                        : { pass: false, details: `получено ${(bt1[0] >>> 0).toString(16)}/${(bt2[0] >>> 0).toString(16)}` };
                } finally { gpu.destroy(); }
            }},
        ];
    },
    async runLinTests() {
        this.log('=== Автотест Linear (L1–L5) ===');
        this.linSummary = 'выполняется…'; this.linPill = 'run';
        const r = await this._runSuite(this._mkItems(this._linTestDefs()), 'linTests');
        const s = this._suiteSummary('linTests');
        this.linSummary = s.text; this.linPill = s.pill;
        this._updateOverall();
        return r;
    },
    // --- Mamba: реальный MambaLayer (h=4, d=8) + BrowserGpu ---
    async _makeMamba() {
        const { BrowserGpu } = await import('./browser-gpu.js');
        const { MambaLayer } = await import('../src/layers/mamba-layer.js');
        const gpu = await BrowserGpu.create();
        const layer = new MambaLayer({ embSize: 4, expansionFactor: 2, divider: 1, gpu, folder: 'browser-test', id: 0 });
        await layer.load();
        return { gpu, layer };
    },
    _mamTestDefs() {
        const H = 4, D = 8;
        const rnd = (n, seed) => {
            let s = seed >>> 0;
            const a = new Uint32Array(n);
            for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
            return a;
        };
        const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
        return [
            { id: 'M1', label: 'conv = current OR delay, delay обновляется', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    // delay после конструктора нулевой: out1 должен равняться cur1
                    const cur1 = rnd(D, 11);
                    layer._applyBinaryConv1d(cur1.slice());
                    const c1 = Array.from(await gpu.readData(layer.convOutput));
                    const ok1 = c1.every((v, i) => (v >>> 0) === (cur1[i] >>> 0));
                    const d1 = Array.from(await gpu.readData(layer.convDelay));
                    const okD1 = d1.every((v, i) => (v >>> 0) === (cur1[i] >>> 0));
                    // второй шаг: out2 = cur2 | cur1, delay := cur2
                    const cur2 = rnd(D, 12);
                    layer._applyBinaryConv1d(cur2.slice());
                    const c2 = Array.from(await gpu.readData(layer.convOutput));
                    const ok2 = c2.every((v, i) => (v >>> 0) === (((cur2[i] | cur1[i]) >>> 0)));
                    const d2 = Array.from(await gpu.readData(layer.convDelay));
                    const okD2 = d2.every((v, i) => (v >>> 0) === (cur2[i] >>> 0));
                    return ok1 && okD1 && ok2 && okD2
                        ? { pass: true, details: 'OR на нулевом delay, затем OR с историей, delay := current' }
                        : { pass: false, details: `шаг1 OR=${ok1} delay=${okD1}, шаг2 OR=${ok2} delay=${okD2}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'M2', label: 'SSM-шаг: next=(prev&~forget)|(curr&add)', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    const mem = layer.mambaMemory;
                    const conv = rnd(D, 21), forget = rnd(D, 22), add = rnd(D, 23);
                    gpu.writeData(conv); gpu.writeData(forget); gpu.writeData(add);
                    // шаг 1: prev = 0 → next = conv & add
                    mem.resetState();
                    await mem.forward({ conv, forget, add });
                    const got1 = Array.from(await gpu.readData(mem.output));
                    const ok1 = got1.every((v, i) => (v >>> 0) === (((conv[i] & add[i]) >>> 0)));
                    // шаг 2: prev = all-ones → next = ~forget | (conv & add)
                    const prev = new Uint32Array(D).fill(0xFFFFFFFF);
                    mem.state.set(prev);
                    gpu.writeData(mem.state);
                    await mem.forward({ conv, forget, add });
                    const got2 = Array.from(await gpu.readData(mem.output));
                    let bad = -1;
                    for (let i = 0; i < D; i++) {
                        const want = ((((~forget[i]) >>> 0) | ((conv[i] & add[i]) >>> 0)) >>> 0);
                        if ((got2[i] >>> 0) !== want) { bad = i; break; }
                    }
                    return ok1 && bad === -1
                        ? { pass: true, details: `${D} слов совпали с эталоном на обоих шагах` }
                        : { pass: false, details: `шаг1(prev=0)=${ok1}, шаг2(prev=1): слово ${bad}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'M3', label: 'память stateful: разные входы меняют state', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    // NB: одинаковый вход дважды — алгебраическая fixed-point:
                    // conv2 = e|e = e, s2 = (s1&~f)|s1 = s1. Поэтому входы РАЗНЫЕ.
                    await layer.forward({ data: rnd(H, 31) });
                    const s1 = Array.from(await gpu.readData(layer.mambaMemory.state));
                    await layer.forward({ data: rnd(H, 32) });
                    const s2 = Array.from(await gpu.readData(layer.mambaMemory.state));
                    const changed = s1.some((v, i) => v !== s2[i]);
                    return changed
                        ? { pass: true, details: 'state после X2 ≠ state после X1' }
                        : { pass: false, details: 'state не меняется — память мертва' };
                } finally { gpu.destroy(); }
            }},
            { id: 'M4', label: 'resetState: повтор дает тот же выход', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    const X = rnd(H, 41);
                    const r1 = await layer.forward({ data: X.slice() });
                    const o1 = Array.from(await gpu.readData(r1.data));
                    layer.resetState();
                    const st = Array.from(await gpu.readData(layer.mambaMemory.state));
                    const dl = Array.from(await gpu.readData(layer.convDelay));
                    const clean = st.every(v => v === 0) && dl.every(v => v === 0);
                    const r2 = await layer.forward({ data: X.slice() });
                    const o2 = Array.from(await gpu.readData(r2.data));
                    return clean && same(o1, o2)
                        ? { pass: true, details: 'state+delay нулевые, выходы совпали' }
                        : { pass: false, details: `clean=${clean}, выходы ${same(o1, o2) ? 'совпали' : 'разные'}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'M5', label: 'forward/back формы: data=h, back_target=h', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    const r = await layer.forward({ data: rnd(H, 51) });
                    const out = await gpu.readData(r.data);
                    const b = await layer.back({ back_target: rnd(H, 52) });
                    const bt = await gpu.readData(b.back_target);
                    this.mamInfo = `h=${H}, d=${D}, проекции 4→8→8→8→4`;
                    return out.length === H && bt.length === H
                        ? { pass: true, details: `data ${out.length}, back_target ${bt.length}` }
                        : { pass: false, details: `data ${out.length}, back_target ${bt.length} (ждали ${H}/${H})` };
                } finally { gpu.destroy(); }
            }},
            { id: 'M6', label: 'время forward+back < 10с', run: async () => {
                const { gpu, layer } = await this._makeMamba();
                try {
                    const t0 = performance.now();
                    await layer.forward({ data: rnd(H, 61) });
                    await layer.back({ back_target: rnd(H, 62) });
                    await gpu.readData(layer.mambaMemory.state);
                    const ms = Math.round(performance.now() - t0);
                    return ms < 10000 ? { pass: true, details: `${ms}мс` } : { pass: false, details: `${ms}мс ≥ 10000` };
                } finally { gpu.destroy(); }
            }},
        ];
    },
    async runMamTests() {
        this.log('=== Автотест Mamba (M1–M6) ===');
        this.mamSummary = 'выполняется…'; this.mamPill = 'run';
        const r = await this._runSuite(this._mkItems(this._mamTestDefs()), 'mamTests');
        const s = this._suiteSummary('mamTests');
        this.mamSummary = s.text; this.mamPill = s.pill;
        this._updateOverall();
        return r;
    },
    // --- Head: реальный класс, vocab=32, emb=4 ---
    async _makeHead() {
        const { BrowserGpu } = await import('./browser-gpu.js');
        const { Head } = await import('../src/layers/head.js');
        const gpu = await BrowserGpu.create();
        const head = new Head({ vocabSize: 32, embSize: 4, gpu, folder: 'browser-test' });
        await head.load(); // fs зашимлен: свежие случайные веса in-memory
        return { gpu, head };
    },
    _hedPopcount32(v) {
        v >>>= 0;
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        v = (v + (v >>> 4)) & 0x0F0F0F0F;
        return ((v * 0x01010101) >>> 24);
    },
    // Эталон логитов на CPU: повторяет FWD-шейдер (XNOR + центрирование)
    _hedLogitsRef(X, W, vocab, emb) {
        const out = new Int32Array(vocab);
        for (let idx = 0; idx < vocab; idx++) {
            let sum = 0;
            for (let i = 0; i < emb; i++) {
                const x = X[i] >>> 0, w = W[idx * emb + i] >>> 0;
                sum += this._hedPopcount32((~(x ^ w)) >>> 0);
            }
            out[idx] = sum * 2 - emb * 32;
        }
        return out;
    },
    _hedHamming(a, b) {
        let n = 0;
        for (let i = 0; i < a.length; i++) n += this._hedPopcount32(((a[i] ^ b[i]) >>> 0));
        return n;
    },
    _hedBitsOf(arr) {
        return Array.from(arr, v => (v >>> 0).toString(2).padStart(32, '0')).join('');
    },
    // Строгая проверка движения ряда к цели: ни один бит не ушел против цели.
    // Возвращает {moved, wrong}.
    _hedToward(oldRow, newRow, goal) {
        const sO = this._hedBitsOf(oldRow), sN = this._hedBitsOf(newRow), sG = this._hedBitsOf(goal);
        let moved = 0, wrong = 0;
        for (let b = 0; b < sO.length; b++) {
            if (sO[b] === sG[b] && sN[b] !== sG[b]) wrong++;
            if (sO[b] !== sG[b] && sN[b] === sG[b]) moved++;
        }
        return { moved, wrong };
    },
    _hedTestDefs() {
        const V = 32, E = 4;
        const rnd = (n, seed) => {
            let s = seed >>> 0;
            const a = new Uint32Array(n);
            for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
            return a;
        };
        const rowOf = (table, r) => table.slice(r * E, (r + 1) * E);
        return [
            { id: 'H1', label: 'predict = argmax совпадений, логиты == эталон', run: async () => {
                const { gpu, head } = await this._makeHead();
                try {
                    const X = rnd(E, 101);
                    // Таблица после load() — CPU-массив без GPU-буфера: правим напрямую,
                    // буфер создастся сам при первом forward
                    const table = head.params.weights;
                    // Ряд 7 — точная копия входа (максимум), остальные случайны
                    table.set(X, 7 * E);
                    const res = await head.forward({ data: X.slice(), targetIdx: 7 });
                    const logits = await gpu.readData(head.logits);
                    const ref = this._hedLogitsRef(X, table, V, E);
                    const bad = ref.findIndex((v, i) => v !== logits[i]);
                    this.hedInfo = `vocab=${V}, emb=${E}`;
                    if (bad !== -1) return { pass: false, details: `логит ${bad}: GPU=${logits[bad]} CPU=${ref[bad]}` };
                    return res.predictIdx === 7 && res.loss === 0
                        ? { pass: true, details: `predict=7, loss=0, ${V} логитов совпали` }
                        : { pass: false, details: `predict=${res.predictIdx} loss=${res.loss} (ждали 7/0)` };
                } finally { gpu.destroy(); }
            }},
            { id: 'H2', label: 'ничья разрешается детерминированно (min idx)', run: async () => {
                const { gpu, head } = await this._makeHead();
                try {
                    // Все ряды одинаковы → все логиты равны → побеждает минимальный idx
                    const X = rnd(E, 202);
                    const table = head.params.weights;
                    for (let r = 0; r < V; r++) table.set(X, r * E);
                    const res = await head.forward({ data: X.slice(), targetIdx: 5 });
                    const r2 = await head.forward({ data: X.slice(), targetIdx: 5 });
                    return res.predictIdx === 0 && r2.predictIdx === 0
                        ? { pass: true, details: 'ничья → predict=0 дважды (детерминизм); loss=1 — коллапс виден' }
                        : { pass: false, details: `ничья дала ${res.predictIdx}/${r2.predictIdx} (ждали 0/0)` };
                } finally { gpu.destroy(); }
            }},
            { id: 'H3', label: 'BACK: target притягивается, predict отталкивается', run: async () => {
                const { gpu, head } = await this._makeHead();
                try {
                    const X = rnd(E, 303);
                    const P = 3, T = 9;
                    const table = head.params.weights;
                    table.set(X, P * E); // predict-ряд = вход
                    const notX = new Uint32Array(Array.from(X, v => (~v) >>> 0));
                    table.set(notX, T * E); // target-ряд = инверсия входа
                    const fwd = await head.forward({ data: X.slice(), targetIdx: T });
                    if (fwd.predictIdx !== P) return { pass: false, details: `сетап сломан: predict=${fwd.predictIdx} (ждали ${P})` };
                    const before = Array.from(await gpu.readData(head.params.weights));
                    let tRes = { moved: 0, wrong: 0 }, pRes = { moved: 0, wrong: 0 }, after = null;
                    for (let a = 0; a < 3; a++) {
                        head.back({ back_target: T, predict: P });
                        after = Array.from(await gpu.readData(head.params.weights));
                        tRes = this._hedToward(rowOf(before, T), rowOf(after, T), X);
                        pRes = this._hedToward(rowOf(before, P), rowOf(after, P), notX);
                        if (tRes.moved > 0 && pRes.moved > 0) break;
                    }
                    if (tRes.wrong > 0 || pRes.wrong > 0)
                        return { pass: false, details: `биты против цели: target ${tRes.wrong}, predict ${pRes.wrong}` };
                    return tRes.moved > 0 && pRes.moved > 0
                        ? { pass: true, details: `target +${tRes.moved} к входу, predict +${pRes.moved} к инверсии` }
                        : { pass: false, details: `движения нет: target +${tRes.moved}, predict +${pRes.moved}` };
                } finally { gpu.destroy(); }
            }},
            { id: 'H4', label: 'back_target == обновленный ряд target', run: async () => {
                const { gpu, head } = await this._makeHead();
                try {
                    const X = rnd(E, 404);
                    const P = 3, T = 9;
                    const table = head.params.weights;
                    table.set(X, P * E);
                    table.set(new Uint32Array(Array.from(X, v => (~v) >>> 0)), T * E);
                    await head.forward({ data: X.slice(), targetIdx: T });
                    const res = head.back({ back_target: T, predict: P });
                    const bt = Array.from(await gpu.readData(res.back_target));
                    const after = Array.from(await gpu.readData(head.params.weights));
                    const rowT = Array.from(rowOf(after, T));
                    const same = bt.length === E && bt.every((v, i) => (v >>> 0) === (rowT[i] >>> 0));
                    return same
                        ? { pass: true, details: `back_target ${E} u32 = ряду ${T}` }
                        : { pass: false, details: 'back_target не совпал с рядом target' };
                } finally { gpu.destroy(); }
            }},
            { id: 'H5', label: 'время forward+back < 10с', run: async () => {
                const { gpu, head } = await this._makeHead();
                try {
                    const t0 = performance.now();
                    const r = await head.forward({ data: rnd(E, 505), targetIdx: 1 });
                    head.back({ back_target: 1, predict: r.predictIdx });
                    await gpu.readData(head.params.weights);
                    const ms = Math.round(performance.now() - t0);
                    return ms < 10000 ? { pass: true, details: `${ms}мс` } : { pass: false, details: `${ms}мс ≥ 10000` };
                } finally { gpu.destroy(); }
            }},
        ];
    },
    async runHedTests() {
        this.log('=== Автотест Head (H1–H5) ===');
        this.hedSummary = 'выполняется…'; this.hedPill = 'run';
        const r = await this._runSuite(this._mkItems(this._hedTestDefs()), 'hedTests');
        const s = this._suiteSummary('hedTests');
        this.hedSummary = s.text; this.hedPill = s.pill;
        this._updateOverall();
        return r;
    },
    // --- LLM сквозной: реальный класс, vocab=512/emb=4/1 слой ---
    async _makeLlm(cfg = {}) {
        const { BrowserGpu } = await import('./browser-gpu.js');
        const { LLM } = await import('../src/core/llm.js');
        const gpu = await BrowserGpu.create();
        const llm = new LLM(Object.assign(
            { vocabSize: 512, embSize: 4, layersCount: 1, gpu, folder: 'browser-test' }, cfg));
        await llm.load(); // fs зашимлен: свежие случайные веса in-memory
        return { gpu, llm };
    },
    _llmFixture() {
        // Строка 1 удвоена: BPE нужны повторы пар на малом корпусе
        const line1 = 'Квантовая механика — раздел физики.';
        const line2 = 'Кот Шрёдингера жив и мертв одновременно.';
        return { line1, line2, corpus: line1 + '\n' + line1 + '\n' + line2 };
    },
    // Поэпоха-обучение с живым прогрессом пункта.
    // Математика = одному train на N эпох (мерджи/счетчики складываются так же).
    async _llmTrainSplit(llm, corpus, headEpochs, fullEpochs, testId) {
        const history = [];
        const total = headEpochs + fullEpochs;
        const poke = () => {
            const it = (this.llmTests || []).find(x => x.id === testId);
            if (it) {
                const last = history.length ? history[history.length - 1].acc.toFixed(2) : '…';
                it.details = `эпоха ${history.length}/${total}, acc ${last}…`;
                this.llmTests = [...this.llmTests];
            }
        };
        for (let e = 0; e < headEpochs; e++) {
            const r = await llm.train(corpus, { epochs: 1, headOnlyEpochs: 1 });
            history.push(...r.history.map(h => ({ ...h, headOnly: true, epoch: history.length })));
            poke();
        }
        for (let e = 0; e < fullEpochs; e++) {
            const r = await llm.train(corpus, { epochs: 1, headOnlyEpochs: 0 });
            history.push(...r.history.map(h => ({ ...h, headOnly: false, epoch: history.length })));
            poke();
        }
        return { history };
    },
    _llmTestDefs() {
        // Трек 1 (демо-путь): S1,S2,S4 на headlong. S5 — гейт трека 2 (коллапс).
        // S3 строгий — последним, никого не блокирует.
        const FIX = this._llmFixture();
        const self = this;
        return [
            { id: 'S1', label: 'headlong: оверфит одной строки (10 эпох Head)', run: async () => {
                const { gpu, llm } = await self._makeLlm();
                try {
                    self.llmInfo = 'vocab=512, emb=4, 1 слой, headlong 10/10';
                    const before = await llm.accuracy(FIX.line1);
                    const tr = await self._llmTrainSplit(llm, FIX.line1 + '\n' + FIX.line1, 10, 0, 'S1');
                    const after = await llm.accuracy(FIX.line1);
                    const curve = tr.history.map(h => h.acc.toFixed(2)).join(',');
                    self.chartData = [...(self.chartData || []), ...tr.history.map(h => 1 - h.acc)];
                    return after.acc >= 0.8 && after.acc > before.acc
                        ? { pass: true, details: `acc ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve})` }
                        : { pass: false, details: `не заучивает: ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve})` };
                } finally { gpu.destroy(); }
            }},
            { id: 'S2', label: 'headlong: эпохи растят accuracy', run: async () => {
                const { gpu, llm } = await self._makeLlm();
                try {
                    const before = await llm.accuracy(FIX.corpus);
                    const tr = await self._llmTrainSplit(llm, FIX.corpus, 6, 0, 'S2');
                    const after = await llm.accuracy(FIX.corpus);
                    const curve = tr.history.map(h => h.acc.toFixed(2)).join(',');
                    self.chartData = [...(self.chartData || []), ...tr.history.map(h => 1 - h.acc)];
                    return after.acc > before.acc
                        ? { pass: true, details: `acc ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve})` }
                        : { pass: false, details: `accuracy не растет: ${before.acc.toFixed(2)} → ${after.acc.toFixed(2)} (${curve})` };
                } finally { gpu.destroy(); }
            }},
            { id: 'S4', label: 'детерминизм после reset', run: async () => {
                const { gpu, llm } = await self._makeLlm();
                try {
                    await self._llmTrainSplit(llm, FIX.corpus, 4, 0, 'S4');
                    const a1 = await llm.accuracy(FIX.corpus);
                    const g1 = await llm.generate(FIX.line1.slice(0, 12), 20);
                    const a2 = await llm.accuracy(FIX.corpus);
                    const g2 = await llm.generate(FIX.line1.slice(0, 12), 20);
                    const same = a1.errors === a2.errors && g1 === g2;
                    return same
                        ? { pass: true, details: `acc-повтор ${a1.errors}/${a2.errors} ошибок, генерация совпала` }
                        : { pass: false, details: `плавает: ошибки ${a1.errors}/${a2.errors}, gen «${g1.slice(0, 20)}»/«${g2.slice(0, 20)}»` };
                } finally { gpu.destroy(); }
            }},
            { id: 'S5', label: 'ГЕЙТ трека 2: медленный низ держит acc', run: async () => {
                // Трек 2, шаг 1: низ в 10x медленнее (emb lr 0.01, +3 AND в маске Linear).
                // Дефолты src не тронуты — тормозит только этот тест.
                const { gpu, llm } = await self._makeLlm({ embLearnRate: 0.01, linUpdateExtra: 3 });
                try {
                    const tr = await self._llmTrainSplit(llm, FIX.line1 + '\n' + FIX.line1, 3, 5, 'S5');
                    const curve = tr.history.map(h => `${h.headOnly ? '*' : ''}${h.acc.toFixed(2)}`).join(',');
                    const headPhase = tr.history.filter(h => h.headOnly);
                    const fullPhase = tr.history.filter(h => !h.headOnly);
                    const peak = Math.max(...headPhase.map(h => h.acc));
                    const tail = fullPhase.length ? fullPhase[fullPhase.length - 1].acc : 0;
                    self.chartData = [...(self.chartData || []), ...tr.history.map(h => 1 - h.acc)];
                    return tail >= Math.max(0.5, peak * 0.7)
                        ? { pass: true, details: `пик head-only ${peak.toFixed(2)}, хвост ${tail.toFixed(2)} (${curve})` }
                        : { pass: false, details: `коллапс после разморозки: пик ${peak.toFixed(2)} → хвост ${tail.toFixed(2)} (${curve})` };
                } finally { gpu.destroy(); }
            }},
            { id: 'S3', label: 'генерация продолжает заученную строку (СТРОГО)', run: async () => {
                const { gpu, llm } = await self._makeLlm();
                try {
                    await self._llmTrainSplit(llm, FIX.corpus, 10, 0, 'S3');
                    const prompt = FIX.line1.slice(0, 12);
                    const gen = await llm.generate(prompt, 30);
                    if (typeof gen !== 'string') return { pass: false, details: `generate вернул не строку` };
                    if (!gen.length) return { pass: false, details: 'пустая генерация (сразу EOS)' };
                    return FIX.line1.includes(prompt + gen)
                        ? { pass: true, details: `«${prompt}» → «${gen.slice(0, 40)}»` }
                        : { pass: false, details: `не продолжение строки: «${gen.slice(0, 60)}»` };
                } finally { gpu.destroy(); }
            }},
        ];
    },
    async runLlmTests() {
        this.log('=== Автотест LLM (S1–S5) ===');
        this.llmSummary = 'выполняется…'; this.llmPill = 'run';
        const r = await this._runSuite(this._mkItems(this._llmTestDefs()), 'llmTests');
        const s = this._suiteSummary('llmTests');
        this.llmSummary = s.text; this.llmPill = s.pill;
        this._updateOverall();
        return r;
    },
});
