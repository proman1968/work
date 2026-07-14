ODA({is: 'oda-chat-form',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                @apply --raised;
                border-radius: 4px;
                margin-left: 8px;
                gap: 6px;
                padding: 6px 8px;
            }
            .field {
                @apply --vertical;
                gap: 2px;
            }
            .field label {
                font-size: xx-small;
                @apply --bold;
                opacity: .8;
            }
            .field input, .field textarea, .field select {
                @apply --content;
                border-radius: 4px;
                padding: 4px 8px;
                font-size: x-small;
                font-family: inherit;
                outline: none;
                min-width: 0;
                border: none;
            }
            .field textarea {
                min-height: 2em;
                resize: vertical;
            }
        </style>
        <div class="field" ~for="questions">
            <label>{{$for.item.label}}</label>
            <textarea ~if="$for.item.type === 'textarea'" 
                ::value="localAnswers[$for.item.id]" 
                placeholder="Введите ответ..."></textarea>
            <select ~if="$for.item.type === 'select'" 
                ::value="localAnswers[$for.item.id]"
                @change="localAnswers[$for.item.id] = $event.target.value">
                <option value="" disabled selected>Выберите...</option>
                <option ~for="$for.item.options">{{$for.item}}</option>
            </select>
            <oda-toggle ~if="$for.item.type === 'checkbox'" 
                ::toggled="localAnswers[$for.item.id]"
                checked-label="Да" unchecked-label="Нет">
            </oda-toggle>
            <input type="number" ~if="$for.item.type === 'number'" 
                ::value="localAnswers[$for.item.id]" 
                placeholder="Введите число...">
            <input type="email" ~if="$for.item.type === 'email'" 
                ::value="localAnswers[$for.item.id]" 
                placeholder="email@example.com">
            <input type="date" ~if="$for.item.type === 'date'" 
                ::value="localAnswers[$for.item.id]">
            <input type="text" ~if="$for.item.type === 'text' || !$for.item.type" 
                ::value="localAnswers[$for.item.id]" 
                placeholder="Введите ответ...">
        </div>
        <oda-button success icon="icons:check" label="Ответить" @tap="submit"></oda-button>
    `,
    imports: 'oda//button, oda/components/toggle/toggle',
    questions: [],
    localAnswers: {},
    init() {
        // Нормализовать options: преобразовать объекты в строки
        for (const q of this.questions) {
            if (q.type === 'select' && Array.isArray(q.options)) {
                q.options = q.options.map(opt => {
                    if (typeof opt === 'string') return opt;
                    if (typeof opt === 'object') return opt.label || opt.text || opt.value || String(opt);
                    return String(opt);
                });
            }
            // Инициализация значений по умолчанию
            if (this.localAnswers[q.id] === undefined) {
                this.localAnswers[q.id] = q.type === 'checkbox' ? false : '';
            }
        }
    },
    submit() {
        const answers = {};
        for (const q of this.questions) {
            answers[q.id] = this.localAnswers[q.id];
        }
        this.fire('answer', answers);
    },
});