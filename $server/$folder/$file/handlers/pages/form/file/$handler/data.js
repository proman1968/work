export default {
    get icon(){
        return 'files:document'
    },
    template: /*html*/ `
        <style>
            :host{
                @apply --vertical;
            }
            object{
                border: none;
            }
        </style>
        <object content :data="url" flex @load></object>        
    `,
    $public:{
        allowSave: true,
    },
    get url(){
        return this.$item?.url + '/~/handlers/pages/open/index.html';
    },
    _onChange(e){
        let body =  e.detail.value;
        if(!this.$item.body || this.$item.body !== body){
            this.$item.body = body;
            this.$item.isChanged = true;
        }
    },
    _onLoad(e){
        e.target.contentDocument.addEventListener("change", this._onChange.bind(this));
        e.target.contentWindow.addEventListener('pointerdown', e => {
            let h = e.target;
            while (h && !h.hasAttribute('popover')) {
                h = h.host || h.parentElement;
            }
            const popovers = top.document.querySelectorAll('[popover]');
            for (let p of popovers) {
                if (h) {
                    if (h === p)
                        h = undefined;
                    continue;
                }
                p.remove();
            }
        })
    }
}