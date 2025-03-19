"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
/**
 * Singleton class responsible for fetching stock prices from Alpha Vantage API
 * and saving the data to a JSON file.
 */
class StockPriceFetcher {
    /**
     * Private constructor to prevent direct instantiation.
     * Initializes the required configuration values from constants.
     */
    constructor() {
        this._apiKey = constants_1.API_KEY;
        this._stockSymbols = constants_1.STOCK_SYMBOLS;
        this._timeTag = constants_1.TIME_TAG;
        this._dataFilePath = constants_1.DATA_FILE_PATH;
    }
    /**
     * Returns the singleton instance of `StockPriceFetcher`.
     * If the instance does not exist, it is created.
     */
    static getInstance() {
        if (!StockPriceFetcher._instance) {
            StockPriceFetcher._instance = new StockPriceFetcher();
        }
        return StockPriceFetcher._instance;
    }
    /**
     * Fetches stock price data from the API, formats it, and saves it to a JSON file.
     */
    fetchAndSaveData() {
        return __awaiter(this, void 0, void 0, function* () {
            const formattedData = yield this._fetchAndFormatStockData();
            this._saveStockPrices(formattedData);
        });
    }
    /**
     * Fetches the latest stock price for a given symbol from Alpha Vantage API.
     *
     * @param {string} symbol - The stock symbol (e.g., "AAPL", "GOOGL").
     * @returns {Promise<StockData | null>} A promise that resolves to an object containing the company name and stock price,
     *          or `null` if data is unavailable or an error occurs.
     */
    _fetchStockPriceFromAlphaVantage(symbol) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Construct API request URL
                const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this._apiKey}`;
                const response = yield axios_1.default.get(url);
                const data = response.data["Global Quote"];
                // Validate response data
                if (!data || !data["05. price"]) {
                    console.warn(`No data found for ${symbol}`);
                    return null;
                }
                // Return formatted stock data
                return {
                    "company name": symbol,
                    price: parseFloat(data["05. price"]),
                };
            }
            catch (error) {
                console.error(`Error fetching data for ${symbol}:`, error);
                return null;
            }
        });
    }
    /**
     * Fetches stock prices for multiple stock symbols and formats the data.
     *
     * @returns {Promise<Record<string, StockData[]>>} A promise that resolves to an object containing stock data,
     *          where the key is a timestamp and the value is an array of stock prices.
     */
    _fetchAndFormatStockData() {
        return __awaiter(this, void 0, void 0, function* () {
            // Fetch stock data for each symbol asynchronously
            const stockPromises = this._stockSymbols.map((symbol) => this._fetchStockPriceFromAlphaVantage(symbol));
            const stockData = yield Promise.all(stockPromises);
            // Return formatted stock data, filtering out null values
            return {
                [this._timeTag]: stockData.filter((stock) => stock !== null),
            };
        });
    }
    /**
     * Saves stock price data to a JSON file.
     * Merges new data with existing data if the file already exists.
     *
     * @param {Record<string, StockData[]>} formattedData - The stock price data to be saved.
     */
    _saveStockPrices(formattedData) {
        return __awaiter(this, void 0, void 0, function* () {
            let fileContent = {};
            // Check if the file already exists
            if (fs_1.default.existsSync(this._dataFilePath)) {
                try {
                    // Read existing file content
                    const fileData = fs_1.default.readFileSync(this._dataFilePath, "utf-8");
                    fileContent = fileData.trim() ? JSON.parse(fileData) : {};
                }
                catch (error) {
                    console.error(`Error parsing JSON from ${this._dataFilePath}:`, error);
                }
                // Merge old and new data by appending new timestamps
                fileContent = Object.assign(Object.assign({}, fileContent), formattedData);
            }
            else {
                // If file doesn't exist, use new data as content
                fileContent = formattedData;
            }
            // Write merged data back to the file
            fs_1.default.writeFileSync(this._dataFilePath, JSON.stringify(fileContent, null, 2));
        });
    }
}
// Singleton instance, initially set to null
StockPriceFetcher._instance = null;
// Export the singleton class
exports.default = StockPriceFetcher;
