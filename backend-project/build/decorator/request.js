"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.post = exports.get = void 0;
var methods_1 = require("../enums/methods");
/**
 * Factory function to create route method decorators (e.g., @get, @post).
 *
 * @param type - The HTTP method (e.g., Methods.get or Methods.post)
 * @returns A decorator function that accepts a path and decorates the method.
 */
function getRequestDecorator(type) {
    /**
     * Route decorator that attaches metadata to a method.
     *
     * @param path - The relative URL path for the route (e.g., '/login')
     *
     * This decorator sets metadata keys:
     * - 'path': the route URL
     * - 'method': the HTTP method ('get' or 'post')
     */
    return function (path) {
        return function (target, key) {
            // Store the path and HTTP method as metadata on the method
            Reflect.defineMetadata('path', path, target, key);
            Reflect.defineMetadata('method', type, target, key);
        };
    };
}
exports.get = getRequestDecorator(methods_1.Methods.get);
exports.post = getRequestDecorator(methods_1.Methods.post);
