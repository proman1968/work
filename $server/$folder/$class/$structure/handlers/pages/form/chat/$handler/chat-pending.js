/**
 * chat-task-pending — задача, которую создаёт чат, показывается сразу после «отправить» (раньше — через секунды):
 * ваше сообщение, вложения и честная стадия («Загружаю вложения 2/3…», «Создаю задачу…», «Запускаю агента…»).
 * Сбой остаётся на экране с понятным действием (повторить / запустить / открыть задачу / закрыть с возвратом текста в поле).
 * Когда настоящая карточка раскрыта, чат убирает этот экран. Логика создания — chat-task.js (runCreateTask).
 */
import { stageText } from './chat-task.js';

const ERROR_TITLE = {
    uploading: 'Не удалось загрузить вложение',
    saving: 'Не удалось создать задачу',
    starting: 'Задача создана, но агент не запустился',
};

ODA({ is: 'chat-task-pending',
    imports: 'oda//button, oda//icon, ~/lib//dot',
    template: /*html*/`
        <style>
            :host {
                position: fixed; inset: 0; z-index: 3; @apply --vertical; @apply --content; font-size: 15px;
                animation: pending-in .12s ease-out;
            }
            @keyframes pending-in { from { opacity: 0; } to { opacity: 1; } }
            .top { @apply --horizontal; align-items: center; gap: 8px; padding: 6px 10px 6px 16px; border-bottom: 1px solid var(--subtle-border); min-height: 44px; box-sizing: border-box; }
            .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .chip { @apply --chip; background: var(--accent-soft); border-color: transparent; }
            .chip[bad] { background: var(--error-soft); }
            .col { width: 100%; max-width: 820px; margin: 0 auto; padding: 16px; box-sizing: border-box; @apply --vertical; gap: 14px; }
            .bubble {
                align-self: flex-end; background: var(--accent-soft); max-width: min(85%, 640px); padding: 10px 14px;
                border-radius: var(--radius-l) var(--radius-l) var(--radius-s) var(--radius-l);
                white-space: pre-wrap; word-break: break-word; line-height: 1.45; user-select: text;
            }
            .att { @apply --horizontal; flex-wrap: wrap; gap: 4px; justify-content: flex-end; margin-top: -8px; }
            .att span { @apply --chip; }
            .work { @apply --horizontal; @apply --muted; align-items: center; gap: 8px; font-size: small; }
            .err { @apply --vertical; gap: 10px; padding: 12px 14px; border-radius: var(--radius-m); background: var(--error-soft); }
            .err b { font-weight: 600; }
            .err .why { @apply --muted; font-size: small; white-space: pre-wrap; word-break: break-word; user-select: text; }
            .btns { @apply --horizontal; flex-wrap: wrap; gap: 8px; }
            .btns oda-button { border-radius: var(--radius-s); padding: 2px 12px; }
            .ghost { border: 1px solid var(--subtle-border); background: var(--content-background); }
        </style>
        <div class="top">
            <work-dot no-flex :size="26" :state="isError ? 'error' : 'thinking'"></work-dot>
            <span class="title" flex :title="pending?.text">{{title}}</span>
            <span class="chip" no-flex :bad="isError">{{isError ? 'Ошибка' : 'Запуск'}}</span>
        </div>
        <div class="col">
            <div class="bubble" ~if="pending?.text">{{pending.text}}</div>
            <div class="att" ~if="pending?.files?.length">
                <span ~for="pending.files"><oda-icon icon="carbon:attachment" :icon-size="12"></oda-icon>{{$for.item}}</span>
            </div>
            <div class="work" ~if="!isError">
                <oda-icon icon="spinners:3-dots-scale" :icon-size="16"></oda-icon><span>{{stageLabel}}</span>
            </div>
            <div class="err" ~if="isError">
                <b>{{errorTitle}}</b>
                <div class="why">{{pending.error}}</div>
                <div class="btns">
                    <oda-button hide-icon accent-invert :label="pending.stage === 'starting' ? 'Запустить агента' : 'Повторить'" @tap="fire('retry')"></oda-button>
                    <oda-button hide-icon class="ghost" ~if="pending.stage === 'starting'" label="Открыть задачу" @tap="fire('open')"></oda-button>
                    <oda-button hide-icon class="ghost" label="Закрыть" title="Вернуть текст и вложения в поле ввода" @tap="fire('close')"></oda-button>
                </div>
            </div>
        </div>
    `,
    pending: null,
    get isError() { return this.pending?.state === 'error'; },
    get title() { return String(this.pending?.text || 'Новая задача').split('\n')[0].slice(0, 90); },
    get stageLabel() { return stageText(this.pending?.stage, this.pending?.info || {}); },
    get errorTitle() { return ERROR_TITLE[this.pending?.stage] || 'Не удалось создать задачу'; },
});
