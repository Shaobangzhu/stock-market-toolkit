"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.use = use;
function use(middleware) {
    return function (target, key) {
        Reflect.defineMetadata('middleware', middleware, target, key);
    };
}
