/** oda-icons-test — браузер иконок: дерево библиотек слева, сетка иконок выбранной библиотеки справа. */
import '../icons-tree/icons-tree.js';
import '../icons-set/icons-set.js';
import '/oda/components/layouts/splitter/splitter.js';
ODA({
    is: 'oda-icons-test',
    template: `
        <style>
            :host {
                @apply --horizontal;
                position: relative;
                overflow: hidden;
            }
        </style>
        <oda-icons-tree no-flex ::value="focusedIcon" style="width: 360px; overflow: auto;"></oda-icons-tree>
        <oda-splitter vertical min="140"></oda-splitter>
        <oda-icons-set flex :library="focusedIcon.split(':')[0] || 'icons'" ::focused-icon></oda-icons-set>
    `,
    $public: {
        iconSize: 48,
    },
    focusedIcon: ''
})
