"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stockPriceFetcher_1 = __importDefault(require("./utils/stockPriceFetcher"));
const router = (0, express_1.Router)();
router.get('/', (req, res) => {
    res.send('hello world');
});
router.get('/getData', (req, res) => {
    stockPriceFetcher_1.default.getInstance().fetchAndSaveData();
    res.send('Get data success!');
});
exports.default = router;
