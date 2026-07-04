export const FS = {};

import { $folder } from './folder.js';
import { $storage } from './storage.js';
import { $user } from './user.js';
import { $file } from './file.js';

Object.assign(FS, { $folder, $storage, $user, $file });

export { $folder, $storage, $user, $file };
