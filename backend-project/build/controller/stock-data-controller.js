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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
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
var singleStockHourlyVolumeFetcher_1 = require("../utils/singleStockHourlyVolumeFetcher");
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
            var position = path_1.default.resolve(__dirname, constants_1.STOCK_PRICE_DATA_FILE_PATH);
            var result = fs_1.default.readFileSync(position, "utf8");
            res.json((0, util_1.getResponseData)(JSON.parse(result)));
        }
        catch (e) {
            res.json((0, util_1.getResponseData)(false, "Data NOT Exist!"));
        }
    };
    StockDataController.prototype.getSingleStockVolume = function (req, res) {
        return __awaiter(this, void 0, void 0, function () {
            var result, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, singleStockHourlyVolumeFetcher_1.singleStockHourlyVolumeFetcher)()];
                    case 1:
                        result = _a.sent();
                        res.json((0, util_1.getResponseData)(result));
                        return [3 /*break*/, 3];
                    case 2:
                        e_1 = _a.sent();
                        console.error(e_1);
                        res.json((0, util_1.getResponseData)(null, "Failed to fetch hourly volume data."));
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    StockDataController.prototype.showSingleStockVolume = function (req, res) {
        try {
            var position = path_1.default.resolve(__dirname, constants_1.SINGLE_STOCK_VOLUME_DATA_FILE_PATH);
            var result = fs_1.default.readFileSync(position, "utf-8");
            res.json((0, util_1.getResponseData)(JSON.parse(result)));
        }
        catch (e) {
            res.json((0, util_1.getResponseData)(false, "Volume Data NOT Exist!"));
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
    __decorate([
        (0, decorator_1.get)("/getSingleStockVolume"),
        (0, decorator_1.use)(checkLogin),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", Promise)
    ], StockDataController.prototype, "getSingleStockVolume", null);
    __decorate([
        (0, decorator_1.get)("/showSingleStockVolume"),
        (0, decorator_1.use)(checkLogin),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", void 0)
    ], StockDataController.prototype, "showSingleStockVolume", null);
    StockDataController = __decorate([
        (0, decorator_1.controller)("/api")
    ], StockDataController);
    return StockDataController;
}());
exports.StockDataController = StockDataController;
