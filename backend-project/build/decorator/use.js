"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.use = use;
/**
 * Middleware decorator to attach a middleware function to a route handler method.
 *
 * @param middleware - An Express middleware function (e.g., authentication, validation).
 * @returns A method decorator that sets 'middleware' metadata on the target method.
 *
 * This metadata can later be used (e.g., in @controller) to apply the middleware
 * when registering the route.
 */
function use(middleware) {
    return function (target, key) {
        Reflect.defineMetadata('middleware', middleware, target, key);
    };
}
