import "reflect-metadata";
import { Request, Response, NextFunction } from "express";
import { controller, use, get } from "../decorator";
import { getResponseData } from "../utils/util";
import StockPriceFetcher from "../utils/stockPriceFetcher";
import fs from "fs";
import path from "path";
import { DATA_FILE_PATH } from "../utils/constants";

interface RequestWithBody extends Request {
  body: {
    [key: string]: string | undefined;
  };
}

const checkLogin = (req: Request, res: Response, next: NextFunction): void => {
  const isLogin = !!(req.session ? req.session.login : false);
  if (isLogin) {
    next();
  } else {
    res.json(getResponseData(null, 'Please Log In First!'));
  }
};

@controller("/")
export class StockDataController {
  @get("/getData")
  @use(checkLogin)
  getData(req: RequestWithBody, res: Response): void {
    StockPriceFetcher.getInstance().fetchAndSaveData();
    res.json(getResponseData(true));
  }

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