export default {
    icon: 'icons:home',
    label: 'Главная',
    imports: 'oda//button, ~/lib//icon, ~/lib//user',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: hidden;
                min-height: 0;

                .top-bar {
                    align-items: center;
                    gap: 8px;
                    padding: 4px 8px;
                    flex-shrink: 0;
                }
                .top-bar .title {
                    @apply --flex;
                    font-weight: 600;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .top-bar .login-btn {
                    border-radius: 8px;
                }
                .page-body {
                    overflow: auto;
                    align-items: center;
                    justify-content: center;
                    min-height: 0;
                }
                .hero {
                    @apply --horizontal;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                    max-width: 640px;
                    padding: 32px 24px;
                    box-sizing: border-box;
                }
                .hero-text {
                    @apply --flex;
                    @apply --vertical;
                    gap: 8px;
                    min-width: 180px;
                }
                h1 {
                    margin: 0;
                    font-size: clamp(1.5rem, 3vw, 2rem);
                    font-weight: 700;
                    letter-spacing: -0.02em;
                    line-height: 1.2;
                }
                .lead {
                    margin: 0;
                    line-height: 1.5;
                    opacity: 0.8;
                }
            }
        </style>
        <div ~if="isTop" class="top-bar" header horizontal>
            <span class="title">{{$item.label}}</span>
            <oda-button
                ~if="!isLoggedIn"
                class="login-btn"
                label="Войти"
                icon="icons:account-circle"
                @tap="open_profile"
            ></oda-button>
            <item-user
                ~if="isLoggedIn"
                :$item="currentUser"
                round
                :icon-size="32"
                @tap="open_profile"
            ></item-user>
        </div>
        <div class="page-body" flex vertical>
            <div class="hero">
                <item-icon :$item icon-size="72"></item-icon>
                <div class="hero-text">
                    <h1>{{$item.label}}</h1>
                    <p class="lead">{{pitch}}</p>
                </div>
            </div>
        </div>
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
    async open_profile() {
        const profile = ODA.createComponent('user-profile');
        try {
            await WORK.showModal(profile, {
                TITLE: { label: this.isLoggedIn ? 'Профиль' : 'Вход или регистрация' },
                allowClose: true,
                BUTTONS: [],
            });
        } catch (_) {
        } finally {
            this._onAuth();
        }
    },
    attached() {
        this._boundAuth = () => this._onAuth();
        WORK.authEvents?.addEventListener('auth', this._boundAuth);
        WORK.AUTH_CHANNEL?.addEventListener('message', this._boundAuth);
    },
    detached() {
        if (this._boundAuth) {
            WORK.authEvents?.removeEventListener('auth', this._boundAuth);
            WORK.AUTH_CHANNEL?.removeEventListener('message', this._boundAuth);
        }
    },
    get pitch() {
        return this.$item?.label
            ? `Раздел «${this.$item.label}» в системе WORK.`
            : 'Раздел системы WORK.';
    }
}
