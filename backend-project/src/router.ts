import { Router, Request, Response, NextFunction } from "express";
import StockPriceFetcher from "./utils/stockPriceFetcher";
import fs from "fs";
import path from "path";
import { getResponseData } from "./utils/util";

interface RequestWithBody extends Request {
  body: {
    [key: string]: string | undefined;
  };
}

const checkLogin = (req: Request, res: Response, next: NextFunction) => {
  const isLogin = req.session ? req.session.login : false;
  if (isLogin) {
    next();
  } else {
    res.json(getResponseData(null, 'Please Log In First!'));
  }
};

const router = Router();

router.get("/", (req: RequestWithBody, res: Response) => {
  const isLogin = req.session ? req.session.login : false;
  if (isLogin) {
    res.send(`
        <html>
            <body>
                <a href='/getData'>Get Data</a>
                <a href='/showData'>Show Data</a>
                <a href='/logout'>Log Out</a>
            </body>
        </html>
    `);
  } else {
    res.send(`
        <html>
            <body>
                <form method="post" action="/login">
                    <input type="password" name="password" />
                    <button>Log In</button>
                </form>
            </body>
        </html>
    `);
  }
});

router.get("/logout", (req: RequestWithBody, res: Response) => {
  if (req.session) {
    req.session.login = undefined;
  }
  res.json(getResponseData(true));
});

router.post("/login", (req: RequestWithBody, res: Response) => {
  const isLogin = req.session ? req.session.login : false;

  if (isLogin) {
    res.json(getResponseData(false, "User Already Logged In."));
  } else {
    if (req.body.password === "123" && req.session) {
      if (req.session) {
        req.session.login = true;
        res.json(getResponseData(true));
      } else {
        res.json(getResponseData(false, "Log In Failure!"));
      }
    } else {
        res.json(getResponseData(false, "Log In Failure!"));
    }
  }
});

router.get("/getData", checkLogin, (req: RequestWithBody, res: Response) => {
  StockPriceFetcher.getInstance().fetchAndSaveData();
  res.json(getResponseData(true));
});

router.get("/showData", checkLogin, (req: RequestWithBody, res: Response) => {
  try {
    const position = path.resolve(__dirname, "../data/prices.json");
    const result = fs.readFileSync(position, "utf8");
    res.json(getResponseData(JSON.parse(result)));
  } catch (e) {
    res.json(getResponseData(false, "Data NOT Exist!"));
  }
});

export default router;