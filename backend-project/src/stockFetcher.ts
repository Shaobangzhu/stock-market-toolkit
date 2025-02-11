import axios from "axios";
import fs from "fs";

import { API_KEY, STOCK_SYMBOLS, TIME_TAG, DATA_FILE_PATH } from "./constants";

interface StockData {
  "company name": string;
  price: number;
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
async function fetchStockPrice(symbol: string): Promise<StockData | null> {
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`;
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
 * @returns {Promise<void>} A promise that resolves when all stock prices are fetched and logged to the console.
 *
 * @description
 * - This function retrieves stock prices for all symbols listed in `STOCK_SYMBOLS` using `fetchStockPrice()`.
 * - It waits for all API calls to complete using `Promise.all()`.
 * - The resulting data is filtered to remove `null` values and is formatted into an object with a timestamp (`TIME_TAG`) as the key.
 * - The formatted stock data is then logged in JSON format.
 *
 * @example
 * await getStockPrices();
 * // Output:
 * // {
 * //   "2025-02-09T12:34:56.789Z": [
 * //     { "company name": "AAPL", "price": 180 },
 * //     { "company name": "GOOGL", "price": 2900 },
 * //     { "company name": "MSFT", "price": 320 },
 * //     { "company name": "AMZN", "price": 3400 }
 * //   ]
 * // }
 */
async function getStockPrices(): Promise<void> {
  const stockPromises = STOCK_SYMBOLS.map((symbol) => fetchStockPrice(symbol));
  const stockData = await Promise.all(stockPromises);

  const formattedData = {
    [TIME_TAG]: stockData.filter((stock) => stock !== null),
  };

  let fileContent: Record<string, StockData[]> = {};

  if (fs.existsSync(DATA_FILE_PATH)) {
    try {
      const fileData = fs.readFileSync(DATA_FILE_PATH, "utf-8");
      fileContent = fileData.trim() ? JSON.parse(fileData) : {};
    } catch (error) {
      console.error(`Error parsing JSON from ${DATA_FILE_PATH}:`, error);
    }

    // **Merge old and new data** by appending new timestamps
    fileContent = { ...fileContent, ...formattedData };
  } else {
    fileContent = formattedData;
  }
  // DEBUG: console.log(JSON.stringify(formattedData, null, 2));

  saveData(JSON.stringify(fileContent, null, 2));
}

/**
 * Saves the structured data (fetched by fetchStockPrice) into a JSON file for future use.
 * @param content json format which is stringified
 */
function saveData(content: string) {
  fs.writeFileSync(DATA_FILE_PATH, content);
}

getStockPrices();