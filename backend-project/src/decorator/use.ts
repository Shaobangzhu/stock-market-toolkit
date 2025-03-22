import { RequestHandler } from 'express';
import { LoginController, StockDataController } from "../controller";

export function use(middleware: RequestHandler) {
    return function(target: LoginController | StockDataController, key: string) {
        Reflect.defineMetadata('middleware', middleware, target, key);
    }
}