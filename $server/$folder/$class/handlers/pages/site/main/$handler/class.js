export default {
    icon: 'icons:home',
    label: 'Главная',
    imports: '~/lib//icon',
    template: /* html */`
        <style>
            :host {
                @apply --flex;
                @apply --vertical;
                @apply --content;
                overflow: auto;
                align-items: center;
                justify-content: center;

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
        <div class="hero">
            <item-icon :$item icon-size="72"></item-icon>
            <div class="hero-text">
                <h1>{{$item.label}}</h1>
                <p class="lead">{{pitch}}</p>
            </div>
        </div>
    `,
    get pitch() {
        return this.$item?.label
            ? `Раздел «${this.$item.label}» в системе WORK.`
            : 'Раздел системы WORK.';
    }
}
