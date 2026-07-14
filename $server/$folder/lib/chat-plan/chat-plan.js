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
                @apply --horizontal;
                gap: 4px;
                padding: 4px 8px;
                flex-wrap: wrap;
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
            <oda-icon icon="icons:checklist" icon-size="16"></oda-icon>
            <span flex>{{currentTitle}}</span>
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
    get doneCount() {
        return this.steps.filter(s => s.status === 'done').length;
    },
    get progressPercent() {
        return this.steps.length ? Math.round(this.doneCount / this.steps.length * 100) : 0;
    },
    get currentStep() {
        return this.steps.find(s => s.status === 'in_progress')
            || this.steps.find(s => s.status !== 'done')
            || null;
    },
    get currentTitle() {
        const step = this.currentStep;
        if (step)
            return `${step.step}. ${step.description}`;
        if (this.steps.length)
            return `План завершён (${this.doneCount}/${this.steps.length})`;
        return '';
    },
    stepIcon(status) {
        switch (status) {
            case 'done': return 'icons:check-circle';
            case 'in_progress': return 'av:play-circle-outline';
            default: return 'icons:radio-button-unchecked';
        }
    },
});