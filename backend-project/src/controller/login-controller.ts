import "reflect-metadata";
import { Response } from "express";
import { controller, get, post } from "../decorator";
import { getResponseData } from "../utils/util";
import { RequestWithBody } from "../interfaces/request-with-body";

@controller("/")
export class LoginController {
  private static _isLogin(req: RequestWithBody): boolean {
    return !!(req.session ? req.session.login : false);
  }

  @post("/login")
  login(req: RequestWithBody, res: Response): void {
    const isLogin = LoginController._isLogin(req);

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
  }

  @get("/logout")
  logout(req: RequestWithBody, res: Response): void {
    if (req.session) {
      req.session.login = undefined;
    }
    res.json(getResponseData(true));
  }

  @get("/")
  home(req: RequestWithBody, res: Response): void {
    const isLogin = LoginController._isLogin(req);
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
  }
}
