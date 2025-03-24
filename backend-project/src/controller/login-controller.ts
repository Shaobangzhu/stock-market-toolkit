import "reflect-metadata";
import { Response } from "express";
import { controller, get, post } from "../decorator";
import { getResponseData } from "../utils/util";
import { RequestWithBody } from "../interfaces/request-with-body";

/**
 * This class is an Express controller using decorators (@controller, @post, @get) to register routes.
 * It handles login, logout, and the home page.
 * The session-based login logic is basic (with hardcoded password "123").
 * Responses use a utility function to maintain a consistent format.
 */
@controller("/api")
export class LoginController {
  // Private static helper to check if user is logged in
  private static _isLogin(req: RequestWithBody): boolean {
    return !!(req.session ? req.session.login : false);
  }

  @get('/isLogin')
  isLogin(req: RequestWithBody, res: Response): void {
    const isLogin = LoginController._isLogin(req);
    res.json(getResponseData(isLogin));
  }

  // Route handler for POST /login
  @post("/login")
  login(req: RequestWithBody, res: Response): void {
    const { password } = req.body;
    const isLogin = LoginController._isLogin(req);

    if (isLogin) {
      res.json(getResponseData(false, "User Already Logged In."));
    } else {
      if (password === "123" && req.session) {
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

  // Route handler for GET /logout
  @get("/logout")
  logout(req: RequestWithBody, res: Response): void {
    if (req.session) {
      req.session.login = undefined;
    }
    res.json(getResponseData(true));
  }
}
