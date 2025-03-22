import router from '../router';

enum Methods {
    get = 'get',
    post = 'post'
}

export function controller(target: any) {
    for (let key in target.prototype) {
        const path = Reflect.getMetadata('path', target.prototype, key);
        const method: Methods = Reflect.getMetadata('method', target.prototype, key);
        const handler = target.prototype[key];
        const middleware = Reflect.getMetadata('middleware', target.prototype, key);
        if (path && method && handler) {
            if (middleware) {
                router[method](path, middleware, handler);
            } else {
                router[method](path, handler);
            }
        }
    }
}