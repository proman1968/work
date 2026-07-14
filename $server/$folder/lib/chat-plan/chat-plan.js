ODA({is: 'oda-chat-plan',
    template: /*html*/`
        <style>
            :host {
                @apply --vertical;
                @apply --content;
                @apply --raised;
                border-radius: 4px;
                overflow: hidden;
                gap: 0;
            }
            .header {
                @apply --horizontal;
                @apply --bold;
                font-size: x-small;
                padding: 4px 8px;
                cursor: pointer;
                align-items: center;
                gap: 6px;
                user-select: none;
            }
            .header:hover {
                @apply --header;
            }
            .progress-track {
                height: 3px;
                @apply --dark;
                overflow: hidden;
            }
            .progress-bar {
                height: 100%;
                background: var(--success-color);
                transition: width 0.3s;
            }
            .steps {
                @apply --vertical;
                gap: 2px;
                padding: 4px 8px;
            }
            .step {
                @apply --horizontal;
                @apply --raised;
                gap: 4px;
                align-items: center;
                font-size: xx-small;
                padding: 2px 8px;
                border-radius: 12px;
                cursor: pointer;
                user-select: none;
            }
            .step:hover {
                @apply --header;
            }
            .step.done {
                opacity: .5;
                text-decoration: line-through;
            }
            .step.active {
                @apply --accent;
                @apply --bold;
            }
        </style>
        <div class="header" @tap="collapsed = !collapsed">
            <span>{{currentNumber}}/{{steps.length}}</span>
            <span style="flex:1">{{currentDescription}}</span>
            <oda-icon :icon="collapsed ? 'icons:expand-more' : 'icons:expand-less'" icon-size="16"></oda-icon>
        </div>
        <div class="progress-track">
            <div class="progress-bar" :style="'width: ' + progressPercent + '%'"></div>
        </div>
        <div class="steps" ~if="!collapsed">
            <div class="step" ~for="steps" :class="$for.item.status" @tap="fire('tap-step', $for.index)">
                <oda-icon :icon="stepIcon($for.item.status)" icon-size="14"></oda-icon>
                <span>{{$for.item.step}}. {{$for.item.description}}</span>
            </div>
        </div>
    `,
    steps: [],
    collapsed: true,
    get currentNumber() {
        const idx = this.steps.findIndex(s => s.status === 'in_progress');
        if (idx >= 0) return idx + 1;
        const pending = this.steps.findIndex(s => s.status !== 'done');
        if (pending >= 0) return pending + 1;
        return this.steps.length; // все выполнены
    },
    get isComplete() {
        return this.steps.length > 0 && this.steps.every(s => s.status === 'done');
    },
    get progressPercent() {
        if (!this.steps.length) return 0;
        const done = this.steps.filter(s => s.status === 'done').length;
        return Math.round(done / this.steps.length * 100);
    },
    get currentStep() {
        return this.steps.find(s => s.status === 'in_progress')
            || this.steps.find(s => s.status !== 'done')
            || null;
    },
    get currentDescription() {
        if (this.isComplete) return 'Выполнено!';
        const step = this.currentStep;
        return step ? step.description : '';
    },
    stepIcon(status) {
        switch (status) {
            case 'done': return 'icons:check-circle';
            case 'in_progress': return 'av:play-circle-outline';
            default: return 'icons:radio-button-unchecked';
        }
    },
});