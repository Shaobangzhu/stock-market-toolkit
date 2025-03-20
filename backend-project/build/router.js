"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var stockPriceFetcher_1 = __importDefault(require("./utils/stockPriceFetcher"));
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var util_1 = require("./utils/util");
var checkLogin = function (req, res, next) {
    var isLogin = req.session ? req.session.login : false;
    if (isLogin) {
        next();
    }
    else {
        res.json((0, util_1.getResponseData)(null, 'Please Log In First!'));
    }
};
var router = (0, express_1.Router)();
router.get("/", function () { });
router.get("/logout", function (req, res) {
    if (req.session) {
        req.session.login = undefined;
    }
    res.json((0, util_1.getResponseData)(true));
});
router.post("/login", function (req, res) {
    var isLogin = req.session ? req.session.login : false;
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
router.get("/getData", checkLogin, function (req, res) {
    stockPriceFetcher_1.default.getInstance().fetchAndSaveData();
    res.json((0, util_1.getResponseData)(true));
});
router.get("/showData", checkLogin, function (req, res) {
    try {
        var position = path_1.default.resolve(__dirname, "../data/prices.json");
        var result = fs_1.default.readFileSync(position, "utf8");
        res.json((0, util_1.getResponseData)(JSON.parse(result)));
    }
    catch (e) {
        res.json((0, util_1.getResponseData)(false, "Data NOT Exist!"));
    }
});
exports.default = router;
