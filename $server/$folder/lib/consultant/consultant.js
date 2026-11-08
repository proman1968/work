/**
 * item-consultant — упрощённый ИИ-чат «Консультант» в левой панели проводника (вместо дерева).
 *
 * Формально каждый диалог — стандартный файл задачи `.task`, который сохраняется в личном
 * кабинете пользователя (`/USERS/<uid>`), попадает в личные логи (`<user>/$user/logs/YYYY-MM-DD/*.logs`)
 * и автоматически отображается в ленте пользователя (`form/chat`).
 *
 * Поддерживает:
 *  - произвольные вопросы пользователя из панели «ИИ» в переключателях;
 *  - автоматический вопрос по контексту текущей открытой формы по кнопке «Консультант» на форме;
 *  - продолжение диалога в том же `.task`, переключение к недавним консультациям из личных логов,
 *    создание нового диалога и переход к полной задаче или ленте пользователя.
 */

let _uiLoaded = null;
let _activityOf = null;
let _pathOfWorkHref = null;
let _resolveClientLocation = null;
let _dotStateOfTask = null;
let _VoiceController = null;

function ensureConsultantUI() {
    return _uiLoaded ??= Promise.all([
        import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/feed.js'),
        import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice-ui.js'),
        import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/voice.js').then(m => { _VoiceController = m.VoiceController; }),
        import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/docs.js').then(m => { _activityOf = m.activityOf; }),
        import('/$server/$folder/$file/$task/handlers/pages/form/file/$handler/ui/util.js').then(m => {
            _pathOfWorkHref = m.pathOfWorkHref;
            _resolveClientLocation = m.resolveClientLocation;
            _resolveClientLocation?.(0)?.catch?.(() => {});
        }),
        import('/$server/$folder/lib/dot/dot.js'),
        import('/$server/$folder/lib/dot/dot-math.js').then(m => { _dotStateOfTask = m.dotStateOfTask; }),
        import('/$server/$folder/lib/prompt-bar/prompt-bar.js'),
    ]).catch(e => console.warn('[consultant] load UI:', e));
}

/** Первый лист $ai с поддержкой chat (приоритет провайдеру odant). */
function firstChatLeaf(node) {
    if (!node)
        return null;
    if (!node.items?.length) {
        if (node.type && node.type !== '$ai')
            return null;
        const mod = String(node.modality || node.DATA?.modality || '').toLowerCase();
        if (['image', 'audio', 'embedding', 'video', 'voice', 'asr', 'tts', 'stt'].includes(mod))
            return null;
        const name = String(node.id || node.label || node.DATA?.label || node.path || '').toLowerCase();
        if (/(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(name))
            return null;
        const c = node.capabilities || node.DATA?.capabilities;
        const list = Array.isArray(c) ? c.map(String) : String(c || '').split(/[\s,]+/).filter(Boolean);
        if (list.length && !list.includes('chat'))
            return null;
        return node;
    }
    const sorted = [...node.items].sort((a, b) => (a.id === 'odant' ? -1 : b.id === 'odant' ? 1 : 0));
    for (const child of sorted) {
        const found = firstChatLeaf(child);
        if (found)
            return found;
    }
    return null;
}

const STATUS_LABELS = {
    idle: { label: 'Готов', icon: 'carbon:checkmark' },
    running: { label: 'Думает…', icon: 'spinners:3-dots-scale' },
    waiting: { label: 'Ждёт ответа', icon: 'carbon:help' },
    needs_review: { label: 'Проверка', icon: 'carbon:warning' },
    stopped: { label: 'Остановлен', icon: 'carbon:pause' },
    error: { label: 'Ошибка', icon: 'carbon:warning' },
    limit: { label: 'Лимит шагов', icon: 'carbon:warning' },
};

export const CONSULTANT_PROMPT_CATEGORIES = Object.freeze([
    { id: 'all', label: 'Все', icon: 'icons:apps' },
    { id: 'accounting', label: 'Учёт и отчёты', icon: 'carbon:data-table' },
    { id: 'org', label: 'Оргструктура и права', icon: 'odant:structure' },
    { id: 'docs', label: 'Документы и задачи', icon: 'enterprise:calendar' },
    { id: 'system', label: 'Конструктор и ИИ', icon: 'icons:build' },
]);

export const CONSULTANT_PROMPTS = Object.freeze([
    // Сценарий 1: Оргструктура и рабочие места (BOSS, ROLES, USERS, GUESTS)
    {
        id: 'org-overview',
        category: 'org',
        scenario: 1,
        icon: 'odant:structure',
        label: 'Какие организации, подразделения и модули доступны в системе?',
        prompt: 'Покажи структуру организаций (/ORGANIZATIONS), их подразделений ($structure) и подключённых модулей (/MODULES) в системе.',
    },
    {
        id: 'org-audit-access',
        category: 'org',
        scenario: 1,
        icon: 'icons:supervisor-account',
        label: 'Аудит ролей BOSS и рабочих мест (ROLES / USERS / GUESTS)',
        prompt: 'Проведи аудит настроек безопасности по организациям и подразделениям: кто назначен руководителем (BOSS), какие рабочие места (ROLES) созданы, где назначены групповые субъекты USERS и GUESTS и какие ссылки LINKS им выданы.',
    },
    {
        id: 'org-setup-unit',
        category: 'org',
        scenario: 1,
        icon: 'icons:add',
        label: 'Развернуть подразделение и настроить рабочие места',
        prompt: 'Помоги создать новое подразделение в организации, настроить рабочие места (ROLES), назначить сотрудников и привязать ссылки LINKS на справочники, операции и счета.',
    },
    // Сценарий 2: Справочники, импорт и качество данных
    {
        id: 'cat-summary',
        category: 'accounting',
        scenario: 2,
        icon: 'carbon:data-table',
        label: 'Сводка по справочникам и операциям учёта',
        prompt: 'Покажи сводку по основным справочникам и последним операциям в учёте.',
    },
    {
        id: 'cat-quality',
        category: 'accounting',
        scenario: 2,
        icon: 'carbon:checkmark-outline',
        label: 'Проверить справочники на дубликаты и пустые реквизиты',
        prompt: 'Проверь основные справочники организации (Контрагенты, Номенклатура, Сотрудники, Договоры) на дубликаты, пустые обязательные поля и ошибки заполнения.',
    },
    // Сценарий 3: Хозяйственные операции, проведение и сторно
    {
        id: 'op-register',
        category: 'accounting',
        scenario: 3,
        icon: 'carbon:task-complete',
        label: 'Зарегистрировать и провести хозяйственную операцию',
        prompt: 'Помоги зарегистрировать новую хозяйственную операцию: покажи доступные классы операций в OPERATIONS, их обязательные поля и аналитики.',
    },
    // Сценарий 4: 4-шаговый анализ по счетам (Ведомость -> Обороты -> Анализ -> Проводки)
    {
        id: 'acc-sheet-balance',
        category: 'accounting',
        scenario: 4,
        icon: 'carbon:report',
        label: 'Оборотно-сальдовая ведомость и проверка баланса',
        prompt: 'Сформируй оборотно-сальдовую ведомость (report kind=sheet) по регистру учёта за активный период, покажи остатки и обороты по счетам и проверь сходимость баланса.',
    },
    {
        id: 'acc-turnovers',
        category: 'accounting',
        scenario: 4,
        icon: 'carbon:analytics',
        label: 'Анализ оборотов и задолженности по субконто (60, 62, 51, 41)',
        prompt: 'Проанализируй обороты и конечное сальдо по ключевым счетам (51 Расчётные счета, 60 Поставщики, 62 Покупатели, 41 Товары) в разрезе аналитик.',
    },
    // Сценарий 5: Коллаборация, поручения и офисные документы
    {
        id: 'docs-feed-summary',
        category: 'docs',
        scenario: 5,
        icon: 'icons:question-answer',
        label: 'Сводка событий, сообщений и задач в ленте',
        prompt: 'Сделай сводку последних событий, сообщений, файлов и проведённых операций по ленте за последние дни.',
    },
    {
        id: 'docs-office-export',
        category: 'docs',
        scenario: 5,
        icon: 'files-color:s-xlsx',
        label: 'Сформировать отчёт в Excel (.xlsx) или Word (.docx)',
        prompt: 'Сформируй управленческий отчёт или выгрузку в таблицу Excel (.xlsx) либо документ Word (.docx) по данным учёта организации.',
    },
    {
        id: 'docs-delegate-task',
        category: 'docs',
        scenario: 5,
        icon: 'carbon:send-alt',
        label: 'Поставить поручение сотруднику со сроком исполнения',
        prompt: 'Помоги оформить и отправить поручение сотруднику через ленту подразделения с указанием получателя и срока исполнения (deadline).',
    },
    // Сценарий 6 и 7: Конструктор классов, БД, локальный ИИ и федерация
    {
        id: 'sys-builder-guide',
        category: 'system',
        scenario: 6,
        icon: 'icons:build',
        label: 'Как добавить поле/аналитику в класс и настроить форму объекта?',
        prompt: 'Объясни и покажи на примере текущей конфигурации, как добавить новое поле или аналитику в класс (METADATA.FIELDS / ANALYTICS) и настроить раскладку карточки объекта в 12-колоночной сетке.',
    },
    {
        id: 'sys-local-ai',
        category: 'system',
        scenario: 7,
        icon: 'carbon:machine-learning-model',
        label: 'Модели ИИ и дообучение на данных организации (/MODELS)',
        prompt: 'Какие модели ИИ сейчас подключены в /MODELS (включая /MODELS/Local и /MODELS/Halogen) и как собрать датасет организации для локального дообучения LoRA / SFT / GRPO?',
    },
]);

export default {
    imports: 'oda//button, oda//icon',
};

ODA({
    is: 'item-consultant',
    imports: 'oda//button, oda//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --flex;
                width: 100%;
                max-width: 100%;
                min-width: 0;
                min-height: 0;
                box-sizing: border-box;
                overflow: hidden;
                background: var(--content-background);
                color: var(--content-color);
                font-size: 14px;
                position: relative;
            }
            .cons-header {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--content-background);
                min-height: 40px;
                box-sizing: border-box;
            }
            .cons-title {
                font-weight: 700;
                font-size: 14px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .status-chip {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                padding: 2px 7px;
                border-radius: 999px;
                background: var(--subtle-background);
                border: 1px solid var(--subtle-border);
                white-space: nowrap;
            }
            .status-chip[running] {
                background: var(--accent-soft);
                color: var(--accent-color);
                border-color: transparent;
            }
            .status-chip[waiting] {
                background: var(--warning-soft);
                border-color: transparent;
            }
            .status-chip[bad] {
                background: var(--error-soft);
                color: var(--error-color);
                border-color: transparent;
            }
            .dialog-btn {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                padding: 0;
                border: none;
                background: transparent;
                color: inherit;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: .8;
            }
            .dialog-btn:hover {
                background: var(--accent-soft);
                opacity: 1;
            }
            .dialog-btn[on] {
                background: var(--accent-soft);
                color: var(--accent-color);
                opacity: 1;
            }
            .dialog-btn work-voice-bars {
                width: 16px;
                height: 16px;
            }
            .ctx-bar {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 5px 10px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                font-size: 12px;
                min-width: 0;
            }
            .ctx-label {
                @apply --flex;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--muted-color);
            }
            .ctx-label b {
                color: var(--content-color);
                font-weight: 600;
            }
            .ctx-ask-btn {
                @apply --no-flex;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                border: 1px solid var(--accent-color);
                background: var(--accent-soft);
                color: var(--accent-color);
                cursor: pointer;
                white-space: nowrap;
            }
            .ctx-ask-btn:hover {
                background: var(--accent-color);
                color: var(--accent-back);
            }
            .history-panel {
                @apply --vertical;
                gap: 4px;
                padding: 8px 10px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                max-height: 220px;
                overflow-y: auto;
            }
            .history-head {
                @apply --horizontal;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .04em;
                color: var(--muted-color);
                margin-bottom: 2px;
            }
            .history-row {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 5px 8px;
                border-radius: 6px;
                background: var(--content-background);
                border: 1px solid var(--subtle-border);
                cursor: pointer;
                font-size: 12px;
                min-width: 0;
            }
            .history-row:hover, .history-row[active] {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
            .history-row-title {
                @apply --flex;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-weight: 500;
            }
            .history-row-time {
                @apply --no-flex;
                font-size: 10px;
                color: var(--muted-color);
            }
            .scroller {
                @apply --vertical;
                @apply --flex;
                overflow-y: auto;
                overflow-x: hidden;
                min-height: 0;
                padding: 10px;
            }
            .col {
                @apply --vertical;
                gap: 10px;
                width: 100%;
                min-height: min-content;
                box-sizing: border-box;
            }
            .welcome {
                @apply --vertical;
                gap: 10px;
                padding: 14px 12px;
                border-radius: 10px;
                background: var(--subtle-background);
                border: 1px solid var(--subtle-border);
                margin: auto 0;
            }
            .welcome-title {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 15px;
            }
            .welcome-text {
                font-size: 13px;
                line-height: 1.45;
                color: var(--muted-color);
            }
            .quick-chips {
                @apply --vertical;
                gap: 6px;
            }
            .quick-chip {
                @apply --horizontal;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border-radius: 8px;
                border: 1px solid var(--subtle-border);
                background: var(--content-background);
                color: var(--content-color);
                font-size: 12px;
                text-align: left;
                cursor: pointer;
            }
            .quick-chip:hover {
                border-color: var(--accent-color);
                background: var(--accent-soft);
            }
            .prompt-cats {
                @apply --horizontal;
                flex-wrap: wrap;
                gap: 4px;
                margin-bottom: 2px;
            }
            .prompt-cat-pill {
                @apply --horizontal;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                border: 1px solid var(--subtle-border);
                background: var(--content-background);
                color: var(--muted-color);
                cursor: pointer;
                white-space: nowrap;
            }
            .prompt-cat-pill:hover {
                border-color: var(--accent-color);
                color: var(--content-color);
            }
            .prompt-cat-pill[active] {
                border-color: var(--accent-color);
                background: var(--accent-soft);
                color: var(--accent-color);
            }
            .prompts-panel {
                @apply --vertical;
                gap: 6px;
                padding: 8px 10px;
                border-bottom: 1px solid var(--subtle-border);
                background: var(--subtle-background);
                max-height: 280px;
                overflow-y: auto;
            }
            .working {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: var(--muted-color);
                padding: 6px 2px;
            }
            .bottom {
                @apply --vertical;
                @apply --no-flex;
                padding: 6px 8px 8px;
                border-top: 1px solid var(--subtle-border);
                background: var(--content-background);
                gap: 4px;
                position: relative;
            }
            .down {
                position: absolute;
                top: -42px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 5;
                width: 34px;
                height: 34px;
                border-radius: 50%;
                background: var(--content-background);
                color: var(--content-color);
                border: 1px solid var(--subtle-border);
                box-shadow: 0 2px 8px var(--shadow-color);
            }
            .down.attn {
                width: auto;
                padding: 0 14px 0 10px;
                border-radius: 999px;
                gap: 6px;
                font-size: 12px;
                background: var(--accent-color);
                color: var(--accent-back);
                border-color: transparent;
            }
            .toast {
                position: absolute;
                left: 12px;
                right: 12px;
                bottom: 84px;
                z-index: 10;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 12px;
                background: var(--content-background);
                border: 1px solid var(--subtle-border);
                box-shadow: 0 2px 8px var(--shadow-color);
                text-align: center;
            }
        </style>

        <div class="cons-header" no-flex>
            <oda-icon ~if="!uiReady" no-flex icon="bootstrap:robot" :icon-size="20"></oda-icon>
            <work-dot ~if="uiReady" no-flex :size="22" :state="dotState" :title="statusMeta.label"></work-dot>
            <span class="cons-title" flex title="ИИ-чат «Консультант»">Консультант</span>
            <span class="status-chip" no-flex :running="status === 'running'" :waiting="status === 'waiting'" :bad="status === 'error' || status === 'limit' || status === 'needs_review'">
                <oda-icon :icon="statusMeta.icon" :icon-size="11"></oda-icon>{{statusMeta.label}}
            </span>
            <button class="dialog-btn" no-flex ~if="uiReady && canVoice" :on="voiceOn" :title="voiceOn ? 'Выключить живой голосовой диалог' : 'Живой голосовой диалог (с взаимным перебиванием)'" :aria-pressed="voiceOn ? 'true' : 'false'" @tap="toggleVoice()">
                <work-voice-bars :on="voiceOn"></work-voice-bars>
            </button>
            <oda-button no-flex icon="icons:lightbulb" :icon-size="16" title="Типовые сценарии и промпты" @tap="togglePrompts"></oda-button>
            <oda-button no-flex icon="carbon:recently-viewed" :icon-size="16" title="Мои консультации (из личных логов)" @tap="toggleHistory"></oda-button>
            <oda-button no-flex icon="icons:question-answer" :icon-size="16" title="Открыть ленту пользователя" @tap="openUserFeed"></oda-button>
            <oda-button no-flex ~if="taskItem" icon="box:i-expand" :icon-size="15" title="Открыть задачу полностью" @tap="openFullTask"></oda-button>
            <oda-button no-flex icon="carbon:add" :icon-size="18" title="Новый вопрос (новая задача)" @tap="startNewChat"></oda-button>
        </div>

        <div class="ctx-bar" no-flex ~if="activeFormSummary">
            <oda-icon no-flex icon="icons:dashboard" :icon-size="14"></oda-icon>
            <span class="ctx-label" :title="activeFormSummary.path">Форма: <b>{{activeFormSummary.label}}</b></span>
            <button class="ctx-ask-btn" @tap="askCurrentForm" title="Задать Консультанту вопрос по открытой форме">Спросить по форме</button>
        </div>

        <div class="prompts-panel" no-flex ~if="showPrompts && hasMessages">
            <div class="history-head">
                <span>Типовые сценарии и промпты</span>
                <oda-button icon="carbon:close" :icon-size="14" @tap="showPrompts = false"></oda-button>
            </div>
            <div class="prompt-cats">
                <button class="prompt-cat-pill" ~for="promptCategories" :active="promptCategory === $for.item.id" @tap="promptCategory = $for.item.id">
                    <oda-icon no-flex :icon="$for.item.icon" :icon-size="12"></oda-icon>
                    <span>{{$for.item.label}}</span>
                </button>
            </div>
            <div class="quick-chips">
                <button class="quick-chip" ~for="filteredPrompts" @tap="sendQuickQuestion($for.item.prompt)">
                    <oda-icon no-flex :icon="$for.item.icon" :icon-size="15"></oda-icon>
                    <span>{{$for.item.label}}</span>
                </button>
            </div>
        </div>

        <div class="history-panel" no-flex ~if="showHistory">
            <div class="history-head">
                <span>Личные консультации ({{recentTasks.length}})</span>
                <oda-button icon="carbon:close" :icon-size="14" @tap="showHistory = false"></oda-button>
            </div>
            <div ~if="!recentTasks.length" style="font-size: 12px; color: var(--muted-color); padding: 4px 0;">Консультаций в личных логах пока нет.</div>
            <div class="history-row" ~for="recentTasks" :active="taskItem?.path === $for.item.path" @tap="selectHistoryTask($for.item)">
                <oda-icon no-flex icon="bootstrap:robot" :icon-size="14"></oda-icon>
                <span class="history-row-title" :title="$for.item.title">{{$for.item.title}}</span>
                <span class="history-row-time">{{$for.item.timeText}}</span>
            </div>
        </div>

        <div class="scroller" flex @scroll="onScroll">
            <div class="col">
                <div class="welcome" ~if="!hasMessages">
                    <div class="welcome-title">
                        <oda-icon icon="bootstrap:robot" :icon-size="22"></oda-icon>
                        <span>ИИ-чат «Консультант»</span>
                    </div>
                    <div class="welcome-text">
                        Задайте вопрос по работе в системе, структуре данных или учёту, выберите один из типовых сценариев ниже либо нажмите кнопку <b>«?»</b> в шапке открытой формы. Все диалоги сохраняются как задачи в ваших личных логах.
                    </div>
                    <div class="quick-chips" ~if="activeFormSummary">
                        <button class="quick-chip" @tap="askCurrentForm">
                            <oda-icon no-flex icon="icons:dashboard" :icon-size="15"></oda-icon>
                            <span>Что сейчас открыто в форме «{{activeFormSummary.label}}»?</span>
                        </button>
                        <button class="quick-chip" ~if="contextSecondaryPrompt" @tap="sendQuickQuestion(contextSecondaryPrompt.prompt)">
                            <oda-icon no-flex :icon="contextSecondaryPrompt.icon" :icon-size="15"></oda-icon>
                            <span>{{contextSecondaryPrompt.label}}</span>
                        </button>
                    </div>
                    <div class="prompt-cats">
                        <button class="prompt-cat-pill" ~for="promptCategories" :active="promptCategory === $for.item.id" @tap="promptCategory = $for.item.id">
                            <oda-icon no-flex :icon="$for.item.icon" :icon-size="12"></oda-icon>
                            <span>{{$for.item.label}}</span>
                        </button>
                    </div>
                    <div class="quick-chips">
                        <button class="quick-chip" ~for="filteredPrompts" @tap="sendQuickQuestion($for.item.prompt)">
                            <oda-icon no-flex :icon="$for.item.icon" :icon-size="15"></oda-icon>
                            <span>{{$for.item.label}}</span>
                        </button>
                    </div>
                </div>

                <microchat-feed ~if="uiReady && hasMessages" :items="feedItems"></microchat-feed>

                <div class="working" ~if="activity">
                    <oda-icon icon="spinners:3-dots-scale" :icon-size="15"></oda-icon>
                    <span>{{activity.text}}</span>
                </div>
            </div>
        </div>

        <div class="bottom" ~if="uiReady">
            <oda-button class="down" ~if="hasMessages && !pinned && !needsHuman" icon="carbon:arrow-down" :icon-size="18" title="К последнему" @tap="toBottom"></oda-button>
            <oda-button class="down attn" ~if="hasMessages && !pinned && needsHuman" accent-invert icon="carbon:arrow-down" :icon-size="16" label="Агент ждёт вас" title="Перейти к вопросу или разрешению" @tap="toBottom"></oda-button>
            <microchat-voice ~if="voiceOn"></microchat-voice>
            <work-prompt-bar ai ::value ::files :pending="busy" :placeholder="placeholderText"
                ::model
                @model-changed.stop="onModelChanged"
                @send="send" @stop="stop"></work-prompt-bar>
        </div>

        <div class="toast" ~if="toastText">{{toastText}}</div>
    `,
    label: 'ИИ',
    icon: 'bootstrap:robot',
    __microchatShell: true,
    uiReady: false,
    $item: null,
    taskItem: null,
    data: null,
    streams: {},
    status: 'idle',
    optimistic: null,
    groupOpen: {},
    pinned: true,
    value: '',
    files: [],
    model: { $def: '', $save: true },
    toastText: '',
    showHistory: false,
    showPrompts: false,
    promptCategory: 'all',
    recentTasks: [],
    activeFormContext: null,
    activeFormSummary: null,
    _sending: false,
    voiceOn: {
        $def: false,
        set(v) {
            this.async(() => this._bindVoiceBars(v ? this._voice : null));
        },
    },

    get promptCategories() {
        return CONSULTANT_PROMPT_CATEGORIES;
    },
    get filteredPrompts() {
        const cat = this.promptCategory || 'all';
        if (cat === 'all')
            return CONSULTANT_PROMPTS;
        return CONSULTANT_PROMPTS.filter(p => p.category === cat);
    },
    get contextSecondaryPrompt() {
        const ctx = this.activeFormSummary;
        if (!ctx?.path)
            return null;
        const t = ctx.type || '';
        const lbl = ctx.label || ctx.path;
        if (t === '$account' || t === '$register') {
            return {
                icon: 'carbon:analytics',
                label: `Проанализировать обороты и сальдо «${lbl}»`,
                prompt: `Проанализируй обороты, аналитики и конечное сальдо по «${lbl}» (${ctx.path}) за активный период.`,
            };
        }
        if (t === '$catalog' || t === '$virtual') {
            return {
                icon: 'carbon:checkmark-outline',
                label: `Проверить качество данных в «${lbl}»`,
                prompt: `Проверь справочник «${lbl}» (${ctx.path}) на дубликаты, пустые обязательные поля и покажи статистику объектов.`,
            };
        }
        if (t === '$operation') {
            return {
                icon: 'carbon:task-complete',
                label: `Помочь создать или проверить операцию «${lbl}»`,
                prompt: `Покажи схему операции «${lbl}» (${ctx.path}), её проводки и последние зарегистрированные документы.`,
            };
        }
        if (t === '$structure' || t === '$base') {
            return {
                icon: 'icons:supervisor-account',
                label: `Проверить роли BOSS, рабочие места и ленту «${lbl}»`,
                prompt: `Покажи настройки ролей BOSS, рабочих мест (ROLES / USERS / GUESTS), привязанных ссылок LINKS и последние события в «${lbl}» (${ctx.path}).`,
            };
        }
        if (t === '$ai' || t === '$provider') {
            return {
                icon: 'carbon:machine-learning-model',
                label: `Параметры модели и локальное дообучение «${lbl}»`,
                prompt: `Опиши возможности модели/провайдера «${lbl}» (${ctx.path}) и параметры локального инференса и дообучения.`,
            };
        }
        return null;
    },
    get canVoice() {
        return !!(navigator.mediaDevices?.getUserMedia || window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    get statusMeta() {
        return STATUS_LABELS[this.status] || STATUS_LABELS.idle;
    },
    get dotState() {
        return _dotStateOfTask
            ? _dotStateOfTask({ status: this.status, waitingKind: this.data?.waiting?.kind })
            : (this.status === 'running' ? 'busy' : 'idle');
    },
    get busy() {
        return this.status === 'running' || this._sending;
    },
    get items() {
        return this.data?.items || [];
    },
    get starting() {
        const d = this.data, count = this.items.length, optimistic = this.optimistic, status = this.status;
        return !!d && !count && !optimistic && status === 'idle' && !!(d.prompt || d.name) && Date.now() - (+d.created || 0) < 20000;
    },
    get feedItems() {
        const o = this.optimistic;
        if (this.starting) {
            return [{ id: 'starting', type: 'user', content: this.data.prompt || this.data.name, time: +this.data.created || Date.now() }];
        }
        const queue = this.data?.queue || [];
        const list = (!o || this.items.some(i => i.type === 'user' && i.content === o.content && i.time >= o.time - 5000))
            ? this.items
            : [...this.items, o];
        return queue.length ? [...list, ...queue] : list;
    },
    get hasMessages() {
        return this.feedItems.length > 0;
    },
    get needsHuman() {
        return this.status === 'waiting';
    },
    get activity() {
        if (this._sending && !this.feedItems.length)
            return { kind: 'start', text: 'Создаю задачу Консультанту…' };
        if (this.starting)
            return { kind: 'start', text: 'Запускаю Консультанта…' };
        if (_activityOf) {
            return _activityOf({
                status: this.status,
                items: this.items,
                streams: this.streams,
                nowMs: this._clock || Date.now(),
                lastDeltaMs: this._lastDelta,
            });
        }
        return this.status === 'running' ? { kind: 'work', text: 'Консультант работает…' } : null;
    },
    get placeholderText() {
        if (this.status === 'waiting')
            return 'Ответьте Консультанту…';
        return this.hasMessages ? 'Уточнить у Консультанта…' : 'Задайте вопрос Консультанту…';
    },

    attached() {
        this._mdLinkHandler ??= e => {
            const { href, ctrl } = e.detail || {};
            const path = !ctrl && _pathOfWorkHref?.(href);
            if (!path)
                return;
            e.preventDefault();
            this.openWorkPath(path);
        };
        this.addEventListener('md-link', this._mdLinkHandler);
        this._activityTimer ??= setInterval(() => {
            if (this.status === 'running')
                this._clock = Date.now();
        }, 1000);
        this._ro ??= new ResizeObserver(() => this._stick());
        this.async(() => {
            const col = this.$('.col');
            if (col)
                this._ro.observe(col);
        }, 50);
    },
    detached() {
        this._unbindTask();
        this._voice?.disable();
        this.voiceOn = false;
        this._bindVoiceBars(null);
        this._ro?.disconnect();
        if (this._mdLinkHandler)
            this.removeEventListener('md-link', this._mdLinkHandler);
        clearInterval(this._activityTimer);
        this._activityTimer = null;
    },

    async toggleVoice(on) {
        await ensureConsultantUI();
        this.uiReady = true;
        const want = typeof on === 'boolean' ? on : !this.voiceOn;
        if (!want) {
            this._voice?.disable();
            this.voiceOn = false;
            return;
        }
        if (!_VoiceController)
            return;
        this._voice ??= new _VoiceController(this);
        this.voiceOn = await this._voice.enable();
    },

    _bindVoiceBars(v) {
        for (const [k, fn] of Object.entries(this._vOn || {}))
            this._vRef?.removeEventListener(k, fn);
        this._vOn = this._vRef = null;
        const setLv = lv => {
            for (const el of this.$$('work-voice-bars') || [])
                el?.setLevel?.(lv);
            this.$('work-prompt-bar')?.setDialogLevel?.(lv);
        };
        setLv(0);
        if (!v)
            return;
        let user = 0, speech = 0, state = v.state;
        const push = () => setLv(state === 'speaking' ? speech : user);
        this._vRef = v;
        this._vOn = {
            level: e => { user = e.detail; push(); },
            speechlevel: e => { speech = e.detail; push(); },
            state: e => { state = e.detail; if (state !== 'speaking') speech = 0; if (state !== 'hearing' && state !== 'listening') user = 0; push(); },
        };
        for (const [k, fn] of Object.entries(this._vOn))
            v.addEventListener(k, fn);
    },

    async onShow() {
        await ensureConsultantUI();
        this.uiReady = true;
        this._hydrateModel();
        this.refreshFormContext();
        this.async(() => {
            this.$('work-prompt-bar')?.focusInput?.();
        }, 80);
    },

    refreshFormContext() {
        const form = this._findActiveWorkForm();
        if (form?.buildConsultantContext) {
            this.activeFormContext = form.buildConsultantContext();
            this.activeFormSummary = this.activeFormContext;
        }
        else if (form?.$item) {
            this.activeFormSummary = {
                path: form.$item.short || form.$item.path || '',
                label: form.$item.DATA?.label || form.$item.label || form.$item.id || '',
            };
        }
    },

    _findActiveWorkForm() {
        try {
            const exp = window.top?.explorer || window.explorer;
            if (exp) {
                const iframe = (exp.$$?.('iframe') || []).find(f => f.src === exp.focusedPage);
                const wf = iframe?.contentWindow?.document?.querySelector?.('work-form')
                    || iframe?.contentWindow?.document?.querySelector?.('pages-form')?.$?.('work-form');
                if (wf)
                    return wf;
            }
            const localWf = document.querySelector?.('work-form')
                || document.querySelector?.('pages-form')?.$?.('work-form');
            if (localWf)
                return localWf;
        }
        catch { /* ignore cross-frame */ }
        return null;
    },

    async _hydrateModel() {
        try {
            const uid = globalThis.WORK?.uid || globalThis.WORK?.USER?.id || globalThis.WORK?.credentials?.uid || 'default';
            const userModel = localStorage.getItem(`work.user.ai:${uid}:model`)
                || localStorage.getItem('work.user.ai:default:model')
                || '';
            if (userModel && !/(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(userModel)) {
                this.model = userModel;
                return;
            }
        }
        catch { /* ignore */ }
        if (this.model && !/(flux|sdxl|stable-?diffusion|z-image|embedding|bge-|rerank|whisper|\basr\b|\btts\b|\bstt\b|voice|kokoro|musicgen|wan2|ltx-video)/i.test(this.model))
            return;
        try {
            const aiRoot = await WORK.get_item('/MODELS', 'info', { deep: 2 });
            if (!aiRoot)
                return;
            const leaf = firstChatLeaf(aiRoot);
            if (leaf?.path)
                this.model = leaf.path;
        }
        catch { /* ignore */ }
    },

    /** Личный кабинет пользователя (/USERS/<uid>), куда пишутся личные логи и лента пользователя. */
    async _getPersonalCabinet() {
        if (WORK.USER)
            return WORK.USER;
        if (WORK.uid) {
            const u = await WORK.get_$user(WORK.uid);
            if (u) {
                WORK.USER = u;
                return u;
            }
        }
        try {
            const credUid = WORK.credentials?.uid || ODA.LocalStorage.create('work-secure')?.getItem('credentials')?.uid;
            if (credUid) {
                const u = await WORK.get_$user(credUid);
                if (u)
                    return u;
            }
        }
        catch { /* ignore */ }
        try {
            const usersRoot = await WORK.get_item('/USERS');
            const items = await usersRoot?.items;
            if (Array.isArray(items) && items.length) {
                const found = items.find(u => u.id === 'CA4E097FF6C1D387') || items[0];
                if (found?.save_file)
                    return found;
                if (found?.id) {
                    const u = await WORK.get_$user(found.id);
                    if (u)
                        return u;
                }
            }
        }
        catch { /* ignore */ }
        return this.$item || await WORK.get_item('/');
    },

    onModelChanged(e) {
        const v = e?.detail?.value;
        if (!v)
            return;
        this.model = v;
        try {
            const uid = globalThis.WORK?.uid || globalThis.WORK?.USER?.id || globalThis.WORK?.credentials?.uid || 'default';
            localStorage.setItem(`work.user.ai:${uid}:model`, v);
            localStorage.setItem('work.user.ai:default:model', v);
        }
        catch { /* ignore */ }
        if (this.taskItem)
            this.taskItem.fetch('configure', { model: v }).catch(() => {});
    },

    startNewChat() {
        this._unbindTask();
        this.taskItem = null;
        this.data = null;
        this.streams = {};
        this.optimistic = null;
        this.status = 'idle';
        this.groupOpen = {};
        this.showHistory = false;
        this.showPrompts = false;
        this.refreshFormContext();
        this.async(() => this.$('work-prompt-bar')?.focusInput?.(), 50);
    },

    togglePrompts() {
        if (!this.hasMessages) {
            this.showHistory = false;
            return;
        }
        this.showPrompts = !this.showPrompts;
        if (this.showPrompts)
            this.showHistory = false;
    },

    async sendQuickQuestion(text) {
        this.showPrompts = false;
        this.value = text;
        await this.send();
    },

    async askCurrentForm() {
        this.refreshFormContext();
        const ctx = this.activeFormSummary;
        if (ctx)
            await this.askAboutContext(ctx);
    },

    /**
     * Автоматически задать Консультанту вопрос касательно того, что сейчас открыто в форме.
     * Создаёт новую задачу `.task` в личных логах пользователя и отображает её в панели Консультанта.
     */
    async askAboutContext(ctx = {}) {
        await ensureConsultantUI();
        this.uiReady = true;
        if (typeof ctx === 'string')
            ctx = { prompt: ctx, title: ctx };
        this.activeFormContext = ctx;
        const prompt = String(ctx.prompt || '').trim()
            || `Проконсультируй по открытой форме «${ctx.label || ctx.path || ''}» (${ctx.path || '/'}). Объясни назначение, какие данные здесь представлены и какие действия доступны.`;
        const title = String(ctx.title || ('Консультация: ' + (ctx.label || ctx.path || 'Форма'))).trim();

        // Если уже открыта задача ровно по этому же запросу и она ещё выполняется — не дублируем
        if (this.taskItem && this.busy && this._lastContextKey && this._lastContextKey === (ctx.path + ':' + (ctx.viewId || ''))) {
            return this.taskItem;
        }
        this._lastContextKey = (ctx.path || '') + ':' + (ctx.viewId || '');
        this.startNewChat();
        this.activeFormContext = ctx;
        this.activeFormSummary = ctx;
        return this._submitQuestion({ text: prompt, title, contextPath: ctx.path || '' });
    },

    async send() {
        if (this._sending && !this.taskItem)
            return;
        await ensureConsultantUI();
        this.uiReady = true;
        const bar = this.$('work-prompt-bar');
        const files = bar?.files ?? this.files ?? [];
        const text = String(this.value ?? '').trim();
        if (!text && !files.length)
            return;
        this.value = '';
        this.files = [];
        let spokenText;
        if (this._voice?.speaker?.busy) {
            spokenText = this._voice.speaker.spokenText;
            this._voice.speaker.cancel('barge');
        }
        await this._submitQuestion({ text, files, voice: !!this.voiceOn, interrupt: true, spokenText });
        this.async(() => bar?.focusInput?.(), 50);
    },

    async sendVoiceText(text, { voice = true, interrupt = true, spokenText } = {}) {
        text = String(text ?? '').trim();
        if (!text)
            return null;
        return this._submitQuestion({ text, voice, interrupt, spokenText });
    },

    async _submitQuestion({ text, title = '', files = [], contextPath = '', voice = false, interrupt = false, spokenText } = {}) {
        if (this._sending && !this.taskItem)
            return null;
        this._sending = true;
        try {
            await ensureConsultantUI();
            this.uiReady = true;
            await this._hydrateModel();
            const cabinet = await this._getPersonalCabinet();
            const location = await _resolveClientLocation?.(200)?.catch?.(() => null);
            const attachments = [];

            // Если в текущем диалоге уже есть открытая задача .task — сохраняем вложения в папку этого таска и отправляем реплику
            if (this.taskItem) {
                if (files.length && typeof this.taskItem.save_file === 'function') {
                    for (const file of files) {
                        if (!(file instanceof File))
                            continue;
                        const up = await this.taskItem.save_file(file, { encoding: 'utf-8', role: 'USER', ignore_save_logs: true, mainContext: this.taskItem.path });
                        const p = up?.logFullPath || up?.path;
                        if (p)
                            attachments.push({ path: p.startsWith('/') ? p : '/' + p, name: file.name });
                    }
                }
                this.optimisticUser(text, attachments, voice);
                const payload = JSON.stringify({
                    prompt: text,
                    attachments,
                    ...(location ? { location, ...(location.tz ? { tz: location.tz } : {}) } : {}),
                    ...(voice ? { voice: true } : {}),
                    ...(interrupt ? { interrupt: true } : {}),
                    ...(spokenText !== undefined ? { spokenText } : {}),
                });
                const res = await this.taskItem.fetch('prompt', {}, payload);
                if (res?.busy)
                    this.toast(res.error || 'Консультант занят');
                return this.taskItem;
            }

            // Иначе создаём новый .task в личном кабинете пользователя (попадает в личные логи и ленту пользователя)
            this.optimisticUser(text, attachments, voice);
            const rawTitle = title || text.split('\n')[0] || (files || []).map(f => f?.name).filter(Boolean).join(', ') || 'Консультация';
            const safeName = String(rawTitle).replace(/[<>:"/\\|?*\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Консультация';
            const body = {
                name: safeName,
                title: safeName,
                prompt: text,
                created: Date.now(),
                items: [],
                ...(location ? { location, ...(location.tz ? { tz: location.tz } : {}) } : {}),
                ...(voice ? { voice: true } : {}),
            };
            if (this.model)
                body.model = this.model;
            if (contextPath)
                body.contextPath = contextPath;

            const role = (WORK.preferredRole && ['BOSS', 'USER'].includes(WORK.preferredRole))
                ? WORK.preferredRole
                : 'USER';
            const saveParams = {
                encoding: 'utf-8',
                role,
                sender: WORK.uid || cabinet?.id || '',
                prompt: text,
                ...(location ? { location: JSON.stringify(location), ...(location.tz ? { tz: location.tz } : {}) } : {}),
                ...(voice ? { voice: true } : {}),
            };
            if (files.length)
                saveParams.skip_file_handler = true;

            const taskFileObj = new File([JSON.stringify(body, null, 2)], safeName + '.task', { type: 'application/json' });
            const log = await cabinet.save_file(taskFileObj, saveParams);
            let path = log?.DATA?.logFullPath || log?.DATA?.path || log?.logFullPath || log?.path || '';
            if (path && typeof path.then === 'function')
                path = await path;
            path = typeof path === 'string' ? (path.startsWith('/') ? path : '/' + path) : '';
            if (!path)
                throw new Error('Сервер не вернул путь созданной задачи');

            const createdTask = await WORK.get_item(path);
            if (createdTask && files.length) {
                const targetHolder = typeof createdTask.save_file === 'function' ? createdTask : cabinet;
                for (const file of files) {
                    if (!(file instanceof File))
                        continue;
                    const up = await targetHolder.save_file(file, { encoding: 'utf-8', role, ignore_save_logs: true, mainContext: path });
                    const p = up?.logFullPath || up?.path;
                    if (p)
                        attachments.push({ path: p.startsWith('/') ? p : '/' + p, name: file.name });
                }
                if (attachments.length) {
                    const includePaths = attachments.map(a => a.path);
                    await cabinet.fetch('append_log_includes', { entryPath: path, includePaths }).catch(() => {});
                }
                await createdTask.fetch('prompt', {}, JSON.stringify({ prompt: text, attachments, ...(voice ? { voice: true } : {}) })).catch(() => {});
            }
            if (createdTask)
                this._bindTask(createdTask);
            return createdTask;
        }
        catch (err) {
            console.warn('[consultant] submit error:', err);
            this.optimistic = null;
            this.status = 'idle';
            this.toast('Не удалось отправить: ' + (err?.message || err));
            return null;
        }
        finally {
            this._sending = false;
        }
    },

    _bindTask(task) {
        this._unbindTask();
        this.taskItem = task || null;
        if (!task)
            return;
        this._taskHandlers = {
            'changed': () => this._reloadTask(),
            'task.delta': e => this._onDelta(e.detail?.value),
            'task.state': e => {
                const s = e.detail?.value?.status;
                if (s) {
                    this.status = s;
                    this._lastDelta = Date.now();
                }
            },
            'chat.done': () => this._reloadTask(),
        };
        for (const [k, fn] of Object.entries(this._taskHandlers))
            task.listen?.(k, fn);
        this._reloadTask();
    },

    _unbindTask() {
        const t = this.taskItem;
        if (t && this._taskHandlers) {
            for (const [k, fn] of Object.entries(this._taskHandlers))
                t.unlisten?.(k, fn);
        }
        this._taskHandlers = null;
    },

    _onDelta(d) {
        if (!d?.item || !d.token)
            return;
        const cur = this.streams[d.item] || {};
        const field = d.field === 'reasoning' ? 'reasoning' : 'content';
        this.streams = { ...this.streams, [d.item]: { ...cur, [field]: (cur[field] || '') + d.token } };
        this._lastDelta = Date.now();
        if (this.status !== 'running')
            this.status = 'running';
        this._stick();
        this._voice?.onDelta({ item: d.item, field });
    },

    _reloadTask() {
        if (!this.taskItem)
            return;
        if (this._loading) {
            this._again = true;
            return;
        }
        this._loading = (async () => {
            let tries = 0;
            try {
                do {
                    this._again = false;
                    try {
                        const raw = await this.taskItem?.load();
                        const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                        const done = new Set((data.items || []).filter(i => i.type === 'assistant' && (i.durationMs || i.stopped || i.interrupted)).map(i => i.id));
                        if (Object.keys(this.streams).some(id => done.has(id))) {
                            const s = {};
                            for (const [id, v] of Object.entries(this.streams)) {
                                if (!done.has(id))
                                    s[id] = v;
                            }
                            this.streams = s;
                        }
                        this.data = data;
                        if (this.items.length)
                            this.optimistic = null;
                        // Пока новая задача только что создана (items ещё пуст и висит optimistic), сохраняем статус 'running' до старта цикла на сервере
                        this.status = data.status || (this.optimistic ? 'running' : 'idle');
                        this._lastDelta = Date.now();
                        this._stick();
                        this._voice?.onData({ ...data, status: this.status });
                        tries = 0;
                    }
                    catch {
                        if (++tries > 4)
                            break;
                        this._again = true;
                        await new Promise(r => setTimeout(r, 250 * tries));
                    }
                } while (this._again);
            }
            finally {
                this._loading = null;
            }
        })();
    },

    optimisticUser(text, attachments = [], voice = false) {
        if (!text && !attachments?.length)
            return;
        this.optimistic = { id: 'optimistic', type: 'user', content: text, attachments, time: Date.now(), ...(voice ? { voice: true } : {}) };
        this.pinned = true;
        this.status = 'running';
        this._stick();
    },

    stop() {
        if (this.taskItem && this.status === 'running')
            this.taskItem.fetch('stop', {}).catch(() => {});
    },

    toggleGroup(id, open) {
        if (!id)
            return;
        this.groupOpen = { ...this.groupOpen, [id]: open };
    },

    async reply(callId, payload = {}) {
        const res = await this.taskItem?.fetch('approve', {}, JSON.stringify({ call: callId, ...payload }));
        if (res && res.ok === false)
            this.toast(res.error || 'Не удалось отправить ответ');
    },

    async revert(item) {
        if (!item?.id || item.id === 'optimistic' || !this.taskItem)
            return;
        const res = await this.taskItem.fetch('revert', { id: item.id });
        if (res?.prompt != null)
            this.value = res.prompt;
    },

    async unqueue(item) {
        if (!item?.id || !this.taskItem)
            return;
        await this.taskItem.fetch('unqueue', { id: item.id });
    },

    async openWorkPath(path) {
        const raw = String(path || '').trim();
        if (!raw)
            return;
        const m = raw.match(/^(.*)\/\.([^/]+)\/history\/[^/]+\/[^/]+$/);
        const targetPath = m ? m[1] + '/' + m[2] : raw;
        let item = await WORK.get_item(targetPath);
        if (Array.isArray(item))
            item = item.at(-1) || null;
        if (!item && targetPath !== raw) {
            item = await WORK.get_item(raw);
            if (Array.isArray(item))
                item = item.at(-1) || null;
        }
        if (!item) {
            this.toast('Не найден элемент: ' + targetPath);
            return;
        }
        const exec = window.top?.execute || window.execute;
        if (typeof exec === 'function')
            exec(item);
    },

    openDoc(doc) {
        if (doc?.path)
            this.openWorkPath(doc.path);
    },

    openFullTask() {
        if (!this.taskItem)
            return;
        const exec = window.top?.execute || window.execute;
        if (typeof exec === 'function')
            exec(this.taskItem);
    },

    async openUserFeed() {
        const cabinet = await this._getPersonalCabinet();
        if (!cabinet)
            return;
        const exec = window.top?.execute || window.execute;
        if (typeof exec === 'function')
            exec(cabinet, { view: 'chat' });
    },

    async toggleHistory() {
        this.showHistory = !this.showHistory;
        if (this.showHistory) {
            this.showPrompts = false;
            await this.loadRecentTasks();
        }
    },

    async loadRecentTasks() {
        try {
            const cabinet = await this._getPersonalCabinet();
            if (!cabinet)
                return;
            const rows = await cabinet.fetch('logs', { mode: 'bodies', ext: 'task' });
            const list = [];
            const seen = new Set();
            for (const row of (Array.isArray(rows) ? rows : [])) {
                const p = row?.path;
                if (!p || seen.has(p))
                    continue;
                seen.add(p);
                let title = '';
                if (row.content) {
                    try {
                        const parsed = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                        title = parsed?.title || parsed?.name || '';
                    }
                    catch { /* ignore */ }
                }
                if (!title)
                    title = p.split('/').pop()?.replace(/\.task$/, '') || 'Задача';
                const timeText = row.time
                    ? new Date(row.time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '';
                list.push({ path: p, title, time: row.time || 0, timeText });
                if (list.length >= 20)
                    break;
            }
            this.recentTasks = list;
        }
        catch (err) {
            console.warn('[consultant] loadRecentTasks:', err);
            this.recentTasks = [];
        }
    },

    async selectHistoryTask(entry) {
        if (!entry?.path)
            return;
        await ensureConsultantUI();
        this.uiReady = true;
        const item = await WORK.get_item(entry.path);
        if (item) {
            this.showHistory = false;
            this.optimistic = null;
            this.streams = {};
            this._bindTask(item);
        }
    },

    onScroll(e) {
        if (this._sticking)
            return;
        const el = e.target;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const movedUp = this._lastScrollTop != null && el.scrollTop < this._lastScrollTop - 4;
        this._lastScrollTop = el.scrollTop;
        if (dist < 60) {
            if (!this.pinned)
                this.pinned = true;
        }
        else if (movedUp && this.pinned) {
            this.pinned = false;
        }
    },

    toBottom() {
        this.pinned = true;
        const el = this.$('.scroller');
        if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            this._lastScrollTop = el.scrollHeight;
        }
    },

    _stick() {
        if (!this.pinned)
            return;
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => {
            const el = this.$('.scroller');
            if (!el || !this.pinned)
                return;
            this._sticking = true;
            el.scrollTop = el.scrollHeight;
            this._lastScrollTop = el.scrollTop;
            requestAnimationFrame(() => {
                if (this.pinned && el) {
                    el.scrollTop = el.scrollHeight;
                    this._lastScrollTop = el.scrollTop;
                }
                this._sticking = false;
            });
        });
    },

    toast(text) {
        this.toastText = String(text || '');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => { this.toastText = ''; }, 3500);
    },
});
