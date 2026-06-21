export default {
    imports: '~/lib//icon',
    template: /*html*/`
        <style>
            :host {
                @apply --horizontal;
                @apply --no-flex;
                align-items: center;
            }
            .item{
                scale: .8;
                border: none;
                border-radius: 4px;

            }
        </style>
        <item-icon auto-run class="item" light raised ~for="this.$item?.tools" raised border :show-labels ~is="showLabels?'item-node':'item-icon'" :$item="$for?.item" :hide-toolbar='!showLabels'></item-icon>
    `,
    $public:{
        filter: {
            $def: '',
            $list: ['service', 'quickTool'],
        },
        showLabels: {
            $def: false,
            $attr: true,
        }
    }

}