"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.controller = controller;
var router_1 = __importDefault(require("../router"));
/**
 * Class decorator factory for registering a controller.
 *
 * @param root - The base route prefix for all handlers in the decorated class.
 *
 * This decorator will iterate over all methods in the class prototype,
 * check for metadata (`path`, `method`, and optional `middleware`),
 * and register each decorated method as a route handler on the Express router.
 */
function controller(root) {
    return function (target) {
        // Loop through all properties (methods) defined on the class prototype
        for (var key in target.prototype) {
            var path = Reflect.getMetadata('path', target.prototype, key);
            var method = Reflect.getMetadata('method', target.prototype, key);
            var handler = target.prototype[key];
            var middleware = Reflect.getMetadata('middleware', target.prototype, key);
            if (path && method) {
                var fullPath = root === '/' ? path : "".concat(root).concat(path);
                if (middleware) {
                    router_1.default[method](fullPath, middleware, handler);
                }
                else {
                    router_1.default[method](fullPath, handler);
                }
            }
        }
    };
}
