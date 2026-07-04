export default {
    icon: 'editor:mode-edit',
    allowSave: true,
    get allowUse() {
        return this.$context?.STATIC?.fields?.length;
    },
    template: /*html*/`
    <style>
        :host {
            @apply --vertical;
            overflow: hidden;
        }
    </style>
    <item-editor-form ~if="dataAccessNode" :data-access-node="dataAccessNode"></item-editor-form>
    `,
    dataAccessNode: null,
    async attached() {
        const node = await this.$item.dataAccessRoot
        this.dataAccessNode = node.children.find(n => n.field.id === 'STATIC');
    }
};
ODA({
    is: 'item-editor-form',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            align-items: flex-start;
            flex-wrap: wrap;
            gap: 8px;
            padding: 16px;
            overflow-x: hidden;
            overflow-y: auto;
        }
    </style>
        <item-editor-form-field-container ~for="dataAccessNode?.children" :data-access-node="$for?.item"></item-editor-form-field-container>
    `,
    dataAccessNode: null,
});

ODA({
    is: 'item-editor-form-container',
    template: /*html*/`
    <style>
        :host([sizing="small"]){
            flex: 1 0 4em;
        }
        :host([sizing="mid"]){
            flex: 1 0 auto;
        }
        :host([sizing="full"]){
            flex: 1 0 100%;
        }
        :host {
            @apply --horizontal;
        }
    </style>`,
    sizing: {
        $attr: true,
        $list: ['small', 'mid', 'full'],
        $def: 'mid'
    },
});

ODA({
    is: 'item-editor-form-field-container',
    extends: 'item-editor-form-container',
    template: /*html*/`
    <style>
        :host {
            fieldset {
                @apply --horizontal;
                flex: auto;
                font-size: inherit;
                border-radius: 8px;

                .editor-box {
                    @apply --vertical;
                    @apply --flex;

                    .children-box {
                        @apply --horizontal;
                        @apply --flex;
                        flex-wrap: wrap;
                        margin: 4px -8px -4px -16px;
                        gap: 8px;
                    }
                }
            }
        }
    </style>
    <fieldset>
        <legend>{{label}}</legend>
        <oda-icon ~if="children?.length" :icon="expanded ? 'icons:chevron-right:90' : 'icons:chevron-right'" fill="var(--light-color)" icon-size="32" @click="expanded = !expanded"></oda-icon>
        <div class="editor-box">
            <div ~is="editorTag" :data-access-node></div>
            <div ~if="children?.length && expanded" class="children-box">
                <item-editor-form-field-container ~for="children" :data-access-node="$for?.item"></item-editor-form-field-container>
            </div>
        </div>
    </fieldset>
    `,
    get editorTag() {
        switch (this.dataAccessNode.field.type) {
            case 'String':
            case 'Number':
            case 'DataTime':
            case 'Boolean':
            case 'table':
            default: {
                return 'item-editor-form-string-field-editor'
            }
            case 'Text': {
                return 'item-editor-form-text-field-editor'
            }
        }
    },
    dataAccessNode: null,
    expanded: {
        $save: true,
        $def: false
    },
    get sizing() {
        switch (this.dataAccessNode?.field.type) {
            case 'table':
            case 'Text': {
                return 'full'
            }
            case 'Boolean': {
                return 'small';
            }
            case 'String':
            case 'Number':
            case 'DataTime':
            default: {
                return 'mid'
            }
        }

    },
    get $saveKey(){
        return this.dataAccessNode?.id;
    },
    get label() {
        return this.dataAccessNode?.label;
    },
    get children() {
        return this.dataAccessNode?.children;
    },
});
ODA({
    is: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host {
            @apply --horizontal;
            @apply --flex;
        }
    </style>
    `,
    dataAccessNode: null,
    async getValue() {
        return (await this.dataAccessNode.getValue()) || '';
    },
    async setValue(value) {
        this.dataAccessNode.setValue(value);
    }
});
ODA({
    is: 'item-editor-form-string-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        input {
            @apply --flex;
            min-width: 0;
            display: block;
            box-sizing: border-box;
            padding: 4px;
            font-size: 125%;
            border: none;
            border-radius: 4px;
        }
    </style>
    <input type="text" size="12" :value="getValue()" @input="setValue($this.value)">
    `,
});
ODA({
    is: 'item-editor-form-text-field-editor',
    extends: 'item-editor-form-field-editor',
    template: /*html*/`
    <style>
        :host{
            @apply --vertical;
        }
        textarea {
            @apply --flex;
            border: none;
            box-sizing: border-box;
            resize: vertical;
            min-height: 2em;
            white-space: pre;
            height: {{editorHeight}}px;
        }
        {{''}}
    </style>
    <textarea rows="4" :value="getValue()" @input="setValue($this.value)" @resize="editorHeight = $this.offsetHeight"></textarea>
    `,
    editorHeight: {
        $save: true,
        $def: 60
    },
})
/*
body: {
    data: {
        f1: {
            @: 'f1 value',
            f1_1: {
                @: 'f1_1 value',
                f1_1_1: {
                    @: 'f1_1_1 value'
                },
                f1_1_2: {
                    @: 'f1_1_2 value'
                }
            }
        },
        f2: {
            @: 'f2 value'
        }
    }
}
 */