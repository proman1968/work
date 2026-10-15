// Типы ядра агента WORK (hardening 4.3).
// Амбиентные (без export): доступны в JSDoc всех @ts-check файлов без импорта.
// strict:false — типы описывают форму ключевых сущностей, а не исчерпывающую модель.

/** Корень дерева WORK (задаётся на globalThis при старте сервера; var — чтобы был виден и как globalThis.WORK). */
declare var WORK: any;

/** JSON Schema аргументов инструмента. */
interface ToolSchema {
    type?: string;
    properties?: { [key: string]: any };
    required?: string[];
    [key: string]: any;
}

/** Инструмент агента (tools/*). */
interface Tool {
    name: string;
    description?: string;
    /** JSON Schema аргументов (parameters агента = inputSchema MCP). */
    parameters?: ToolSchema;
    /** чтение — всегда можно, параллелится */
    readonly?: boolean;
    concurrent?: boolean;
    risk?: 'write' | 'danger';
    /** безопасен в режиме «План» */
    planSafe?: boolean;
    /** результат — чужое содержимое (taint.js) */
    untrusted?: boolean;
    /** ОС/сеть — только администратору */
    system?: boolean;
    /** действие наружу (taint.js): true | (args) => boolean */
    outbound?: boolean | ((args: object) => boolean);
    /** правило инструмента поверх политики (permissions.js) */
    permission?: (args: object, ctx: ToolCtx) => Verdict | null | Promise<Verdict | null>;
    /** WORK-путь цели вызова (для проверки защищённых зон) */
    target?: (args: object) => string | string[] | null | undefined;
    run: (args: object, ctx: ToolCtx) => any;
}

/** Контекст выполнения инструмента (loop.js ctx, расширяется каждым владельцем). */
interface ToolCtx {
    session?: any;
    place?: any;
    env?: any;
    task?: any;
    role?: string;
    host?: Host;
    /** накопитель хода: snapshot, path, untrusted (undo.js, taint.js) */
    entry?: Entry;
    depth?: number;
    tools?: Tool[];
    /** источники внешнего содержимого в контексте (taint.js) */
    tainted?: string[] | null;
    [key: string]: any;
}

/** Решение политики (permissions.js) или правила организации (hooks.js). */
interface Verdict {
    verdict: 'allow' | 'ask' | 'deny';
    reason?: string;
    /** «разрешить всегда» не предлагается (действие наружу, правило организации) */
    noAlways?: boolean;
    /** не показывать аргументы в вопросе человеку (секреты) */
    hideArgs?: boolean;
}

/** Вызов инструмента в ленте (loop.js; статусы — жизненный цикл, вкл. восстановление после рестарта). */
interface Entry {
    id: string;
    name: string;
    args?: { [key: string]: any };
    status: 'pending' | 'approval' | 'waiting' | 'running' | 'ok' | 'error' | 'denied' | 'interrupted' | 'approved';
    result?: any;
    error?: any;
    answer?: any;
    items?: any[];
    path?: string;
    diff?: string;
    durationMs?: number;
    reason?: string;
    noAlways?: boolean;
    hideArgs?: boolean;
    [key: string]: any;
}

/** Тело .task (лента и метаданные, session.js normalizeBody). */
interface TaskBody {
    version?: number;
    status?: string;
    items?: any[];
    model?: string;
    role?: string;
    queue?: any[];
    waiting?: any;
    [key: string]: any;
}

/** Событие потока модели (loop.js, адаптер MODELS/$ai). */
interface LLMEvent {
    type?: string;
    text?: string;
    reasoning?: string;
    name?: string;
    arguments?: string | object;
    usage?: { prompt?: number, completion?: number, cached?: number, cacheWrite?: number, [key: string]: any };
    error?: any;
    [key: string]: any;
}

/** Контракт владельца ленты (session.js, index.js runOnce, MCP-сервер). */
interface Host {
    mode?: 'auto' | 'ask' | 'plan';
    signal?: AbortSignal;
    /** «разрешить всегда» в этой сессии: Set или структурный заменитель (session.js makeHost) */
    allowed?: Set<string> | { has?: (name: string) => any, add?: (name: string) => any, [key: string]: any };
    save: () => any;
    emit?: (event: any) => void;
    /** стоп на человека: { kind: 'approval'|'question', … } → ответ */
    wait?: (request: any) => any;
    [key: string]: any;
}

/** Адаптер модели (index.js llmFor; llmWithFallback — 9.1: запасные модели). */
interface LLM {
    name: string;
    /** элемент дерева MODELS (streamChat, generateImage, capabilities…) */
    item?: any;
    contextTokens?: number;
    vision?: boolean;
    /** 9.1: какая модель реально ответила после переключения на запасную (null — основная) */
    used?: string | null;
    stream: (req: { messages?: any, tools?: any, signal?: AbortSignal, effort?: string, [key: string]: any }) => AsyncIterable<LLMEvent>;
}

/** Итог цикла (loop.js runLoop). */
interface RunResult {
    status: 'done' | 'limit' | 'stopped' | 'error';
    content?: string;
}

/** Параметры runLoop (loop.js). */
interface LoopOpts {
    llm: LLM;
    system: string | { stable: string, volatile: string } | (() => any);
    items: any[];
    tools: Tool[];
    host: Host;
    ctx?: ToolCtx;
    depth?: number;
    hooks?: any;
    maxTurns?: number;
    /** внешнее содержимое в контексте родителя (для субагента, taint.js) */
    taintedFrom?: string[];
    loadImage?: (path: string) => any;
    effort?: string;
    [key: string]: any;
}

/** Параметры createEnv (index.js). */
interface EnvParams {
    place?: any;
    session?: any;
    host?: Host;
    tz?: string;
    location?: any;
    role?: string;
    voice?: boolean;
}

/** Параметры runOnce (index.js). */
interface RunOnceParams {
    place?: any;
    session?: any;
    prompt?: string;
    model?: string;
    agent?: string;
    mode?: 'auto' | 'ask' | 'plan';
    signal?: AbortSignal;
    role?: string;
}
