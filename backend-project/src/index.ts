import { API_KEY, STOCK_SYMBOLS, TIME_TAG, DATA_FILE_PATH } from "./constants";
import StockPriceFetcher from "./utils/stockPriceFetcher";

const operation = new StockPriceFetcher(API_KEY, STOCK_SYMBOLS, TIME_TAG, DATA_FILE_PATH);
operation.formatAndSaveStockPrices();