import { LoginController, StockDataController } from "../controller";
import { Methods } from '../enums/methods';

/**
 * Factory function to create route method decorators (e.g., @get, @post).
 * 
 * @param type - The HTTP method (e.g., Methods.get or Methods.post)
 * @returns A decorator function that accepts a path and decorates the method.
 */
function getRequestDecorator(type: Methods) {
    /**
     * Route decorator that attaches metadata to a method.
     * 
     * @param path - The relative URL path for the route (e.g., '/login')
     * 
     * This decorator sets metadata keys:
     * - 'path': the route URL
     * - 'method': the HTTP method ('get' or 'post')
     */
    return function (path: string) {
        return function(target: LoginController | StockDataController, key: string) {
            // Store the path and HTTP method as metadata on the method
            Reflect.defineMetadata('path', path, target, key);
            Reflect.defineMetadata('method', type, target, key);
        };
    }
}

export const get = getRequestDecorator(Methods.get);
export const post = getRequestDecorator(Methods.post);