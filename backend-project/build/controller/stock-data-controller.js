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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockDataController = void 0;
require("reflect-metadata");
var decorator_1 = require("../decorator");
var util_1 = require("../utils/util");
var stockPriceFetcher_1 = __importDefault(require("../utils/stockPriceFetcher"));
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var constants_1 = require("../utils/constants");
// Middleware to check if the user is logged in (based on session)
var checkLogin = function (req, res, next) {
    var isLogin = !!(req.session ? req.session.login : false);
    if (isLogin) {
        next();
    }
    else {
        res.json((0, util_1.getResponseData)(null, 'Please Log In First!'));
    }
};
/**
 * getData(): Fetches stock price data and saves it to disk.
 * showData(): Reads and returns saved stock data from a file.
 */
var StockDataController = /** @class */ (function () {
    function StockDataController() {
    }
    // GET /getData
    // Middleware @use(checkLogin) ensures only logged-in users can access
    StockDataController.prototype.getData = function (req, res) {
        stockPriceFetcher_1.default.getInstance().fetchAndSaveData();
        res.json((0, util_1.getResponseData)(true));
    };
    // GET /showData
    // Middleware @use(checkLogin) ensures only logged-in users can access
    StockDataController.prototype.showData = function (req, res) {
        try {
            var position = path_1.default.resolve(__dirname, constants_1.DATA_FILE_PATH);
            var result = fs_1.default.readFileSync(position, "utf8");
            res.json((0, util_1.getResponseData)(JSON.parse(result)));
        }
        catch (e) {
            res.json((0, util_1.getResponseData)(false, "Data NOT Exist!"));
        }
    };
    __decorate([
        (0, decorator_1.get)("/getData"),
        (0, decorator_1.use)(checkLogin),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], StockDataController.prototype, "getData", null);
    __decorate([
        (0, decorator_1.get)("/showData"),
        (0, decorator_1.use)(checkLogin),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], StockDataController.prototype, "showData", null);
    StockDataController = __decorate([
        (0, decorator_1.controller)("/")
    ], StockDataController);
    return StockDataController;
}());
exports.StockDataController = StockDataController;
