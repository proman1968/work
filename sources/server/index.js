export const FS = {};
 
import { $folder } from './folder.js';
import { $class } from './class.js';
import { $handler } from './handler.js';
import { $user } from './user.js';
import { $file } from './file.js';
 
Object.assign(FS, { $folder, $class, $handler, $user, $file });
 
export { $folder, $class, $handler, $user, $file };
