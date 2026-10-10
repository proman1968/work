/**
 * item-site-user — блок входа для страниц сайта: кнопка explorer и аватар
 * для вошедшего, «Войти» для гостя. Показывается только в top-окне
 * (во вложенном iframe вход — у оболочки).
 */
export default {
    imports: 'oda//button, ~/lib//user',
    template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                align-items: center;
                gap: 8px;
            }
            oda-button {
                border-radius: var(--radius-s, 8px);
            }
        </style>
        <oda-button ~if="isTop && isLoggedIn" icon="icons:open-in-new" title="Открыть в explorer" @tap="openExplorer"></oda-button>
        <oda-button ~if="isTop && !isLoggedIn" icon="icons:account-circle" label="Войти" @tap="openProfile"></oda-button>
        <item-user ~if="isTop && isLoggedIn" :$item="currentUser" round :icon-size="32" @tap="openProfile"></item-user>
    `,
    get isTop() {
        return WORK.top === window;
    },
    get isLoggedIn() {
        return !!WORK.uid;
    },
    get currentUser() {
        return WORK.USER;
    },
    _onAuth() {
        this.isLoggedIn = undefined;
        this.currentUser = undefined;
    },
    openExplorer() {
        const base = this.$item?.url || location.origin;
        window.open(base + '/~/handlers//explorer/index.html', '_blank');
    },
    async openProfile() {
        const profile = ODA.createComponent('user-profile');
        try {
            await WORK.showModal(profile, {
                TITLE: { label: this.isLoggedIn ? 'Профиль' : 'Вход или регистрация' },
                allowClose: true,
                BUTTONS: [],
            });
        } catch { /* закрыли */ }
        finally {
            this._onAuth();
        }
    },
    attached() {
        this._boundAuth ??= () => this._onAuth();
        WORK.authEvents?.addEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', this._boundAuth);
    },
    detached() {
        WORK.authEvents?.removeEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
    },
}
