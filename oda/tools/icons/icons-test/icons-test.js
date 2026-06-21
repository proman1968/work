import '../icons-tree/icons-tree.js';
import '../icons-set/icons-set.js';
import '/oda//splitter.js';
ODA({
    is: 'oda-icons-test',
    template: `
        <style>
            :host {
                @apply --horizontal;
                position: relative;
                overflow: hidden;
                min-height: 100vh;
                height: 100vh;
            }
        </style>
        <oda-icons-tree no-flex ::focused-icon ::selected-lib ::search-icons style="width: 360px;"></oda-icons-tree>
        <oda-splitter vertical min="140"></oda-splitter>
        <oda-icons-set flex :library="selectedLib || focusedIcon.split(':')[0] || ''" ::focused-icon :search-icons="searchIcons"></oda-icons-set>
    `,
    $public: {
        iconSize: 48,
    },
    selectedLib: '',
    focusedIcon: '',
    searchIcons: []
})
