"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stockPriceFetcher_1 = __importDefault(require("./utils/stockPriceFetcher"));
stockPriceFetcher_1.default.getInstance().fetchAndSaveData();
