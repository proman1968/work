/**
 * form/trainer для конкретного узла модели $ai — чистая карточка параметров, состояния и проверки модели.
 */
export default {
    imports: 'oda//icon',
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            @apply --flex;
            overflow-y: auto;
            background: var(--content-background, #ffffff);
            color: var(--content-color, #1e293b);
            font-size: 13px;
            padding: 16px 20px;
            gap: 14px;
            box-sizing: border-box;
        }
        .header-card {
            @apply --horizontal;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            flex-wrap: wrap;
        }
        .header-left {
            @apply --horizontal;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }
        .title {
            font-size: 16px;
            font-weight: 700;
        }
        .subtitle {
            font-size: 12px;
            opacity: 0.75;
            margin-top: 2px;
        }
        .toolbar {
            @apply --horizontal;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge.active {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
            border: 1px solid light-dark(#86efac, #16a34a);
        }
        .badge.inactive {
            background: light-dark(#f1f5f9, #27272a);
            color: light-dark(#64748b, #a1a1aa);
            border: 1px solid light-dark(#cbd5e1, #3f3f46);
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        .dot.on { background: #22c55e; }
        .dot.off { background: #94a3b8; }
        .grid-2 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 14px;
        }
        .card {
            @apply --vertical;
            gap: 10px;
            padding: 14px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--content-background, #ffffff);
        }
        .section-title {
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.75;
            border-bottom: 1px solid var(--border-color, #e2e8f0);
            padding-bottom: 6px;
        }
        .kv-row {
            @apply --horizontal;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 5px 0;
            border-bottom: 1px solid var(--border-color, #f1f5f9);
            font-size: 12.5px;
        }
        .kv-label {
            opacity: 0.75;
        }
        .kv-val {
            font-weight: 600;
            text-align: right;
        }
        .pill {
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 4px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
        }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            font-size: 12.5px;
            font-weight: 600;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f1f5f9);
            color: inherit;
            cursor: pointer;
        }
        .btn.primary {
            background: var(--accent-color, #2563eb);
            border-color: var(--accent-color, #2563eb);
            color: #ffffff;
        }
        .btn.danger {
            color: light-dark(#b91c1c, #fca5a5);
            border-color: light-dark(#fecaca, #7f1d1d);
        }
        textarea {
            padding: 8px 10px;
            font-size: 13px;
            font-family: inherit;
            border: 1px solid var(--border-color, #cbd5e1);
            border-radius: 6px;
            background: var(--content-background, #ffffff);
            color: inherit;
            resize: vertical;
        }
        .reply-box {
            padding: 10px 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #cbd5e1);
            background: var(--subtle-background, #f8fafc);
            white-space: pre-wrap;
            line-height: 1.45;
            font-size: 13px;
        }
        .msg {
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12.5px;
        }
        .msg.ok {
            background: light-dark(#dcfce7, #14532d);
            color: light-dark(#166534, #bbf7d0);
        }
        .msg.err {
            background: light-dark(#fee2e2, #450a0a);
            color: light-dark(#991b1b, #fecaca);
        }
        .msg.warn {
            background: light-dark(#fef3c7, #451a03);
            color: light-dark(#92400e, #fde68a);
            border: 1px solid light-dark(#fde68a, #92400e);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
        }
        .msg.info {
            background: light-dark(#eff6ff, #172554);
            color: light-dark(#1d4ed8, #bfdbfe);
            border: 1px solid light-dark(#bfdbfe, #1e40af);
        }
    </style>

    <div class="header-card" ~if="info">
        <div class="header-left">
            <oda-icon :icon="info.icon || 'carbon:machine-learning-model'" icon-size="30"></oda-icon>
            <div>
                <div class="title">{{info.label || info.id}}</div>
                <div class="subtitle">Провайдер: {{providerName}} · Путь: {{info.path}}</div>
            </div>
        </div>
        <div class="toolbar">
            <span class="badge" ~class="info.aiActive ? 'active' : 'inactive'">
                <span class="dot" ~class="info.aiActive ? 'on' : 'off'"></span>
                <span>{{info.aiActive ? 'Активна' : ('Неактивна: ' + (info.aiStatusReason || 'не настроена'))}}</span>
            </span>
            <label class="toolbar" style="cursor:pointer;font-weight:600;">
                <input type="checkbox" :checked="modelEnabled" @change="toggleEnabled($event.target.checked)">
                <span>Включена</span>
            </label>
            <button type="button" class="btn danger" ~if="isLocalModel" @tap="deleteModel()">Удалить с диска</button>
        </div>
    </div>

    <div class="msg warn" ~if="info?.incompatibleOnPlatform">
        <span>
            <b>Несовместимые файлы весов ({{info.sizeGb || 0}} ГБ):</b> {{info.incompatibleReason || 'Веса предназначены для другой ОС.'}}
        </span>
        <button type="button" class="btn danger" :disabled="busyAction" @tap="deleteIncompatible()">
            {{busyAction ? 'Удаление…' : 'Удалить несовместимые файлы'}}
        </button>
    </div>

    <div class="msg ok" ~if="notice">{{notice}}</div>
    <div class="msg err" ~if="error">{{error}}</div>
    <div class="msg info" ~if="provisionBanner">{{provisionBanner}}</div>
    <div class="msg warn" ~if="weightsRepairLine">{{weightsRepairLine}}</div>

    <div class="grid-2" ~if="info">
        <div class="card">
            <div class="section-title">Параметры модели</div>
            <div class="kv-row">
                <span class="kv-label">Идентификатор модели (API):</span>
                <span class="kv-val"><code>{{resolvedModelId}}</code></span>
            </div>
            <div class="kv-row">
                <span class="kv-label">Протокол:</span>
                <span class="kv-val">{{resolvedProtocol}}</span>
            </div>
            <div class="kv-row" ~if="info.weightFormat">
                <span class="kv-label">Формат весов:</span>
                <span class="kv-val"><code>{{info.weightFormat}}</code><span ~if="info.sizeGb"> ({{info.sizeGb}} ГБ)</span></span>
            </div>
            <div class="kv-row" ~if="resolvedProtocol === 'halogen'">
                <span class="kv-label">Встроенный сервер (:8731):</span>
                <span class="kv-val">{{halogenServerLine}}</span>
            </div>
            <div class="kv-row" ~if="resolvedProtocol === 'halogen' && halogenSpeculationLine">
                <span class="kv-label">Спекуляция (MTP):</span>
                <span class="kv-val">{{halogenSpeculationLine}}</span>
            </div>
            <div class="kv-row">
                <span class="kv-label">Размер контекста (maxTokens):</span>
                <span class="kv-val">{{info.maxTokens || info.DATA?.maxTokens || 32768}} токенов</span>
            </div>
            <div class="kv-row">
                <span class="kv-label">Макс. длина ответа (maxOutput):</span>
                <span class="kv-val">{{info.maxOutput || info.DATA?.maxOutput || 8192}} токенов</span>
            </div>
            <div class="kv-row" ~if="resolvedBaseUrl">
                <span class="kv-label">Адрес API (Base URL):</span>
                <span class="kv-val" style="word-break:break-all;"><code>{{resolvedBaseUrl}}</code></span>
            </div>
            <div class="kv-row">
                <span class="kv-label">Возможности:</span>
                <div class="toolbar" style="justify-content:flex-end;">
                    <span class="pill" ~for="capabilities">{{$for.item}}</span>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="section-title">Быстрая проверка ({{testModalityLabel}})</div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'llm'">
                <textarea rows="3" :value="testPrompt" placeholder="Введите тестовый вопрос к модели…" @input="testPrompt = $this.value"></textarea>
            </div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'tts'">
                <textarea rows="2" :value="testTtsText" placeholder="Текст для озвучивания…" @input="testTtsText = $this.value"></textarea>
            </div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'stt'">
                <div style="font-size:12px;opacity:0.8;">Можно загрузить WAV-файл или запустить автоматическую проверку встроенным тестовым аудиосигналом.</div>
                <input type="file" accept="audio/wav,.wav" @change="onSttFileChange($event)">
            </div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'image'">
                <textarea rows="2" :value="testImagePrompt" placeholder="Опишите изображение…" @input="testImagePrompt = $this.value"></textarea>
            </div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'embed'">
                <textarea rows="3" :value="testEmbedInput" placeholder="Строки для векторизации (по одной в строке)…" @input="testEmbedInput = $this.value"></textarea>
            </div>
            <div class="vertical" style="gap:8px;" ~if="testModality === 'rerank'">
                <textarea rows="2" :value="testRerankQuery" placeholder="Поисковый запрос…" @input="testRerankQuery = $this.value"></textarea>
                <textarea rows="3" :value="testRerankDocs" placeholder="Документы (по одному в строке)…" @input="testRerankDocs = $this.value"></textarea>
            </div>
            <div class="toolbar">
                <button type="button" class="btn primary" :disabled="testing" @tap="runTestPrompt()">
                    {{testing ? 'Выполняю…' : testButtonLabel}}
                </button>
                <label class="toolbar" ~if="testModality === 'llm' && hasEffortCap" style="cursor:pointer;font-size:12px;opacity:0.85;">
                    <input type="checkbox" :checked="testNoThinking" @change="testNoThinking = $event.target.checked">
                    <span>Без рассуждений (чистый замер скорости)</span>
                </label>
            </div>
            <div class="toolbar" ~if="testMetricsLine" style="font-size:12px;opacity:0.9;">
                <span class="pill">{{testMetricsLine}}</span>
            </div>
            <div class="reply-box" ~if="testReply">{{testReply}}</div>
            <audio controls ~if="testAudioUrl" :src="testAudioUrl" style="width:100%;"></audio>
            <img ~if="testImageUrl" :src="testImageUrl" style="max-width:100%;max-height:360px;object-fit:contain;border-radius:6px;border:1px solid var(--border-color, #cbd5e1);">
        </div>
    </div>
    `,
    info: null,
    modelEnabled: true,
    testNoThinking: true,
    provisionBanner: '',
    weightsRepair: null,
    testPrompt: 'Привет! Коротко в 3–4 предложениях расскажи, чем ты умеешь помогать в работе с документами, таблицами и кодом.',
    testTtsText: 'Привет! Локальный синтез речи платформы WORK работает.',
    testImagePrompt: 'Минималистичная светлая 3D-иконка офисного здания в стиле современного UI',
    testEmbedInput: 'Учётная система WORK\nОборотно-сальдовая ведомость',
    testRerankQuery: 'остатки на расчётном счёте 51',
    testRerankDocs: 'Счёт 51 «Расчётные счета»: обороты и остатки денежных средств\nДоговор аренды офиса и коммунальные услуги',
    testSttBase64: '',
    testReply: '',
    testAudioUrl: '',
    testImageUrl: '',
    testMetricsLine: '',
    testing: false,
    busyAction: false,
    notice: '',
    error: '',
    get hasEffortCap() {
        const caps = (this.capabilities || []).map(c => String(c).toLowerCase());
        return caps.includes('effort') || caps.includes('thinking');
    },
    get testModality() {
        const mod = String(this.info?.modality || this.info?.DATA?.modality || '').toLowerCase();
        const caps = (this.capabilities || []).map(c => String(c).toLowerCase());
        const id = String(this.info?.id || this.resolvedModelId || '').toLowerCase();
        if (caps.includes('tts') || mod === 'tts' || mod === 'voice')
            return 'tts';
        if (caps.includes('stt') || caps.includes('asr') || mod === 'stt' || mod === 'asr')
            return 'stt';
        if (caps.includes('image') || caps.includes('text-to-image') || mod === 'image')
            return 'image';
        if (caps.includes('rerank') || mod === 'rerank' || id.includes('rerank'))
            return 'rerank';
        if (caps.includes('embeddings') || caps.includes('rag') || mod === 'embed' || mod === 'embedding')
            return 'embed';
        return 'llm';
    },
    get testModalityLabel() {
        const map = {
            llm: 'Чат / LLM',
            tts: 'Синтез речи (TTS)',
            stt: 'Распознавание речи (STT)',
            image: 'Генерация изображений',
            embed: 'Эмбеддинги (RAG)',
            rerank: 'Реранкинг (RAG)',
        };
        return map[this.testModality] || 'Модель';
    },
    get testButtonLabel() {
        const map = {
            llm: 'Отправить запрос',
            tts: 'Озвучить фразу',
            stt: 'Проверить распознавание',
            image: 'Сгенерировать картинку',
            embed: 'Проверить эмбеддинги',
            rerank: 'Проверить реранкинг',
        };
        return map[this.testModality] || 'Проверить';
    },
    get providerName() {
        const parts = String(this.info?.path || this.$item?.path || '').split('/').filter(Boolean);
        return parts[1] || 'MODELS';
    },
    get isLocalModel() {
        return String(this.info?.path || this.$item?.path || '').startsWith('/MODELS/Local/');
    },
    get resolvedModelId() {
        return this.info?.model || this.info?.DATA?.model || this.info?.id || '';
    },
    get resolvedProtocol() {
        return this.info?.protocol || this.info?.DATA?.protocol || (this.isLocalModel ? 'local' : 'openai');
    },
    get resolvedBaseUrl() {
        if (this.resolvedProtocol === 'local')
            return '';
        const raw = this.info?.baseUrl ?? this.info?.DATA?.baseUrl ?? '';
        if (!raw || raw === 'null' || raw === 'undefined')
            return '';
        return String(raw);
    },
    get capabilities() {
        const c = this.info?.capabilities || this.info?.DATA?.capabilities || ['chat', 'stream'];
        return Array.isArray(c) ? c : String(c).split(/[\s,]+/).filter(Boolean);
    },
    get halogenServerLine() {
        const setup = this.info?.engineSetup;
        const prof = setup?.running?.profile || setup?.settings?.profile || 'default';
        const npu = (setup?.running?.npuPrefill || setup?.engine?.npuReady) ? ' · NPU prefill' : '';
        if (this.info?.halogenOnline)
            return `Запущен (профиль ${prof}${npu})`;
        return `Автозапуск по первому запросу (профиль ${prof}${npu})`;
    },
    get weightsRepairLine() {
        const r = this.weightsRepair || this.info?.weightsRepair;
        if (!r)
            return '';
        const reasons = Array.isArray(r.reasons) && r.reasons.length ? ` (${r.reasons.join('; ')})` : '';
        if (r.active)
            return `Автоматическая докачка недостающих файлов модели: ${Number(r.progress) || 0}%${reasons}`;
        if (r.broken && r.status !== 'repaired')
            return `Нарушена структура файлов модели${reasons}. Починка выполняется автоматически при первом обращении.`;
        return '';
    },
    get halogenSpeculationLine() {
        const setup = this.info?.engineSetup;
        const plan = setup?.plan || setup?.running?.speculation || this.info?.speculation;
        if (!plan)
            return '';
        if (plan.summary)
            return plan.summary;
        if (plan.enabled || plan.mode === 'explicit' || plan.mode === 'weights-only') {
            const parts = [
                plan.mode === 'explicit' ? 'MTP включён' : 'MTP (по весам)',
                plan.promptLookup ? 'Prompt Lookup вкл.' : 'Prompt Lookup выкл.',
            ];
            return parts.filter(Boolean).join(' · ');
        }
        return 'Отключена';
    },
    async attached() {
        await this.reload();
    },
    async reload() {
        if (!this.$item)
            return;
        try {
            let inf = null;
            try {
                inf = await this.$item.fetch('trainer_model_info');
            }
            catch {
                inf = await this.$item.fetch('info');
            }
            this.info = inf;
            if (inf?.weightsRepair)
                this.weightsRepair = inf.weightsRepair;
            this.modelEnabled = inf?.enabled !== false && inf?.DATA?.enabled !== false;
            if (inf?.pythonProvision?.active && inf.pythonProvision.stage) {
                this.provisionBanner = inf.pythonProvision.stage + ' (выполняется один раз автоматически)';
            }
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async deleteIncompatible() {
        if (!this.$item || !this.isLocalModel)
            return;
        this.busyAction = true;
        this.error = '';
        this.notice = '';
        try {
            const res = await this.$item.fetch('trainer_delete_incompatible', { modelId: this.$item.id });
            this._refreshTree();
            await this.reload().catch(() => {});
            this.notice = res?.mode === 'deleted_model'
                ? 'Несовместимая модель и её файлы удалены с диска. Откройте /MODELS/Local для установки Windows-версии.'
                : 'Несовместимые файлы (.hgn/.hnpw) удалены с диска.';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            this.busyAction = false;
        }
    },
    _refreshTree() {
        for (const w of [window, window.parent, window.top]) {
            try {
                const wk = w?.WORK;
                if (!wk?.items)
                    continue;
                for (const k of Object.keys(wk.items)) {
                    if (k === '/MODELS' || k.startsWith('/MODELS/')) {
                        const node = wk.items[k];
                        if (node?.[w.R]?.cache)
                            delete node[w.R].cache.items;
                        node?.reset?.();
                    }
                }
            }
            catch { /* ignore */ }
        }
    },
    async toggleEnabled(checked) {
        this.error = '';
        this.notice = '';
        if (!this.$item)
            return;
        try {
            await this.$item.fetch('provider_toggle_model', {
                nodePath: this.$item.path,
                enabled: checked,
            });
            await this.reload();
            this._refreshTree();
            this.notice = checked ? 'Модель включена.' : 'Модель отключена.';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    async deleteModel() {
        if (!this.$item || !this.isLocalModel)
            return;
        this.error = '';
        try {
            await this.$item.fetch('trainer_delete_model', { modelId: this.$item.id });
            this._refreshTree();
            this.notice = 'Модель и её веса удалены с диска.';
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
    },
    onSttFileChange(e) {
        const f = e?.target?.files?.[0];
        if (!f) {
            this.testSttBase64 = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result || '');
            this.testSttBase64 = res.includes(',') ? res.split(',')[1] : '';
        };
        reader.readAsDataURL(f);
    },
    async runTestPrompt() {
        if (!this.$item)
            return;
        const m = this.testModality;
        if (m === 'llm' && !this.testPrompt.trim())
            return;
        this.testing = true;
        this.error = '';
        this.notice = '';
        this.testReply = '';
        this.testAudioUrl = '';
        this.testImageUrl = '';
        this.testMetricsLine = '';
        this.provisionBanner = '';

        const pollTimer = setInterval(async () => {
            try {
                const st = await this.$item?.fetch?.('trainer_provision_status');
                if (st?.python?.active && st.python.stage) {
                    this.provisionBanner = st.python.stage + ' (первичная подготовка среды, выполняется автоматически один раз)';
                }
                else if (st?.buboPrepare?.status === 'running' && st.buboPrepare.message) {
                    this.provisionBanner = st.buboPrepare.message;
                }
                if (st?.weightsRepair)
                    this.weightsRepair = st.weightsRepair;
            }
            catch { /* ignore */ }
        }, 1200);

        try {
            const body = { modality: m };
            if (m === 'llm') {
                body.messages = [{ role: 'user', content: this.testPrompt.trim() }];
                body.maxOutput = 256;
                if (this.hasEffortCap && this.testNoThinking)
                    body.effort = 'off';
            }
            else if (m === 'tts')
                body.text = this.testTtsText.trim();
            else if (m === 'stt' && this.testSttBase64)
                body.audioBase64 = this.testSttBase64;
            else if (m === 'image')
                body.prompt = this.testImagePrompt.trim();
            else if (m === 'embed')
                body.input = this.testEmbedInput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            else if (m === 'rerank') {
                body.query = this.testRerankQuery.trim();
                body.documents = this.testRerankDocs.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            }

            const res = await this.$item.fetch('trainer_test_model', {}, body);
            if (!res?.ok) {
                this.error = res?.error || 'Ошибка проверки модели.';
                return;
            }
            const parts = [];
            if (res.engineStartMs > 500)
                parts.push(`Старт движка: ${(res.engineStartMs / 1000).toFixed(1)} с`);
            if (res.durationMs)
                parts.push(`${res.engineStartMs > 500 ? 'Генерация' : 'Время'}: ${(res.durationMs / 1000).toFixed(2)} с`);
            if (res.ttftMs)
                parts.push(`TTFT: ${(res.ttftMs / 1000).toFixed(2)} с`);
            if (res.tokPerSec)
                parts.push(`Скорость: ${res.tokPerSec} tok/s`);
            if (res.promptTokPerSec)
                parts.push(`Prefill: ${res.promptTokPerSec} tok/s`);
            if (res.mtpAcceptPct != null) {
                parts.push(`MTP: ${res.mtpAcceptPct}%` + (res.mtpTokensPerStep ? ` (${res.mtpTokensPerStep} ток/шаг)` : ''));
            }
            if (res.usage?.completion_tokens)
                parts.push(`Токенов: ${res.usage.prompt_tokens || 0} → ${res.usage.completion_tokens}`);
            if (res.summary && m !== 'llm')
                parts.push(res.summary);
            this.testMetricsLine = parts.join(' · ');

            if (m === 'tts' && res.audioBase64) {
                this.testAudioUrl = 'data:audio/wav;base64,' + res.audioBase64;
            }
            else if (m === 'image' && res.base64) {
                this.testImageUrl = `data:${res.mime || 'image/png'};base64,${res.base64}`;
            }
            else if (m === 'embed') {
                this.testReply = `Получено векторов: ${res.count}, размерность: ${res.dimensions}`;
            }
            else if (m === 'rerank') {
                this.testReply = (res.results || [])
                    .map((r, i) => `${i + 1}. [${((r.relevance_score ?? 0) * 100).toFixed(1)}%] ${r.document || ''}`)
                    .join('\n');
            }
            else {
                this.testReply = String(res.text ?? '');
            }
            await this.reload().catch(() => {});
        }
        catch (e) {
            this.error = String(e?.message || e);
        }
        finally {
            clearInterval(pollTimer);
            this.provisionBanner = '';
            this.testing = false;
        }
    },
}
