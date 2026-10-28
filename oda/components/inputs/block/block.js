/**
 * oda-block-input — блочный контрол: строка-заголовок (подпись, выжимка значения, инструменты) и тело произвольной высоты.
 * Наследник дописывает в шаблон тело с class="body"; выжимку — геттер summary; кнопки заголовка — геттер tools
 * ([{icon, title, action(), disabled}]). Свёрнутый блок показывает только заголовок.
 */

ODA({
    is: 'oda-block-input',
    imports: 'oda//input.js, oda//button.js',
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
                @apply --header;
                align-items: center;
                gap: 6px;
                min-height: 28px;
                padding: 2px 8px;
                border-bottom: 1px solid var(--border-color);
                font-size: 12px;
            }
            :host([collapsed]) .header {
                border-bottom-color: transparent;
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
                text-align: right;
                font-size: 12px;
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
                gap: 4px;
            }
            :host([collapsed]:not([no-header])) .body {
                display: none;
            }
            .tool {
                @apply --no-flex;
                border-radius: 3px;
                font-size: 12px;
            }
        </style>
        <div class="header" ~show="!noHeader || visibleTools.length">
            <oda-button ~if="collapsible && !noHeader" class="tool" :icon="collapsed ? 'icons:chevron-right' : 'icons:expand-more'" :icon-size title="Свернуть / развернуть" @tap.stop="toggle()"></oda-button>
            <label class="caption" ~if="caption && !noHeader">{{caption}}</label>
            <div class="tools" @tap.stop @dblclick.stop>
                <oda-button ~for="visibleTools" class="tool" :icon="$for.item.icon" :label="$for.item.label || ''" :title="$for.item.title || ''" :disabled="!!$for.item.disabled" icon-size="16" @tap="runTool($for.item, $event)"></oda-button>
            </div>
            <span class="summary" :title="summary">{{summary}}</span>
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
        /** без подписи и сворачивания (форма показывает подпись сама); строка остаётся под кнопки, если они есть */
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
    /** кнопки, видимые сейчас: правящие скрыты в режиме чтения */
    get visibleTools() {
        return this.tools.filter(t => !t.edit || !this.isReadonly);
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
