"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_FILE_PATH = exports.TIME_TAG = exports.STOCK_SYMBOLS = exports.API_KEY = void 0;
var path_1 = __importDefault(require("path"));
exports.API_KEY = "IDKPZZVM3N4664J7";
exports.STOCK_SYMBOLS = ["U", "PLTR", "UBER", "SOFI"];
exports.TIME_TAG = new Date().getTime().toString();
exports.DATA_FILE_PATH = path_1.default.resolve(__dirname, '../../data/prices.json');
