/**
 * oda-media-input — блочное поле медиа по URL: предпросмотр изображения, видео или аудио.
 * value — строка URL (http(s), data:, blob:). Выбор файла: изображение → data: URL (сериализуется),
 * видео и аудио → blob: URL (живёт только в текущей вкладке). Теги oda-image-input / oda-video-input / oda-audio-input — kind задан.
 */
import '/oda/components/inputs/block/block.js';

export const ACCEPT = { image: 'image/*', video: 'video/*', audio: 'audio/*' };
export const readAsDataURL = file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
});
/** файл → {src, type, name}: изображение — data: URL, остальное — blob: URL */
export async function fileToMedia(file) {
    const type = file.type.split('/')[0];
    return { src: type === 'image' ? await readAsDataURL(file) : URL.createObjectURL(file), type, name: file.name };
}
/** тип медиа по расширению URL / data: */
export function mediaKind(src = '') {
    const m = /^data:(\w+)\//.exec(src);
    if (m)
        return m[1];
    const ext = src.split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext))
        return 'video';
    if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(ext))
        return 'audio';
    return 'image';
}
export const mediaName = (src = '') => src.startsWith('data:') ? src.slice(0, src.indexOf(';')) : decodeURIComponent(src.split(/[?#]/)[0].split('/').pop());

ODA({
    is: 'oda-media-input',
    extends: 'oda-block-input',
    template: /*html*/`
        <style>
            .body {
                @apply --vertical;
                align-items: center;
                justify-content: center;
                min-height: 6em;
                padding: var(--space-s);
                background: var(--subtle-background);
            }
            :host([dragover]) .body {
                outline: 2px dashed var(--accent-color);
                outline-offset: -4px;
            }
            img, video {
                max-width: 100%;
                max-height: 24em;
                object-fit: contain;
                border-radius: var(--radius-s);
            }
            audio {
                width: 100%;
            }
            .empty {
                @apply --vertical;
                @apply --muted;
                align-items: center;
                gap: var(--space-s);
            }
        </style>
        <div class="body">
            <img ~if="!isEmpty && mediaType === 'image'" :src="value" :alt="summary">
            <video ~if="!isEmpty && mediaType === 'video'" :src="value" controls></video>
            <audio ~if="!isEmpty && mediaType === 'audio'" :src="value" controls></audio>
            <div ~if="isEmpty" class="empty">
                <oda-icon :icon="emptyIcon" :icon-size="48"></oda-icon>
                <span>{{isReadonly ? 'Нет файла' : 'Перетащите файл или выберите его кнопкой в заголовке'}}</span>
            </div>
        </div>
    `,
    $public: {
        value: {
            $def: '',
            $type: String
        },
        /** image | video | audio; пусто — по URL */
        kind: ''
    },
    dragover: {
        $def: false,
        $attr: true
    },
    get mediaType() {
        return this.kind || mediaKind(this.value);
    },
    get emptyIcon() {
        return { video: 'av:videocam', audio: 'image:music-note' }[this.kind] ?? 'image:photo';
    },
    get summary() {
        return this.isEmpty ? '' : mediaName(this.value);
    },
    get tools() {
        return [
            { icon: 'icons:file-upload', title: 'Выбрать файл', edit: true, action: () => this.choose() },
            { icon: 'icons:link', title: 'Задать URL', edit: true, action: () => this.askUrl() },
            { icon: 'icons:open-in-new', title: 'Открыть', disabled: this.isEmpty, action: () => window.open(this.value, '_blank') },
            { icon: 'icons:close', title: 'Очистить', edit: true, disabled: this.isEmpty, action: () => this.value = '' }
        ];
    },
    async setFile(file) {
        this.value = (await fileToMedia(file)).src;
    },
    async choose() {
        const [file] = await ODA.showFileDialog({ accept: ACCEPT[this.kind] ?? 'image/*,video/*,audio/*' });
        if (file)
            this.setFile(file);
    },
    async askUrl() {
        this.value = await ODA.showPrompt('URL', { value: this.value.startsWith('data:') ? '' : this.value });
    },
    $listeners: {
        dragover(e) {
            if (this.isReadonly || this.disabled)
                return;
            e.preventDefault();
            this.dragover = true;
        },
        dragleave() {
            this.dragover = false;
        },
        drop(e) {
            e.preventDefault();
            this.dragover = false;
            const file = e.dataTransfer.files[0];
            if (file && !this.isReadonly && !this.disabled)
                this.setFile(file);
        }
    }
});
ODA({ is: 'oda-image-input', extends: 'oda-media-input', kind: 'image' });
ODA({ is: 'oda-video-input', extends: 'oda-media-input', kind: 'video' });
ODA({ is: 'oda-audio-input', extends: 'oda-media-input', kind: 'audio' });
