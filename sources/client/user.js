import { $folder } from './folder.js';
import { $storage } from './storage.js';

export class $user extends $storage{
    get iconColor(){
        if(this.icon[0] === '@'){
            let id = this.id;
            let hash = 0;
            for (let i = 0; i < id.length; i++) {
                hash = id.charCodeAt(i) + ((hash << 5) - hash);
            }
            // Преобразуем хэш в HEX цвет
            let color = '#';
            for (let i = 0; i < 3; i++) {
                const value = (hash >> (i * 8)) & 0xFF;
                color += value.toString(16).padStart(2, '0');
            }
            return color;
        }
        return '';
    }
}

$user.LISTS = [...$folder.LISTS, 'online'];
