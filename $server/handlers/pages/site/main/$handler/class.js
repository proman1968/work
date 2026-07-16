export default {
    icon: 'icons:home',
    label: 'Главная',
    imports: 'oda//icon, ~/lib//icon, ~/lib//node',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: auto;

                .page {
                    @apply --flex;
                    @apply --vertical;
                    max-width: 920px;
                    width: 100%;
                    margin: 0 auto;
                    padding: 32px 24px 48px;
                    gap: 28px;
                    box-sizing: border-box;
                }
                .hero {
                    @apply --horizontal;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                }
                .hero-text {
                    @apply --flex;
                    @apply --vertical;
                    gap: 10px;
                    min-width: 220px;
                }
                .eyebrow {
                    font-size: 12px;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    opacity: 0.65;
                    font-weight: 600;
                }
                h1 {
                    margin: 0;
                    font-size: clamp(1.75rem, 4vw, 2.4rem);
                    font-weight: 700;
                    letter-spacing: -0.03em;
                    line-height: 1.15;
                }
                .lead {
                    margin: 0;
                    max-width: 40rem;
                    line-height: 1.55;
                    opacity: 0.85;
                }
                .section {
                    @apply --vertical;
                    gap: 12px;
                }
                .section h2 {
                    margin: 0;
                    font-size: 1.1rem;
                    font-weight: 600;
                }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 12px;
                }
                .card {
                    @apply --vertical;
                    @apply --raised;
                    gap: 8px;
                    padding: 16px;
                    border-radius: 12px;
                }
                .card b {
                    font-size: 0.95rem;
                }
                .card span {
                    font-size: 0.85rem;
                    line-height: 1.45;
                    opacity: 0.75;
                }
                .modules {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                    gap: 10px;
                }
                .module {
                    @apply --horizontal;
                    @apply --raised;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 10px;
                    cursor: pointer;
                }
                .module:hover {
                    @apply --active;
                }
            }
        </style>
        <div class="page">
            <div class="hero">
                <item-icon :$item icon-size="96"></item-icon>
                <div class="hero-text">
                    <div class="eyebrow">ODANT · PaaS</div>
                    <h1>{{$item.label}}</h1>
                    <p class="lead">{{pitch}}</p>
                </div>
            </div>

            <div class="section">
                <h2>Возможности</h2>
                <div class="grid">
                    <div class="card" ~for="benefits">
                        <oda-icon :icon="$for.item.icon" :icon-size="28"></oda-icon>
                        <b>{{$for.item.title}}</b>
                        <span>{{$for.item.text}}</span>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>Слои платформы</h2>
                <div class="grid">
                    <div class="card" ~for="layers">
                        <b>{{$for.item.title}}</b>
                        <span>{{$for.item.text}}</span>
                    </div>
                </div>
            </div>

            <div ~if="modules?.length" class="section">
                <h2>Модули</h2>
                <div class="modules">
                    <div class="module" ~for="modules" @tap="open_module($for.item)">
                        <item-node :$item="$for.item"></item-node>
                    </div>
                </div>
            </div>
        </div>
    `,
    pitch: 'Файло-ориентированная веб-платформа: структура папок одновременно является данными, API и точкой входа в UI. WORK — PaaS-решение на базе ODANT для цифровой работы организаций.',
    benefits: [
        {
            icon: 'carbon:folder',
            title: 'Папка = объект',
            text: 'Общие операции info, save, history и logs для файлов, групп, пользователей и структур.'
        },
        {
            icon: 'carbon:flow',
            title: 'Наследование ~',
            text: 'Handlers, формы и настройки сливаются слоями — без пересборки ядра.'
        },
        {
            icon: 'carbon:application',
            title: 'UI из $handler',
            text: 'Страницы и формы живут на диске и исполняются в браузере через ODA.'
        },
        {
            icon: 'carbon:security',
            title: 'Self-hosted',
            text: 'On-premise и white-label: данные и аудит остаются в контуре организации.'
        }
    ],
    layers: [
        {
            title: 'ODANT · sources/',
            text: 'Ядро: HTTP, get_item, merge class.js, auth, журнал.'
        },
        {
            title: 'ODANT · oda/',
            text: 'UI-фреймворк: Web Components, layouts, формы, диалоги.'
        },
        {
            title: 'ODANT · $server/',
            text: 'Типы, handlers, lib — расширяемость без правок ядра.'
        },
        {
            title: 'WORK · PaaS',
            text: 'Чат, документы, звонки, календарь, почта и ИИ-память в одной модели.'
        }
    ],
    get modules() {
        return new AsyncPromise(async () => {
            const items = (await this.$item?.items) || [];
            return items.filter(i => i instanceof CORE.$class);
        });
    },
    open_module(item) {
        const url = item.url + '/~/handlers//site/index.html';
        window.open(url, '_blank');
    }
}
