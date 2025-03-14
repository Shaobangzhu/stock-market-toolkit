import StockPriceFetcher from "./utils/stockPriceFetcher";

const fetcherOne = StockPriceFetcher.getInstance();
fetcherOne.fetchAndSaveData();