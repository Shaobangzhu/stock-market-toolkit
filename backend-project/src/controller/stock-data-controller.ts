import "reflect-metadata";
import { Request, Response, NextFunction } from "express";
import { controller, use, get } from "../decorator";
import { getResponseData } from "../utils/util";
import StockPriceFetcher from "../utils/stockPriceFetcher";
import fs from "fs";
import path from "path";
import { DATA_FILE_PATH } from "../utils/constants";
import { RequestWithBody } from "../interfaces/request-with-body"; 

// Middleware to check if the user is logged in (based on session)
const checkLogin = (req: Request, res: Response, next: NextFunction): void => {
  const isLogin = !!(req.session ? req.session.login : false);
  if (isLogin) {
    next();
  } else {
    res.json(getResponseData(null, 'Please Log In First!'));
  }
};

/**
 * getData(): Fetches stock price data and saves it to disk.
 * showData(): Reads and returns saved stock data from a file.
 */
@controller("/")
export class StockDataController {

  // GET /getData
  // Middleware @use(checkLogin) ensures only logged-in users can access
  @get("/getData")
  @use(checkLogin)
  getData(req: RequestWithBody, res: Response): void {
    StockPriceFetcher.getInstance().fetchAndSaveData();
    res.json(getResponseData(true));
  }

  // GET /showData
  // Middleware @use(checkLogin) ensures only logged-in users can access
  @get("/showData")
  @use(checkLogin)
  showData(req: RequestWithBody, res: Response): void {
    try {
        const position = path.resolve(__dirname, DATA_FILE_PATH);
        const result = fs.readFileSync(position, "utf8");
        res.json(getResponseData(JSON.parse(result)));
      } catch (e) {
        res.json(getResponseData(false, "Data NOT Exist!"));
      }
  }
}