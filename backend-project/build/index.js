"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var body_parser_1 = __importDefault(require("body-parser"));
var cookie_session_1 = __importDefault(require("cookie-session"));
require("./controller/login-controller");
require("./controller/stock-data-controller");
var router_1 = __importDefault(require("./router"));
// Create a new Express application
var app = (0, express_1.default)();
// Middleware to parse form data from POST requests (e.g., login form)
app.use(body_parser_1.default.urlencoded({ extended: false }));
// Middleware to enable cookie-based sessions
app.use((0, cookie_session_1.default)({
    name: "session", // Cookie name
    keys: ["author clu"], // Secret key(s) for encryption
    maxAge: 24 * 60 * 60 * 1000, // Cookie/session expiration time: 1 day
}));
// Use the router that contains all registered controller routes
app.use(router_1.default);
// Start the Express server on port 7001
app.listen(7001, function () {
    console.log("server is running");
});
