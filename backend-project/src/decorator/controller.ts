import router from '../router';
import { RequestHandler } from 'express';
import { Methods } from '../enums/methods';

/**
 * Class decorator factory for registering a controller.
 * 
 * @param root - The base route prefix for all handlers in the decorated class.
 * 
 * This decorator will iterate over all methods in the class prototype, 
 * check for metadata (`path`, `method`, and optional `middleware`), 
 * and register each decorated method as a route handler on the Express router.
 */
export function controller(root: string) {
    return function (target: new (...args: any[]) => any) {
        // Loop through all properties (methods) defined on the class prototype
        for (let key in target.prototype) {
            const path: string = Reflect.getMetadata('path', target.prototype, key);
            const method: Methods = Reflect.getMetadata('method', target.prototype, key);
            const handler = target.prototype[key];
            const middleware: RequestHandler = Reflect.getMetadata('middleware', target.prototype, key);
            if (path && method) {
                const fullPath = root === '/' ? path : `${root}${path}`;
                if (middleware) {
                    router[method](fullPath, middleware, handler);
                } else {
                    router[method](fullPath, handler);
                }
            }
        }
    }
}