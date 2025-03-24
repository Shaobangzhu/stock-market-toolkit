"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginController = void 0;
require("reflect-metadata");
var decorator_1 = require("../decorator");
var util_1 = require("../utils/util");
/**
 * This class is an Express controller using decorators (@controller, @post, @get) to register routes.
 * It handles login, logout, and the home page.
 * The session-based login logic is basic (with hardcoded password "123").
 * Responses use a utility function to maintain a consistent format.
 */
var LoginController = /** @class */ (function () {
    function LoginController() {
    }
    LoginController_1 = LoginController;
    // Private static helper to check if user is logged in
    LoginController._isLogin = function (req) {
        return !!(req.session ? req.session.login : false);
    };
    // Route handler for POST /login
    LoginController.prototype.login = function (req, res) {
        var isLogin = LoginController_1._isLogin(req);
        if (isLogin) {
            res.json((0, util_1.getResponseData)(false, "User Already Logged In."));
        }
        else {
            if (req.body.password === "123" && req.session) {
                if (req.session) {
                    req.session.login = true;
                    res.json((0, util_1.getResponseData)(true));
                }
                else {
                    res.json((0, util_1.getResponseData)(false, "Log In Failure!"));
                }
            }
            else {
                res.json((0, util_1.getResponseData)(false, "Log In Failure!"));
            }
        }
    };
    // Route handler for GET /logout
    LoginController.prototype.logout = function (req, res) {
        if (req.session) {
            req.session.login = undefined;
        }
        res.json((0, util_1.getResponseData)(true));
    };
    // Route handler for GET /
    LoginController.prototype.home = function (req, res) {
        var isLogin = LoginController_1._isLogin(req);
        if (isLogin) {
            res.send("\n        <html>\n            <body>\n                <a href='/getData'>Get Data</a>\n                <a href='/showData'>Show Data</a>\n                <a href='/logout'>Log Out</a>\n            </body>\n        </html>\n    ");
        }
        else {
            res.send("\n        <html>\n            <body>\n                <form method=\"post\" action=\"/login\">\n                    <input type=\"password\" name=\"password\" />\n                    <button>Log In</button>\n                </form>\n            </body>\n        </html>\n    ");
        }
    };
    var LoginController_1;
    __decorate([
        (0, decorator_1.post)("/login"),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], LoginController.prototype, "login", null);
    __decorate([
        (0, decorator_1.get)("/logout"),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], LoginController.prototype, "logout", null);
    __decorate([
        (0, decorator_1.get)("/"),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], LoginController.prototype, "home", null);
    LoginController = LoginController_1 = __decorate([
        (0, decorator_1.controller)("/")
    ], LoginController);
    return LoginController;
}());
exports.LoginController = LoginController;
