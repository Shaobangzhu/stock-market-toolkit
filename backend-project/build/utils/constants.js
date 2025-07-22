"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SINGLE_STOCK_VOLUME_DATA_FILE_PATH = exports.STOCK_PRICE_DATA_FILE_PATH = exports.TIME_TAG = exports.STOCK_SYMBOLS = exports.SINGLE_STOCK_SYMBOL = void 0;
var path_1 = __importDefault(require("path"));
exports.SINGLE_STOCK_SYMBOL = "OPEN";
exports.STOCK_SYMBOLS = ["U", "PLTR", "UBER", "SOFI"];
exports.TIME_TAG = new Date().getTime().toString();
exports.STOCK_PRICE_DATA_FILE_PATH = path_1.default.resolve(__dirname, '../../data/prices.json');
exports.SINGLE_STOCK_VOLUME_DATA_FILE_PATH = path_1.default.resolve(__dirname, '../../data/volume.json');
