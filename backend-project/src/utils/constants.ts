import path from 'path';

export const STOCK_SYMBOLS = ["U", "PLTR", "UBER", "SOFI"];

export const TIME_TAG = new Date().getTime().toString();

export const DATA_FILE_PATH = path.resolve(__dirname, '../../data/prices.json');