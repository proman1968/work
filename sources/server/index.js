export const FS = {};
 
import { $folder } from './folder.js';
import { $class } from './class.js';
import { $handler, $trigger, $method, $timer } from './handler.js';
import { $user } from './user.js';
import { $file } from './file.js';
import { $node } from './node.js';
 
Object.assign(FS, { $folder, $class, $handler, $trigger, $method, $timer, $user, $file, $node });
 
export { $folder, $class, $handler, $user, $file, $node };
