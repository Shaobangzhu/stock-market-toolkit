import 'reflect-metadata';
import { RequestHandler } from 'express';
import { LoginController, StockDataController } from "../controller";

/**
 * Middleware decorator to attach a middleware function to a route handler method.
 * 
 * @param middleware - An Express middleware function (e.g., authentication, validation).
 * @returns A method decorator that sets 'middleware' metadata on the target method.
 * 
 * This metadata can later be used (e.g., in @controller) to apply the middleware 
 * when registering the route.
 */
export function use(middleware: RequestHandler) {
    return function(target: LoginController | StockDataController, key: string) {
        Reflect.defineMetadata('middleware', middleware, target, key);
    }
}