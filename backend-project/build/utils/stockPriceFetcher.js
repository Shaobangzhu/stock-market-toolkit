"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
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
var axios_1 = __importDefault(require("axios"));
var fs_1 = __importDefault(require("fs"));
var constants_1 = require("./constants");
/**
 * Singleton class responsible for fetching stock prices from Alpha Vantage API
 * and saving the data to a JSON file.
 */
var StockPriceFetcher = /** @class */ (function () {
    /**
     * Private constructor to prevent direct instantiation.
     * Initializes the required configuration values from constants.
     */
    function StockPriceFetcher() {
        this._apiKey = constants_1.API_KEY;
        this._stockSymbols = constants_1.STOCK_SYMBOLS;
        this._timeTag = constants_1.TIME_TAG;
        this._dataFilePath = constants_1.DATA_FILE_PATH;
    }
    /**
     * Returns the singleton instance of `StockPriceFetcher`.
     * If the instance does not exist, it is created.
     */
    StockPriceFetcher.getInstance = function () {
        if (!StockPriceFetcher._instance) {
            StockPriceFetcher._instance = new StockPriceFetcher();
        }
        return StockPriceFetcher._instance;
    };
    /**
     * Fetches stock price data from the API, formats it, and saves it to a JSON file.
     */
    StockPriceFetcher.prototype.fetchAndSaveData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var formattedData;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._fetchAndFormatStockData()];
                    case 1:
                        formattedData = _a.sent();
                        this._saveStockPrices(formattedData);
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Fetches the latest stock price for a given symbol from Alpha Vantage API.
     *
     * @param {string} symbol - The stock symbol (e.g., "AAPL", "GOOGL").
     * @returns {Promise<StockData | null>} A promise that resolves to an object containing the company name and stock price,
     *          or `null` if data is unavailable or an error occurs.
     */
    StockPriceFetcher.prototype._fetchStockPriceFromAlphaVantage = function (symbol) {
        return __awaiter(this, void 0, void 0, function () {
            var url, response, data, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=".concat(symbol, "&apikey=").concat(this._apiKey);
                        return [4 /*yield*/, axios_1.default.get(url)];
                    case 1:
                        response = _a.sent();
                        data = response.data["Global Quote"];
                        // Validate response data
                        if (!data || !data["05. price"]) {
                            console.warn("No data found for ".concat(symbol));
                            return [2 /*return*/, null];
                        }
                        // Return formatted stock data
                        return [2 /*return*/, {
                                "company name": symbol,
                                price: parseFloat(data["05. price"]),
                            }];
                    case 2:
                        error_1 = _a.sent();
                        console.error("Error fetching data for ".concat(symbol, ":"), error_1);
                        return [2 /*return*/, null];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Fetches stock prices for multiple stock symbols and formats the data.
     *
     * @returns {Promise<Record<string, StockData[]>>} A promise that resolves to an object containing stock data,
     *          where the key is a timestamp and the value is an array of stock prices.
     */
    StockPriceFetcher.prototype._fetchAndFormatStockData = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stockPromises, stockData;
            var _a;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        stockPromises = this._stockSymbols.map(function (symbol) {
                            return _this._fetchStockPriceFromAlphaVantage(symbol);
                        });
                        return [4 /*yield*/, Promise.all(stockPromises)];
                    case 1:
                        stockData = _b.sent();
                        // Return formatted stock data, filtering out null values
                        return [2 /*return*/, (_a = {},
                                _a[this._timeTag] = stockData.filter(function (stock) { return stock !== null; }),
                                _a)];
                }
            });
        });
    };
    /**
     * Saves stock price data to a JSON file.
     * Merges new data with existing data if the file already exists.
     *
     * @param {Record<string, StockData[]>} formattedData - The stock price data to be saved.
     */
    StockPriceFetcher.prototype._saveStockPrices = function (formattedData) {
        return __awaiter(this, void 0, void 0, function () {
            var fileContent, fileData;
            return __generator(this, function (_a) {
                fileContent = {};
                // Check if the file already exists
                if (fs_1.default.existsSync(this._dataFilePath)) {
                    try {
                        fileData = fs_1.default.readFileSync(this._dataFilePath, "utf-8");
                        fileContent = fileData.trim() ? JSON.parse(fileData) : {};
                    }
                    catch (error) {
                        console.error("Error parsing JSON from ".concat(this._dataFilePath, ":"), error);
                    }
                    // Merge old and new data by appending new timestamps
                    fileContent = __assign(__assign({}, fileContent), formattedData);
                }
                else {
                    // If file doesn't exist, use new data as content
                    fileContent = formattedData;
                }
                // Write merged data back to the file
                fs_1.default.writeFileSync(this._dataFilePath, JSON.stringify(fileContent, null, 2));
                return [2 /*return*/];
            });
        });
    };
    // Singleton instance, initially set to null
    StockPriceFetcher._instance = null;
    return StockPriceFetcher;
}());
// Export the singleton class
exports.default = StockPriceFetcher;
