/** Контрол html между лентой и панелью: превью без кнопок. Высота — по пингу контента, кэп 80vh шелла. */
ODA({ is: 'microchat-control-html',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                height: auto;
                min-height: 0;
                box-sizing: border-box;
                padding: 4px 8px;
            }
            microchat-html {
                flex: 1 1 auto;
                min-height: 0;
            }
        </style>
        <microchat-html :data></microchat-html>
    `,
    data: null,
});
