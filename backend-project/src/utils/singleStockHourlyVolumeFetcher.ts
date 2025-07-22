import axios from "axios";
import fs from "fs";
import path from "path";
import {
  SINGLE_STOCK_SYMBOL,
  SINGLE_STOCK_VOLUME_DATA_FILE_PATH,
} from "./constants";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const SYMBOL = SINGLE_STOCK_SYMBOL;
const INTERVAL = "30min";
const FILE_PATH = SINGLE_STOCK_VOLUME_DATA_FILE_PATH;

/**
 * Fetches 30 mins interval intraday volume data for OPEN,
 * groups by day, and saves it to volume.json with date as key
 */
export async function singleStockHourlyVolumeFetcher(): Promise<{
  updated: string;
  latestPoints: any[];
}> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${SYMBOL}&interval=${INTERVAL}&apikey=${API_KEY}&outputsize=full`;
  const response = await axios.get(url);
  const data = response.data as Record<string, any>;
  const rawData = data[`Time Series (${INTERVAL})`] as Record<
    string,
    {
      "1. open": string;
      "2. high": string;
      "3. low": string;
      "4. close": string;
      "5. volume": string;
    }
  >;

  if (!rawData) throw new Error("No intraday data returned from API");

  const groupedData: Record<string, any[]> = {};

  for (const [timestamp, value] of Object.entries(rawData)) {
    const date = new Date(`${timestamp}Z`);
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const timeStr = date.toISOString().slice(11, 16); // HH:mm

    if (!groupedData[dateStr]) groupedData[dateStr] = [];

    groupedData[dateStr].push({
      time: timeStr,
      open: parseFloat(value["1. open"]),
      high: parseFloat(value["2. high"]),
      low: parseFloat(value["3. low"]),
      close: parseFloat(value["4. close"]),
      volume: parseInt(value["5. volume"]),
    });
  }

  // Sort each day's array by time ascending
  for (const date in groupedData) {
    groupedData[date].sort((a, b) => a.time.localeCompare(b.time));
  }

  // Merge into existing file
  let finalContent: Record<string, any[]> = {};
  if (fs.existsSync(FILE_PATH)) {
    try {
      const existing = fs.readFileSync(FILE_PATH, "utf-8");
      finalContent = JSON.parse(existing);
    } catch (err) {
      console.warn("Could not parse existing volume.json. Overwriting...");
    }
  }

  // Overwrite data of the same day
  finalContent = { ...finalContent, ...groupedData };

  fs.writeFileSync(FILE_PATH, JSON.stringify(finalContent, null, 2));

  // Return metadata
  const latestDate = Object.keys(groupedData).sort().pop()!;
  return {
    updated: latestDate,
    latestPoints: groupedData[latestDate],
  };
}
