export default {
    template: /*html*/ `
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
            }
            @media print {
                :host {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                }
            }
            object{
                border: none;
            }
        </style>
        <div ~is="fileControl" :$item :data="url" content flex></div>
    `,
    $public:{
        allowSave: false,
    },
    fileControl: 'object',
    get url(){
        return this.$context?.url;
    }
}