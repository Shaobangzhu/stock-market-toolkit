import axios from "axios";

const API_KEY = "IDKPZZVM3N4664J7";
const STOCK_SYMBOLS = ["U", "PLTR", "UBER", "SPY"];
const TIME_TAG = new Date().toISOString();

interface StockData {
    "company name": string;
    price: number;
}

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
            price: parseFloat(data["05. price"])
        };
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        return null;
    }
}

async function getStockPrices(): Promise<void> {
    const stockPromises = STOCK_SYMBOLS.map(symbol => fetchStockPrice(symbol));
    const stockData = await Promise.all(stockPromises);

    const formattedData = {
        [TIME_TAG]: stockData.filter(stock => stock !== null),
    };

    console.log(JSON.stringify(formattedData, null, 2));
}

getStockPrices();