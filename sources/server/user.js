import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { $item } from '../core.js';
import * as mime from "mime-types";
import { extractor } from '../modules/embeddings/embeddings.js';
import { DOMParser } from 'linkedom';
import { FS } from './index.js';
import { $storage } from './storage.js';
export class $user extends $storage{
    get online(){
        return !!Object.values($server?.users)?.find(u => u.uid === this.id);
    }
    get $public(){
        return {
            icon:{
                get(){
                    let icon = this.DATA?.icon;
                    if(!icon){
                        icon = this.label.split(' ');
                        while(icon.length>2)
                            icon.pop()
                        icon = icon.map(s=>s[0]);
                        icon = icon.join('');
                        icon = '@:' + icon.toUpperCase()
                    }
                    return icon || 'fontawesome:s-puzzle-piece';
                }
            }
        }
    }
}
$user.steps = Object.create(null);