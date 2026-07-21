export default {
    template: /*html*/ `
        <style>
            :host{
                @apply --flex;
                @apply --vertical;
                overflow: hidden;
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
        return this.$context?.url + '/~/handlers/pages/open/index.html';
    }
}