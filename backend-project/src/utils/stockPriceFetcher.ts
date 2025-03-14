import axios from "axios";
import fs from "fs";
import { API_KEY, STOCK_SYMBOLS, TIME_TAG, DATA_FILE_PATH } from "../constants";

// Interface defining the structure of stock data
interface StockData {
  "company name": string;
  price: number;
}

/**
 * Singleton class responsible for fetching stock prices from Alpha Vantage API
 * and saving the data to a JSON file.
 */
class StockPriceFetcher {
  // Singleton instance, initially set to null
  private static _instance: StockPriceFetcher | null = null;

  // Private instance variables for API credentials and file handling
  private _apiKey: string;
  private _stockSymbols: string[];
  private _timeTag: string;
  private _dataFilePath: string;

  /**
   * Private constructor to prevent direct instantiation.
   * Initializes the required configuration values from constants.
   */
  private constructor() {
    this._apiKey = API_KEY;
    this._stockSymbols = STOCK_SYMBOLS;
    this._timeTag = TIME_TAG;
    this._dataFilePath = DATA_FILE_PATH;
  }

  /**
   * Returns the singleton instance of `StockPriceFetcher`.
   * If the instance does not exist, it is created.
   */
  public static getInstance(): StockPriceFetcher {
    if(!StockPriceFetcher._instance) {
      StockPriceFetcher._instance = new StockPriceFetcher();
    }
    return StockPriceFetcher._instance;
  }

  /**
   * Fetches stock price data from the API, formats it, and saves it to a JSON file.
   */
  public async fetchAndSaveData(): Promise<void> {
    const formattedData = await this._fetchAndFormatStockData();
    this._saveStockPrices(formattedData);
  }

  /**
   * Fetches the latest stock price for a given symbol from Alpha Vantage API.
   *
   * @param {string} symbol - The stock symbol (e.g., "AAPL", "GOOGL").
   * @returns {Promise<StockData | null>} A promise that resolves to an object containing the company name and stock price,
   *          or `null` if data is unavailable or an error occurs.
   */
  private async _fetchStockPriceFromAlphaVantage(
    symbol: string
  ): Promise<StockData | null> {
    try {
      // Construct API request URL
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this._apiKey}`;
      const response = await axios.get(url);
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
   */
  private async _fetchAndFormatStockData(): Promise<Record<string, StockData[]>> {
    // Fetch stock data for each symbol asynchronously
    const stockPromises = this._stockSymbols.map((symbol) =>
      this._fetchStockPriceFromAlphaVantage(symbol)
    );
    const stockData = await Promise.all(stockPromises);

    // Return formatted stock data, filtering out null values
    return {
      [this._timeTag]: stockData.filter((stock) => stock !== null),
    };
  }

  /**
   * Saves stock price data to a JSON file.
   * Merges new data with existing data if the file already exists.
   *
   * @param {Record<string, StockData[]>} formattedData - The stock price data to be saved.
   */
  private async _saveStockPrices(
    formattedData: Record<string, StockData[]>
  ): Promise<void> {
    let fileContent: Record<string, StockData[]> = {};

    // Check if the file already exists
    if (fs.existsSync(this._dataFilePath)) {
      try {
        // Read existing file content
        const fileData = fs.readFileSync(this._dataFilePath, "utf-8");
        fileContent = fileData.trim() ? JSON.parse(fileData) : {};
      } catch (error) {
        console.error(`Error parsing JSON from ${this._dataFilePath}:`, error);
      }

      // Merge old and new data by appending new timestamps
      fileContent = { ...fileContent, ...formattedData };
    } else {
      // If file doesn't exist, use new data as content
      fileContent = formattedData;
    }
     // Write merged data back to the file
    fs.writeFileSync(this._dataFilePath, JSON.stringify(fileContent, null, 2));
  }
}

// Export the singleton class
export default StockPriceFetcher;