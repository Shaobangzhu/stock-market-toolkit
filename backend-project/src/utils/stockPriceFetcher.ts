import axios from "axios";
import fs from "fs";
import { API_KEY, STOCK_SYMBOLS, TIME_TAG, DATA_FILE_PATH } from "../constants";

interface StockData {
  "company name": string;
  price: number;
}

class StockPriceFetcher {

  private static _instance: StockPriceFetcher | null = null;
  private _apiKey: string;
  private _stockSymbols: string[];
  private _timeTag: string;
  private _dataFilePath: string;

  private constructor() {
    this._apiKey = API_KEY;
    this._stockSymbols = STOCK_SYMBOLS;
    this._timeTag = TIME_TAG;
    this._dataFilePath = DATA_FILE_PATH;
  }

  public static getInstance() {
    if(!StockPriceFetcher._instance) {
      StockPriceFetcher._instance = new StockPriceFetcher();
    }
    return StockPriceFetcher._instance;
  }

  public async fetchAndSaveData(): Promise<void> {
    const formattedData = await this._fetchAndFormatStockData();
    this._saveStockPrices(formattedData);
  }

  /**
   * Fetches the latest stock price for a given symbol from Alpha Vantage API.
   *
   * @param {string} symbol - The stock symbol (e.g., "U", "PLTR").
   * @returns {Promise<StockData | null>} A promise that resolves to an object containing the company name and stock price, or `null` if data is unavailable or an error occurs.
   *
   * @example
   * const stockData = await fetchStockPrice("AAPL");
   * console.log(stockData);
   * // Output: { "company name": "AAPL", price: 180.25 } (example data)
   *
   * @throws Logs an error message if the API request fails.
   */
  private async _fetchStockPriceFromAlphaVantage(
    symbol: string
  ): Promise<StockData | null> {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this._apiKey}`;
      const response = await axios.get(url);
      const data = response.data["Global Quote"];

      if (!data || !data["05. price"]) {
        console.warn(`No data found for ${symbol}`);
        return null;
      }

      return {
        "company name": symbol,
        price: parseFloat(data["05. price"]),
      };
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetches stock prices for multiple stock symbols and formats the data.
   *
   * @returns {Promise<Record<string, StockData[]>>} A promise that resolves to an object containing stock data,
   *          where the key is a timestamp and the value is an array of stock prices.
   *
   * @description
   * - This helper method is responsible for making API calls for all stock symbols.
   * - It filters out `null` values and returns structured data with a timestamp.
   * - This method does **not** handle file operations.
   */
  private async _fetchAndFormatStockData(): Promise<Record<string, StockData[]>> {
    const stockPromises = this._stockSymbols.map((symbol) =>
      this._fetchStockPriceFromAlphaVantage(symbol)
    );
    const stockData = await Promise.all(stockPromises);

    return {
      [this._timeTag]: stockData.filter((stock) => stock !== null),
    };
  }

  /**
   * Fetches, formats, and saves stock price data to a JSON file.
   *
   * @returns {Promise<void>} A promise that resolves once the data has been written to the file.
   *
   * @description
   * - Calls `_fetchAndFormatStockData()` to retrieve and format stock price data.
   * - Reads the existing JSON file (if available) and merges new data with existing data.
   * - Saves the updated stock data back to the file.
   * - Logs an error if reading/parsing the JSON file fails.
   */
  private async _saveStockPrices(
    formattedData: Record<string, StockData[]>
  ): Promise<void> {
    let fileContent: Record<string, StockData[]> = {};

    if (fs.existsSync(this._dataFilePath)) {
      try {
        const fileData = fs.readFileSync(this._dataFilePath, "utf-8");
        fileContent = fileData.trim() ? JSON.parse(fileData) : {};
      } catch (error) {
        console.error(`Error parsing JSON from ${this._dataFilePath}:`, error);
      }

      // Merge old and new data by appending new timestamps
      fileContent = { ...fileContent, ...formattedData };
    } else {
      fileContent = formattedData;
    }

    fs.writeFileSync(this._dataFilePath, JSON.stringify(fileContent, null, 2));
  }
}

export default StockPriceFetcher;