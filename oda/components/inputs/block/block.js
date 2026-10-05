/**
 * oda-block-input — блочный контрол: строка-заголовок (подпись, выжимка значения, инструменты) и тело произвольной высоты.
 * Наследник дописывает в шаблон тело с class="body"; выжимку — геттер summary; кнопки заголовка — геттер tools
 * ([{icon, title, action(), disabled}]). Свёрнутый блок показывает только заголовок.
 */
import '/oda/components/inputs/input/input.js';
import '/oda/components/button/button.js';

ODA({
    is: 'oda-block-input',
    extends: 'oda-input',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                flex: none;
                align-items: stretch;
                gap: 0;
                padding: 0;
                min-height: 0;
                overflow: hidden;
                cursor: default;

            }
            :host(:focus-within) {
                box-shadow: none;
            }
            .header {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
                gap: var(--space-s);
                min-height: var(--control-height);
                padding: 0 var(--space-xs) 0 var(--space-s);
                background-color: var(--subtle-background);
                border-bottom: 1px solid var(--control-border-color);
            }
            :host([collapsed]) .header {
                border-bottom-color: transparent;
            }
            :host([no-header]) .header {
                display: none;
            }
            .caption {
                font-weight: 600;
                white-space: nowrap;
            }
            .summary {
                @apply --flex;
                @apply --muted;
                min-width: 0;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
            }
            .body {
                flex: none;
                min-height: 0;
                overflow: auto;
            }
            .tools {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
            }
            :host([collapsed]) .body {
                display: none;
            }
            .tool {
                @apply --no-flex;
                border-radius: var(--radius-s);
            }
        </style>
        <div class="header">
            <oda-button ~if="collapsible" class="tool" :icon="collapsed ? 'icons:chevron-right' : 'icons:expand-more'" :icon-size title="Свернуть / развернуть" @tap.stop="toggle()"></oda-button>
            <label class="caption" ~if="caption">{{caption}}</label>
            <span class="summary" :title="summary">{{summary}}</span>
            <div class="tools" @tap.stop @dblclick.stop>
                <oda-button ~for="tools" class="tool" :icon="$for.item.icon" :title="$for.item.title || ''" :disabled="!!$for.item.disabled || (isReadonly && $for.item.edit)" ~show="!$for.item.edit || !isReadonly" :icon-size @tap="runTool($for.item, $event)"></oda-button>
            </div>
        </div>
    `,
    $public: {
        collapsed: {
            $def: false,
            $attr: true
        },
        collapsible: {
            $def: true,
            $attr: true
        },
        /** скрыть строку-заголовок (форма показывает подпись сама) */
        noHeader: {
            $def: false,
            $attr: true
        },
        /** своя подпись заголовка; по умолчанию — подпись поля */
        caption: {
            $def: '',
            get() {
                return this.label;
            }
        }
    },
    isBlock: {
        $def: true,
        $attr: true
    },
    /** краткая выжимка значения в строке-заголовке */
    get summary() {
        return '';
    },
    /** кнопки строки-заголовка: {icon, title, action(e), disabled, edit (скрыть в режиме чтения)} */
    get tools() {
        return [];
    },
    runTool(tool, e) {
        tool.action.call(this, e);
    },
    toggle() {
        if (this.collapsible)
            this.collapsed = !this.collapsed;
    },
    focus() {
        this.collapsed = false;
        this.$('.control')?.focus();
    }
});
