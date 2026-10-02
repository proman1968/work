/**
 * oda-gallery-input — коллекция медиа: текущий элемент крупно, лента миниатюр, навигация в заголовке.
 * value — Array элементов {src, type?, name?} или строк-URL; index — текущий элемент; клавиши ← / →.
 */
import '/oda/components/inputs/block/block.js';
import { fileToMedia, mediaKind, mediaName } from '/oda/components/inputs/media/media.js';

ODA({
    is: 'oda-gallery-input',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                gap: var(--space-s);
                padding: var(--space-s);
                background: var(--subtle-background);
                outline: none;
            }
            .stage {
                @apply --vertical;
                align-items: center;
                justify-content: center;
                min-height: 8em;
            }
            .stage img, .stage video {
                max-width: 100%;
                max-height: 24em;
                object-fit: contain;
                border-radius: var(--radius-s);
            }
            .stage audio {
                width: 100%;
            }
            .strip {
                @apply --horizontal;
                gap: var(--space-xs);
                overflow-x: auto;
            }
            .thumb {
                @apply --no-flex;
                @apply --vertical;
                align-items: center;
                justify-content: center;
                width: 4em;
                height: 3em;
                border: 2px solid transparent;
                border-radius: var(--radius-xs);
                background: var(--content-background);
                overflow: hidden;
                cursor: pointer;
            }
            .thumb.current {
                border-color: var(--accent-color);
            }
            .thumb img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .empty {
                @apply --muted;
                text-align: center;
                padding: var(--space-l);
            }
        </style>
        <div class="body" tabindex="0" @keydown="onKey($event)">
            <div ~if="current" class="stage">
                <img ~if="current.type === 'image'" :src="current.src" :alt="current.name">
                <video ~if="current.type === 'video'" :src="current.src" controls></video>
                <audio ~if="current.type === 'audio'" :src="current.src" controls></audio>
            </div>
            <div ~if="items.length > 1" class="strip">
                <div ~for="items" class="thumb" ~class="{current: $for.index === pos}" :title="$for.item.name" @tap="index = $for.index">
                    <img ~if="$for.item.type === 'image'" :src="$for.item.src">
                    <oda-icon ~if="$for.item.type !== 'image'" :icon="$for.item.type === 'video' ? 'av:videocam' : 'image:music-note'"></oda-icon>
                </div>
            </div>
            <div ~if="!items.length" class="empty">Нет элементов</div>
        </div>
    `,
    $public: {
        value: {
            $type: Array
        },
        index: 0
    },
    get items() {
        return (this.value ?? []).map(i => {
            const item = typeof i === 'string' ? { src: i } : i;
            return { ...item, type: item.type || mediaKind(item.src), name: item.name || mediaName(item.src) };
        });
    },
    /** текущий индекс в границах коллекции */
    get pos() {
        return Math.max(0, Math.min(this.index, this.items.length - 1));
    },
    get current() {
        return this.items[this.pos];
    },
    get summary() {
        return this.items.length ? `${this.pos + 1} из ${this.items.length} · ${this.current.name}` : '';
    },
    get tools() {
        return [
            { icon: 'icons:chevron-left', title: 'Предыдущий', disabled: this.pos <= 0, action: () => this.index = this.pos - 1 },
            { icon: 'icons:chevron-right', title: 'Следующий', disabled: this.pos >= this.items.length - 1, action: () => this.index = this.pos + 1 },
            { icon: 'icons:add', title: 'Добавить', edit: true, action: () => this.add() },
            { icon: 'icons:delete', title: 'Удалить текущий', edit: true, disabled: !this.items.length, action: () => this.removeAt() }
        ];
    },
    async add() {
        const files = await ODA.showFileDialog({ accept: 'image/*,video/*,audio/*', multiple: true });
        const added = await Promise.all([...files].map(fileToMedia));
        this.value = [...(this.value ?? []), ...added];
        this.index = this.value.length - added.length;
    },
    removeAt() {
        this.value = this.value.filter((_, i) => i !== this.pos);
    },
    onKey(e) {
        if (e.key === 'ArrowLeft' && this.pos > 0)
            this.index = this.pos - 1;
        else if (e.key === 'ArrowRight' && this.pos < this.items.length - 1)
            this.index = this.pos + 1;
    }
});
