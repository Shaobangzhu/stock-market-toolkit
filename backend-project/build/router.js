"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stockPriceFetcher_1 = __importDefault(require("./utils/stockPriceFetcher"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("./utils/util");
const checkLogin = (req, res, next) => {
    const isLogin = req.session ? req.session.login : false;
    if (isLogin) {
        next();
    }
    else {
        res.json((0, util_1.getResponseData)(null, 'Please Log In First!'));
    }
};
const router = (0, express_1.Router)();
router.get("/", (req, res) => {
    const isLogin = req.session ? req.session.login : false;
    if (isLogin) {
        res.send(`
        <html>
            <body>
                <a href='/getData'>Get Data</a>
                <a href='/showData'>Show Data</a>
                <a href='/logout'>Log Out</a>
            </body>
        </html>
    `);
    }
    else {
        res.send(`
        <html>
            <body>
                <form method="post" action="/login">
                    <input type="password" name="password" />
                    <button>Log In</button>
                </form>
            </body>
        </html>
    `);
    }
});
router.get("/logout", (req, res) => {
    if (req.session) {
        req.session.login = undefined;
    }
    res.json((0, util_1.getResponseData)(true));
});
router.post("/login", (req, res) => {
    const isLogin = req.session ? req.session.login : false;
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
});
router.get("/getData", checkLogin, (req, res) => {
    stockPriceFetcher_1.default.getInstance().fetchAndSaveData();
    res.json((0, util_1.getResponseData)(true));
});
router.get("/showData", checkLogin, (req, res) => {
    try {
        const position = path_1.default.resolve(__dirname, "../data/prices.json");
        const result = fs_1.default.readFileSync(position, "utf8");
        res.json((0, util_1.getResponseData)(JSON.parse(result)));
    }
    catch (e) {
        res.json((0, util_1.getResponseData)(false, "Data NOT Exist!"));
    }
});
exports.default = router;
