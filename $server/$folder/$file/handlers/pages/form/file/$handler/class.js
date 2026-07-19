export default {
    get icon(){
        return 'files:document'
    },
    template: /*html*/ `
        <style>
            :host{
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
    get label(){
        return this.$item?.ext?.toUpperCase?.();
    },
    fileControl: 'object',
    get url(){
        return this.$item?.url + '/~/handlers/pages/open/index.html';
    }
}