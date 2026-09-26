/** Контрол todo в слоте панели: чеклист без кнопок. Данные — объект todo (steps). */
ODA({ is: 'microchat-control-todo',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                padding: 4px 8px;
            }
        </style>
        <microchat-todo-steps :data></microchat-todo-steps>
    `,
    data: null,
});
