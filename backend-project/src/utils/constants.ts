import path from 'path';

export const SINGLE_STOCK_SYMBOL = "FIG";

export const STOCK_SYMBOLS = ["U", "PLTR", "UBER", "SOFI"];

export const TIME_TAG = new Date().getTime().toString();

export const STOCK_PRICE_DATA_FILE_PATH = path.resolve(__dirname, '../../data/prices.json');

export const SINGLE_STOCK_VOLUME_DATA_FILE_PATH = path.resolve(__dirname, '../../data/volume.json');