import * as fsPath from 'path';

export const normalizePath = (path: string) => fsPath.normalize(fsPath.resolve(path.replace(/[/\\]+/g, '/'))).replace(/\\/g, '/');
