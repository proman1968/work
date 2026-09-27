/**
 * Панель артефакта: предпросмотр файла, созданного/изменённого агентом (html — живая страница,
 * картинки, markdown, код/текст). Открывается тапом по пути в карточке вызова.
 */
import { extOf, fileUrl, copyText, findShell } from './util.js';

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const PAGE = ['html', 'htm', 'pdf'];

ODA({ is: 'microchat-dock',
    imports: 'oda//button, oda//icon, oda//markdown//markdown-viewer',
    template: /*html*/`
        <style>
            :host { @apply --vertical; overflow: hidden; min-width: 0; border-left: 1px solid var(--subtle-border); background: var(--subtle-background); }
            .bar { @apply --horizontal; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--subtle-border); min-width: 0; }
            .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: small; }
            .path { @apply --muted; font-size: x-small; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-family: var(--font-mono); }
            .bar oda-button { border-radius: var(--radius-s); padding: 2px; }
            .sheet { overflow: auto; min-height: 0; }
            iframe { border: none; width: 100%; height: 100%; background: white; }
            .img { @apply --vertical; align-items: center; justify-content: center; padding: 16px; }
            .img img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-s); }
            .md { padding: 12px 16px; user-select: text; }
            pre { margin: 0; padding: 12px 16px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; user-select: text; }
            .empty { @apply --muted; padding: 24px; text-align: center; }
        </style>
        <div class="bar" no-flex>
            <oda-icon no-flex :icon="icon" :icon-size="16"></oda-icon>
            <div vertical flex style="min-width: 0;">
                <span class="name">{{name}}</span>
                <span class="path" :title="path">{{path}}</span>
            </div>
            <oda-button no-flex icon="carbon:renew" :icon-size="16" title="Обновить" @tap="reload"></oda-button>
            <oda-button no-flex icon="carbon:copy" :icon-size="16" title="Копировать содержимое" ~if="!isImage" @tap="copy"></oda-button>
            <oda-button no-flex icon="carbon:launch" :icon-size="16" title="Открыть в новой вкладке" @tap="launch"></oda-button>
            <oda-button no-flex icon="carbon:close" :icon-size="16" title="Закрыть" @tap="close"></oda-button>
        </div>
        <div class="sheet" flex vertical>
            <iframe flex ~if="isPage" :src="url"></iframe>
            <div class="img" flex ~if="isImage"><img :src="url"></div>
            <div class="md" ~if="isMarkdown && text"><oda-markdown-viewer vertical :value="text"></oda-markdown-viewer></div>
            <pre ~if="!isPage && !isImage && !isMarkdown && text">{{text}}</pre>
            <div class="empty" ~if="!isPage && !isImage && !text">{{loading ? 'Загрузка…' : 'Нет содержимого'}}</div>
        </div>
    `,
    path: {
        $def: '',
        set(n) {
            this.text = '';
            this.bust = Date.now();
            this.loadText();
        },
    },
    text: '',
    loading: false,
    bust: 0,
    get ext() { return extOf(this.path); },
    get name() { return String(this.path || '').split('/').pop(); },
    get isImage() { return IMAGE.includes(this.ext); },
    get isPage() { return PAGE.includes(this.ext); },
    get isMarkdown() { return this.ext === 'md'; },
    get url() { return fileUrl(this.path) + '?_=' + this.bust; },
    get icon() {
        if (this.isImage) return 'carbon:image';
        if (this.isPage) return 'carbon:application-web';
        return 'carbon:document';
    },
    async loadText() {
        if (!this.path || this.isImage || this.isPage)
            return;
        this.loading = true;
        try {
            const item = await WORK.get_item(this.path);
            const raw = await item?.load?.();
            this.text = typeof raw === 'string' ? raw : (raw == null ? '' : JSON.stringify(raw, null, 2));
        }
        catch (e) {
            this.text = 'Не удалось загрузить: ' + (e?.message || e);
        }
        finally {
            this.loading = false;
        }
    },
    reload() {
        this.bust = Date.now();
        this.loadText();
    },
    copy() { copyText(this.text); },
    launch() { window.open(fileUrl(this.path), '_blank'); },
    close() { findShell(this)?.openArtifact(''); },
});
